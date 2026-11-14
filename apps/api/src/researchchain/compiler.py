"""Compile bounded structured documents to checkpointable LangGraph execution."""

import operator
from collections.abc import Callable
from typing import Annotated, Any, TypedDict

from langchain_core.runnables import RunnableLambda
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from researchchain.graph import (
    ForkConfig,
    GraphDefinition,
    LoopConfig,
    Predicate,
    RouteConfig,
    SubgraphConfig,
    ValueSource,
    Workflow,
    WorkflowNode,
)

STRUCTURED_COMPILER_VERSION = "structured-0.2.0"


class ExecutionStopped(Exception):
    def __init__(self, reason: str, status: str = "limited") -> None:
        super().__init__(reason)
        self.status = status


def merge_records(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    return {**left, **right}


class StructuredState(TypedDict):
    brief: str
    artifact_ids: list[str]
    records: Annotated[dict[str, dict[str, Any]], merge_records]
    outputs: Annotated[dict[str, dict[str, Any]], merge_records]
    rejected: Annotated[bool, operator.or_]


Guard = Callable[[str, bool], None]


def read_value(source: ValueSource, state: StructuredState, prefix: str, iteration: int) -> Any:
    if source.source == "brief":
        return state["brief"]
    if source.source == "artifact_count":
        return len(state["artifact_ids"])
    if source.source == "iteration":
        return iteration
    return state["outputs"][f"{prefix}/{source.node_id}"][source.port]  # type: ignore[index]


def evaluate(predicate: Predicate, state: StructuredState, prefix: str, iteration: int) -> bool:
    left = read_value(predicate.left, state, prefix, iteration)
    right = predicate.value
    match predicate.operator:
        case "equals":
            return bool(left == right)
        case "not_equals":
            return bool(left != right)
        case "contains":
            return str(right) in str(left)
        case "gt":
            return bool(left > right)
        case "gte":
            return bool(left >= right)
        case "lt":
            return bool(left < right)
        case "lte":
            return bool(left <= right)


def node_function(
    node: WorkflowNode, path: str, prefix: str, iteration: int, guard: Guard
) -> Callable[[StructuredState], dict[str, Any]]:
    def execute(state: StructuredState) -> dict[str, Any]:
        if state.get("rejected"):
            return {}
        guard(path, True)
        outputs: dict[str, Any] = {}
        rejected = False
        if node.kind == "review":
            decision = interrupt(
                {
                    "node_id": node.id,
                    "path": path,
                    "question": node.instructions or "Continue this workflow?",
                }
            )
            rejected = decision == "reject"
            outputs["decision"] = decision
            detail = "Rejected by reviewer" if rejected else "Approved by reviewer"
        elif node.kind == "note":
            detail = (
                str(read_value(node.inputs["text"], state, prefix, iteration))
                if "text" in node.inputs
                else node.instructions or "Note recorded."
            )
            outputs["text"] = detail
        elif node.kind == "finish":
            detail = "Workflow completed." if prefix == "root" else "Subgraph completed."
        elif node.kind == "fork":
            detail = "Started parallel branches."
        elif node.kind == "route":
            assert isinstance(node.config, RouteConfig)
            selected = evaluate(node.config.condition, state, prefix, iteration)
            detail = f"Selected {'true' if selected else 'false'} branch."
        elif node.kind == "join":
            detail = "Branches joined."
        elif node.kind == "loop":
            detail = "Started bounded loop."
        else:
            detail = "Entered pinned subgraph."
        guard(path, False)
        return {
            "records": {
                path: {
                    "node_id": node.id,
                    "path": path,
                    "label": node.label,
                    "kind": node.kind,
                    "detail": detail,
                }
            },
            "outputs": {path: outputs},
            "rejected": rejected,
        }

    return execute


class StructuredCompiler:
    def __init__(self, workflow: Workflow, guard: Guard) -> None:
        self.workflow = workflow
        self.guard = guard
        self.builder = StateGraph(StructuredState)
        self.definitions = {(item.id, item.version): item for item in workflow.subgraphs}

    @staticmethod
    def pass_through(state: StructuredState) -> dict[str, Any]:
        return {}

    def loop_check(
        self, node: WorkflowNode, path: str, body_prefix: str, iteration: int
    ) -> Callable[[StructuredState], dict[str, Any]]:
        config = node.config
        assert isinstance(config, LoopConfig)

        def check(state: StructuredState) -> dict[str, Any]:
            if state.get("rejected"):
                return {}
            self.guard(f"{path}/check-{iteration}", True)
            satisfied = config.until is not None and evaluate(
                config.until, state, body_prefix, iteration
            )
            if config.until and not satisfied and iteration == config.max_iterations:
                raise ExecutionStopped(f"Loop '{node.label}' exhausted {iteration} iterations.")
            detail = f"Iteration {iteration} completed."
            if satisfied:
                detail += " Exit condition satisfied."
            return {
                "outputs": {path: {"iterations": iteration, "satisfied": satisfied}},
                "records": {
                    f"{path}/check-{iteration}": {
                        "node_id": node.id,
                        "path": f"{path}/check-{iteration}",
                        "label": node.label,
                        "kind": "loop",
                        "detail": detail,
                    }
                },
            }

        return check

    @staticmethod
    def loop_route(path: str, done: str, next_body: str) -> Callable[[StructuredState], str]:
        def route(state: StructuredState) -> str:
            if state.get("rejected"):
                return END
            return done if state["outputs"][path].get("satisfied") else next_body

        return route

    def add_graph(self, graph: GraphDefinition, prefix: str, iteration: int = 0) -> tuple[str, str]:
        entries = {node.id: f"{prefix}/{node.id}" for node in graph.nodes}
        exits = dict(entries)
        owners = {
            node.config.join: node.kind
            for node in graph.nodes
            if isinstance(node.config, (RouteConfig, ForkConfig))
        }
        finish = ""
        for node in graph.nodes:
            path = entries[node.id]
            self.builder.add_node(
                path, RunnableLambda(node_function(node, path, prefix, iteration, self.guard))
            )
            if node.kind == "finish":
                finish = path
            if isinstance(node.config, (SubgraphConfig, LoopConfig)):
                config = node.config
                body = self.definitions[config.ref.id, config.ref.version]
                done = f"{path}/_exit"
                self.builder.add_node(done, self.pass_through)
                exits[node.id] = done
                if isinstance(config, SubgraphConfig):
                    first, last = self.add_graph(body, f"{path}/body", iteration)
                    self.builder.add_edge(path, first)
                    self.builder.add_edge(last, done)
                else:
                    bodies = [
                        self.add_graph(body, f"{path}/iteration-{i}", i)
                        for i in range(1, config.max_iterations + 1)
                    ]
                    self.builder.add_edge(path, bodies[0][0])
                    for index, (_, last) in enumerate(bodies):
                        number = index + 1
                        check_path = f"{path}/check-{number}"
                        self.builder.add_node(
                            check_path,
                            RunnableLambda(
                                self.loop_check(node, path, f"{path}/iteration-{number}", number)
                            ),
                        )
                        self.builder.add_edge(last, check_path)
                        next_body = bodies[number][0] if number < len(bodies) else done
                        self.builder.add_conditional_edges(
                            check_path, self.loop_route(path, done, next_body)
                        )
        for node in graph.nodes:
            outgoing = {
                edge.source_port: entries[edge.target]
                for edge in graph.edges
                if edge.source == node.id
            }
            if isinstance(node.config, RouteConfig):
                self.builder.add_conditional_edges(
                    entries[node.id], self.route(node.config.condition, outgoing, prefix, iteration)
                )
            elif isinstance(node.config, ForkConfig):
                self.builder.add_conditional_edges(
                    entries[node.id], self.fork(list(outgoing.values()))
                )
            elif node.kind != "finish":
                edge = next(edge for edge in graph.edges if edge.source == node.id)
                if owners.get(edge.target) != "fork":
                    self.builder.add_conditional_edges(
                        exits[node.id], self.follow(outgoing["next"])
                    )
        for join, kind in owners.items():
            if kind == "fork":
                tails = [exits[edge.source] for edge in graph.edges if edge.target == join]
                self.builder.add_edge(tails, entries[join])
        return entries[graph.start_node], finish

    @staticmethod
    def route(
        predicate: Predicate, outgoing: dict[str, str], prefix: str, iteration: int
    ) -> Callable[[StructuredState], str]:
        def choose(state: StructuredState) -> str:
            if state.get("rejected"):
                return END
            return outgoing["true" if evaluate(predicate, state, prefix, iteration) else "false"]

        return choose

    @staticmethod
    def follow(target: str) -> Callable[[StructuredState], str]:
        def choose(state: StructuredState) -> str:
            return END if state.get("rejected") else target

        return choose

    @staticmethod
    def fork(targets: list[str]) -> Callable[[StructuredState], list[str]]:
        def choose(state: StructuredState) -> list[str]:
            return [END] if state.get("rejected") else targets

        return choose

    def compile(self, checkpointer: BaseCheckpointSaver[Any]) -> Any:
        first, last = self.add_graph(self.workflow, "root")
        self.builder.add_edge(START, first)
        self.builder.add_edge(last, END)
        return self.builder.compile(checkpointer=checkpointer)


def compile_structured(
    workflow: Workflow, checkpointer: BaseCheckpointSaver[Any], guard: Guard | None = None
) -> Any:
    return StructuredCompiler(workflow, guard or (lambda path, count: None)).compile(checkpointer)
