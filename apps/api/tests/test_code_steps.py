import hashlib
import time
from typing import Any
from uuid import uuid4

import pytest
from pydantic import ValidationError

from researchchain.code_execution import CodeExecutionError, execute_code
from researchchain.code_models import CodeInputs
from researchchain.database import Database
from researchchain.graph import CodeConfig, Workflow
from researchchain.models import ResumeRequest, RunRequest
from researchchain.revisions import RevisionStore
from researchchain.runtime import RunStore, compiler_version


def code_workflow(source: str, *, review: bool = False) -> Workflow:
    nodes: list[dict[str, Any]] = [
        {
            "id": "code",
            "kind": "code",
            "label": "Owner transform",
            "position": {"x": 0, "y": 0},
            "config": {"type": "code", "source": source},
            "inputs": {"text": {"source": "brief"}, "number": {"source": "artifact_count"}},
        },
        {
            "id": "note",
            "kind": "note",
            "label": "Use transformed text",
            "position": {"x": 100, "y": 0},
            "inputs": {"text": {"source": "output", "node_id": "code", "port": "text"}},
        },
        {"id": "finish", "kind": "finish", "label": "Finish", "position": {"x": 200, "y": 0}},
    ]
    if review:
        nodes.insert(
            2,
            {
                "id": "review",
                "kind": "review",
                "label": "Owner review",
                "instructions": "Continue?",
                "position": {"x": 150, "y": 0},
            },
        )
    return Workflow.model_validate(
        {
            "schema_version": "0.2",
            "name": "Owner code experiment",
            "start_node": "code",
            "nodes": nodes,
            "edges": [
                {"source": a["id"], "target": b["id"]}
                for a, b in zip(nodes, nodes[1:], strict=False)
            ],
        }
    )


def test_code_computes_with_json_inputs_and_no_host_capabilities(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OWNER_PRIVATE_KEY", "never-inherit-this-secret")
    source = """
        const hidden = [typeof process, typeof require, typeof fetch, typeof std, typeof os];
        if (hidden.some(value => value !== 'undefined')) throw new Error('Host object exposed');
        return {text: inputs.text.toUpperCase() + ' ✓', number: Math.sqrt(inputs.number)};
    """
    result = execute_code(
        CodeConfig(source=source),
        CodeInputs(text="owner", number=81, brief="test", artifact_count=2, iteration=3),
    )
    assert result.outputs.text == "OWNER ✓"
    assert result.outputs.number == 9
    assert result.inputs.iteration == 3
    assert result.source_sha256 == hashlib.sha256(source.encode()).hexdigest()
    assert result.runtime == "quickjs-ng-0.18.0.1"


@pytest.mark.parametrize(
    "source",
    [
        "return {",
        "throw new Error('Owner diagnostic');",
        "while (true) {}",
        "function recur() { return recur(); } recur();",
        "const huge = new Array(100000000).fill('memory'); return {text: 'x', number: 0};",
        "return {text: 'x'.repeat(24001), number: 0};",
        "return {text: 'x', number: NaN};",
        "return {text: 'x', number: Infinity};",
        "return {text: 12, number: 1};",
        "return {text: 'x', number: true};",
        "return Promise.resolve({text: 'x', number: 1});",
        "return undefined;",
        "return {text: 'x', number: 1, extra: 'not a port'};",
    ],
)
def test_code_failures_are_bounded_and_do_not_break_the_next_step(source: str) -> None:
    inputs = CodeInputs(brief="test", artifact_count=0, iteration=0)
    started = time.monotonic()
    with pytest.raises(CodeExecutionError):
        execute_code(CodeConfig(source=source, timeout_seconds=0.05), inputs)
    assert time.monotonic() - started < 5
    assert (
        execute_code(CodeConfig(source="return {text: 'next', number: 7};"), inputs).outputs.number
        == 7
    )


def test_code_workflow_pins_outputs_and_resumes_without_reexecuting(
    database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    from researchchain import compiler

    calls = []
    original = compiler.execute_code

    def capture(config: CodeConfig, inputs: CodeInputs) -> Any:
        calls.append(config.source)
        return original(config, inputs)

    monkeypatch.setattr(compiler, "execute_code", capture)
    workflow = code_workflow(
        "return {text: inputs.text.toUpperCase(), number: inputs.number + 2};", review=True
    )
    revision = RevisionStore(database).save(workflow)
    store = RunStore(database)
    run = store.start(RunRequest(id=uuid4(), revision_id=revision.id, brief="Owner input"))
    assert run.status == "paused" and run.review and run.checkpoint_id
    assert run.compiler_version == "code-0.1.0"
    assert run.events[0].code and run.events[0].code.outputs.number == 2
    assert run.events[1].detail == "OWNER INPUT"
    assert run.usage.model_calls == 0
    changed = workflow.model_dump()
    changed["nodes"][0]["config"]["source"] = "return {text: 'new', number: 99};"
    RevisionStore(database).save(Workflow.model_validate(changed))
    restored = RunStore(database).get(run.id)
    assert restored.events[0].code == run.events[0].code
    completed = RunStore(database).resume(
        run.id,
        ResumeRequest(
            checkpoint_id=run.checkpoint_id,
            interrupt_id=run.review.interrupt_id,
            decision="approve",
        ),
    )
    assert completed.status == "completed"
    assert len(calls) == 1
    assert completed.workflow == workflow


def test_code_error_is_a_durable_failed_run_with_an_actionable_reason(database: Database) -> None:
    revision = RevisionStore(database).save(
        code_workflow("throw new Error('Check the denominator');")
    )
    run = RunStore(database).start(RunRequest(id=uuid4(), revision_id=revision.id, brief="test"))
    assert run.status == "failed"
    assert "Owner transform" in (run.stop_reason or "")
    assert "Check the denominator" in (run.stop_reason or "")
    assert RunStore(database).get(run.id).stop_reason == run.stop_reason
    assert run.usage.model_calls == 0


def test_code_validation_and_legacy_compiler_identity() -> None:
    workflow = code_workflow("return {text: '', number: 0};").model_dump()
    for patch in [
        {"timeout_seconds": 0},
        {"timeout_seconds": 6},
        {"language": "python"},
        {"runtime": "unknown"},
    ]:
        changed = {**workflow, "nodes": [dict(node) for node in workflow["nodes"]]}
        changed["nodes"][0]["config"] = {**changed["nodes"][0]["config"], **patch}
        with pytest.raises(ValidationError):
            Workflow.model_validate(changed)
    workflow["nodes"][0]["inputs"]["number"] = {"source": "brief"}
    with pytest.raises(ValidationError, match="incompatible type"):
        Workflow.model_validate(workflow)
    plain = Workflow.model_validate(
        {
            "name": "legacy",
            "start_node": "end",
            "nodes": [
                {"id": "end", "kind": "finish", "label": "Finish", "position": {"x": 0, "y": 0}}
            ],
            "edges": [],
        }
    )
    assert compiler_version(plain) == "chain-0.1.0"
