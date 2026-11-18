from copy import deepcopy
from typing import Any

import pytest
from graph_fixtures import chain, edge, nested, node, predicate, split
from pydantic import ValidationError

from researchchain.graph import Workflow


@pytest.mark.parametrize("kind", ["fork", "route"])
def test_branch_contract_round_trips(kind: str) -> None:
    parsed = Workflow.model_validate(split(kind))
    assert Workflow.model_validate_json(parsed.model_dump_json()) == parsed


@pytest.mark.parametrize("kind", ["subgraph", "loop"])
def test_nested_contract_round_trips(kind: str) -> None:
    parsed = Workflow.model_validate(nested(kind, until=True))
    assert Workflow.model_validate_json(parsed.model_dump_json()) == parsed


@pytest.mark.parametrize("in_subgraph", [False, True])
def test_disconnected_control_output_identifies_the_invalid_step(in_subgraph: bool) -> None:
    document = nested()
    graph = document["subgraphs"][0] if in_subgraph else document
    graph["edges"] = []
    with pytest.raises(ValidationError, match="connect each declared control output") as raised:
        Workflow.model_validate(document)
    assert raised.value.errors()[0]["loc"] == (
        ("subgraphs", 0, "nodes", 0) if in_subgraph else ("nodes", 0)
    )


def test_graph_wide_validation_has_no_step_location() -> None:
    document = nested()
    document["start_node"] = "missing"
    with pytest.raises(ValidationError, match="Start node must exist") as raised:
        Workflow.model_validate(document)
    assert raised.value.errors()[0]["loc"] == ()


@pytest.mark.parametrize("in_subgraph", [False, True])
@pytest.mark.parametrize(
    "fault,location,message",
    [
        ("missing_join", (0, "config", "join"), "Each split requires its own existing join node."),
        ("claimed_join", (1, "config", "join"), "Each split requires its own existing join node."),
        ("same_start", (0,), "Split branches must have distinct starting nodes."),
        ("direct_join", (0,), "A split branch needs a step before its join."),
        ("single_input", (4,), "A join needs at least two incoming branches."),
    ],
)
def test_branch_topology_errors_identify_the_affected_step(
    in_subgraph: bool, fault: str, location: tuple[str | int, ...], message: str
) -> None:
    graph = split("route" if fault in ("missing_join", "direct_join") else "fork")
    if fault == "missing_join":
        graph["nodes"][0]["config"]["join"] = "missing"
    elif fault == "claimed_join":
        graph["nodes"][1] = node("left", "fork", config=deepcopy(graph["nodes"][0]["config"]))
        graph["nodes"].extend([node("inner_a"), node("inner_b")])
        graph["edges"][2] = edge("left", "inner_a", "left")
        graph["edges"].extend(
            [edge("left", "inner_b", "right"), edge("inner_a", "join"), edge("inner_b", "join")]
        )
    elif fault == "same_start":
        graph["edges"][1]["target"] = "left"
    elif fault == "direct_join":
        graph["edges"][0]["target"] = "join"
        del graph["nodes"][1], graph["edges"][2]
    else:
        graph["edges"][2]["target"] = "finish"

    document = graph
    prefix = ("subgraphs", 0) if in_subgraph else ()
    if in_subgraph:
        document = nested()
        graph.pop("schema_version")
        document["subgraphs"][0].update(graph)

    with pytest.raises(ValidationError) as raised:
        Workflow.model_validate(document)

    error = raised.value.errors()[0]
    assert error["loc"] == (*prefix, "nodes", *location)
    assert error["msg"] == f"Value error, {message}"


@pytest.mark.parametrize(
    "branch_target,owner_index,message",
    [
        ("outer_join", 1, "A branch reached a different split's join."),
        ("inner_join", 0, "Every branch must reach its paired join before finishing."),
    ],
)
def test_branch_walk_errors_identify_the_nearest_owning_split(
    branch_target: str, owner_index: int, message: str
) -> None:
    workflow = {
        "schema_version": "0.2",
        "name": "Nested splits",
        "start_node": "outer",
        "nodes": [
            node(
                "outer",
                "fork",
                config={"type": "fork", "branches": ["a", "b", "c"], "join": "outer_join"},
            ),
            node(
                "inner",
                "route",
                config={"type": "route", "condition": predicate(), "join": "inner_join"},
            ),
            *[node(step) for step in ("a", "b", "c", "d")],
            node("outer_join", "join"),
            node("inner_join", "join"),
            node("finish", "finish"),
        ],
        "edges": [
            edge("outer", "inner", "a"),
            edge("outer", "c", "b"),
            edge("outer", "d", "c"),
            edge("inner", "a", "true"),
            edge("inner", "b", "false"),
            edge("a", branch_target),
            edge("b", "inner_join"),
            edge("c", "outer_join"),
            edge("d", "outer_join"),
            edge("outer_join", "inner_join"),
            edge("inner_join", "finish"),
        ],
    }
    with pytest.raises(ValidationError) as raised:
        Workflow.model_validate(workflow)

    error = raised.value.errors()[0]
    assert error["loc"] == ("nodes", owner_index)
    assert error["msg"] == f"Value error, {message}"


@pytest.mark.parametrize("in_subgraph", [False, True])
@pytest.mark.parametrize(
    "port,source,message",
    [
        (
            "text",
            {"source": "output", "node_id": "consumer", "port": "text"},
            "Output from 'consumer' is not available on every incoming path.",
        ),
        (
            "text",
            {"source": "output", "node_id": "source", "port": "missing"},
            "Unknown output port source.missing.",
        ),
        (
            "text",
            {"source": "artifact_count"},
            "Input consumer.text is unknown or has an incompatible type.",
        ),
        (
            "unknown",
            {"source": "output", "node_id": "missing", "port": "text"},
            "Input consumer.unknown is unknown or has an incompatible type.",
        ),
    ],
)
def test_input_binding_errors_identify_the_invalid_input(
    in_subgraph: bool, port: str, source: dict[str, str], message: str
) -> None:
    graph = chain(node("source"), node("consumer", inputs={port: source}), node("finish", "finish"))
    # The diagnostic index follows the document order instead of the execution order.
    graph["nodes"].append(graph["nodes"].pop(1))
    document = graph
    location: tuple[str | int, ...] = ("nodes", 2, "inputs", port)
    if in_subgraph:
        document = nested()
        graph.pop("schema_version")
        document["subgraphs"][0].update(graph)
        location = ("subgraphs", 0, *location)

    with pytest.raises(ValidationError) as raised:
        Workflow.model_validate(document)

    error = raised.value.errors()[0]
    assert error["loc"] == location
    assert error["msg"] == f"Value error, {message}"


@pytest.mark.parametrize("in_subgraph", [False, True])
@pytest.mark.parametrize(
    "condition,message",
    [
        (predicate("brief", 2, "equals"), "Predicate values must match the input port type."),
        (predicate("iteration", 2, "contains"), "Contains requires a text port."),
        (predicate("brief", "yes", "gte"), "Numeric comparisons require a number port."),
        (
            {
                "left": {"source": "output", "node_id": "left", "port": "text"},
                "operator": "contains",
                "value": "yes",
            },
            "Output from 'left' is not available on every incoming path.",
        ),
    ],
)
def test_route_predicate_errors_identify_the_invalid_condition(
    in_subgraph: bool, condition: dict[str, Any], message: str
) -> None:
    graph = split("route")
    graph["nodes"][0]["config"]["condition"] = condition
    document = graph
    location: tuple[str | int, ...] = ("nodes", 0, "config", "condition")
    if in_subgraph:
        document = nested()
        graph.pop("schema_version")
        document["subgraphs"][0].update(graph)
        location = ("subgraphs", 0, *location)

    with pytest.raises(ValidationError) as raised:
        Workflow.model_validate(document)

    error = raised.value.errors()[0]
    assert error["loc"] == location
    assert error["msg"] == f"Value error, {message}"


@pytest.mark.parametrize(
    "case",
    [
        "cycle",
        "crossed",
        "missing_join",
        "wrong_port",
        "unbounded",
        "unknown_config",
        "unknown_input",
        "numeric_to_text",
    ],
)
def test_ambiguous_or_untyped_control_is_rejected(case: str) -> None:
    document = split()
    if case == "cycle":
        document["edges"][3]["target"] = "right"
    elif case == "crossed":
        document["edges"][2]["target"] = "right"
    elif case == "missing_join":
        document["nodes"][0]["config"]["join"] = "finish"
    elif case == "wrong_port":
        document["edges"][0]["source_port"] = "text"
    elif case == "unbounded":
        document = nested("loop")
        del document["nodes"][0]["config"]["max_iterations"]
    elif case == "unknown_config":
        document["nodes"][0]["config"]["python"] = "untrusted()"
    elif case == "unknown_input":
        document["nodes"][1]["inputs"] = {"unknown": {"source": "brief"}}
    else:
        document["nodes"][1]["inputs"] = {"text": {"source": "artifact_count"}}
    with pytest.raises(ValidationError) as raised:
        Workflow.model_validate(document)
    if case == "crossed":
        assert raised.value.errors()[0]["loc"] == ()


@pytest.mark.parametrize("kind,valid", [("fork", True), ("route", False)])
def test_join_output_availability_follows_actual_execution(kind: str, valid: bool) -> None:
    document = split(kind)
    document["nodes"].insert(
        -1,
        node("consumer", inputs={"text": {"source": "output", "node_id": "left", "port": "text"}}),
    )
    document["edges"][-1] = edge("join", "consumer")
    document["edges"].append(edge("consumer", "finish"))
    if valid:
        Workflow.model_validate(document)
    else:
        with pytest.raises(ValidationError, match="every incoming path"):
            Workflow.model_validate(document)


@pytest.mark.parametrize("case", ["missing", "recursive", "duplicate", "explosion"])
def test_subgraph_references_are_pinned_and_finite(case: str) -> None:
    document = nested("loop")
    body = document["subgraphs"][0]
    if case == "missing":
        document["nodes"][0]["config"]["ref"]["version"] = 2
        document["nodes"][0]["config"]["until"] = predicate("iteration", "wrong type")
    elif case == "duplicate":
        document["subgraphs"].append(deepcopy(body))
    elif case == "recursive":
        body["nodes"][0] = node(
            "inside",
            "subgraph",
            config={"type": "subgraph", "ref": {"id": "investigate", "version": 1}},
        )
    else:
        document["nodes"][0]["config"]["max_iterations"] = 20
        child = deepcopy(body)
        child["id"] = "child"
        body["nodes"][0] = node(
            "inside",
            "loop",
            config={"type": "loop", "ref": {"id": "child", "version": 1}, "max_iterations": 20},
        )
        child["nodes"] = [node(f"n{i}") for i in range(10)] + [node("done", "finish")]
        child["edges"] = [
            edge(a["id"], b["id"]) for a, b in zip(child["nodes"], child["nodes"][1:], strict=False)
        ]
        child["start_node"] = "n0"
        document["subgraphs"].append(child)
    with pytest.raises(ValidationError) as raised:
        Workflow.model_validate(document)
    if case == "missing":
        error = raised.value.errors()[0]
        assert error["loc"] == ()
        assert error["msg"] == "Value error, Missing pinned subgraph definition ('investigate', 2)."


@pytest.mark.parametrize("owner", ["root", "nested", "archived"])
@pytest.mark.parametrize(
    "until,message",
    [
        (predicate("iteration", "wrong type"), "Predicate values must match the input port type."),
        (
            {
                "left": {"source": "output", "node_id": "left", "port": "text"},
                "operator": "equals",
                "value": "yes",
            },
            "Output from 'left' is not available on every incoming path.",
        ),
        (
            {
                "left": {"source": "output", "node_id": "split", "port": "text"},
                "operator": "equals",
                "value": "yes",
            },
            "Unknown output port split.text.",
        ),
    ],
)
def test_stop_predicate_errors_identify_the_owning_loop(
    owner: str, until: dict[str, Any], message: str
) -> None:
    workflow = nested("loop", until=True)
    config = workflow["nodes"][0]["config"]
    config["ref"]["id"] = "loop_body"
    config["until"] = until
    workflow["nodes"].reverse()
    body = split("route")
    body.pop("schema_version")
    workflow["subgraphs"] = [{"id": "loop_body", "version": 1, **body}]
    document = workflow
    location: tuple[str | int, ...] = ("nodes", 1, "config", "until")
    if owner != "root":
        document = nested()
        workflow.pop("schema_version")
        definitions = workflow.pop("subgraphs")
        definition = {"id": "investigate", "version": 2, **workflow}
        document["subgraphs"].extend([*definitions, definition])
        if owner == "nested":
            document["nodes"][0]["config"]["ref"]["version"] = 2
        location = ("subgraphs", 2, *location)

    with pytest.raises(ValidationError) as raised:
        Workflow.model_validate(document)

    error = raised.value.errors()[0]
    assert error["loc"] == location
    assert error["msg"] == f"Value error, {message}"


@pytest.mark.parametrize("value", ["wrong type", float("inf"), float("nan")])
def test_numeric_predicates_reject_wrong_types_and_nonfinite_values(value: Any) -> None:
    document = nested("loop", until=True)
    document["nodes"][0]["config"]["until"]["value"] = value
    with pytest.raises(ValidationError):
        Workflow.model_validate(document)


def test_legacy_document_preserves_serialization_and_compiler_boundary(workflow: dict) -> None:
    parsed = Workflow.model_validate(workflow)
    assert set(parsed.canonical_document()) == set(workflow)
    assert "config" not in parsed.canonical_document()["nodes"][0]
    assert "source_port" not in parsed.canonical_document()["edges"][0]
    workflow["schema_version"] = "0.1"
    workflow["nodes"][0]["inputs"] = {"text": {"source": "brief"}}
    with pytest.raises(ValidationError):
        Workflow.model_validate(workflow)


def test_valid_typed_text_binding() -> None:
    Workflow.model_validate(
        chain(
            node("source"),
            node(
                "consumer",
                inputs={"text": {"source": "output", "node_id": "source", "port": "text"}},
            ),
            node("finish", "finish"),
        )
    )
