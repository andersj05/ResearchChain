"""Durable, checkpoint-specific execution with a recoverable command journal."""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, TypedDict
from uuid import UUID, uuid4

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from psycopg import Connection
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from researchchain.compiler import (
    STRUCTURED_COMPILER_VERSION,
    ExecutionStopped,
    Guard,
    compile_structured,
)
from researchchain.controls import ExecutionControl, control_state, set_terminal
from researchchain.database import Database
from researchchain.models import (
    CancelResult,
    ResumeRequest,
    ReviewPrompt,
    RunEvent,
    RunRequest,
    RunSnapshot,
    RunSummary,
    RunUsage,
    Workflow,
    WorkflowNode,
)
from researchchain.revisions import ConflictError, NotFoundError, read_revision

COMPILER_VERSION = "chain-0.1.0"


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
    workflow: Workflow, checkpointer: BaseCheckpointSaver[Any], guard: Guard | None = None
) -> Any:
    """Compile validated registered nodes; never evaluate code from a workflow."""
    if workflow.schema_version == "0.2":
        return compile_structured(workflow, checkpointer, guard)
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
    def __init__(self, database: Database) -> None:
        self.database = database

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
        row = conn.execute("SELECT * FROM runs WHERE id = %s", (run_id,)).fetchone()
        if row is None:
            raise NotFoundError("Run not found.")
        if row["compiler_version"] not in (COMPILER_VERSION, STRUCTURED_COMPILER_VERSION):
            raise ConflictError("This run requires a compatible compiler version before recovery.")
        return row

    @staticmethod
    def _unfinished(conn: Connection[DictRow], run_id: UUID) -> DictRow | None:
        return conn.execute(
            "SELECT * FROM run_commands WHERE run_id = %s AND response IS NULL", (run_id,)
        ).fetchone()

    def _graph(
        self, conn: Connection[DictRow], manifest: DictRow, guard: Guard | None = None
    ) -> Any:
        revision = read_revision(conn, manifest["revision_id"])
        expected = (
            COMPILER_VERSION
            if revision.workflow.schema_version == "0.1"
            else STRUCTURED_COMPILER_VERSION
        )
        if manifest["compiler_version"] != expected:
            raise ConflictError("This run requires a compatible compiler version before recovery.")
        return compile_workflow(revision.workflow, PostgresSaver(conn), guard)

    def _snapshot(
        self, conn: Connection[DictRow], manifest: DictRow, *, interrupted: bool = False
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
        if control["terminal_status"]:
            status = control["terminal_status"]
            pending = []
        reviews = [ReviewPrompt(interrupt_id=item.id, **item.value) for item in pending]
        return RunSnapshot(
            id=manifest["id"],
            revision_id=revision.id,
            revision_number=revision.number,
            workflow_name=revision.name,
            created_at=manifest["created_at"],
            workflow=revision.workflow,
            brief=manifest["brief"],
            artifacts=manifest["artifacts"],
            compiler_version=manifest["compiler_version"],
            checkpoint_id=state.config.get("configurable", {}).get("checkpoint_id"),
            status=status,
            events=list(state.values.get("records", {}).values())
            if revision.workflow.schema_version == "0.2"
            else state.values.get("events", []),
            review=reviews[0] if reviews else None,
            reviews=reviews,
            stop_reason=control["reason"],
            usage=RunUsage(
                node_executions=control["node_executions"], active_seconds=control["active_seconds"]
            ),
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
        control = control_state(conn, manifest["id"])
        if control["terminal_status"]:
            snapshot = self._snapshot(conn, manifest)
            self._complete_command(conn, command["id"], snapshot)
            return snapshot
        workflow = read_revision(conn, manifest["revision_id"]).workflow
        execution = ExecutionControl(conn, manifest["id"], workflow.budgets)
        graph = self._graph(conn, manifest, execution.guard)
        config = self._config(manifest["id"])
        if workflow.schema_version == "0.2":
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
                if workflow.schema_version == "0.2":
                    initial.update(records={}, outputs={})
                else:
                    initial["events"] = []
                graph.invoke(initial, config, durability="sync")
            elif command["kind"] == "resume" and any(
                item.id == command["interrupt_id"] for item in pending
            ):
                graph.invoke(
                    Command(resume={command["interrupt_id"]: command["decision"]}),
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

    def start(self, request: RunRequest) -> RunSnapshot:
        with self._locked(request.id) as conn:
            existing = conn.execute("SELECT * FROM runs WHERE id = %s", (request.id,)).fetchone()
            artifacts = [item.model_dump() for item in request.artifacts]
            if existing is None:
                with conn.transaction():
                    workflow = read_revision(conn, request.revision_id).workflow
                    conn.execute(
                        "INSERT INTO runs (id, revision_id, compiler_version, brief, artifacts) "
                        "VALUES (%s, %s, %s, %s, %s)",
                        (
                            request.id,
                            request.revision_id,
                            COMPILER_VERSION
                            if workflow.schema_version == "0.1"
                            else STRUCTURED_COMPILER_VERSION,
                            request.brief,
                            Jsonb(artifacts),
                        ),
                    )
                    conn.execute("INSERT INTO run_controls (run_id) VALUES (%s)", (request.id,))
                    conn.execute(
                        "INSERT INTO run_commands (id, run_id, kind) VALUES (%s, %s, 'start')",
                        (uuid4(), request.id),
                    )
            elif (
                existing["revision_id"] != request.revision_id
                or existing["brief"] != request.brief
                or existing["artifacts"] != artifacts
            ):
                raise ConflictError("This run ID already belongs to different inputs.")
            manifest = self._manifest(conn, request.id)
            command = conn.execute(
                "SELECT * FROM run_commands WHERE run_id = %s AND kind = 'start'", (request.id,)
            ).fetchone()
            assert command is not None
            return self._drive(conn, manifest, command)

    def get(self, run_id: UUID) -> RunSnapshot:
        with self._locked(run_id) as conn:
            return self._snapshot(
                conn,
                self._manifest(conn, run_id),
                interrupted=self._unfinished(conn, run_id) is not None,
            )

    def list(self, limit: int = 20) -> list[RunSummary]:
        with self.database.connection() as conn:
            ids = [
                row["id"]
                for row in conn.execute(
                    "SELECT id FROM runs ORDER BY created_at DESC, id DESC LIMIT %s", (limit,)
                )
            ]
        return [
            RunSummary.model_validate(
                self.get(run_id).model_dump(include=set(RunSummary.model_fields))
            )
            for run_id in ids
        ]

    def resume(self, run_id: UUID, request: ResumeRequest) -> RunSnapshot:
        with self._locked(run_id) as conn:
            manifest = self._manifest(conn, run_id)
            existing = conn.execute(
                "SELECT * FROM run_commands WHERE run_id = %s AND interrupt_id = %s",
                (run_id, request.interrupt_id),
            ).fetchone()
            if existing is not None:
                if (
                    existing["decision"] != request.decision
                    or existing["checkpoint_id"] != request.checkpoint_id
                ):
                    raise ConflictError("This review already has a different recorded decision.")
                return self._drive(conn, manifest, existing)
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
                "(id, run_id, kind, checkpoint_id, interrupt_id, decision) "
                "VALUES (%s, %s, 'resume', %s, %s, %s) RETURNING *",
                (uuid4(), run_id, request.checkpoint_id, request.interrupt_id, request.decision),
            ).fetchone()
            assert command is not None
            return self._drive(conn, manifest, command)

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
