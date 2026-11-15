"""Bounded, verified HTTP exchanges with no destination or transport-error logging."""

import asyncio
import logging
import ssl
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from threading import RLock

import httpx

from researchchain.models import Health
from researchchain.monitor_models import AlertEvent, MonitorSettings

DEADLINE_SECONDS = 10
_LOG_LOCK = RLock()


@dataclass(frozen=True)
class Delivery:
    accepted: bool
    retry_seconds: int | None = None


@contextmanager
def quiet_transport() -> Iterator[None]:
    # Webhook paths/query strings can be credentials. This standalone operator
    # process emits its own content-free diagnostics, never HTTP library logs.
    with _LOG_LOCK:
        previous = logging.root.manager.disable
        logging.disable(logging.CRITICAL)
        try:
            yield
        finally:
            logging.disable(previous)


def retry_seconds(value: str | None, now: datetime) -> int | None:
    if value is None or len(value) > 64:
        return None
    try:
        if value.isascii() and value.isdecimal():
            seconds = int(value)
        else:
            parsed = parsedate_to_datetime(value)
            if parsed.tzinfo is None:
                return None
            seconds = int((parsed - now).total_seconds())
        return max(0, min(3600, seconds))
    except (ValueError, TypeError, OverflowError):
        return None


class MonitorHTTP:
    def __init__(
        self,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        certificate_context: ssl.SSLContext | None = None,
    ):
        # Injection supports synthetic receivers; the CLI has no TLS-disable flag.
        self.transport = transport
        self.certificate_context = certificate_context

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=5,
            trust_env=False,
            follow_redirects=False,
            verify=self.certificate_context if self.certificate_context is not None else True,
            transport=self.transport,
        )

    async def _ready(self, origin: str) -> bool:
        async with asyncio.timeout(DEADLINE_SECONDS), self._client() as client:
            async with client.stream(
                "GET", origin + "/api/health", headers={"Accept-Encoding": "identity"}
            ) as response:
                if response.status_code != 200:
                    return False
                data = bytearray()
                async for chunk in response.aiter_raw(chunk_size=1024):
                    data.extend(chunk)
                    if len(data) > 4096:
                        return False
                Health.model_validate_json(data)
                return True

    def ready(self, origin: str) -> bool:
        with quiet_transport():
            try:
                return asyncio.run(self._ready(origin))
            except Exception:
                return False

    async def _send(self, settings: MonitorSettings, event: AlertEvent) -> Delivery:
        assert settings.webhook is not None
        body = event.model_dump_json().encode()
        if len(body) > 16384:
            return Delivery(False)
        headers = {
            "Content-Type": "application/json",
            "Accept-Encoding": "identity",
            "Idempotency-Key": str(event.id),
        }
        if settings.bearer is not None:
            headers["Authorization"] = "Bearer " + settings.bearer.get_secret_value()
        async with asyncio.timeout(DEADLINE_SECONDS), self._client() as client:
            async with client.stream(
                "POST", settings.webhook.get_secret_value(), content=body, headers=headers
            ) as response:
                # Never download a webhook response body or follow a redirect.
                return Delivery(
                    accepted=200 <= response.status_code < 300,
                    retry_seconds=retry_seconds(
                        response.headers.get("Retry-After"), datetime.now(UTC)
                    ),
                )

    def send(self, settings: MonitorSettings, event: AlertEvent) -> Delivery:
        with quiet_transport():
            try:
                return asyncio.run(self._send(settings, event))
            except Exception:
                return Delivery(False)
