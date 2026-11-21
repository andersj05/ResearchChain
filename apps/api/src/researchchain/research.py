"""Durable, budgeted model attempts with no implicit retries after uncertain outcomes."""

import asyncio
import json
import threading
import time
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
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
from researchchain.controls import ExecutionControl, set_terminal
from researchchain.evidence import read_evidence
from researchchain.graph import (
    ModelOverride,
    ModelSelection,
    ResearchConfig,
    Workflow,
    WorkflowNode,
    resolve_model,
)
from researchchain.providers.chatgpt_auth import PLAN_SCOPE, ChatGPTAuth
from researchchain.providers.chatgpt_plan import ChatGPTPlan, Completion
from researchchain.providers.credentials import ConnectionError, CredentialStore
from researchchain.research_directions import DIRECTIONS_VERSION, pin_directions
from researchchain.research_models import (
    EvidenceSnapshot,
    ModelAttempt,
    OwnerDirection,
    ProviderAccount,
    ProviderModel,
    ProviderStatus,
    ResearchManifest,
    ResearchResult,
    ResearchWithLookup,
    StoredResearchResult,
    TeamAssignment,
    WorkspaceActivity,
)
from researchchain.research_prompt import (
    ANALYST_VERSION,
    MODEL_SETTINGS_VERSION,
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
from researchchain.research_session_report import (
    REPORT_VERSION,
    confirm_editor_report,
    editor_output,
    prepare_editor,
)
from researchchain.research_sessions import SESSION_VERSION
from researchchain.research_swarm import (
    SWARM_VERSION,
    SwarmRequest,
    lead_output_characters,
    prepare_delegation,
    run_swarm,
    swarm_prompt_hash,
)
from researchchain.research_team import (
    TEAM_VERSION,
    member_output,
    plan_result,
    prepare_assignment,
    prepare_plan,
    team_prompt_hash,
)
from researchchain.research_workspace import (
    attach_chart,
    generated_files,
    load_files,
    save_files,
    staged_files,
    team_handoff,
    team_workspace_files,
)
from researchchain.sec_financials import SEC_TOOL_VERSION, lookup_sec_financials
from researchchain.usage_models import UsageError
from researchchain.usage_store import admit_request
from researchchain.web_research import WebSearchProgress

RESEARCH_COMPILER_VERSION = "research-0.3.0"
UNCERTAIN = (
    "The prior model attempt has an uncertain outcome. It will not be resent. "
    "Start a new run after review."
)


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
    def pin_account(self, account_id: str, selections: set[ModelSelection]) -> ProviderAccount: ...
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
                    ProviderModel.model_validate(model, from_attributes=True) for model in models
                ]
            except ConnectionError as error:
                result.error = str(error)
        return result

    def pin_account(self, account_id: str, selections: set[ModelSelection]) -> ProviderAccount:
        status = self.status()
        if status.error:
            raise ConnectionError(status.error)
        account = next((item for item in status.accounts if item.id == account_id), None)
        if not account or not account.active or not account.plan_enabled:
            raise ConnectionError("Select the connected ChatGPT account before starting research.")
        catalog = {item.slug: item for item in status.models}
        unavailable = {item.model for item in selections}.difference(catalog)
        if unavailable:
            raise ConnectionError(
                "Choose an available model for this account. Unavailable: "
                + ", ".join(sorted(unavailable))
            )
        for selected in sorted(
            selections, key=lambda s: (s.model, s.reasoning_effort or "", s.verbosity or "")
        ):
            model = catalog[selected.model]
            effort = selected.reasoning_effort
            if (
                effort is not None
                and effort != "model_default"
                and effort not in model.reasoning_efforts
            ):
                allowed = ", ".join(["model default", *model.reasoning_efforts])
                raise ConnectionError(
                    f"{model.slug} does not support reasoning effort '{effort}'. Choose {allowed}."
                )
            if selected.verbosity not in (None, "model_default") and not model.supports_verbosity:
                raise ConnectionError(
                    f"{model.slug} does not support response verbosity '{selected.verbosity}'. "
                    "Choose model default for verbosity."
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
                request_body=prepared.request_body(),
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
            "model_settings_version": MODEL_SETTINGS_VERSION,
            **(
                {"swarm_version": SWARM_VERSION, "swarm_prompt_hash": swarm_prompt_hash()}
                if any(c.team and c.team.swarm for c in configs)
                else {}
            ),
            **(
                {"team_version": TEAM_VERSION, "team_prompt_hash": team_prompt_hash()}
                if any(c.team for c in configs)
                else {}
            ),
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


def fence_uncertain_effects(conn: Connection[DictRow], run_id: UUID) -> None:
    """Check all assignments under the run lock before dispatch or direct recovery."""
    unsafe = conn.execute(
        "SELECT 1 FROM research_attempts WHERE run_id = %s "
        "AND status IN ('preparing', 'requesting', 'unknown') LIMIT 1",
        (run_id,),
    ).fetchone()
    if unsafe:
        with conn.transaction():
            conn.execute(
                "UPDATE research_attempts SET status = 'unknown', reason = %s, "
                "finished_at = clock_timestamp() WHERE run_id = %s "
                "AND status IN ('preparing', 'requesting')",
                (UNCERTAIN, run_id),
            )
            set_terminal(conn, run_id, "failed", UNCERTAIN)


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
        # Older workflows run one model step at a time. Team researchers may overlap
        # when the owner permits as-needed tokens. With a fixed token budget the
        # preceding response's actual usage must be known before the next admission.
        self.model_lock = threading.Lock()
        self.max_sessions = (
            control.budgets.max_concurrency
            if manifest.settings.limits.max_total_tokens == "as_needed"
            else 1
        )
        self.sessions = threading.BoundedSemaphore(self.max_sessions)
        self.swarm_pool = (
            ThreadPoolExecutor(max_workers=self.max_sessions)
            if manifest.tool_config.get("swarm_version") == SWARM_VERSION
            else None
        )
        self.failure: tuple[str, str] | None = None
        self.guided = (
            manifest.tool_config.get("session") == SESSION_VERSION
            and manifest.tool_config.get("owner_directions_version") == DIRECTIONS_VERSION
        )

    def close(self) -> None:
        if self.swarm_pool:
            self.swarm_pool.shutdown(wait=True, cancel_futures=True)

    def guard(self, path: str, count: bool = False) -> None:
        if self.failure:
            reason, status = self.failure
            if status == "interrupted":
                raise RuntimeError(reason)
            raise ExecutionStopped(reason, status)
        self.control.guard(path, count)

    @contextmanager
    def session(self, path: str, *, count: bool = False) -> Iterator[None]:
        with self.sessions:
            try:
                self.guard(path, count)
                yield
            except Exception as error:
                if "team_version" in self.manifest.tool_config:
                    # Stop other assignments at their next guard or before acquiring a
                    # slot. Interruptions leave the ordinary uncertainty fence intact.
                    failure = (
                        (str(error), error.status)
                        if isinstance(error, ExecutionStopped)
                        else ("Research team execution was interrupted.", "interrupted")
                    )
                    with self.control.lock:
                        self.failure = self.failure or failure
                raise

    def __call__(
        self,
        node: WorkflowNode,
        path: str,
        context: str,
        feedback: str,
        team_source: str | None = None,
    ) -> str:
        assert isinstance(node.config, ResearchConfig)
        self.verify_implementation(node)
        if node.config.team and node.config.team.swarm:
            return run_swarm(self, node, path, context, feedback, team_source)
        if node.config.team:
            return self.execute_team(node, path, context, feedback, team_source)
        with self.model_lock, self.session(path):
            return self.execute(
                node, path, context, feedback, team_source=team_source
            ).model_dump_json()

    def reserve(
        self, node: WorkflowNode, path: str, model: str
    ) -> tuple[UUID, StoredResearchResult | None, list[OwnerDirection]]:
        assert isinstance(node.config, ResearchConfig)
        limits = self.manifest.settings.limits
        with self.control.lock:
            previous = self.conn.execute(
                "SELECT * FROM research_attempts WHERE run_id = %s AND path = %s",
                (self.run_id, path),
            ).fetchone()
            if previous:
                if previous["status"] == "completed":
                    return (
                        previous["id"],
                        StoredResearchResult.model_validate(previous["result"]),
                        [],
                    )
                if previous["status"] in {"preparing", "requesting"}:
                    reason = UNCERTAIN
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
            with self.conn.transaction():
                directions = pin_directions(self.conn, self.run_id) if self.guided else []
                self.conn.execute(
                    "INSERT INTO research_attempts (id, run_id, path, stage, model, status) "
                    "VALUES (%s, %s, %s, %s, %s, 'preparing')",
                    (attempt_id, self.run_id, path, node.config.stage, model),
                )
            return attempt_id, None, directions

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
                    self.guard(path)
            return await task
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            if pending_web is not None:
                on_delta(pending_web)

    def verify_implementation(self, node: WorkflowNode) -> None:
        assert isinstance(node.config, ResearchConfig)
        settings_version = self.manifest.tool_config.get("model_settings_version")
        if settings_version is not None and settings_version != MODEL_SETTINGS_VERSION:
            raise ExecutionStopped("This run requires its pinned model settings support.", "failed")
        if "owner_directions_version" in self.manifest.tool_config and not self.guided:
            raise ExecutionStopped(
                "This session requires its pinned owner guidance support.", "failed"
            )
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

        if node.config.team and (
            self.manifest.tool_config.get("team_version") != TEAM_VERSION
            or self.manifest.tool_config.get("team_prompt_hash") != team_prompt_hash()
        ):
            raise ExecutionStopped(
                "This run requires its pinned research team implementation.", "failed"
            )
        if (
            node.config.team
            and node.config.team.swarm
            and (
                self.manifest.tool_config.get("swarm_version") != SWARM_VERSION
                or self.manifest.tool_config.get("swarm_prompt_hash") != swarm_prompt_hash()
            )
        ):
            raise ExecutionStopped("This run requires its pinned swarm implementation.", "failed")

    def execute_team(
        self, node: WorkflowNode, path: str, context: str, feedback: str, team_source: str | None
    ) -> str:
        config = node.config
        assert isinstance(config, ResearchConfig) and config.team and config.analyst
        lead_model = resolve_model(self.manifest.settings, config, config.team.lead)
        director = node.model_copy(
            update={
                "config": config.model_copy(
                    update={
                        "analyst": None,
                        "team": None,
                        "web_search": False,
                        "sec_financials": False,
                        "style_excerpt": "",
                    }
                )
            }
        )
        plan_path = f"{path}/plan"
        with self.session(plan_path, count=True):
            saved = self.execute_pass(
                director, plan_path, context, feedback, lead_model, [], director=config
            )
        plan = saved.team_plan
        if plan is None or len(plan.assignments) > config.team.max_agents:
            raise ExecutionStopped(
                "The saved research plan does not match the pinned team.", "failed"
            )

        member = node.model_copy(
            update={"config": config.model_copy(update={"team": None, "style_excerpt": ""})}
        )
        researcher = config.team.researcher

        def investigate(index_assignment: tuple[int, TeamAssignment]) -> StoredResearchResult:
            index, assignment = index_assignment
            member_path = f"{path}/agent-{index}"
            with self.session(member_path, count=True):
                return self.execute(
                    member,
                    member_path,
                    context,
                    feedback,
                    assignment=assignment,
                    team_source=team_source,
                    role=researcher,
                )

        with ThreadPoolExecutor(max_workers=min(self.max_sessions, len(plan.assignments))) as pool:
            # map preserves plan order even when researchers finish in reverse order.
            results = list(pool.map(investigate, enumerate(plan.assignments, 1)))
        self.guard(path)
        try:
            with self.control.lock:
                return team_handoff(self.conn, self.run_id, path, plan, results)
        except ValueError:
            raise ExecutionStopped(
                "The team handoff does not match its saved research receipts.", "failed"
            ) from None

    def execute(
        self,
        node: WorkflowNode,
        path: str,
        context: str,
        feedback: str,
        *,
        assignment: TeamAssignment | None = None,
        team_source: str | None = None,
        role: ModelOverride | None = None,
        swarm_delegation: dict[str, Any] | None = None,
    ) -> StoredResearchResult:
        assert isinstance(node.config, ResearchConfig)
        selected = resolve_model(self.manifest.settings, node.config, role)
        tools = self.manifest.tool_config
        report_version = tools.get("session_report_version")
        session_editor = (
            path == "root/report"
            and tools.get("session") == SESSION_VERSION
            and report_version is not None
        )
        if session_editor and report_version != REPORT_VERSION:
            raise ExecutionStopped("This session requires its pinned report editor.", "failed")
        if node.config.analyst:

            def step(
                history: list[StoredResearchResult], body: dict[str, Any]
            ) -> tuple[StoredResearchResult, dict[str, Any]]:
                pass_path = path if not history else f"{path}/analyst-pass-{len(history) + 1}"
                result = self.execute_pass(
                    node,
                    pass_path,
                    context,
                    feedback,
                    selected,
                    history,
                    body,
                    assignment=assignment,
                    team_source=team_source,
                    session_editor=session_editor,
                    swarm_delegation=swarm_delegation,
                )
                with self.control.lock:
                    row = self.conn.execute(
                        "SELECT response_artifact_id FROM research_attempts "
                        "WHERE run_id=%s AND path=%s",
                        (self.run_id, pass_path),
                    ).fetchone()
                    assert row
                    receipt = json.loads(read_content(self.conn, row["response_artifact_id"]))
                return result, receipt["analyst_response"]

            return self.provider.run_analyst(
                selected.model,
                node.config.analyst.max_passes,
                step,
                lambda: self.guard(path),
                workspace=node.config.analyst.workspace,
            )
        return self.execute_pass(
            node,
            path,
            context,
            feedback,
            selected,
            [],
            team_source=team_source,
            session_editor=session_editor,
        )

    def execute_pass(
        self,
        node: WorkflowNode,
        path: str,
        context: str,
        feedback: str,
        selected: ModelSelection,
        history: list[StoredResearchResult],
        body: dict[str, Any] | None = None,
        *,
        assignment: TeamAssignment | None = None,
        director: ResearchConfig | None = None,
        team_source: str | None = None,
        session_editor: bool = False,
        swarm: SwarmRequest | None = None,
        swarm_skill: str = "",
        swarm_delegation: dict[str, Any] | None = None,
    ) -> StoredResearchResult:
        assert isinstance(node.config, ResearchConfig)
        attempt_id, previous, directions = self.reserve(node, path, selected.model)
        if previous:
            return previous
        partial = ""
        lead_characters: int | None = None
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
            self.guard(path)
            with self.control.lock:
                prepared = prepare_research(
                    self.conn,
                    self.manifest,
                    node.config.stage,
                    self.brief,
                    context,
                    feedback,
                    node.instructions,
                    model=selected.model,
                    reasoning_effort=selected.reasoning_effort,
                    verbosity=selected.verbosity,
                    web_search=node.config.web_search,
                    sec_financials=node.config.sec_financials,
                    style_excerpt=node.config.style_excerpt,
                    owner_directions=directions,
                )
                if director:
                    assert director.analyst and director.team
                    prepare_plan(
                        prepared,
                        node.instructions,
                        director.analyst.skill,
                        director.team.max_agents,
                    )
                if assignment:
                    prepare_assignment(prepared, assignment)
                if swarm:
                    swarm.prepare(prepared, node.instructions, swarm_skill)
                if swarm_delegation:
                    prepare_delegation(prepared, swarm_delegation)
                if session_editor:
                    prepare_editor(prepared, self.manifest.settings.limits.max_output_characters)
                if directions:
                    prepared.instructions += (
                        "\nThe packet's owner_directions are the owner's guidance added during "
                        "this session, in the order received. Apply relevant directions to this "
                        "pass and distinguish editorial judgment from evidence."
                    )
                available = (
                    generated_files(self.conn, self.run_id, prepared, history) if workspace else {}
                )
                inputs = {}
                if workspace:
                    team_files = (
                        team_workspace_files(self.conn, self.run_id, team_source, context)
                        if team_source
                        else {}
                    )
                    inputs = staged_files(prepared, available, team_files=team_files)
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
                if (node.config.analyst or director or directions or swarm) and len(
                    payload
                ) > self.manifest.settings.limits.max_input_bytes:
                    raise ValueError(
                        "The analyst history and evidence exceed the input byte limit."
                    )
                original = put_artifact(self.conn, payload, f"research-request-{attempt_id}.json")
                self.conn.execute(
                    "UPDATE research_attempts SET input_artifact_id = %s, input_bytes = %s, "
                    "status = 'requesting', owner_direction_ids = %s::uuid[] WHERE id = %s",
                    (original.id, len(payload), [note.id for note in directions], attempt_id),
                )
            self.guard(path)
            with self.control.lock:
                admit_request(self.conn, attempt_id, "research")
            # Admission may wait behind another process. Recheck cancellation and
            # elapsed time before starting provider work; keep the consumed slot.
            self.guard(path)
            completion = asyncio.run(self.controlled(prepared, progress, path))
            partial = completion.text
            if swarm:
                lead_characters = lead_output_characters(completion)
                result = swarm.result(
                    completion, self.manifest.settings.limits.max_output_characters
                )
                self.finish(
                    attempt_id,
                    "completed",
                    partial,
                    completion,
                    result=result,
                    output_characters=lead_characters,
                )
                return result
            if director:
                assert director.team
                result = plan_result(partial, director.team.max_agents)
                self.finish(attempt_id, "completed", partial, completion, result=result)
                return result
            lead = None
            python = None
            review_question = None
            markdown = None
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
                answer = completion.text
                if assignment:
                    answer, review_question = member_output(answer)
                if session_editor:
                    answer, markdown = editor_output(
                        answer, self.manifest.settings.limits.max_output_characters
                    )
                validated = validate_result(answer, node.config.stage, prepared)
            result = StoredResearchResult(
                **validated.model_dump(exclude={"sec_lookup"}),
                next_lead=lead.lead if lead else None,
                review_question=review_question,
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
                self.guard(path)
                result.sec_financials = asyncio.run(lookup_sec_financials(validated.sec_lookup))
                self.guard(path)
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
                execution = run_python(python, files, lambda: self.guard(path))
                activity.status = "completed" if execution.exit_code == 0 else "failed"
                activity.output = execution.output
                exports = execution.files
            if history and not lead:
                retain_observations(result, history)
            if workspace and not lead:
                result.workspace_files = list(available.values())
            self.finish(
                attempt_id,
                "completed",
                partial,
                completion,
                result=result,
                exports=exports,
                session_report=session_editor and not lead,
                markdown=markdown,
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
                attempt_id,
                "failed",
                partial,
                completion,
                reason=reason[:1000],
                result=interim,
                output_characters=lead_characters,
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
        session_report: bool = False,
        markdown: bytes | None = None,
        output_characters: int | None = None,
    ) -> None:
        def tokens(name: str) -> int | None:
            value = completion.usage.get(name) if completion else None
            return (
                value
                if isinstance(value, int) and not isinstance(value, bool) and value >= 0
                else None
            )

        if output_characters is None:
            output_characters = len(text)
        with self.control.lock, self.conn.transaction():
            if session_report:
                assert isinstance(result, StoredResearchResult)
                confirm_editor_report(self.conn, result, markdown)
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
