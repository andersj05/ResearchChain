import json
from uuid import uuid4

import pytest
from psycopg.types.json import Jsonb
from test_dispatch import setup_queue
from test_research_contracts import result_document

from researchchain.artifacts import put_artifact
from researchchain.graph import SwarmConfig
from researchchain.research_models import (
    StoredResearchResult,
    SwarmDelegate,
    SwarmFinish,
    SwarmLeadPlan,
    TeamAssignment,
)
from researchchain.research_prompt import PreparedResearch
from researchchain.research_workspace import (
    load_files,
    save_files,
    staged_files,
    swarm_handoff,
    team_workspace_files,
)


def test_eighty_workspaces_keep_namespaced_receipts_in_a_bounded_editor_handoff(database, workflow):
    queue, request = setup_queue(database, workflow)
    queue.start(request)
    config = SwarmConfig(lead_count=4, researchers_per_lead=20)
    base = "root/team"
    result = StoredResearchResult.model_validate(result_document("custom"))
    mandates = [
        TeamAssignment(title=f"Lead {i}", objective=f"Investigate sector {i}.") for i in range(1, 5)
    ]
    with database.connection() as conn:
        artifact = put_artifact(conn, b"Synthetic receipt.", "record.txt")

        def record(path, **updates):
            receipt_id = uuid4()
            conn.execute(
                "INSERT INTO research_attempts (id,run_id,path,model,stage,status,"
                "input_artifact_id,response_artifact_id,result,finished_at) "
                "VALUES (%s,%s,%s,'synthetic','custom','completed',%s,%s,%s,clock_timestamp())",
                (
                    receipt_id,
                    request.id,
                    path,
                    artifact.id,
                    artifact.id,
                    Jsonb(result.model_copy(update=updates).model_dump(mode="json")),
                ),
            )
            return receipt_id

        record(base + "/plan", swarm_plan=SwarmLeadPlan(leads=mandates))
        for lead in range(1, 5):
            assignments = [
                TeamAssignment(title=f"Worker {i}", objective=f"Read series {i}.")
                for i in range(1, 21)
            ]
            record(
                f"{base}/lead-{lead}/turn-1",
                swarm_action=SwarmDelegate(
                    rationale="Read the synthetic series.", assignments=assignments
                ),
            )
            record(
                f"{base}/lead-{lead}/turn-2",
                swarm_action=SwarmFinish(
                    findings="Synthetic sector conclusion.", limitations=["One period."]
                ),
            )
            for worker in range(1, 21):
                path = f"{base}/lead-{lead}/agent-{worker}"
                record(path, next_lead="Check figures.")
                file = save_files(conn, {"series.csv": f"lead,worker\n{lead},{worker}\n".encode()})
                last_id = record(
                    path + "/analyst-pass-2", workspace_files=file, conclusion="Synthetic. " * 500
                )
        record(
            base + "/lead-4/agent-21",
            workspace_files=save_files(conn, {"other.csv": b"unassigned"}),
        )
        text = swarm_handoff(conn, request.id, base, config)
        material = json.loads(text)
        assert (
            len(material["leads"]) == 4
            and len(material["agents"]) == 80
            and len(text.encode()) < 500_000
        )
        assert material["agents"][-1]["attempt_id"] == str(last_id)
        assert material["agents"][-1]["findings"].endswith("…")
        assert len({a["files"][0]["input_name"] for a in material["agents"]}) == 80
        confirmed = team_workspace_files(conn, request.id, base, text)
        assert len(confirmed) == 80 and not any("other.csv" in name for name in confirmed)
        prepared = PreparedResearch("", [], {}, {}, None, "synthetic")
        files = load_files(conn, staged_files(prepared, {}, team_files=confirmed))
        assert len(files) == 64
        for lead in range(1, 5):
            assert (
                files[f"lead-{lead}-agent-16-1-series.csv"] == f"lead,worker\n{lead},16\n".encode()
            )
        assert "could not be staged" in prepared.instructions
        with pytest.raises(ValueError):
            team_workspace_files(conn, uuid4(), base, text)
        with pytest.raises(ValueError, match="differs"):
            team_workspace_files(
                conn, request.id, base, text.replace("lead-1-agent-1-1-series.csv", "other.csv")
            )
        with pytest.raises(ValueError, match="missing"):
            team_workspace_files(conn, request.id, "root/different-team", text)
        record(base + "/lead-1/agent-1/analyst-pass-3")
        with pytest.raises(ValueError, match="conflicting"):
            swarm_handoff(conn, request.id, base, config)
