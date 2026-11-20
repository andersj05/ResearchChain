"""Team handoffs use only confirmed receipts belonging to the bound team occurrence."""

import json
from uuid import uuid4

import pytest
from psycopg.types.json import Jsonb
from test_dispatch import setup_queue
from test_research_contracts import result_document

from researchchain.artifacts import put_artifact
from researchchain.research_models import (
    StoredResearchResult,
    TeamAssignment,
    TeamPlan,
    WorkspaceFile,
)
from researchchain.research_prompt import PreparedResearch
from researchchain.research_workspace import (
    load_files,
    save_files,
    staged_files,
    team_handoff,
    team_workspace_files,
)
from researchchain.web_research import read_web_research


def test_handoff_checks_recorded_plan_lanes_and_exact_files(database, workflow):
    queue, request = setup_queue(database, workflow)
    queue.start(request)
    path = "root/team"
    result = StoredResearchResult.model_validate(result_document("custom"))
    plan = TeamPlan(
        assignments=[
            TeamAssignment(title="Timing", objective="Inspect publication timestamps"),
            TeamAssignment(title="Coverage", objective="Measure sample breadth"),
        ],
        review_question="Which release matters?",
    )
    long_name = "x" * 92 + ".csv"
    with database.connection() as conn:
        artifact = put_artifact(conn, b"Synthetic request and response", "receipt.txt")

        def record(step, final):
            key = uuid4()
            conn.execute(
                "INSERT INTO research_attempts (id,run_id,path,model,stage,status,"
                "input_artifact_id,response_artifact_id,result,finished_at) VALUES "
                "(%s,%s,%s,'test-model','custom','completed',%s,%s,%s,clock_timestamp())",
                (
                    key,
                    request.id,
                    step,
                    artifact.id,
                    artifact.id,
                    Jsonb(final.model_dump(mode="json")),
                ),
            )
            return key

        record(path + "/plan", result.model_copy(update={"team_plan": plan}))
        record(path + "/agent-1", result.model_copy(update={"next_lead": "Read the release"}))
        first = result.model_copy(
            update={
                "conclusion": "Release timing varies.",
                "review_question": plan.review_question,
                "workspace_files": save_files(
                    conn, {"memo.md": b"Timing findings", long_name: b"value\n1"}
                ),
                "web_research": read_web_research(
                    {
                        "output": [
                            {
                                "type": "message",
                                "content": [
                                    {
                                        "annotations": [
                                            {
                                                "type": "url_citation",
                                                "url": "https://example.org/releases",
                                                "title": "Release dates",
                                            }
                                        ]
                                    }
                                ],
                            }
                        ]
                    }
                ),
            }
        )
        second = result.model_copy(
            update={
                "conclusion": "One period is missing.",
                "review_question": "Should we include partial periods?",
                "workspace_files": save_files(conn, {"memo.md": b"Coverage findings"}),
            }
        )
        second_id = record(path + "/agent-2", second)
        # A similarly named occurrence is not part of this team's handoff.
        record(path + "-copy/agent-1/analyst-pass-2", second)
        with pytest.raises(ValueError, match="missing"):
            team_handoff(conn, request.id, path, plan, [first, second])
        first_id = record(path + "/agent-1/analyst-pass-2", first)
        packet = team_handoff(conn, request.id, path, plan, [first, second])
        handoff = json.loads(packet)
        assert (
            handoff["review_question"]
            == "Which release matters?\nShould we include partial periods?"
        )
        agents = handoff["agents"]
        assert [a["attempt_id"] for a in agents] == [str(first_id), str(second_id)]
        assert agents[0]["web_sources"] == [
            {"url": "https://example.org/releases", "title": "Release dates", "cited": True}
        ]
        assert agents[1]["findings"] == "One period is missing."
        imported = team_workspace_files(conn, request.id, path, packet)
        prepared = PreparedResearch("", [], {}, {}, None, "test-model")
        inputs = load_files(conn, staged_files(prepared, {}, team_files=imported))
        assert inputs[agents[0]["files"][0]["input_name"]] == b"Timing findings"
        assert inputs[agents[1]["files"][0]["input_name"]] == b"Coverage findings"
        long_alias = agents[0]["files"][1]["input_name"]
        assert len(long_alias) == 96 and long_alias.endswith(".csv")
        assert inputs[long_alias] == b"value\n1"
        with pytest.raises(ValueError, match="differs"):
            team_handoff(conn, request.id, path, plan, [second, first])
        agents[0]["files"][0]["artifact_id"] = artifact.id
        with pytest.raises(ValueError, match="differs"):
            team_workspace_files(conn, request.id, path, json.dumps(handoff))
        with pytest.raises(ValueError, match="missing"):
            team_workspace_files(conn, uuid4(), path, packet)
        with pytest.raises(ValueError, match="missing"):
            team_workspace_files(conn, request.id, path + "-copy", packet)


def test_staging_team_inputs_respects_local_files_and_reports_omissions(monkeypatch):
    workspace = "researchchain.research_workspace"
    monkeypatch.setattr(workspace + ".MAX_INPUT_BYTES", 12)
    monkeypatch.setattr(workspace + ".MAX_FILES", 4)
    synthetic = WorkspaceFile(
        name="own.csv", media_type="text/csv", byte_size=4, artifact_id="sha256:" + "0" * 64
    )
    names = {
        name: synthetic.model_copy(update={"name": name, "byte_size": size})
        for name, size in [
            ("own.csv", 2),
            ("large.csv", 13),
            ("kept.csv", 8),
            ("extra.txt", 1),
        ]
    }
    prepared = PreparedResearch("", [], {}, {}, None, "test-model")
    assert list(staged_files(prepared, {"own.csv": synthetic}, team_files=names)) == [
        "own.csv",
        "kept.csv",
    ]
    assert "own.csv, large.csv, extra.txt" in prepared.instructions
    assert "kept.csv" not in prepared.instructions
