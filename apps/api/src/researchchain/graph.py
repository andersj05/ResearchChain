"""Versioned workflow documents and server-side structured-control validation."""

from collections import deque
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Position(StrictModel):
    x: float = Field(ge=-10000, le=10000, allow_inf_nan=False)
    y: float = Field(ge=-10000, le=10000, allow_inf_nan=False)


NodeKind = Literal[
    "note", "review", "finish", "route", "fork", "join", "loop", "subgraph", "research", "code"
]
PortType = Literal["control", "text", "number"]


class ValueSource(StrictModel):
    source: Literal["brief", "artifact_count", "iteration", "output", "previous_iteration"]
    node_id: str | None = None
    port: str | None = None

    @model_validator(mode="after")
    def validate_reference(self) -> Self:
        if self.source in ("output", "previous_iteration"):
            if not self.node_id or not self.port:
                raise ValueError("Output references require node_id and port.")
        elif self.node_id is not None or self.port is not None:
            raise ValueError("Only output references accept node_id and port.")
        return self


class Predicate(StrictModel):
    left: ValueSource
    operator: Literal["equals", "not_equals", "contains", "gt", "gte", "lt", "lte"]
    value: str | Annotated[float, Field(allow_inf_nan=False)]


class RouteConfig(StrictModel):
    type: Literal["route"] = "route"
    condition: Predicate
    join: str


class ForkConfig(StrictModel):
    type: Literal["fork"] = "fork"
    join: str
    branches: list[str] = Field(min_length=2, max_length=8)

    @model_validator(mode="after")
    def validate_branches(self) -> Self:
        import re

        if len(set(self.branches)) != len(self.branches) or any(
            not re.fullmatch(r"[a-z][a-z0-9_-]{0,31}", name) for name in self.branches
        ):
            raise ValueError("Branch ports must be unique lowercase identifiers.")
        return self


class SubgraphRef(StrictModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    version: int = Field(ge=1, le=100000)


class SubgraphConfig(StrictModel):
    type: Literal["subgraph"] = "subgraph"
    ref: SubgraphRef


class LoopConfig(StrictModel):
    type: Literal["loop"] = "loop"
    ref: SubgraphRef
    max_iterations: int = Field(ge=1, le=20)
    until: Predicate | None = None


ResearchStage = Literal["hypothesize", "challenge", "revise", "custom"]
ModelSlug = Annotated[str, Field(pattern=r"^[a-zA-Z0-9._:-]{1,120}$")]
ReasoningEffort = Literal["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]
ResponseVerbosity = Literal["low", "medium", "high"]
EffortOverride = ReasoningEffort | Literal["model_default"]
VerbosityOverride = ResponseVerbosity | Literal["model_default"]


class ModelOverride(StrictModel):
    model: ModelSlug | None = Field(default=None, exclude_if=lambda value: value is None)
    reasoning_effort: EffortOverride | None = Field(default=None, exclude_if=lambda x: x is None)
    verbosity: VerbosityOverride | None = Field(default=None, exclude_if=lambda x: x is None)


class AnalystConfig(StrictModel):
    max_passes: int = Field(default=4, ge=1, le=100)
    skill: str = Field(default="", max_length=32000, pattern=r"^[^\x00]*$")
    workspace: bool = Field(default=False, exclude_if=lambda enabled: not enabled)

    @model_validator(mode="after")
    def workspace_needs_synthesis(self) -> Self:
        if self.workspace and self.max_passes < 2:
            raise ValueError(
                "A Python workspace needs at least two passes for a tool and its result."
            )
        return self


class SwarmConfig(StrictModel):
    lead_count: int = Field(default=2, ge=1, le=4)
    researchers_per_lead: int = Field(default=20, ge=1, le=20)
    max_parallel: int = Field(default=4, ge=1, le=20)
    max_lead_turns: int = Field(default=6, ge=2, le=12)
    allow_consultations: bool = True


class ResearchTeamConfig(StrictModel):
    max_agents: int = Field(ge=1, le=4)
    swarm: SwarmConfig | None = Field(default=None, exclude_if=lambda value: value is None)
    lead: ModelOverride | None = Field(
        default=None, exclude_if=lambda v: not v or not v.model_dump()
    )
    researcher: ModelOverride | None = Field(
        default=None, exclude_if=lambda v: not v or not v.model_dump()
    )


class ResearchConfig(StrictModel):
    type: Literal["research"] = "research"
    stage: ResearchStage = "hypothesize"
    prompt_version: Literal["research-1", "custom-1"] = "research-1"
    style_excerpt: str | None = Field(
        default=None, max_length=32000, pattern=r"^[^\x00]*$", exclude_if=lambda value: not value
    )
    model: ModelSlug | None = Field(default=None, exclude_if=lambda value: value is None)
    reasoning_effort: EffortOverride | None = Field(default=None, exclude_if=lambda x: x is None)
    verbosity: VerbosityOverride | None = Field(default=None, exclude_if=lambda x: x is None)

    web_search: bool | Literal["auto"] = False
    sec_financials: bool = False
    analyst: AnalystConfig | None = Field(default=None, exclude_if=lambda value: value is None)
    team: ResearchTeamConfig | None = Field(default=None, exclude_if=lambda value: value is None)

    @model_validator(mode="after")
    def matching_prompt(self) -> Self:
        if self.style_excerpt and (self.stage != "custom" or self.team):
            raise ValueError("A writing sample belongs to an individual custom writing step.")
        if self.team and not (self.stage == "custom" and self.analyst and self.analyst.workspace):
            raise ValueError("A research team requires a custom Codex analyst with a workspace.")
        if (self.web_search or self.sec_financials or self.analyst) and self.stage != "custom":
            raise ValueError("External research tools are available on custom model steps only.")
        expected = "custom-1" if self.stage == "custom" else "research-1"
        if self.prompt_version != expected:
            raise ValueError("The stage must use its matching prompt version.")
        return self


class CodeConfig(StrictModel):
    type: Literal["code"] = "code"
    language: Literal["javascript"] = "javascript"
    runtime: Literal["quickjs-ng-0.18.0.1"] = "quickjs-ng-0.18.0.1"
    source: str = Field(min_length=1, max_length=20000, pattern=r"^[^\x00]*$")
    timeout_seconds: float = Field(default=1, ge=0.05, le=5, allow_inf_nan=False)


MAX_RESPONSE_SECONDS = 600
# An optional source reading, one coordinator and four leads taking twelve turns.
# Eighty researchers and the editor can each take twelve passes. Account limits still apply.
MAX_RESEARCH_CALLS = 2 + 4 * 12 + (4 * 20 + 1) * 12


class ResearchLimits(StrictModel):
    max_model_calls: int = Field(default=3, ge=0, le=MAX_RESEARCH_CALLS)
    max_tool_calls: int = Field(default=3, ge=0, le=MAX_RESEARCH_CALLS)
    max_input_bytes: int = Field(default=512000, ge=1000, le=8000000)
    max_output_characters: int = Field(default=24000, ge=1000, le=100000)
    max_response_seconds: float = Field(
        default=90, gt=0, le=MAX_RESPONSE_SECONDS, allow_inf_nan=False
    )
    max_total_tokens: Annotated[int, Field(ge=1, le=2**53 - 1)] | Literal["as_needed"] = 1_000_000


class ResearchSettings(StrictModel):
    provider: Literal["chatgpt_plan"] = "chatgpt_plan"
    model: ModelSlug = "gpt-6.1-sol"
    reasoning_effort: ReasoningEffort | None = Field(default=None, exclude_if=lambda x: x is None)
    verbosity: ResponseVerbosity | None = Field(default=None, exclude_if=lambda x: x is None)
    billing: Literal["included_plan"] = "included_plan"
    limits: ResearchLimits = Field(default_factory=ResearchLimits)


@dataclass(frozen=True)
class ModelSelection:
    model: str
    reasoning_effort: EffortOverride | None = None
    verbosity: VerbosityOverride | None = None


def resolve_model(
    settings: ResearchSettings, config: ResearchConfig, role: ModelOverride | None = None
) -> ModelSelection:
    """Resolve each choice independently. Keep explicit model defaults for the wire request."""
    selected = ModelSelection(settings.model, settings.reasoning_effort, settings.verbosity)
    for override in (config, role):
        if override is not None:
            selected = ModelSelection(
                override.model or selected.model,
                override.reasoning_effort or selected.reasoning_effort,
                override.verbosity or selected.verbosity,
            )
    return selected


NodeConfig = Annotated[
    RouteConfig | ForkConfig | SubgraphConfig | LoopConfig | ResearchConfig | CodeConfig,
    Field(discriminator="type"),
]


class WorkflowNode(StrictModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    kind: NodeKind
    label: str = Field(min_length=1, max_length=100)
    instructions: str = Field(default="", max_length=6000)
    position: Position
    config: NodeConfig | None = None
    inputs: dict[str, ValueSource] = Field(default_factory=dict, max_length=8)


class WorkflowEdge(StrictModel):
    source: str
    target: str
    source_port: str = "next"
    target_port: str = "in"


class ExecutionBudgets(StrictModel):
    max_node_executions: int = Field(default=256, ge=1, le=10000)
    max_active_seconds: float = Field(default=120, gt=0, le=3600, allow_inf_nan=False)
    max_concurrency: int = Field(default=4, ge=1, le=20)


class GraphDefinition(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    start_node: str
    nodes: list[WorkflowNode] = Field(min_length=1, max_length=128)
    edges: list[WorkflowEdge] = Field(max_length=256)


class SubgraphDefinition(GraphDefinition):
    id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    version: int = Field(ge=1, le=100000)


OUTPUT_PORTS: dict[str, dict[str, PortType]] = {
    "note": {"text": "text"},
    "code": {"text": "text", "number": "number"},
    "review": {"decision": "text", "feedback": "text"},
    "research": {"text": "text", "review_question": "text"},
    "loop": {"iterations": "number"},
}
INPUT_PORTS: dict[str, dict[str, PortType]] = {
    "note": {"text": "text"},
    "review": {"question": "text"},
    "code": {"text": "text", "number": "number"},
    "research": {"context": "text", "feedback": "text"},
}


def control_ports(node: WorkflowNode) -> list[str]:
    if isinstance(node.config, RouteConfig):
        return ["true", "false"]
    if isinstance(node.config, ForkConfig):
        return node.config.branches
    return [] if node.kind == "finish" else ["next"]


def source_type(
    source: ValueSource, nodes: dict[str, WorkflowNode], available: set[str]
) -> PortType:
    if source.source == "brief":
        return "text"
    if source.source in ("artifact_count", "iteration"):
        return "number"
    if source.node_id not in available or source.node_id not in nodes:
        raise ValueError(f"Output from {source.node_id!r} is not available on every incoming path.")
    ports = OUTPUT_PORTS.get(nodes[source.node_id].kind, {})
    if source.port not in ports:
        raise ValueError(f"Unknown output port {source.node_id}.{source.port}.")
    if source.port == "review_question":
        config = nodes[source.node_id].config
        if not isinstance(config, ResearchConfig) or config.team is None:
            raise ValueError("Only a research team can supply a review question.")
    return ports[source.port]


def validate_predicate(
    predicate: Predicate, nodes: dict[str, WorkflowNode], available: set[str]
) -> None:
    if predicate.left.source == "previous_iteration":
        raise ValueError("Previous iteration outputs are available only to step inputs.")
    kind = source_type(predicate.left, nodes, available)
    if (kind == "text") != isinstance(predicate.value, str):
        raise ValueError("Predicate values must match the input port type.")
    if predicate.operator == "contains" and kind != "text":
        raise ValueError("Contains requires a text port.")
    if predicate.operator in ("gt", "gte", "lt", "lte") and kind != "number":
        raise ValueError("Numeric comparisons require a number port.")


def _located_value_error(
    error: ValueError, location: tuple[str | int, ...], value: object
) -> ValidationError:
    return ValidationError.from_exception_data(
        "Workflow",
        [{"type": "value_error", "loc": location, "input": value, "ctx": {"error": error}}],
    )


def validate_graph(
    graph: GraphDefinition,
    *,
    legacy: bool = False,
    allow_previous_iteration: bool = False,
    location: tuple[str | int, ...] = (),
) -> None:
    nodes = {node.id: node for node in graph.nodes}
    if len(nodes) != len(graph.nodes):
        raise ValueError("Node IDs must be unique.")
    if graph.start_node not in nodes:
        raise ValueError("Start node must exist.")
    outgoing: dict[str, dict[str, str]] = {node_id: {} for node_id in nodes}
    incoming: dict[str, list[str]] = {node_id: [] for node_id in nodes}
    for edge in graph.edges:
        if edge.source not in nodes or edge.target not in nodes:
            raise ValueError("Every connection must reference existing nodes.")
        if edge.source == edge.target or edge.source_port in outgoing[edge.source]:
            raise ValueError("Duplicate output connections and self-loops are not supported.")
        if edge.target_port != "in":
            raise ValueError("Control connections must target the control input port 'in'.")
        outgoing[edge.source][edge.source_port] = edge.target
        incoming[edge.target].append(edge.source)
    finishes = [node.id for node in graph.nodes if node.kind == "finish"]
    if len(finishes) != 1:
        raise ValueError("A workflow must contain exactly one finish node.")
    indices = {node.id: index for index, node in enumerate(graph.nodes)}

    def topology_error(node: WorkflowNode, message: str) -> ValidationError:
        return _located_value_error(
            ValueError(message),
            (*location, "nodes", indices[node.id]),
            node.model_dump(mode="json"),
        )

    owners: dict[str, WorkflowNode] = {}
    for node in graph.nodes:
        if legacy:
            if node.kind not in ("note", "review", "finish") or node.config or node.inputs:
                raise ValueError("Version 0.1 only supports note, review, and finish nodes.")
        elif node.kind in ("route", "fork", "loop", "subgraph", "research", "code"):
            if node.config is None or node.config.type != node.kind:
                raise ValueError(
                    f"Node {node.id} requires its registered {node.kind} configuration."
                )
        elif node.config is not None:
            raise ValueError(f"Node {node.id} does not accept that configuration.")
        if set(outgoing[node.id]) != set(control_ports(node)):
            message = (
                "Version 0.1 supports one connected chain ending at finish."
                if legacy
                else f"Node {node.id} must connect each declared control output exactly once."
            )
            raise topology_error(node, message)
        if node.id == graph.start_node:
            if incoming[node.id]:
                raise ValueError("The start node cannot have incoming connections.")
        elif node.kind == "join" and not legacy:
            if len(incoming[node.id]) < 2:
                raise topology_error(node, "A join needs at least two incoming branches.")
        elif len(incoming[node.id]) != 1:
            raise ValueError("Branches must reconverge at an explicit join.")
        if isinstance(node.config, (RouteConfig, ForkConfig)):
            join = node.config.join
            if join not in nodes or nodes[join].kind != "join" or join in owners:
                raise _located_value_error(
                    ValueError("Each split requires its own existing join node."),
                    (*location, "nodes", indices[node.id], "config", "join"),
                    join,
                )
            owners[join] = node
            if len(set(outgoing[node.id].values())) != len(outgoing[node.id]):
                raise topology_error(node, "Split branches must have distinct starting nodes.")
    if legacy and (len(nodes) > 32 or len(graph.edges) > 31):
        raise ValueError("Version 0.1 supports at most 32 nodes in one connected chain.")
    # Reject cycles before recursively checking the structured branch regions.
    remaining = {key: len(value) for key, value in incoming.items()}
    queue = deque(key for key, count in remaining.items() if count == 0)
    order = []
    while queue:
        current = queue.popleft()
        order.append(current)
        for target in outgoing[current].values():
            remaining[target] -= 1
            if remaining[target] == 0:
                queue.append(target)
    if len(order) != len(nodes):
        raise ValueError(
            "Every node must be reachable without cycles; use a bounded loop and versioned body."
        )
    visited: set[str] = set()

    def walk(current: str, stop: str | None) -> None:
        while current != stop:
            if current in visited:
                raise ValueError("Branch regions must be disjoint until their paired join.")
            visited.add(current)
            node = nodes[current]
            if isinstance(node.config, (RouteConfig, ForkConfig)):
                join = node.config.join
                for target in outgoing[current].values():
                    if target == join:
                        raise topology_error(node, "A split branch needs a step before its join.")
                    walk(target, join)
                if join in visited:
                    raise ValueError("Crossed or shared joins are ambiguous.")
                visited.add(join)
                current = outgoing[join]["next"]
            elif node.kind == "join":
                message = "A branch reached a different split's join."
                if stop is not None:
                    raise topology_error(owners[stop], message)
                raise ValueError(message)
            elif node.kind == "finish":
                if stop is not None:
                    raise topology_error(
                        owners[stop], "Every branch must reach its paired join before finishing."
                    )
                return
            else:
                current = outgoing[current]["next"]

    walk(graph.start_node, None)
    if visited != set(nodes):
        raise ValueError("Every node must be reachable from the start.")
    previous_outputs = (
        guaranteed_outputs(graph)
        if allow_previous_iteration
        and any(
            source.source == "previous_iteration"
            for node in graph.nodes
            for source in node.inputs.values()
        )
        else set()
    )
    # Availability follows actual join semantics, not mere reachability.
    available: dict[str, set[str]] = {}
    for node_id in order:
        predecessors = [available[p] | {p} for p in incoming[node_id]]
        if not predecessors:
            before: set[str] = set()
        elif node_id in owners and owners[node_id].kind == "fork":
            before = set.union(*predecessors)
        else:
            before = set.intersection(*predecessors)
        available[node_id] = before
        node = nodes[node_id]
        node_location = (*location, "nodes", indices[node_id])
        for port, source in node.inputs.items():
            try:
                expected = INPUT_PORTS.get(node.kind, {}).get(port)
                if (
                    node.kind == "review"
                    and port == "question"
                    and (source.source != "output" or source.port != "review_question")
                ):
                    raise ValueError("Connect the review question to a research team's question.")
                sources = before
                if source.source == "previous_iteration":
                    if not allow_previous_iteration:
                        raise ValueError(
                            "Previous iteration outputs require a direct loop body with no "
                            "ordinary subgraph callers."
                        )
                    if isinstance(node.config, ResearchConfig):
                        if port == "context" and node.config.stage in ("challenge", "revise"):
                            raise ValueError("This research preset needs context on iteration 1.")
                        if port == "feedback" and source.port != "feedback":
                            raise ValueError(
                                "Reviewer feedback must come from a review's feedback port."
                            )
                    sources = previous_outputs
                if expected is None or source_type(source, nodes, sources) != expected:
                    raise ValueError(
                        f"Input {node_id}.{port} is unknown or has an incompatible type."
                    )
            except ValueError as error:
                raise _located_value_error(
                    error, (*node_location, "inputs", port), source.model_dump(mode="json")
                ) from error
        if isinstance(node.config, RouteConfig):
            condition = node.config.condition
            try:
                validate_predicate(condition, nodes, before)
            except ValueError as error:
                raise _located_value_error(
                    error,
                    (*node_location, "config", "condition"),
                    condition.model_dump(mode="json"),
                ) from error
        # Loop predicates use the loop body's final outputs and are checked below.


class Workflow(GraphDefinition):
    schema_version: Literal["0.1", "0.2", "0.3"] = "0.1"
    subgraphs: list[SubgraphDefinition] = Field(default_factory=list, max_length=32)
    budgets: ExecutionBudgets = Field(default_factory=ExecutionBudgets)
    research: ResearchSettings | None = None

    @model_validator(mode="after")
    def validate_topology(self) -> Self:
        legacy = self.schema_version == "0.1"
        all_graphs: list[GraphDefinition] = [self, *self.subgraphs]
        has_research = any(node.kind == "research" for graph in all_graphs for node in graph.nodes)
        if self.schema_version != "0.3":
            if has_research or self.research:
                raise ValueError("Research nodes and settings require schema version 0.3.")
            for graph in all_graphs:
                for node in graph.nodes:
                    sources = list(node.inputs.values())
                    if isinstance(node.config, RouteConfig):
                        sources.append(node.config.condition.left)
                    if isinstance(node.config, LoopConfig) and node.config.until:
                        sources.append(node.config.until.left)
                    if any(source.port == "feedback" for source in sources):
                        raise ValueError("Reviewer feedback requires schema version 0.3.")
        if has_research and self.research is None:
            raise ValueError("Research nodes require provider, model, and execution settings.")
        if legacy and (self.subgraphs or self.budgets != ExecutionBudgets()):
            raise ValueError("Subgraphs and configurable budgets require schema version 0.2.")
        validate_graph(self, legacy=legacy)
        definitions = {
            (item.id, item.version): (index, item) for index, item in enumerate(self.subgraphs)
        }
        if len(definitions) != len(self.subgraphs):
            raise ValueError("Subgraph id/version pairs must be unique within the revision.")
        ordinary_bodies = {
            (node.config.ref.id, node.config.ref.version)
            for graph in all_graphs
            for node in graph.nodes
            if isinstance(node.config, SubgraphConfig)
        }
        for index, definition in enumerate(self.subgraphs):
            # An unused version can retain its inputs when a caller pins a newer version.
            validate_graph(
                definition,
                allow_previous_iteration=(definition.id, definition.version) not in ordinary_bodies,
                location=("subgraphs", index),
            )
        visiting: set[tuple[str, int]] = set()
        costs: dict[tuple[str, int], int] = {}

        def expansion(
            graph: GraphDefinition, depth: int, location: tuple[str | int, ...] = ()
        ) -> int:
            if depth > 8:
                raise ValueError("Nested subgraphs cannot exceed eight levels.")
            count = len(graph.nodes)
            for index, node in enumerate(graph.nodes):
                config = node.config
                if not isinstance(config, (SubgraphConfig, LoopConfig)):
                    continue
                key = (config.ref.id, config.ref.version)
                if key not in definitions:
                    raise ValueError(f"Missing pinned subgraph definition {key}.")
                if key in visiting:
                    raise ValueError("Recursive subgraph references are not supported.")
                visiting.add(key)
                body_index, body = definitions[key]
                body_cost = expansion(body, depth + 1, ("subgraphs", body_index))
                visiting.remove(key)
                costs[key] = body_cost
                iterations = config.max_iterations if isinstance(config, LoopConfig) else 1
                count += iterations * (body_cost + 1) + 1
                if isinstance(config, LoopConfig) and config.until:
                    body_nodes = {item.id: item for item in body.nodes}
                    # A body output is valid only if available at its finish.
                    guaranteed = guaranteed_outputs(body)
                    try:
                        validate_predicate(config.until, body_nodes, guaranteed)
                    except ValueError as error:
                        raise _located_value_error(
                            error,
                            (*location, "nodes", index, "config", "until"),
                            config.until.model_dump(mode="json"),
                        ) from error
                if count > 2048:
                    raise ValueError("Expanded workflow exceeds the 2048-node compilation limit.")
            return count

        expansion(self, 0)
        for key, (index, definition) in definitions.items():
            if key not in costs:
                visiting.add(key)
                expansion(definition, 1, ("subgraphs", index))
                visiting.remove(key)
        return self

    def executable_research_configs(self) -> Iterator[ResearchConfig]:
        """Visit research nodes in the root and its pinned subgraph versions."""
        definitions = {(item.id, item.version): item for item in self.subgraphs}
        pending: list[GraphDefinition] = [self]
        while pending:
            for node in pending.pop().nodes:
                config = node.config
                if isinstance(config, ResearchConfig):
                    yield config
                elif isinstance(config, (LoopConfig, SubgraphConfig)):
                    body = definitions.pop((config.ref.id, config.ref.version), None)
                    if body:
                        pending.append(body)

    def has_research_swarm(self) -> bool:
        return any(
            config.team and config.team.swarm for config in self.executable_research_configs()
        )

    @model_validator(mode="after")
    def validate_run_limits(self) -> Self:
        # Wider budgets are available only to a workflow that can execute a swarm.
        limits: list[tuple[tuple[str, ...], int, int]] = [
            (("budgets", "max_concurrency"), self.budgets.max_concurrency, 16)
        ]
        if self.research:
            budget = self.research.limits
            limits.extend(
                [
                    (("research", "limits", "max_model_calls"), budget.max_model_calls, 100),
                    (("research", "limits", "max_tool_calls"), budget.max_tool_calls, 100),
                ]
            )
        exceeded = [(path, value, limit) for path, value, limit in limits if value > limit]
        if exceeded and not self.has_research_swarm():
            raise ValidationError.from_exception_data(
                "Workflow",
                [
                    {"type": "less_than_equal", "loc": path, "input": value, "ctx": {"le": limit}}
                    for path, value, limit in exceeded
                ],
            )
        return self

    def research_selections(self) -> set[ModelSelection]:
        """Settings for executable roles, excluding archived subgraph versions."""
        assert self.research is not None
        # The workflow's pinned model must remain available even if every step overrides it.
        selections = {ModelSelection(self.research.model)}
        for config in self.executable_research_configs():
            if config.team:
                selections.add(resolve_model(self.research, config, config.team.lead))
                selections.add(resolve_model(self.research, config, config.team.researcher))
            else:
                selections.add(resolve_model(self.research, config))
        return selections

    def research_models(self) -> set[str]:
        return {selection.model for selection in self.research_selections()}

    def canonical_document(self) -> dict[str, Any]:
        """Keep legacy content hashes stable; API responses include normalized defaults."""
        document = self.model_dump(mode="json")
        for graph in [document, *document.get("subgraphs", [])]:
            for node in graph["nodes"]:
                config = node.get("config")
                if config and config.get("type") == "research":
                    for tool in ("web_search", "sec_financials"):
                        if not config.get(tool):
                            config.pop(tool, None)
        if self.schema_version != "0.3":
            document.pop("research", None)
        if self.schema_version == "0.1":
            document.pop("subgraphs", None)
            document.pop("budgets", None)
            for node in document.get("nodes", []):
                node.pop("config", None)
                node.pop("inputs", None)
            for edge in document.get("edges", []):
                edge.pop("source_port", None)
                edge.pop("target_port", None)
        return document


def guaranteed_outputs(graph: GraphDefinition) -> set[str]:
    """Outputs guaranteed on successful completion of this structured graph."""
    nodes = {node.id: node for node in graph.nodes}
    edges = {(edge.source, edge.source_port): edge.target for edge in graph.edges}

    def walk(current: str, stop: str | None) -> set[str]:
        result: set[str] = set()
        while current != stop:
            node = nodes[current]
            result.add(current)
            if isinstance(node.config, (RouteConfig, ForkConfig)):
                branches = [
                    walk(edges[current, port], node.config.join) for port in control_ports(node)
                ]
                result |= (
                    set.union(*branches) if node.kind == "fork" else set.intersection(*branches)
                )
                current = node.config.join
                result.add(current)
            if nodes[current].kind == "finish":
                break
            current = edges[current, "next"]
        return result

    return walk(graph.start_node, None)
