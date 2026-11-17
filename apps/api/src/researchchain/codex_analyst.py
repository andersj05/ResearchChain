"""Isolated Codex app-server session for one owner-configured research step.

The loopback provider relays the model's authenticated response items to Codex
and handles its single read-only follow-up tool. Only the worker can perform inference.
Codex gets a one-session loopback capability, never the owner's plan credentials.
"""

import hmac
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

from pydantic import Field

from researchchain.compiler import ExecutionStopped
from researchchain.graph import StrictModel
from researchchain.research_models import StoredResearchResult
from researchchain.sec_financials import SecLookup
from researchchain.web_research import WebResearch

type AnalystPass = Callable[
    [list[StoredResearchResult], dict[str, Any]], tuple[StoredResearchResult, dict[str, Any]]
]


class ResearchLead(StrictModel):
    lead: str = Field(min_length=1, max_length=1500)
    findings: str = Field(min_length=1, max_length=6000)
    sec_lookup: SecLookup | None = None


def follow_tool(*, sec_financials: bool = True) -> dict[str, Any]:
    schema = ResearchLead.model_json_schema()
    schema["required"] = list(schema["properties"])
    lookup = schema["properties"]["sec_lookup"]
    lookup.pop("default", None)
    if not sec_financials:
        schema["properties"]["sec_lookup"] = {"type": "null"}
        schema.pop("$defs", None)
    return {
        "type": "function",
        "name": "pursue_lead",
        "description": "Record findings and return observed sources for the next lead. "
        "Request an SEC lookup only if enabled in the step instructions.",
        "inputSchema": schema,
    }


def tool_call(response: dict[str, Any]) -> dict[str, Any] | None:
    calls = []
    items = response.get("output")
    if not isinstance(items, list):
        raise ValueError("Codex received invalid output metadata.")
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("Codex received an invalid output item.")
        kind = item.get("type")
        if (
            kind == "function_call"
            and item.get("name") == "pursue_lead"
            and item.get("namespace") == "research"
        ):
            if not (
                isinstance(item.get("call_id"), str)
                and item["call_id"]
                and isinstance(item.get("arguments"), str)
            ):
                raise ValueError("The analyst returned an incomplete tool call.")
            calls.append(item)
        elif kind not in {"message", "web_search_call", "reasoning"}:
            raise ValueError("The model requested a capability outside this analyst step.")
    if len(calls) > 1:
        raise ValueError("An analyst pass can pursue one next lead.")
    return calls[0] if calls else None


def retain_observations(result: StoredResearchResult, history: list[StoredResearchResult]) -> None:
    """Keep observed provenance available to the next workflow node after synthesis."""
    passes = [*history, result]
    traces = [p.web_research for p in passes if p.web_research]
    if traces:
        sources = {}
        for trace in traces:
            for source in trace.sources:
                if source.url not in sources or source.cited:
                    sources[source.url] = source
        actions = [action for trace in traces for action in trace.actions]
        result.web_research = WebResearch(
            observed_at=traces[-1].observed_at,
            sources=sorted(sources.values(), key=lambda source: not source.cited)[:200],
            actions=actions[:100],
            feeds=list(dict.fromkeys(feed for trace in traces for feed in trace.feeds)),
            truncated=any(trace.truncated for trace in traces)
            or len(sources) > 200
            or len(actions) > 100,
        )
    if result.sec_financials is None:
        result.sec_financials = next(
            (p.sec_financials for p in reversed(history) if p.sec_financials), None
        )


class Session:
    def __init__(self, model: str, passes: int, step: AnalystPass):
        self.model, self.passes, self.step = model, passes, step
        self.token = secrets.token_urlsafe(32)
        self.history: list[StoredResearchResult] = []
        self.call_id = ""
        self.received = False
        self.completed = False
        self.error: Exception | None = None
        self.last_activity = time.monotonic()

    def respond(self, body: dict[str, Any]) -> bytes:
        if body.get("model") != self.model or not isinstance(body.get("input"), list):
            raise ValueError("Codex did not request the pinned analyst model.")
        if len(self.history) >= self.passes or (self.history and not self.received):
            raise ValueError("Codex requested an unexpected repeat analyst pass.")
        if self.history and not any(
            isinstance(item, dict)
            and item.get("type") == "function_call_output"
            and item.get("call_id") == self.call_id
            for item in body["input"]
        ):
            raise ValueError("Codex did not include the completed research tool receipt.")
        self.received = False
        result, response = self.step(self.history.copy(), body)
        self.history.append(result)
        call = tool_call(response)
        self.call_id = call["call_id"] if call else ""
        events: list[dict[str, Any]] = [
            {
                "type": "response.created",
                "response": {**response, "status": "in_progress", "output": []},
            }
        ]
        events.extend(
            {"type": "response.output_item.done", "output_index": i, "item": item}
            for i, item in enumerate(response["output"])
        )
        events.append({"type": "response.completed", "response": response})
        self.last_activity = time.monotonic()
        return b"".join(b"data: " + json.dumps(event).encode() + b"\n\n" for event in events)


def _handler(session: Session) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        timeout = 2

        def log_message(self, format: str, *args: Any) -> None:
            pass

        def do_POST(self) -> None:
            if (
                self.path != "/v1/responses"
                or self.headers.get("Origin") is not None
                or not hmac.compare_digest(
                    self.headers.get("Authorization", "").encode(),
                    ("Bearer " + session.token).encode(),
                )
            ):
                self.send_error(403)
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 8 * 1024 * 1024:
                    raise ValueError("The Codex request exceeds the local session limit.")
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    raise ValueError("Invalid Codex request.")
                stream = session.respond(body)
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(len(stream)))
                self.end_headers()
                self.wfile.write(stream)
            except Exception as error:
                session.error = error
                self.close_connection = True

    return Handler


def _protocol(process: subprocess.Popen[bytes], cwd: Path, session: Session) -> None:
    assert process.stdin and process.stdout

    def send(message: dict[str, Any]) -> None:
        assert process.stdin
        process.stdin.write(json.dumps(message).encode() + b"\n")
        process.stdin.flush()

    def request(identifier: int, method: str, params: dict[str, Any]) -> None:
        send({"method": method, "id": identifier, "params": params})

    try:
        request(
            1,
            "initialize",
            {
                "clientInfo": {"name": "researchchain", "title": "ResearchChain", "version": "1.0"},
                "capabilities": {"experimentalApi": True},
            },
        )
        while line := process.stdout.readline(2 * 1024 * 1024):
            if not line.endswith(b"\n"):
                raise ValueError("Codex returned an oversized protocol event.")
            message = json.loads(line)
            method, identifier = message.get("method"), message.get("id")
            params = message.get("params", {})
            if "error" in message:
                raise ValueError(
                    "Codex rejected the analyst configuration. Check the installed CLI version."
                )
            if method is None and identifier == 1:
                send({"method": "initialized"})
                request(
                    2,
                    "thread/start",
                    {
                        "cwd": str(cwd),
                        "model": session.model,
                        "modelProvider": "researchchain",
                        "ephemeral": True,
                        "approvalPolicy": "never",
                        "sandbox": "read-only",
                        "baseInstructions": "Complete the pinned research task using its receipts.",
                        "dynamicTools": [
                            {
                                "type": "namespace",
                                "name": "research",
                                "description": "ResearchChain analyst tools",
                                "tools": [follow_tool()],
                            }
                        ],
                    },
                )
            elif method is None and identifier == 2:
                request(
                    3,
                    "turn/start",
                    {
                        "threadId": message["result"]["thread"]["id"],
                        "input": [{"type": "text", "text": "Run the pinned analyst step."}],
                    },
                )
            elif method == "item/tool/call":
                current = session.history[-1] if session.history else None
                if not (
                    current
                    and current.next_lead
                    and params.get("tool") == "pursue_lead"
                    and params.get("callId") == session.call_id
                    and not session.received
                    and params.get("namespace") == "research"
                    and params.get("arguments", {}).get("lead") == current.next_lead
                ):
                    raise ValueError("Codex requested an unapproved research tool.")
                session.received = True
                send(
                    {
                        "id": identifier,
                        "result": {
                            "success": True,
                            "contentItems": [
                                {"type": "inputText", "text": current.model_dump_json()}
                            ],
                        },
                    }
                )
            elif method == "turn/completed":
                if (
                    params["turn"]["status"] != "completed"
                    or not session.history
                    or session.history[-1].next_lead
                ):
                    raise ValueError("Codex ended before the analyst completed a final pass.")
                session.completed = True
                return
            elif method and identifier is not None:
                raise ValueError("Codex requested an unavailable interactive capability.")
        raise ValueError("The Codex analyst process exited before completing the turn.")
    except Exception as error:
        if session.error is None:
            session.error = error


@contextmanager
def _process_tree(process: subprocess.Popen[bytes]) -> Iterator[None]:
    if sys.platform == "win32":
        import win32api  # type: ignore[import-untyped]
        import win32job  # type: ignore[import-untyped]

        job = win32job.CreateJobObject(None, "")
        info = win32job.QueryInformationJobObject(job, win32job.JobObjectExtendedLimitInformation)
        info["BasicLimitInformation"]["LimitFlags"] |= win32job.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        win32job.SetInformationJobObject(job, win32job.JobObjectExtendedLimitInformation, info)
        try:
            handle = win32api.OpenProcess(0x0101, False, process.pid)
            try:
                win32job.AssignProcessToJobObject(job, handle)
            finally:
                handle.Close()
            yield
        finally:
            job.Close()
    else:
        import signal

        try:
            yield
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def run_codex_analyst(
    model: str, passes: int, step: AnalystPass, guard: Callable[[], None]
) -> StoredResearchResult:
    executable = shutil.which("codex")
    if not executable:
        raise ExecutionStopped(
            "Install the Codex CLI on the worker PATH or disable Codex analyst on this step.",
            "failed",
        )
    session = Session(model, passes, step)
    try:
        with tempfile.TemporaryDirectory(prefix="researchchain-analyst-") as private:
            directory = Path(private)
            work = directory / "work"
            home = directory / "codex"
            work.mkdir()
            home.mkdir()
            with HTTPServer(("127.0.0.1", 0), _handler(session)) as server:
                server.timeout = 0.15
                config = {
                    "model_provider": "researchchain",
                    "model_providers.researchchain.name": "ResearchChain",
                    "model_providers.researchchain.base_url": f"http://127.0.0.1:{server.server_port}/v1",
                    "model_providers.researchchain.env_key": "RESEARCHCHAIN_SESSION",
                    "model_providers.researchchain.wire_api": "responses",
                    "model_providers.researchchain.supports_websockets": False,
                    "model_providers.researchchain.request_max_retries": 0,
                    "model_providers.researchchain.stream_max_retries": 0,
                    "model_providers.researchchain.stream_idle_timeout_ms": 3_600_000,
                    "features.shell_tool": False,
                    "features.view_image": False,
                    "web_search": "disabled",
                    "analytics.enabled": False,
                }
                args = [executable, "app-server", "--listen", "stdio://"]
                for name, value in config.items():
                    args.extend(["-c", name + "=" + json.dumps(value)])
                env = {
                    k: os.environ[k]
                    for k in ("SystemRoot", "WINDIR", "PATH", "TEMP", "TMP")
                    if k in os.environ
                }
                env.update(
                    CODEX_HOME=str(home),
                    HOME=private,
                    USERPROFILE=private,
                    APPDATA=private,
                    LOCALAPPDATA=private,
                    RESEARCHCHAIN_SESSION=session.token,
                )
                guard()
                with (
                    subprocess.Popen(
                        args,
                        cwd=work,
                        env=env,
                        stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.DEVNULL,
                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                        start_new_session=os.name != "nt",
                    ) as process,
                    _process_tree(process),
                ):
                    reader = threading.Thread(
                        target=_protocol, args=(process, work, session), daemon=True
                    )
                    reader.start()
                    try:
                        while not session.completed:
                            if session.error:
                                raise session.error
                            guard()
                            if time.monotonic() - session.last_activity > 45:
                                raise ValueError(
                                    "Timed out waiting for the local Codex analyst harness."
                                )
                            server.handle_request()
                    finally:
                        assert process.stdin
                        process.stdin.close()
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait()
                        reader.join(timeout=5)
    except (ValueError, OSError, KeyError, IndexError) as error:
        # OS errors can include private temporary paths. Only expose our own protocol diagnostics.
        reason = str(error) if type(error) is ValueError else "The local Codex session failed."
        raise ExecutionStopped(reason, "failed") from None
    return session.history[-1]
