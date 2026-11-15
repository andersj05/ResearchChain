"""Plan-backed Responses client: no API keys, implicit retries or billing fallback."""

import asyncio
import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx

from researchchain.providers.chatgpt_auth import (
    RESOURCE,
    ChatGPTAuth,
    error_for_code,
    provider_error,
    safe_identifier,
)
from researchchain.providers.credentials import ConnectionError


@dataclass(frozen=True)
class ModelChoice:
    slug: str
    display_name: str


@dataclass(frozen=True)
class Completion:
    model: str
    text: str
    response_id: str
    usage: dict[str, Any]
    returned_model: str | None = None


class ChatGPTPlan:
    def __init__(self, auth: ChatGPTAuth):
        self.auth = auth

    def models(self) -> tuple[str, list[ModelChoice]]:
        account, token = self.auth.access()
        body = self.auth._json(
            "GET", f"{RESOURCE}/models", headers={"Authorization": f"Bearer {token}"}
        )
        try:
            models = body["models"]
            if not isinstance(models, list):
                raise ValueError
            choices = []
            for model in models:
                if model.get("visibility") == "list":
                    slug, name = model["slug"], model["display_name"]
                    if not isinstance(slug, str) or not isinstance(name, str):
                        raise ValueError
                    choices.append(ModelChoice(slug, name))
            return account, choices
        except (KeyError, TypeError, ValueError, AttributeError):
            raise ConnectionError("OpenAI returned an invalid model catalog.") from None

    async def complete(
        self,
        model: str,
        prompt: str,
        *,
        account_id: str,
        timeout_seconds: float = 45,
        output_chars: int = 2000,
        transport: httpx.AsyncBaseTransport | None = None,
        instructions: str | None = None,
        input_items: list[dict[str, Any]] | None = None,
        output_schema: dict[str, Any] | None = None,
        on_delta: Callable[[str], None] | None = None,
    ) -> Completion:
        if not 0 < timeout_seconds <= 120 or not 0 < output_chars <= 200000:
            raise ValueError("A bounded time and output allowance are required.")
        # Refresh is serialized and has its own network timeout. Never silently use
        # a different account after model selection or a pinned research manifest.
        account, token = await asyncio.to_thread(self.auth.access)
        if account != account_id:
            raise ConnectionError("The active ChatGPT account changed. Select its model again.")
        body: dict[str, Any] = {
            "model": model,
            "input": input_items
            if input_items is not None
            else [{"role": "user", "content": prompt}],
            "store": False,
            "stream": True,
        }
        if instructions is not None:
            body["instructions"] = instructions
        if output_schema is not None:
            body["text"] = {
                "format": {
                    "type": "json_schema",
                    "name": "research_result",
                    "strict": True,
                    "schema": output_schema,
                }
            }
        text = ""
        size = 0
        pending = b""
        try:
            async with (
                asyncio.timeout(timeout_seconds),
                httpx.AsyncClient(
                    timeout=httpx.Timeout(timeout_seconds, connect=min(10, timeout_seconds)),
                    follow_redirects=False,
                    trust_env=False,
                    transport=transport,
                ) as client,
            ):
                async with client.stream(
                    "POST",
                    f"{RESOURCE}/responses",
                    headers={"Authorization": f"Bearer {token}"},
                    json=body,
                ) as response:
                    if response.status_code != 200:
                        # Error bodies may contain arbitrary provider diagnostics;
                        # only their shape, code, parameter and request ID are surfaced.
                        error_body = b""
                        async for chunk in response.aiter_bytes():
                            error_body += chunk
                            if len(error_body) > 256 * 1024:
                                raise ConnectionError(
                                    "OpenAI returned an oversized error response."
                                )
                        raise provider_error(
                            httpx.Response(
                                response.status_code,
                                headers=response.headers,
                                content=error_body,
                            )
                        )
                    content_type = response.headers.get("content-type")
                    # The direct plan route can omit this header. Accept only
                    # valid Responses SSE events below, never plain JSON/HTML.
                    if content_type and not content_type.startswith("text/event-stream"):
                        raise ConnectionError("OpenAI did not return a Responses event stream.")
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > 2 * 1024 * 1024:
                            raise ConnectionError(
                                "Response exceeded the connection check's size limit."
                            )
                        pending += chunk
                        while b"\n" in pending:
                            line, pending = pending.split(b"\n", 1)
                            if len(line) > 256 * 1024:
                                raise ConnectionError("OpenAI returned an oversized stream event.")
                            line = line.rstrip(b"\r")
                            if not line.startswith(b"data:"):
                                continue
                            data = line[5:].strip()
                            if data == b"[DONE]":
                                continue
                            try:
                                event = json.loads(data)
                                if not isinstance(event, dict):
                                    raise ValueError
                            except (ValueError, UnicodeError):
                                raise ConnectionError(
                                    "OpenAI returned an invalid stream event."
                                ) from None
                            kind = event.get("type")
                            if kind == "response.output_text.delta":
                                delta = event.get("delta")
                                if not isinstance(delta, str):
                                    raise ConnectionError("OpenAI returned an invalid text delta.")
                                text += delta
                                if on_delta:
                                    on_delta(text[:output_chars])
                                if len(text) > output_chars:
                                    raise ConnectionError(
                                        "Response exceeded the connection check's output limit."
                                    )
                            elif kind in {"error", "response.failed"}:
                                response_body = event.get("response")
                                response_error = (
                                    response_body.get("error")
                                    if isinstance(response_body, dict)
                                    else None
                                )
                                error = event.get("error") or response_error or event
                                if not isinstance(error, dict):
                                    error = {}
                                raise error_for_code(
                                    safe_identifier(error.get("code")),
                                    param=safe_identifier(error.get("param")),
                                    status=200,
                                    shape="stream_error",
                                    request_id=safe_identifier(
                                        response.headers.get("x-request-id")
                                        or response.headers.get("openai-request-id")
                                    ),
                                )
                            elif kind == "response.incomplete":
                                raise ConnectionError(
                                    "The ChatGPT response was incomplete; the check did not pass."
                                )
                            elif kind == "response.completed":
                                result = event.get("response")
                                if (
                                    not isinstance(result, dict)
                                    or result.get("status") != "completed"
                                ):
                                    raise ConnectionError(
                                        "OpenAI returned an invalid completion event."
                                    )
                                response_id = result.get("id")
                                if not isinstance(response_id, str) or not response_id:
                                    raise ConnectionError(
                                        "The completed response had no identifier."
                                    )
                                usage = result.get("usage") or {}
                                if not isinstance(usage, dict):
                                    raise ConnectionError(
                                        "The completed response had invalid usage."
                                    )
                                return Completion(
                                    model,
                                    text,
                                    response_id,
                                    usage,
                                    result.get("model")
                                    if isinstance(result.get("model"), str)
                                    else None,
                                )
                        if len(pending) > 256 * 1024:
                            raise ConnectionError("OpenAI returned an oversized stream event.")
        except (httpx.HTTPError, TimeoutError):
            raise ConnectionError(
                "ChatGPT connection check timed out or was interrupted. It did not pass."
            ) from None
        raise ConnectionError(
            "The stream ended without response.completed; the check did not pass."
        )
