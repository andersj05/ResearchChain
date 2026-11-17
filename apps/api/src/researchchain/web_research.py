"""Provider-observed web activity, separate from model-authored research claims."""

from datetime import UTC, datetime
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import Field

from researchchain.graph import StrictModel


class WebSource(StrictModel):
    url: str
    title: str
    cited: bool = False


class WebAction(StrictModel):
    id: str
    action: str
    status: str
    queries: list[str]
    url: str | None = None


class WebResearch(StrictModel):
    version: Literal["web-research-1"] = "web-research-1"
    observed_at: datetime
    actions: list[WebAction] = Field(max_length=100)
    sources: list[WebSource] = Field(max_length=200)
    truncated: bool = False
    feeds: list[Literal["oai-finance", "oai-weather", "oai-sports"]] = Field(
        default_factory=list, exclude_if=lambda feeds: not feeds
    )


def safe_web_url(value: Any) -> str | None:
    if not isinstance(value, str) or len(value) > 4000 or any(ord(c) < 33 for c in value):
        return None
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme in {"https", "http"}
            and parsed.hostname
            and not parsed.username
            and not parsed.password
        ):
            return value
    except ValueError:
        pass
    return None


def web_request_options(mode: bool | Literal["auto"] = True) -> dict[str, Any]:
    # SIWC does not support max_tool_calls. Bound requests in the executor and
    # time/output in the transport; report hosted actions without claiming a cap.
    return {
        "tools": [{"type": "web_search"}],
        "include": ["web_search_call.action.sources"],
        "tool_choice": "auto" if mode == "auto" else {"type": "web_search"},
    }


def clean_text(value: str, limit: int) -> str:
    return value.replace("\x00", "").encode("utf-8", errors="replace").decode()[:limit]


def read_web_research(response: dict[str, Any]) -> WebResearch:
    actions: list[WebAction] = []
    sources: dict[str, WebSource] = {}
    truncated = False
    feeds: list[Literal["oai-finance", "oai-weather", "oai-sports"]] = []

    def source(item: Any, cited: bool = False) -> None:
        nonlocal truncated
        if not isinstance(item, dict) or not (url := safe_web_url(item.get("url"))):
            return
        if url not in sources:
            if len(sources) >= 200:
                truncated = True
                return
            title = item.get("title")
            sources[url] = WebSource(
                url=url, title=clean_text(title, 1000) if isinstance(title, str) else url
            )
        if cited:
            sources[url].cited = True
            if isinstance(item.get("title"), str):
                sources[url].title = clean_text(item["title"], 1000)

    output = response.get("output", [])
    for item in output if isinstance(output, list) else []:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "web_search_call":
            action = item.get("action") or {}
            if not isinstance(action, dict):
                action = {}
            queries = action.get("queries", [action.get("query")])
            if not isinstance(queries, list):
                queries = []
            if len(actions) < 100:
                actions.append(
                    WebAction(
                        id=clean_text(str(item.get("id", "")), 200),
                        action=clean_text(str(action.get("type", "unknown")), 100),
                        status=clean_text(str(item.get("status", "unknown")), 100),
                        queries=[clean_text(q, 2000) for q in queries[:20] if isinstance(q, str)],
                        url=safe_web_url(action.get("url")),
                    )
                )
            else:
                truncated = True
            for entry in (
                action.get("sources", []) if isinstance(action.get("sources"), list) else []
            ):
                if isinstance(entry, dict):
                    label = entry.get("name") if entry.get("type") == "api" else entry.get("url")
                    for feed in ("oai-finance", "oai-weather", "oai-sports"):
                        if label == feed and feed not in feeds:
                            feeds.append(feed)
                source(entry)
        for content in item.get("content", []) if isinstance(item.get("content"), list) else []:
            if isinstance(content, dict):
                for annotation in (
                    content.get("annotations", [])
                    if isinstance(content.get("annotations"), list)
                    else []
                ):
                    if isinstance(annotation, dict) and annotation.get("type") == "url_citation":
                        source(annotation, cited=True)
    return WebResearch(
        observed_at=datetime.now(UTC),
        actions=actions,
        sources=list(sources.values()),
        truncated=truncated,
        feeds=feeds,
    )
