"""Durable, checkpoint-specific execution with a recoverable command journal."""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, Literal, TypedDict
from uuid import UUID, uuid4

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, StateSnapshot, interrupt
from psycopg import Connection
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from researchchain.agents import require_agent_revision, run_agent
from researchchain.artifacts import EvidenceError, read_artifact
from researchchain.compiler import (
    LOOP_INPUT_COMPILER_VERSION,
    STRUCTURED_COMPILER_VERSION,
    ExecutionStopped,
    Guard,
    ResearchStep,
    compile_structured,
)
from researchchain.controls import ExecutionControl, control_state, set_terminal
from researchchain.database import Database
from researchchain.evidence import read_evidence
from researchchain.graph import ResearchConfig
from researchchain.models import (
    CancelResult,
    CheckpointStep,
    PendingReviewRun,
    PendingReviewsPage,
    RecentRunSummary,
    ResumeRequest,
    ReviewPrompt,
    RunArchiveItem,
    RunArchivePage,
    RunArchiveQuery,
    RunEvent,
    RunRequest,
    RunSnapshot,
    RunSummary,
    RunUsage,
    Workflow,
    WorkflowNode,
)
from researchchain.research import (
    RESEARCH_COMPILER_VERSION,
    ChatGPTResearchProvider,
    ResearchExecutor,
    ResearchProvider,
    fence_uncertain_effects,
    make_manifest,
    read_attempts,
    read_manifest,
)
from researchchain.research_sessions import SESSION_VERSION
from researchchain.research_team import TEAM_VERSION
from researchchain.retention_guards import require_retained_run
from researchchain.revisions import ConflictError, NotFoundError, read_revision

COMPILER_VERSION = "chain-0.1.0"
CODE_COMPILER_VERSION = "code-0.1.0"


def checkpoint_steps(state: StateSnapshot, status: str) -> list[CheckpointStep]:
    steps = []
    for task in state.tasks:
        step_status: Literal["scheduled", "stopped"]
        if task.name.startswith("__"):
            continue
        if task.error is not None:
            step_status = "stopped"
        elif status in {"running", "queued", "interrupted"} and task.name in state.next:
            step_status = "scheduled"
        else:
            continue
        path = task.name if "/" in task.name else f"root/{task.name}"
        # A loop check or subgraph exit belongs to its enclosing workflow node.
        # User steps have an even number of components (root/node[/body/node]).
        if len(path.split("/")) % 2:
            path = path.rsplit("/", 1)[0]
        steps.append(CheckpointStep(path=path, status=step_status))
    return steps


def recorded_events(state: StateSnapshot, workflow: Workflow) -> list[RunEvent]:
    if workflow.schema_version == "0.1":
        return [RunEvent.model_validate(event) for event in state.values.get("events", [])]
    outputs = state.values.get("outputs", {})
    events = []
    for path, event in state.values.get("records", {}).items():
        if event["kind"] == "review" and outputs.get(path, {}).get("decision") in {
            "approve",
            "reject",
        }:
            event = {**event, "review_response": outputs[path]}
        events.append(RunEvent.model_validate(event))
    return events


def compiler_version(workflow: Workflow) -> str:
    nodes = [node for graph in (workflow, *workflow.subgraphs) for node in graph.nodes]
    if any(
        isinstance(node.config, ResearchConfig) and (node.config.team or node.config.style_excerpt)
        for node in nodes
    ):
        return TEAM_VERSION
    if any(
        source.source == "previous_iteration" for node in nodes for source in node.inputs.values()
    ):
        return LOOP_INPUT_COMPILER_VERSION
    if any(node.kind == "code" for node in nodes):
        return CODE_COMPILER_VERSION
    return {
        "0.1": COMPILER_VERSION,
        "0.2": STRUCTURED_COMPILER_VERSION,
        "0.3": RESEARCH_COMPILER_VERSION,
    }[workflow.schema_version]


class ResearchState(TypedDict):
    brief: str
    artifact_ids: list[str]
    events: list[dict[str, Any]]
    rejected: bool


def _node_function(node: WorkflowNode) -> Any:
    def execute(state: ResearchState) -> dict[str, Any]:
        rejected = state["rejected"]
        if node.kind == "review":
            # This function replays on resume. No external effects before interrupt.
            decision = interrupt(
                {"node_id": node.id, "question": node.instructions or "Continue this workflow?"}
            )
            rejected = decision == "reject"
            detail = "Rejected by reviewer" if rejected else "Approved by reviewer"
        elif node.kind == "finish":
            detail = "Development workflow finished. No report was generated."
        else:
            detail = node.instructions or "Note recorded."
        event = RunEvent(node_id=node.id, label=node.label, kind=node.kind, detail=detail)
        return {"events": [*state["events"], event.model_dump()], "rejected": rejected}

    return execute


def _route_review(state: ResearchState) -> str:
    return "stop" if state["rejected"] else "continue"


def compile_workflow(
    workflow: Workflow,
    checkpointer: BaseCheckpointSaver[Any],
    guard: Guard | None = None,
    research: ResearchStep | None = None,
) -> Any:
    """Compile validated nodes; code steps use the isolated JavaScript executor."""
    if workflow.schema_version != "0.1":
        return compile_structured(workflow, checkpointer, guard, research)
    builder = StateGraph(ResearchState)
    successors = {edge.source: edge.target for edge in workflow.edges}
    for node in workflow.nodes:
        execute = _node_function(node)
        if guard:
            execute = _guarded_legacy(execute, node.id, guard)
        builder.add_node(node.id, execute)
        if node.kind == "finish":
            builder.add_edge(node.id, END)
        elif node.kind == "review":
            builder.add_conditional_edges(
                node.id, _route_review, {"stop": END, "continue": successors[node.id]}
            )
        else:
            builder.add_edge(node.id, successors[node.id])
    builder.add_edge(START, workflow.start_node)
    return builder.compile(checkpointer=checkpointer)


def _guarded_legacy(execute: Any, node_id: str, guard: Guard) -> Any:
    def wrapped(state: ResearchState) -> dict[str, Any]:
        guard(node_id, True)
        result: dict[str, Any] = execute(state)
        guard(node_id, False)
        return result

    return wrapped


class RunStore:
    def __init__(self, database: Database, provider: ResearchProvider | None = None) -> None:
        self.database = database
        self.provider = provider or ChatGPTResearchProvider()

    @staticmethod
    def _config(run_id: UUID) -> dict[str, Any]:
        return {"configurable": {"thread_id": str(run_id)}, "recursion_limit": 64}

    @contextmanager
    def _locked(self, run_id: UUID) -> Iterator[Connection[DictRow]]:
        with self.database.connection() as conn:
            conn.execute("SELECT pg_advisory_lock(hashtextextended(%s, 0))", (f"run:{run_id}",))
            # Closing the dedicated session releases the lock, even on exceptions.
            # The saver uses this connection too, so a disconnected worker cannot
            # write after another process acquires its abandoned lock.
            yield conn

    def _manifest(self, conn: Connection[DictRow], run_id: UUID) -> DictRow:
        require_retained_run(conn, run_id)
        row = conn.execute("SELECT * FROM runs WHERE id = %s", (run_id,)).fetchone()
        if row is None:
            raise NotFoundError("Run not found.")
        if row["compiler_version"] not in (
            COMPILER_VERSION,
            CODE_COMPILER_VERSION,
            STRUCTURED_COMPILER_VERSION,
            RESEARCH_COMPILER_VERSION,
            LOOP_INPUT_COMPILER_VERSION,
            TEAM_VERSION,
        ):
            raise ConflictError("This run requires a compatible compiler version before recovery.")
        return row

    @staticmethod
    def _unfinished(conn: Connection[DictRow], run_id: UUID) -> DictRow | None:
        return conn.execute(
            "SELECT * FROM run_commands WHERE run_id = %s AND response IS NULL", (run_id,)
        ).fetchone()

    def _graph(
        self,
        conn: Connection[DictRow],
        manifest: DictRow,
        guard: Guard | None = None,
        *,
        saver: PostgresSaver | None = None,
        research: ResearchStep | None = None,
    ) -> Any:
        revision = read_revision(conn, manifest["revision_id"])
        expected = compiler_version(revision.workflow)
        if manifest["compiler_version"] != expected:
            raise ConflictError("This run requires a compatible compiler version before recovery.")
        return compile_workflow(revision.workflow, saver or PostgresSaver(conn), guard, research)

    def _snapshot(
        self,
        conn: Connection[DictRow],
        manifest: DictRow,
        *,
        interrupted: bool = False,
        running: bool = False,
        queued: bool = False,
        worker_error: str | None = None,
    ) -> RunSnapshot:
        revision = read_revision(conn, manifest["revision_id"])
        state = self._graph(conn, manifest).get_state(self._config(manifest["id"]))
        pending = [item for task in state.tasks for item in task.interrupts]
        status: Any = "completed"
        if interrupted or not state.values or (state.next and not pending):
            status = "interrupted"
        elif state.values.get("rejected"):
            status = "rejected"
        elif pending:
            status = "paused"
        control = control_state(conn, manifest["id"])
        if queued or running:
            status = "queued" if queued else "running"
            pending = []
        if control["terminal_status"]:
            status = control["terminal_status"]
            pending = []
        reviews = [ReviewPrompt(interrupt_id=item.id, **item.value) for item in pending]
        attempts = read_attempts(conn, manifest["id"])
        return RunSnapshot(
            **run_agent(conn, manifest["id"]),
            id=manifest["id"],
            revision_id=revision.id,
            revision_number=revision.number,
            workflow_name=revision.name,
            created_at=manifest["created_at"],
            workflow=revision.workflow,
            brief=manifest["brief"],
            baseline_run_id=manifest["baseline_run_id"],
            artifacts=manifest["artifacts"],
            evidence_ids=self._evidence_ids(conn, manifest["id"]),
            compiler_version=manifest["compiler_version"],
            checkpoint_id=state.config.get("configurable", {}).get("checkpoint_id"),
            checkpoint_steps=checkpoint_steps(state, status),
            status=status,
            execution_pending=running or queued,
            events=recorded_events(state, revision.workflow),
            review=reviews[0] if reviews else None,
            reviews=reviews,
            stop_reason=control["reason"] or worker_error,
            usage=RunUsage(
                node_executions=control["node_executions"],
                active_seconds=control["active_seconds"],
                model_calls=len(attempts),
                tool_calls=len(attempts),
                input_tokens=sum(item.input_tokens or 0 for item in attempts),
                output_tokens=sum(item.output_tokens or 0 for item in attempts),
                usage_complete=all(
                    item.input_tokens is not None and item.output_tokens is not None
                    for item in attempts
                ),
            ),
            research_manifest=read_manifest(conn, manifest["id"]),
            model_attempts=attempts,
        )

    def _complete_command(
        self, conn: Connection[DictRow], command_id: UUID, snapshot: RunSnapshot
    ) -> None:
        conn.execute(
            "UPDATE run_commands SET response = %s WHERE id = %s AND response IS NULL",
            (Jsonb(snapshot.model_dump(mode="json")), command_id),
        )

    def _drive(self, conn: Connection[DictRow], manifest: DictRow, command: DictRow) -> RunSnapshot:
        if command["response"] is not None:
            return RunSnapshot.model_validate(command["response"])
        fence_uncertain_effects(conn, manifest["id"])
        control = control_state(conn, manifest["id"])
        if control["terminal_status"]:
            snapshot = self._snapshot(conn, manifest)
            self._complete_command(conn, command["id"], snapshot)
            return snapshot
        workflow = read_revision(conn, manifest["revision_id"]).workflow
        saver = PostgresSaver(conn)
        execution = ExecutionControl(conn, manifest["id"], workflow.budgets, saver.lock)
        research_manifest = read_manifest(conn, manifest["id"])
        researcher = (
            ResearchExecutor(
                conn, manifest["id"], manifest["brief"], research_manifest, execution, self.provider
            )
            if research_manifest
            else None
        )
        graph = self._graph(conn, manifest, execution.guard, saver=saver, research=researcher)
        config = self._config(manifest["id"])
        if workflow.schema_version != "0.1":
            config.update(recursion_limit=4096, max_concurrency=workflow.budgets.max_concurrency)
        state = graph.get_state(config)
        pending = [item for task in state.tasks for item in task.interrupts]
        try:
            execution.begin()
            if not state.created_at:
                if command["kind"] != "start":
                    raise ConflictError(
                        "The checkpoint for this review is missing. Restore a database backup."
                    )
                initial = {
                    "brief": manifest["brief"],
                    "artifact_ids": [item["id"] for item in manifest["artifacts"]],
                    "rejected": False,
                }
                if workflow.schema_version != "0.1":
                    initial.update(records={}, outputs={})
                else:
                    initial["events"] = []
                graph.invoke(initial, config, durability="sync")
            elif command["kind"] == "resume" and any(
                item.id == command["interrupt_id"] for item in pending
            ):
                graph.invoke(
                    Command(
                        resume={
                            command["interrupt_id"]: (
                                {"decision": command["decision"], "feedback": command["feedback"]}
                                if workflow.schema_version == "0.3"
                                else command["decision"]
                            )
                        }
                    ),
                    config,
                    durability="sync",
                )
            elif state.next and not pending:
                graph.invoke(None, config, durability="sync")
            execution.guard("", False)
        except ExecutionStopped as error:
            set_terminal(conn, manifest["id"], error.status, str(error))
        finally:
            execution.end()

        snapshot = self._snapshot(conn, manifest)
        if snapshot.status == "interrupted":
            raise ConflictError(
                "Execution is still incomplete. Retry recovery from the saved checkpoint."
            )
        if snapshot.status in ("completed", "rejected"):
            set_terminal(conn, manifest["id"], snapshot.status)
            snapshot = self._snapshot(conn, manifest)
        self._complete_command(conn, command["id"], snapshot)
        return snapshot

    @staticmethod
    def _evidence_ids(conn: Connection[DictRow], run_id: UUID) -> list[UUID]:
        return [
            row["evidence_id"]
            for row in conn.execute(
                "SELECT evidence_id FROM run_evidence WHERE run_id = %s ORDER BY ordinal", (run_id,)
            )
        ]

    def start_command(
        self, conn: Connection[DictRow], request: RunRequest, *, research_session: bool = False
    ) -> DictRow:
        """Validate and journal inputs; the caller serializes admission and commits."""
        require_retained_run(conn, request.id)
        existing = conn.execute("SELECT * FROM runs WHERE id = %s", (request.id,)).fetchone()
        if existing and (
            run_agent(conn, request.id)["agent_id"] != request.agent_id
            or existing["revision_id"] != request.revision_id
            or existing["baseline_run_id"] != request.baseline_run_id
            or existing["brief"] != request.brief
            or self._evidence_ids(conn, request.id) != request.evidence_ids
        ):
            raise ConflictError("This run ID already belongs to different inputs.")
        existing_research = read_manifest(conn, request.id) if existing else None
        if (
            research_session
            and existing
            and (
                not existing_research
                or existing_research.tool_config.get("session") != SESSION_VERSION
            )
        ):
            raise ConflictError("This ID already belongs to a different run.")
        if existing and request.provider_account_id != (
            existing_research.account_id if existing_research else None
        ):
            raise ConflictError("This run ID already belongs to a different provider account.")
        selected_agent = (
            require_agent_revision(conn, request.agent_id, request.revision_id)
            if request.agent_id and not existing
            else None
        )
        artifacts = [item.model_dump() for item in request.artifacts]
        if existing is None:
            if request.baseline_run_id is not None:
                if research_session:
                    baseline_manifest = read_manifest(conn, request.baseline_run_id)
                    if (
                        not baseline_manifest
                        or baseline_manifest.tool_config.get("session") != SESSION_VERSION
                    ):
                        raise NotFoundError("Baseline research session not found.")
                baseline = conn.execute(
                    "SELECT a.agent_id FROM runs r LEFT JOIN agent_runs a ON a.run_id = r.id "
                    "WHERE r.id = %s",
                    (request.baseline_run_id,),
                ).fetchone()
                if baseline is None or baseline["agent_id"] != request.agent_id:
                    raise NotFoundError("Baseline run not found for this agent.")
            if len({item.id for item in request.artifacts}) != len(request.artifacts):
                raise EvidenceError("Select each original only once.")
            for item in request.artifacts:
                stored = read_artifact(conn, item.id)
                if stored.name != item.name or stored.media_type != item.media_type:
                    raise EvidenceError("Artifact metadata must match the captured original.")
        # Accepted legacy requests deliberately bypass new availability rules.
        # Their saved addresses and command receipts remain valid after migration.
        for evidence_id in request.evidence_ids:
            source = read_evidence(conn, evidence_id)
            if source.artifact and source.artifact.id not in {item["id"] for item in artifacts}:
                artifacts.append(source.artifact.model_dump(include={"id", "name", "media_type"}))
        if len(artifacts) > 100:
            raise EvidenceError("A run supports at most 100 unique originals.")
        if existing is None:
            workflow = read_revision(conn, request.revision_id).workflow
            research_manifest = None
            if workflow.research:
                if not request.provider_account_id:
                    raise EvidenceError(
                        "Select the connected provider account for this research run."
                    )
                account = self.provider.pin_account(
                    request.provider_account_id, workflow.research_models()
                )
                research_manifest = make_manifest(
                    conn, workflow, request.revision_id, request.evidence_ids, account
                )
                if research_session:
                    research_manifest.tool_config["session"] = SESSION_VERSION
            elif request.provider_account_id:
                raise EvidenceError("Provider selection is only valid for a research workflow.")
            with conn.transaction():
                conn.execute(
                    "INSERT INTO runs "
                    "(id, revision_id, compiler_version, brief, artifacts, baseline_run_id) "
                    "VALUES (%s, %s, %s, %s, %s, %s)",
                    (
                        request.id,
                        request.revision_id,
                        compiler_version(workflow),
                        request.brief,
                        Jsonb(artifacts),
                        request.baseline_run_id,
                    ),
                )
                if selected_agent:
                    conn.execute(
                        "INSERT INTO agent_runs (run_id, agent_id, agent_name) VALUES (%s, %s, %s)",
                        (request.id, selected_agent.id, selected_agent.name),
                    )
                if research_manifest:
                    conn.execute(
                        "INSERT INTO run_research_manifests (run_id, manifest) VALUES (%s, %s)",
                        (request.id, Jsonb(research_manifest.model_dump(mode="json"))),
                    )
                for ordinal, evidence_id in enumerate(request.evidence_ids):
                    conn.execute(
                        "INSERT INTO run_evidence (run_id, evidence_id, ordinal) "
                        "VALUES (%s, %s, %s)",
                        (request.id, evidence_id, ordinal),
                    )
                conn.execute("INSERT INTO run_controls (run_id) VALUES (%s)", (request.id,))
                conn.execute(
                    "INSERT INTO run_commands (id, run_id, kind) VALUES (%s, %s, 'start')",
                    (uuid4(), request.id),
                )
        elif existing["artifacts"] != artifacts:
            raise ConflictError("This run ID already belongs to different inputs.")
        command = conn.execute(
            "SELECT * FROM run_commands WHERE run_id = %s AND kind = 'start'", (request.id,)
        ).fetchone()
        assert command is not None
        return command

    def start(self, request: RunRequest) -> RunSnapshot:
        """Synchronous driver for local runtime operations and focused tests."""
        with self._locked(request.id) as conn:
            command = self.start_command(conn, request)
            return self._drive(conn, self._manifest(conn, request.id), command)

    def get(self, run_id: UUID) -> RunSnapshot:
        with self.database.connection() as conn:
            # Progress can be requested before the start transaction commits.
            # Only use the run lock after a saved run is visible to the reader.
            manifest = self._manifest(conn, run_id)
            # Readers never wait for a model call. A live writer owns the run's
            # advisory lock; checkpoint reads and the attempt journal use MVCC.
            lock = conn.execute(
                "SELECT pg_try_advisory_lock(hashtextextended(%s, 0)) AS acquired",
                (f"run:{run_id}",),
            ).fetchone()
            assert lock is not None
            command = self._unfinished(conn, run_id)
            job = (
                conn.execute(
                    "SELECT state, last_error FROM run_jobs WHERE command_id = %s",
                    (command["id"],),
                ).fetchone()
                if command
                else None
            )
            unfinished = command is not None
            return self._snapshot(
                conn,
                manifest,
                interrupted=unfinished,
                # Other readers briefly own this lock too. Only an unfinished
                # command indicates that a worker may still be executing.
                running=unfinished and not lock["acquired"],
                queued=bool(
                    unfinished
                    and job
                    and (
                        job["state"] == "queued" or (job["state"] == "running" and lock["acquired"])
                    )
                ),
                worker_error=job["last_error"] if job else None,
            )

    def search(self, query: RunArchiveQuery) -> RunArchivePage:
        matches = self._search_runs(query, look_ahead=True)
        return RunArchivePage(items=matches[: query.limit], has_more=len(matches) > query.limit)

    def _search_runs(
        self, query: RunArchiveQuery, *, look_ahead: bool = False, sessions_only: bool = False
    ) -> list[RunArchiveItem]:
        # History reads journaled summaries, not every graph/checkpoint. A live
        # advisory lock distinguishes executing commands from abandoned ones.
        with self.database.connection() as conn:
            rows = conn.execute(
                "SELECT * FROM (SELECT r.id, a.agent_id, a.agent_name, r.revision_id, "
                "w.number AS revision_number, "
                "w.workflow->>'name' AS workflow_name, r.created_at, "
                "LEFT(r.brief, 240) AS brief_excerpt, "
                "COALESCE(c.terminal_status, CASE WHEN command.response IS NOT NULL "
                "THEN command.response->>'status' WHEN command.state = 'queued' THEN 'queued' "
                "WHEN EXISTS ("
                "SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.granted "
                "AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database()) "
                "AND l.objsubid = 1 "
                "AND l.classid::bigint = ((hashtextextended('run:' || r.id::text, 0) >> 32) "
                "& 4294967295) "
                "AND l.objid::bigint = (hashtextextended('run:' || r.id::text, 0) & 4294967295)"
                ") THEN 'running' WHEN command.state = 'running' THEN 'queued' "
                "ELSE 'interrupted' END) AS status "
                "FROM runs r JOIN workflow_revisions w ON w.id = r.revision_id "
                "LEFT JOIN agent_runs a ON a.run_id = r.id "
                "JOIN run_controls c ON c.run_id = r.id "
                "LEFT JOIN LATERAL (SELECT command.response, job.state FROM run_commands command "
                "LEFT JOIN run_jobs job ON job.command_id = command.id WHERE command.run_id = r.id "
                "ORDER BY command.created_at DESC, command.id DESC LIMIT 1) command ON true "
                "WHERE (%(agent_id)s::uuid IS NULL OR a.agent_id = %(agent_id)s) "
                "AND (NOT %(sessions_only)s OR EXISTS (SELECT 1 FROM run_research_manifests rm "
                "WHERE rm.run_id = r.id AND rm.manifest->'tool_config'->>'session' "
                "= %(session_version)s)) "
                "AND (NOT %(unassigned)s OR a.agent_id IS NULL) "
                "AND (%(exclude_id)s::uuid IS NULL OR r.id <> %(exclude_id)s) "
                "AND (%(before_created_at)s::timestamptz IS NULL "
                "OR (r.created_at, r.id) < (%(before_created_at)s, %(before_id)s)) "
                "AND (%(search)s = '' OR strpos(lower(concat_ws(' ', "
                "w.workflow->>'name', a.agent_name, r.id::text, r.brief)), lower(%(search)s)) > 0)"
                ") summary WHERE (%(status)s::text IS NULL OR status = %(status)s) "
                "ORDER BY created_at DESC, id DESC LIMIT %(limit)s",
                {
                    **query.model_dump(),
                    "sessions_only": sessions_only,
                    "session_version": SESSION_VERSION,
                    "search": query.search.strip(),
                    "limit": query.limit + int(look_ahead),
                },
            )
            return [
                RunArchiveItem(
                    brief_excerpt=row.pop("brief_excerpt"), run=RunSummary.model_validate(row)
                )
                for row in rows
            ]

    def list(
        self, limit: int = 20, agent_id: UUID | None = None, *, sessions_only: bool = False
    ) -> list[RecentRunSummary]:
        return [
            RecentRunSummary(**item.run.model_dump(), brief_excerpt=item.brief_excerpt)
            for item in self._search_runs(
                RunArchiveQuery(limit=limit, agent_id=agent_id), sessions_only=sessions_only
            )
        ]

    def pending_reviews(
        self, limit: int, offset: int, agent_id: UUID | None = None
    ) -> PendingReviewsPage:
        # Read the most recent command receipt. An admitted resume has no response
        # yet and hides the old questions until the worker records its next pause.
        with self.database.connection() as conn:
            rows = conn.execute(
                "SELECT r.id, a.agent_name, w.workflow->>'name' AS workflow_name, r.created_at, "
                "LEFT(r.brief, 240) AS brief_excerpt, "
                "command.response->>'checkpoint_id' AS checkpoint_id, "
                "CASE WHEN command.response->'reviews'->0 IS NOT NULL "
                "THEN command.response->'reviews' "
                "ELSE jsonb_build_array(command.response->'review') END AS reviews "
                "FROM runs r JOIN run_controls c ON c.run_id = r.id "
                "JOIN workflow_revisions w ON w.id = r.revision_id "
                "LEFT JOIN agent_runs a ON a.run_id = r.id "
                "JOIN LATERAL (SELECT response FROM run_commands WHERE run_id = r.id "
                "ORDER BY created_at DESC, id DESC LIMIT 1) command ON true "
                "WHERE c.terminal_status IS NULL AND command.response->>'status' = 'paused' "
                "AND command.response->>'checkpoint_id' IS NOT NULL "
                "AND (command.response->>'review' IS NOT NULL "
                "OR command.response->'reviews'->0 IS NOT NULL) "
                "AND (%(agent_id)s::uuid IS NULL OR a.agent_id = %(agent_id)s) "
                "ORDER BY r.created_at, r.id LIMIT %(limit)s OFFSET %(offset)s",
                {"agent_id": agent_id, "limit": limit + 1, "offset": offset},
            ).fetchall()
            return PendingReviewsPage(
                items=[PendingReviewRun.model_validate(row) for row in rows[:limit]],
                has_more=len(rows) > limit,
            )

    def resume_command(
        self, conn: Connection[DictRow], run_id: UUID, request: ResumeRequest
    ) -> DictRow:
        """Journal an exact review; the caller serializes admission and owns the run."""
        manifest = self._manifest(conn, run_id)
        existing = conn.execute(
            "SELECT * FROM run_commands WHERE run_id = %s AND interrupt_id = %s",
            (run_id, request.interrupt_id),
        ).fetchone()
        if existing is not None:
            if (
                existing["decision"] != request.decision
                or existing["checkpoint_id"] != request.checkpoint_id
                or existing["feedback"] != request.feedback
            ):
                raise ConflictError("This review already has a different recorded decision.")
            return existing
        if (
            request.feedback
            and read_revision(conn, manifest["revision_id"]).workflow.schema_version != "0.3"
        ):
            raise ConflictError("Reviewer feedback requires workflow version 0.3.")
        if self._unfinished(conn, run_id) is not None:
            raise ConflictError("Recover this run's interrupted request before reviewing it.")
        snapshot = self._snapshot(conn, manifest)
        if (
            snapshot.status != "paused"
            or not any(item.interrupt_id == request.interrupt_id for item in snapshot.reviews)
            or snapshot.checkpoint_id != request.checkpoint_id
        ):
            raise ConflictError(
                "This review is no longer current. Refresh the run before deciding."
            )
        command = conn.execute(
            "INSERT INTO run_commands "
            "(id, run_id, kind, checkpoint_id, interrupt_id, decision, feedback) "
            "VALUES (%s, %s, 'resume', %s, %s, %s, %s) RETURNING *",
            (
                uuid4(),
                run_id,
                request.checkpoint_id,
                request.interrupt_id,
                request.decision,
                request.feedback,
            ),
        ).fetchone()
        assert command is not None
        return command

    def resume(self, run_id: UUID, request: ResumeRequest) -> RunSnapshot:
        with self._locked(run_id) as conn:
            command = self.resume_command(conn, run_id, request)
            return self._drive(conn, self._manifest(conn, run_id), command)

    def recover(self, run_id: UUID) -> RunSnapshot:
        with self._locked(run_id) as conn:
            manifest = self._manifest(conn, run_id)
            command = self._unfinished(conn, run_id)
            return (
                self._drive(conn, manifest, command) if command else self._snapshot(conn, manifest)
            )

    def cancel(self, run_id: UUID) -> CancelResult:
        # Do not acquire the execution lock: another HTTP request must be able to
        # signal a worker currently holding it. Registered nodes stop cooperatively.
        with self.database.connection() as conn:
            self._manifest(conn, run_id)
            set_terminal(conn, run_id, "cancelled", "Cancelled by user.")
            control = control_state(conn, run_id)
            return CancelResult(id=run_id, status=control["terminal_status"])
