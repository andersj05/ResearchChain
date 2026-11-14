"""A bounded local execution slice; replace memory storage before production."""

from dataclasses import dataclass
from threading import RLock
from typing import Any, Literal, TypedDict
from uuid import uuid4

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from researchchain.models import (
    ReviewPrompt,
    RunEvent,
    RunRequest,
    RunSnapshot,
    Workflow,
    WorkflowNode,
)


class ResearchState(TypedDict):
    brief: str
    events: list[dict[str, Any]]
    rejected: bool


def _node_function(node: WorkflowNode) -> Any:
    def execute(state: ResearchState) -> dict[str, Any]:
        rejected = state["rejected"]
        if node.kind == "review":
            # No side effects before interrupt: LangGraph replays this function on resume.
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


def compile_workflow(workflow: Workflow) -> Any:
    """Compile only validated node kinds and connections; never eval browser code."""
    builder = StateGraph(ResearchState)
    successors = {edge.source: edge.target for edge in workflow.edges}
    for node in workflow.nodes:
        builder.add_node(node.id, _node_function(node))
        if node.kind == "finish":
            builder.add_edge(node.id, END)
        elif node.kind == "review":
            builder.add_conditional_edges(
                node.id, _route_review, {"stop": END, "continue": successors[node.id]}
            )
        else:
            builder.add_edge(node.id, successors[node.id])
    builder.add_edge(START, workflow.start_node)
    return builder.compile(checkpointer=InMemorySaver())


@dataclass
class _Run:
    workflow: Workflow
    graph: Any


class RunStore:
    """Process-local runs. Lock mutations so duplicate resumes cannot race."""

    def __init__(self, capacity: int = 100) -> None:
        self._runs: dict[str, _Run] = {}
        self._lock = RLock()
        self._capacity = capacity

    @staticmethod
    def _config(run_id: str) -> dict[str, Any]:
        return {"configurable": {"thread_id": run_id}, "recursion_limit": 64}

    def start(self, request: RunRequest) -> RunSnapshot:
        with self._lock:
            if len(self._runs) >= self._capacity:
                raise OverflowError("Local run capacity reached. Restart the API to clear runs.")
            workflow = request.workflow.model_copy(deep=True)
            run_id = str(uuid4())
            run = _Run(workflow=workflow, graph=compile_workflow(workflow))
            run.graph.invoke(
                {"brief": request.brief, "events": [], "rejected": False}, self._config(run_id)
            )
            self._runs[run_id] = run
            return self.get(run_id)

    def get(self, run_id: str) -> RunSnapshot:
        with self._lock:
            run = self._runs[run_id]
            state = run.graph.get_state(self._config(run_id))
            pending = [item for task in state.tasks for item in task.interrupts]
            status: Literal["paused", "completed", "rejected"] = "completed"
            if state.values["rejected"]:
                status = "rejected"
            elif pending:
                status = "paused"
            return RunSnapshot(
                id=run_id,
                workflow=run.workflow.model_copy(deep=True),
                brief=state.values["brief"],
                status=status,
                events=state.values["events"],
                review=ReviewPrompt.model_validate(pending[0].value) if pending else None,
            )

    def resume(self, run_id: str, decision: Literal["approve", "reject"]) -> RunSnapshot:
        with self._lock:
            if self.get(run_id).status != "paused":
                raise ValueError("Only a paused run can be resumed.")
            self._runs[run_id].graph.invoke(Command(resume=decision), self._config(run_id))
            return self.get(run_id)
