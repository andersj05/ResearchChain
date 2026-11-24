"""Validate loop-carried bindings and execute them through the structured compiler."""

import pytest
from graph_fixtures import chain, nested, node, split
from pydantic import ValidationError
from test_compiler import run

from researchchain.compiler import LOOP_INPUT_COMPILER_VERSION
from researchchain.graph import Workflow
from researchchain.runtime import compiler_version


def previous(node_id: str, port: str = "text") -> dict[str, str]:
    return {"source": "previous_iteration", "node_id": node_id, "port": port}


def test_previous_inputs_reset_for_each_nested_caller_and_outer_iteration() -> None:
    inner_ref = {"id": "inner", "version": 1}
    outer_ref = {"id": "outer", "version": 1}

    def caller(node_id: str, ref: dict) -> dict:
        return node(node_id, "loop", config={"type": "loop", "ref": ref, "max_iterations": 2})

    inner = chain(
        node(
            "record",
            "code",
            config={
                "type": "code",
                "language": "javascript",
                "source": (
                    'return {text: inputs.text + "/" + inputs.iteration, '
                    "number: inputs.number + 1};"
                ),
            },
            inputs={"text": previous("record"), "number": previous("record", "number")},
        ),
        node("done", "finish"),
    )
    outer = chain(caller("first", inner_ref), caller("second", inner_ref), node("done", "finish"))
    document = chain(caller("repeat", outer_ref), node("done", "finish"))
    for body in (inner, outer):
        body.pop("schema_version")
    document["subgraphs"] = [{**inner_ref, **inner}, {**outer_ref, **outer}]

    assert compiler_version(Workflow.model_validate(document)) == LOOP_INPUT_COMPILER_VERSION
    _, _, result = run(document)
    for outer_index in (1, 2):
        for caller_id in ("first", "second"):
            prefix = f"root/repeat/iteration-{outer_index}/{caller_id}"
            first = result["records"][f"{prefix}/iteration-1/record"]["code"]
            second = result["records"][f"{prefix}/iteration-2/record"]["code"]
            assert first["inputs"]["text"] == ""
            assert first["inputs"]["number"] == 0
            assert second["inputs"]["text"] == "/1"
            assert second["inputs"]["number"] == 1
            assert second["outputs"] == {"text": "/1/2", "number": 2}


def test_binding_guards_scope_availability_and_first_iteration_requirements() -> None:
    with pytest.raises(ValidationError, match="require a direct loop body"):
        Workflow.model_validate(
            chain(node("start", inputs={"text": previous("start")}), node("done", "finish"))
        )

    document = nested("loop")
    body = document["subgraphs"][0]
    body["nodes"][0]["inputs"] = {"text": previous("inside")}
    Workflow.model_validate(document)
    archived = chain(node("start"), node("done", "finish"))
    archived["subgraphs"] = [body]
    Workflow.model_validate(archived)

    ordinary = {"type": "subgraph", "ref": {"id": body["id"], "version": body["version"]}}
    mixed = chain(
        document["nodes"][0], node("shared", "subgraph", config=ordinary), node("done", "finish")
    )
    mixed["subgraphs"] = [body]
    with pytest.raises(ValidationError, match="ordinary subgraph callers"):
        Workflow.model_validate(mixed)

    branched = split("route")
    branched.pop("schema_version")
    branched["nodes"][1]["inputs"] = {"text": previous("right")}
    document["subgraphs"] = [{"id": body["id"], "version": body["version"], **branched}]
    with pytest.raises(ValidationError, match="not available on every incoming path"):
        Workflow.model_validate(document)

    document["subgraphs"] = [body]
    document["schema_version"] = "0.3"
    document["research"] = {}
    body["nodes"][0].update(
        kind="research",
        config={"type": "research", "stage": "challenge"},
        inputs={"context": previous("inside")},
    )
    with pytest.raises(ValidationError, match="needs context on iteration 1"):
        Workflow.model_validate(document)
    body["nodes"][0]["inputs"] = {"feedback": previous("inside")}
    with pytest.raises(ValidationError, match="review's feedback port"):
        Workflow.model_validate(document)


def test_previous_outputs_cannot_be_used_as_predicates_or_change_legacy_compiler_pins() -> None:
    document = nested("loop", until=True)
    assert compiler_version(Workflow.model_validate(document)) == "structured-0.2.0"
    document["nodes"][0]["config"]["until"] = {
        "left": previous("inside"),
        "operator": "equals",
        "value": "inside",
    }
    with pytest.raises(ValidationError, match="available only to step inputs"):
        Workflow.model_validate(document)
