"""Durable, budgeted model attempts with no implicit retries after uncertain outcomes."""

import asyncio
import json
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import UUID, uuid4

import httpx
from psycopg import Connection
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb
from pydantic import ValidationError

from researchchain.analyst_workspace import PythonRequest, run_python
from researchchain.artifacts import put_artifact, read_content
from researchchain.codex_analyst import (
    AnalystPass,
    ResearchLead,
    retain_observations,
    run_codex_analyst,
    tool_call,
)
from researchchain.compiler import ExecutionStopped
from researchchain.controls import ExecutionControl
from researchchain.evidence import read_evidence
from researchchain.graph import ResearchConfig, Workflow, WorkflowNode
from researchchain.providers.chatgpt_auth import PLAN_SCOPE, ChatGPTAuth
from researchchain.providers.chatgpt_plan import ChatGPTPlan, Completion
from researchchain.providers.credentials import ConnectionError, CredentialStore
from researchchain.research_models import (
    EvidenceSnapshot,
    ModelAttempt,
    ProviderAccount,
    ProviderModel,
    ProviderStatus,
    ResearchManifest,
    ResearchResult,
    ResearchWithLookup,
    StoredResearchResult,
    WorkspaceActivity,
)
from researchchain.research_prompt import (
    ANALYST_VERSION,
    PROMPT_VERSION,
    WORKSPACE_VERSION,
    PreparedResearch,
    json_bytes,
    prepare_analyst_pass,
    prepare_research,
    prompt_hashes,
    sec_prompt_hash,
    validate_result,
    web_prompt_hash,
)
from researchchain.research_workspace import (
    attach_chart,
    generated_files,
    load_files,
    save_files,
    staged_files,
)
from researchchain.sec_financials import SEC_TOOL_VERSION, lookup_sec_financials
from researchchain.usage_models import UsageError
from researchchain.usage_store import admit_request
from researchchain.web_research import WebSearchProgress

RESEARCH_COMPILER_VERSION = "research-0.3.0"


class ResearchProvider(Protocol):
    def run_analyst(
        self,
        model: str,
        passes: int,
        step: AnalystPass,
        guard: Callable[[], None],
        *,
        workspace: bool = False,
    ) -> StoredResearchResult: ...
    def pin_account(self, account_id: str, models: set[str]) -> ProviderAccount: ...
    def status(self) -> ProviderStatus: ...
    async def complete(
        self,
        manifest: ResearchManifest,
        prepared: PreparedResearch,
        on_delta: Callable[[str | WebSearchProgress], None],
    ) -> Completion: ...


class ChatGPTResearchProvider:
    run_analyst = staticmethod(run_codex_analyst)

    def __init__(self, store: CredentialStore | None = None):
        self.store = store or CredentialStore()

    def status(self) -> ProviderStatus:
        with self.store.locked():
            saved = self.store.read()
            accounts = [
                ProviderAccount(
                    id=account.client_id,
                    label=account.label,
                    email=account.email,
                    active=account.client_id == saved.active_client_id,
                    signed_in=account.tokens is not None,
                    plan_enabled=bool(
                        account.tokens
                        and PLAN_SCOPE in account.tokens.scopes
                        and "resource.invoke" in account.tokens.scopes
                    ),
                )
                for account in saved.accounts.values()
            ]
        result = ProviderStatus(accounts=accounts)
        if any(account.active and account.plan_enabled for account in accounts):
            try:
                with httpx.Client(timeout=15, follow_redirects=False, trust_env=False) as client:
                    account_id, models = ChatGPTPlan(ChatGPTAuth(self.store, client)).models()
                if account_id != saved.active_client_id:
                    raise ConnectionError("The active account changed. Refresh its models.")
                result.models = [
                    ProviderModel(slug=model.slug, display_name=model.display_name)
                    for model in models
                ]
            except ConnectionError as error:
                result.error = str(error)
        return result

    def pin_account(self, account_id: str, models: set[str]) -> ProviderAccount:
        status = self.status()
        if status.error:
            raise ConnectionError(status.error)
        account = next((item for item in status.accounts if item.id == account_id), None)
        if not account or not account.active or not account.plan_enabled:
            raise ConnectionError("Select the connected ChatGPT account before starting research.")
        unavailable = models.difference(item.slug for item in status.models)
        if unavailable:
            raise ConnectionError(
                "Choose an available model for this account. Unavailable: "
                + ", ".join(sorted(unavailable))
            )
        return account

    async def complete(
        self,
        manifest: ResearchManifest,
        prepared: PreparedResearch,
        on_delta: Callable[[str | WebSearchProgress], None],
    ) -> Completion:
        limits = manifest.settings.limits
        with httpx.Client(timeout=15, follow_redirects=False, trust_env=False) as client:
            provider = ChatGPTPlan(ChatGPTAuth(self.store, client))
            return await provider.complete(
                prepared.model,
                "",
                account_id=manifest.account_id,
                timeout_seconds=limits.max_response_seconds,
                output_chars=limits.max_output_characters,
                input_items=prepared.input_items,
                instructions=prepared.instructions,
                output_schema=prepared.schema,
                on_delta=on_delta,
                on_web_progress=on_delta,
                web_search=prepared.web_search,
                analyst_options=prepared.analyst_options,
            )


def make_manifest(
    conn: Connection[DictRow],
    workflow: Workflow,
    revision_id: UUID,
    evidence_ids: list[UUID],
    account: ProviderAccount,
) -> ResearchManifest:
    assert workflow.research is not None
    snapshots = []
    for evidence_id in evidence_ids:
        source = read_evidence(conn, evidence_id)
        snapshots.append(
            EvidenceSnapshot(
                evidence_id=source.id,
                original=source.content_hash,
                representation=source.representation,
                availability=source.availability,
                publisher=source.publisher,
                source_url=str(source.source_url) if source.source_url else None,
                as_of_date=source.as_of_date.isoformat() if source.as_of_date else None,
            )
        )
    configs = [
        node.config
        for graph in [workflow, *workflow.subgraphs]
        for node in graph.nodes
        if isinstance(node.config, ResearchConfig)
    ]
    hashes = prompt_hashes(include_custom=any(config.stage == "custom" for config in configs))
    web = any(config.web_search for config in configs)
    sec = any(config.sec_financials for config in configs)
    return ResearchManifest(
        settings=workflow.research,
        account_id=account.id,
        account_label=account.label,
        workflow_revision_id=revision_id,
        prompt_versions={
            stage: "custom-1" if stage == "custom" else PROMPT_VERSION for stage in hashes
        },
        prompt_hashes=hashes,
        evidence=snapshots,
        created_at=datetime.now(UTC),
        tool_config={
            **({"analyst_version": ANALYST_VERSION} if any(c.analyst for c in configs) else {}),
            **(
                {"workspace_version": WORKSPACE_VERSION}
                if any(c.analyst and c.analyst.workspace for c in configs)
                else {}
            ),
            "version": "evidence-packet-1",
            "allowed": ["read_pinned_evidence"],
            "calls_per_attempt": 1,
            "remote_tools": (["web_search"] if web else []) + (["sec_financials"] if sec else []),
            "web_prompt_hash": web_prompt_hash() if web else None,
            **(
                {"auto_web_prompt_hash": web_prompt_hash("auto")}
                if any(config.web_search == "auto" for config in configs)
                else {}
            ),
            **(
                {
                    "sec_version": SEC_TOOL_VERSION,
                    "sec_prompt_hash": sec_prompt_hash(),
                    "sec_lookups_per_enabled_step": 1,
                }
                if sec
                else {}
            ),
            "web_action_limit": "provider-managed; bounded by request time and output",
            "automatic_billing_fallback": False,
            "token_limit": (
                "track_usage_without_token_cutoff"
                if workflow.research.limits.max_total_tokens == "as_needed"
                else "stop_before_next_call_after_reported_usage"
            ),
            "workspace_request_allowance": "current_policy_before_each_model_request",
            "spend_control": "included_plan; disable credits in ChatGPT app usage settings",
        },
    )


def read_manifest(conn: Connection[DictRow], run_id: UUID) -> ResearchManifest | None:
    row = conn.execute(
        "SELECT manifest FROM run_research_manifests WHERE run_id = %s", (run_id,)
    ).fetchone()
    return ResearchManifest.model_validate(row["manifest"]) if row else None


def read_attempts(conn: Connection[DictRow], run_id: UUID) -> list[ModelAttempt]:
    rows = conn.execute(
        "SELECT a.*, d.policy_revision AS admission_policy_revision FROM research_attempts a "
        "LEFT JOIN model_request_admissions d ON d.id = a.id "
        "WHERE a.run_id = %s ORDER BY a.created_at, a.id",
        (run_id,),
    )
    return [
        ModelAttempt.model_validate({key: value for key, value in row.items() if key != "run_id"})
        for row in rows
    ]


class ResearchExecutor:
    def __init__(
        self,
        conn: Connection[DictRow],
        run_id: UUID,
        brief: str,
        manifest: ResearchManifest,
        control: ExecutionControl,
        provider: ResearchProvider,
    ):
        self.conn, self.run_id, self.brief = conn, run_id, brief
        self.manifest, self.control, self.provider = manifest, control, provider
        # Structured forks may run concurrently; model attempts for one run are
        # serialized so returned usage is charged before another call is admitted.
        self.model_lock = threading.Lock()

    def __call__(self, node: WorkflowNode, path: str, context: str, feedback: str) -> str:
        with self.model_lock:
            self.control.guard(path, False)
            return self.execute(node, path, context, feedback)

    def reserve(
        self, node: WorkflowNode, path: str, model: str
    ) -> tuple[UUID, ResearchResult | None]:
        assert isinstance(node.config, ResearchConfig)
        limits = self.manifest.settings.limits
        with self.control.lock:
            previous = self.conn.execute(
                "SELECT * FROM research_attempts WHERE run_id = %s AND path = %s",
                (self.run_id, path),
            ).fetchone()
            if previous:
                if previous["status"] == "completed":
                    return previous["id"], StoredResearchResult.model_validate(previous["result"])
                if previous["status"] in {"preparing", "requesting"}:
                    reason = (
                        "The prior model attempt has an uncertain outcome. It will not be resent. "
                        "Start a new run after review."
                    )
                    self.conn.execute(
                        "UPDATE research_attempts SET status = 'unknown', reason = %s, "
                        "finished_at = clock_timestamp() WHERE id = %s",
                        (reason, previous["id"]),
                    )
                else:
                    reason = previous["reason"] or "The prior model attempt did not complete."
                raise ExecutionStopped(reason, "failed")
            attempts = self.conn.execute(
                "SELECT count(*) AS calls, "
                "COALESCE(sum(input_tokens + output_tokens), 0) AS tokens, "
                "bool_or(status = 'completed' AND (input_tokens IS NULL OR output_tokens IS NULL)) "
                "AS missing_usage FROM research_attempts WHERE run_id = %s",
                (self.run_id,),
            ).fetchone()
            assert attempts
            if attempts["calls"] >= limits.max_model_calls:
                raise ExecutionStopped("Model-call budget reached.")
            if attempts["calls"] >= limits.max_tool_calls:
                raise ExecutionStopped("Evidence-tool call budget reached.")
            token_limit = limits.max_total_tokens
            if token_limit != "as_needed":
                if attempts["missing_usage"]:
                    raise ExecutionStopped(
                        "Provider usage is unavailable; another request cannot be admitted "
                        "within the token budget."
                    )
                if attempts["tokens"] >= token_limit:
                    raise ExecutionStopped(
                        f"Reported token budget reached. Used {attempts['tokens']:,} of "
                        f"{token_limit:,} tokens before the next model call."
                    )
            attempt_id = uuid4()
            self.conn.execute(
                "INSERT INTO research_attempts (id, run_id, path, stage, model, status) "
                "VALUES (%s, %s, %s, %s, %s, 'preparing')",
                (attempt_id, self.run_id, path, node.config.stage, model),
            )
            return attempt_id, None

    async def controlled(
        self,
        prepared: PreparedResearch,
        on_delta: Callable[[str | WebSearchProgress], None],
        path: str,
    ) -> Completion:
        pending_web: WebSearchProgress | None = None

        def observe(update: str | WebSearchProgress) -> None:
            nonlocal pending_web
            if isinstance(update, WebSearchProgress):
                pending_web = update
            else:
                on_delta(update)

        task = asyncio.create_task(self.provider.complete(self.manifest, prepared, observe))
        try:
            while not task.done():
                await asyncio.wait([task], timeout=0.2)
                if pending_web is not None:
                    on_delta(pending_web)
                    pending_web = None
                if not task.done():
                    self.control.guard(path, False)
            return await task
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            if pending_web is not None:
                on_delta(pending_web)

    def execute(self, node: WorkflowNode, path: str, context: str, feedback: str) -> str:
        assert isinstance(node.config, ResearchConfig)
        if (
            any(
                prompt_hashes(include_custom=True).get(stage) != value
                for stage, value in self.manifest.prompt_hashes.items()
            )
            or self.manifest.prompt_hashes.get(node.config.stage)
            != prompt_hashes(include_custom=True).get(node.config.stage)
            or self.manifest.prompt_versions.get(node.config.stage) != node.config.prompt_version
        ):
            raise ExecutionStopped(
                "This run requires its pinned research prompt implementation.", "failed"
            )
        if node.config.web_search and (
            "web_search" not in self.manifest.tool_config.get("remote_tools", [])
            or self.manifest.tool_config.get(
                "auto_web_prompt_hash" if node.config.web_search == "auto" else "web_prompt_hash"
            )
            != web_prompt_hash(node.config.web_search)
        ):
            raise ExecutionStopped(
                "This run requires its pinned web research implementation.", "failed"
            )
        if node.config.sec_financials and (
            "sec_financials" not in self.manifest.tool_config.get("remote_tools", [])
            or self.manifest.tool_config.get("sec_version") != SEC_TOOL_VERSION
            or self.manifest.tool_config.get("sec_prompt_hash") != sec_prompt_hash()
        ):
            raise ExecutionStopped(
                "This run requires its pinned SEC lookup implementation.", "failed"
            )
        model = node.config.model or self.manifest.settings.model
        if node.config.analyst:
            if self.manifest.tool_config.get("analyst_version") != ANALYST_VERSION:
                raise ExecutionStopped(
                    "This run requires its pinned analyst implementation.", "failed"
                )
            workspace = node.config.analyst.workspace
            if (
                workspace
                and self.manifest.tool_config.get("workspace_version") != WORKSPACE_VERSION
            ):
                raise ExecutionStopped("This run requires its pinned Python workspace.", "failed")

            def step(
                history: list[StoredResearchResult], body: dict[str, Any]
            ) -> tuple[StoredResearchResult, dict[str, Any]]:
                pass_path = path if not history else f"{path}/analyst-pass-{len(history) + 1}"
                result = self.execute_pass(node, pass_path, context, feedback, model, history, body)
                with self.control.lock:
                    row = self.conn.execute(
                        "SELECT response_artifact_id FROM research_attempts "
                        "WHERE run_id=%s AND path=%s",
                        (self.run_id, pass_path),
                    ).fetchone()
                    assert row
                    receipt = json.loads(read_content(self.conn, row["response_artifact_id"]))
                return result, receipt["analyst_response"]

            result = self.provider.run_analyst(
                model,
                node.config.analyst.max_passes,
                step,
                lambda: self.control.guard(path, False),
                workspace=workspace,
            )
            return result.model_dump_json()
        return self.execute_pass(node, path, context, feedback, model, []).model_dump_json()

    def execute_pass(
        self,
        node: WorkflowNode,
        path: str,
        context: str,
        feedback: str,
        model: str,
        history: list[StoredResearchResult],
        body: dict[str, Any] | None = None,
    ) -> StoredResearchResult:
        assert isinstance(node.config, ResearchConfig)
        attempt_id, previous = self.reserve(node, path, model)
        if previous:
            return StoredResearchResult.model_validate(previous)
        partial = ""
        completion: Completion | None = None
        interim: StoredResearchResult | None = None
        exports: dict[str, bytes] = {}
        last_update = 0.0
        workspace = bool(node.config.analyst and node.config.analyst.workspace)

        def progress(update: str | WebSearchProgress) -> None:
            nonlocal partial, last_update
            if isinstance(update, WebSearchProgress):
                with self.control.lock:
                    self.conn.execute(
                        "UPDATE research_attempts SET web_actions_completed = %s WHERE id = %s",
                        (update.completed_actions, attempt_id),
                    )
                return
            partial = update
            if time.monotonic() - last_update >= 0.5:
                with self.control.lock:
                    self.conn.execute(
                        "UPDATE research_attempts SET output_characters = %s WHERE id = %s",
                        (len(update), attempt_id),
                    )
                last_update = time.monotonic()

        try:
            self.control.guard(path, False)
            with self.control.lock:
                prepared = prepare_research(
                    self.conn,
                    self.manifest,
                    node.config.stage,
                    self.brief,
                    context,
                    feedback,
                    node.instructions,
                    model=model,
                    web_search=node.config.web_search,
                    sec_financials=node.config.sec_financials,
                )
                available = (
                    generated_files(self.conn, self.run_id, prepared, history) if workspace else {}
                )
                inputs = staged_files(prepared, available) if workspace else {}
                if node.config.analyst:
                    assert body is not None
                    prepare_analyst_pass(prepared, node.config.analyst, history, body, list(inputs))
                    if workspace:
                        attach_chart(
                            self.conn,
                            prepared,
                            history,
                            self.manifest.settings.limits.max_input_bytes,
                        )
                payload = json_bytes(prepared.request_body())
                if (
                    node.config.analyst
                    and len(payload) > self.manifest.settings.limits.max_input_bytes
                ):
                    raise ValueError(
                        "The analyst history and evidence exceed the input byte limit."
                    )
                original = put_artifact(self.conn, payload, f"research-request-{attempt_id}.json")
                self.conn.execute(
                    "UPDATE research_attempts SET input_artifact_id = %s, input_bytes = %s, "
                    "status = 'requesting' WHERE id = %s",
                    (original.id, len(payload), attempt_id),
                )
            self.control.guard(path, False)
            with self.control.lock:
                admit_request(self.conn, attempt_id, "research")
            # Admission may wait behind another process. Recheck cancellation and
            # elapsed time before starting provider work; keep the consumed slot.
            self.control.guard(path, False)
            completion = asyncio.run(self.controlled(prepared, progress, path))
            partial = completion.text
            lead = None
            python = None
            if node.config.analyst:
                if completion.analyst_response is None:
                    raise ValueError("The analyst provider did not return a Codex response.")
                call = tool_call(completion.analyst_response, workspace=workspace)
                if call is not None:
                    if len(call["arguments"]) > self.manifest.settings.limits.max_output_characters:
                        raise ValueError("The analyst tool call exceeds the response output limit.")
                    if len(history) + 1 >= node.config.analyst.max_passes:
                        raise ValueError("The analyst requested a follow-up after its final pass.")
                    if call["name"] == "run_python":
                        python = PythonRequest.model_validate_json(call["arguments"])
                        lead = ResearchLead(lead=python.purpose, findings=python.purpose)
                    else:
                        lead = ResearchLead.model_validate_json(call["arguments"])
                    if lead.sec_lookup and not node.config.sec_financials:
                        raise ValueError("The analyst requested an unavailable SEC lookup.")
            if lead:
                validated: ResearchResult = ResearchWithLookup(
                    schema_version="research-result-1",
                    stage="custom",
                    conclusion=lead.findings,
                    revision_summary=lead.lead,
                    unresolved_questions=[lead.lead],
                    evidence_requests=[],
                    hypotheses=[],
                    limitations=["Interim analyst findings."],
                    sec_lookup=lead.sec_lookup,
                )
                partial = json.dumps(call)
            else:
                validated = validate_result(completion.text, node.config.stage, prepared)
            result = StoredResearchResult(
                **validated.model_dump(exclude={"sec_lookup"}),
                next_lead=lead.lead if lead else None,
            )
            if node.config.web_search:
                trace = completion.web_research
                if (
                    (
                        node.config.web_search is True
                        and not lead
                        and not any(p.web_research for p in history)
                    )
                    or (trace and trace.actions)
                ) and not (trace and any(action.status == "completed" for action in trace.actions)):
                    raise ValueError(
                        "The provider did not complete a web search. "
                        "No researched result was accepted."
                    )
                if trace and trace.actions:
                    result.web_research = trace
            if isinstance(validated, ResearchWithLookup) and validated.sec_lookup:
                self.control.guard(path, False)
                result.sec_financials = asyncio.run(lookup_sec_financials(validated.sec_lookup))
                self.control.guard(path, False)
            if python:
                activity = WorkspaceActivity(summary=python.purpose, status="requested")
                result.workspace_activity = activity
                interim = result
                with self.control.lock, self.conn.transaction():
                    activity.files = save_files(self.conn, {"analysis.py": python.script.encode()})
                    self.conn.execute(
                        "UPDATE research_attempts SET result = %s WHERE id = %s",
                        (Jsonb(result.model_dump(mode="json")), attempt_id),
                    )
                with self.control.lock:
                    files = load_files(self.conn, inputs)
                execution = run_python(python, files, lambda: self.control.guard(path, False))
                activity.status = "completed" if execution.exit_code == 0 else "failed"
                activity.output = execution.output
                exports = execution.files
            if history and not lead:
                retain_observations(result, history)
            if workspace and not lead:
                result.workspace_files = list(available.values())
            self.finish(
                attempt_id, "completed", partial, completion, result=result, exports=exports
            )
            return result
        except ExecutionStopped as error:
            self.finish(
                attempt_id,
                error.status,
                partial,
                completion,
                reason=str(error),
                result=interim,
            )
            raise
        except UsageError as error:
            status = "limited" if error.status == 429 else "failed"
            self.finish(attempt_id, status, partial, completion, reason=str(error))
            raise ExecutionStopped(str(error), status) from None
        except (ConnectionError, ValueError) as error:
            reason = (
                "Model output failed the research schema or source checks; "
                "inspect the saved response."
                if isinstance(error, ValidationError)
                else str(error)
            )
            self.finish(
                attempt_id, "failed", partial, completion, reason=reason[:1000], result=interim
            )
            raise ExecutionStopped(reason[:1000], "failed") from None

    def finish(
        self,
        attempt_id: UUID,
        status: str,
        text: str,
        completion: Completion | None,
        *,
        reason: str | None = None,
        result: ResearchResult | None = None,
        exports: dict[str, bytes] | None = None,
    ) -> None:
        def tokens(name: str) -> int | None:
            value = completion.usage.get(name) if completion else None
            return (
                value
                if isinstance(value, int) and not isinstance(value, bool) and value >= 0
                else None
            )

        output_characters = len(text)
        with self.control.lock, self.conn.transaction():
            if isinstance(result, StoredResearchResult) and result.workspace_activity:
                activity = result.workspace_activity
                if exports:
                    activity.files = save_files(self.conn, exports)
                if status != "completed":
                    activity.status = "failed"
                    activity.output = reason or "The Python action stopped."
            sec = result.sec_financials if isinstance(result, StoredResearchResult) else None
            if completion and (completion.web_research or sec or completion.analyst_response):
                text = json_bytes(
                    {
                        "model_text": text,
                        **(
                            {"analyst_response": completion.analyst_response}
                            if completion.analyst_response
                            else {}
                        ),
                        **(
                            {"web_research": completion.web_research.model_dump(mode="json")}
                            if completion.web_research
                            else {}
                        ),
                        **({"sec_financials": sec.model_dump(mode="json")} if sec else {}),
                    }
                ).decode()
            original = (
                put_artifact(self.conn, text.encode("utf-8"), f"research-response-{attempt_id}.txt")
                if text
                else None
            )
            self.conn.execute(
                "UPDATE research_attempts SET status = %s, response_artifact_id = %s, result = %s, "
                "reason = %s, output_characters = %s, response_id = %s, returned_model = %s, "
                "input_tokens = %s, output_tokens = %s, "
                "finished_at = clock_timestamp() WHERE id = %s",
                (
                    status,
                    original.id if original else None,
                    Jsonb(result.model_dump(mode="json")) if result else None,
                    reason,
                    output_characters,
                    completion.response_id if completion else None,
                    completion.returned_model if completion else None,
                    tokens("input_tokens"),
                    tokens("output_tokens"),
                    attempt_id,
                ),
            )
