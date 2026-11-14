from typing import Any

import pytest
from graph_fixtures import chain, nested, node, split
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from researchchain.compiler import ExecutionStopped, compile_structured
from researchchain.graph import Workflow


def run(document: dict, brief: str = "yes") -> tuple[Any, dict, dict]:
    graph = compile_structured(Workflow.model_validate(document), InMemorySaver())
    config = {"configurable": {"thread_id": "test"}, "recursion_limit": 4096}
    output = graph.invoke(
        {"brief": brief, "artifact_ids": [], "records": {}, "outputs": {}, "rejected": False},
        config,
        durability="sync",
    )
    return graph, config, output


def test_parallel_join_waits_for_longest_branch_and_runs_once() -> None:
    _, _, output = run(split())
    events = list(output["records"])
    assert events.index("root/join") > events.index("root/longer")
    assert events.count("root/join") == 1
    assert set(events) == {
        f"root/{name}" for name in ("split", "left", "right", "longer", "join", "finish")
    }


@pytest.mark.parametrize(
    "brief,selected,absent", [("yes", "left", "right"), ("no", "right", "left")]
)
def test_conditional_join_only_waits_for_selected_branch(
    brief: str, selected: str, absent: str
) -> None:
    _, _, output = run(split("route"), brief)
    assert f"root/{selected}" in output["records"]
    assert f"root/{absent}" not in output["records"]
    assert "root/finish" in output["records"]


@pytest.mark.parametrize("until,iterations", [(False, 3), (True, 2)])
def test_loop_count_and_exit_predicate(until: bool, iterations: int) -> None:
    _, _, output = run(nested("loop", until=until))
    assert output["outputs"]["root/nested"]["iterations"] == iterations
    assert sum(path.endswith("/inside") for path in output["records"]) == iterations
    assert "root/finish" in output["records"]


def test_exhausted_condition_is_not_silently_completed() -> None:
    document = nested("loop", until=True)
    document["nodes"][0]["config"]["until"]["value"] = 99
    with pytest.raises(ExecutionStopped, match="exhausted 3 iterations"):
        run(document)


def test_review_in_each_loop_iteration_has_a_distinct_checkpoint_identity() -> None:
    graph, config, output = run(nested("loop", review=True))
    identities = []
    for i in range(1, 4):
        pending = output["__interrupt__"][0]
        identities.append(pending.id)
        assert pending.value["path"] == f"root/nested/iteration-{i}/inside"
        output = graph.invoke(Command(resume={pending.id: "approve"}), config, durability="sync")
    assert len(set(identities)) == 3
    assert "root/finish" in output["records"]


def test_subgraph_review_rejection_stops_parent() -> None:
    graph, config, output = run(nested(review=True))
    output = graph.invoke(Command(resume={output["__interrupt__"][0].id: "reject"}), config)
    assert output["rejected"]
    assert "root/finish" not in output["records"]


def test_nested_split_reconverges_before_outer_join() -> None:
    document = split()
    inner = split("route")
    inner.pop("schema_version")
    document["subgraphs"] = [{"id": "inner", "version": 1, **inner}]
    document["nodes"][1] = node(
        "left", "subgraph", config={"type": "subgraph", "ref": {"id": "inner", "version": 1}}
    )
    _, _, output = run(document)
    events = list(output["records"])
    assert events.index("root/join") > events.index("root/left/body/finish")
    assert events[-1] == "root/finish"


def test_data_binding_delivers_actual_text() -> None:
    document = chain(
        node("first", inputs={"text": {"source": "brief"}}),
        node("copy", inputs={"text": {"source": "output", "node_id": "first", "port": "text"}}),
        node("finish", "finish"),
    )
    _, _, output = run(document, "Test the competing explanation")
    assert output["outputs"]["root/copy"]["text"] == "Test the competing explanation"


def test_two_simultaneous_reviews_do_not_approve_each_other() -> None:
    document = split()
    document["nodes"][1]["kind"] = "review"
    document["nodes"][2]["kind"] = "review"
    graph, config, output = run(document)
    assert len(output["__interrupt__"]) == 2
    first, second = output["__interrupt__"]
    output = graph.invoke(Command(resume={first.id: "approve"}), config, durability="sync")
    assert [item.id for item in output["__interrupt__"]] == [second.id]
    output = graph.invoke(Command(resume={second.id: "approve"}), config, durability="sync")
    assert "root/finish" in output["records"]
