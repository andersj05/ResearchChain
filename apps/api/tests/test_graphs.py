from copy import deepcopy
from typing import Any

import pytest
from graph_fixtures import chain, edge, nested, node, split
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
    with pytest.raises(ValidationError):
        Workflow.model_validate(document)


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
    with pytest.raises(ValidationError):
        Workflow.model_validate(document)


@pytest.mark.parametrize("value", ["wrong type", float("inf"), float("nan")])
def test_numeric_predicates_reject_wrong_types_and_nonfinite_values(value: Any) -> None:
    document = nested("loop", until=True)
    document["nodes"][0]["config"]["until"]["value"] = value
    with pytest.raises(ValidationError):
        Workflow.model_validate(document)


def test_legacy_document_preserves_serialization_and_compiler_boundary(workflow: dict) -> None:
    parsed = Workflow.model_validate(workflow)
    assert set(parsed.model_dump()) == set(workflow)
    assert "config" not in parsed.model_dump()["nodes"][0]
    assert "source_port" not in parsed.model_dump()["edges"][0]
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
