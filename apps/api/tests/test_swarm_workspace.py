import base64
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
    SwarmAskExpert,
    SwarmConsultation,
    SwarmDelegate,
    SwarmFinish,
    SwarmLeadPlan,
    TeamAssignment,
)
from researchchain.research_perspectives import perspective_id
from researchchain.research_prompt import PreparedResearch, json_bytes, validate_result
from researchchain.research_swarm_workspace import worker_evidence_summary
from researchchain.research_workspace import (
    load_files,
    save_files,
    staged_files,
    swarm_handoff,
    team_workspace_files,
)
from researchchain.sec_financials import SecFinancials


def cited_worker_result():
    source, document = uuid4(), uuid4()
    delivered = "The reported figure declined. " * 60
    packet = PreparedResearch(
        "",
        [],
        {},
        {
            source: {"citation_basis": "source_text", "text": delivered},
            document: {"citation_basis": "document_interpretation"},
        },
        None,
        "synthetic",
    )
    raw = result_document("custom")
    base = raw["hypotheses"][0]
    citation = {
        "evidence_id": str(source),
        "basis": "source_text",
        "locator": "Page 4",
        "quote": delivered.strip(),
        "rationale": "Synthetic reading of the filing.",
        "relation": "supports",
    }
    raw["hypotheses"] = [
        {
            **base,
            "id": f"H{i}",
            "statement": f"Claim {i}: " + "株" * 500,
            "assessment": "mixed",
            "citations": [
                *[citation] * 18,
                {**citation, "relation": "contradicts"},
                {
                    **citation,
                    "evidence_id": str(document),
                    "basis": "document_interpretation",
                    "quote": "",
                    "relation": "context",
                },
            ],
        }
        for i in range(1, 9)
    ]
    validated = validate_result(json.dumps(raw), "custom", packet)
    filing = SecFinancials.model_validate(
        {
            "request": {"ticker": "SYN", "metric": "revenue"},
            "status": "available",
            "retrieved_at": "2026-01-03T12:00:00Z",
            "cik": "0000000001",
            "source_url": "https://data.sec.gov/api/synthetic",
            "observations": [
                {
                    "start": "2024-01-01",
                    "end": "2024-12-31",
                    "filed": "2025-03-02",
                    "accession": "0000000001-25-000001",
                    "form": "10-K",
                    "value": 321,
                    "unit": "USD",
                }
            ],
        }
    )
    return (
        StoredResearchResult(**validated.model_dump(), sec_financials=filing),
        str(source),
        str(document),
    )


def test_worker_evidence_keeps_checked_basis_opposing_relations_and_filing_periods():
    worker, source, document = cited_worker_result()
    summary = worker_evidence_summary(worker)
    assert len(json_bytes(summary)) < 9000
    assert summary["evidence_hypotheses_omitted"] == 4
    assert summary["evidence_citations_omitted"] == 160 - 12
    hypothesis = summary["evidence_hypotheses"][0]
    assert (
        hypothesis["id"] == "H1"
        and hypothesis["assessment"] == "mixed"
        and hypothesis["statement_excerpted"]
    )
    assert hypothesis["citations_omitted"] == 17
    supporting, contradicting, context = hypothesis["citations"]
    assert supporting["relation"] == "supports" and contradicting["relation"] == "contradicts"
    assert supporting["evidence_id"] == contradicting["evidence_id"] == source
    assert (
        contradicting["validation"] == "exact_match_in_delivered_text"
        and contradicting["quote_excerpted"]
    )
    assert worker.hypotheses[0].citations[0].quote.startswith(contradicting["quote"])
    assert context["evidence_id"] == document and context["basis"] == "document_interpretation"
    assert (
        not context.get("quote")
        and context["validation"] == "source_representation_checked_no_verified_quote"
    )
    saved_filing = summary["sec_financials"]
    assert saved_filing["request"] == {"ticker": "SYN", "metric": "revenue"}
    assert saved_filing["observations"][0] == worker.sec_financials.observations[0].model_dump(
        mode="json"
    )
    assert not saved_filing["source_url_omitted"] and saved_filing["observations_omitted"] == 0


def test_eighty_workspaces_keep_namespaced_receipts_in_a_bounded_editor_handoff(database, workflow):
    queue, request = setup_queue(database, workflow)
    queue.start(request)
    config = SwarmConfig(lead_count=4, researchers_per_lead=20)
    base = "root/team"
    result = StoredResearchResult.model_validate(result_document("custom"))
    cited, _, _ = cited_worker_result()
    owner_feedback = "Review each period. " * 100 + "Final caveat: exclude unaudited sales."
    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCA"
        "O+jfZkAAAAASUVORK5CYII="
    )
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
            if lead == 1:
                ask_path = f"{base}/lead-1/turn-2"
                record(
                    ask_path,
                    swarm_action=SwarmAskExpert(
                        consultation=SwarmConsultation(
                            thesis="Sales may lag.",
                            question="Which periods?",
                            options=["One", "All"],
                        )
                    ),
                )
                conn.execute(
                    "INSERT INTO run_commands "
                    "(id,run_id,kind,checkpoint_id,interrupt_id,decision,feedback,response) "
                    "VALUES (%s,%s,'resume','synthetic',%s,'approve',%s,'{}'::jsonb)",
                    (uuid4(), request.id, perspective_id(request.id, ask_path), owner_feedback),
                )
            record(
                f"{base}/lead-{lead}/turn-{3 if lead == 1 else 2}",
                swarm_action=SwarmFinish(
                    findings="Synthetic sector conclusion.", limitations=["One period."]
                ),
            )
            for worker in range(1, 21):
                path = f"{base}/lead-{lead}/agent-{worker}"
                record(path, next_lead="Check figures.")
                outputs = {"analysis.py": b"print('Synthetic')"}
                if worker % 2:
                    outputs["series.csv"] = f"lead,worker\n{lead},{worker}\n".encode()
                else:
                    outputs["figure.png"] = png
                file = save_files(conn, outputs)
                last_id = record(
                    path + "/analyst-pass-2",
                    workspace_files=file,
                    conclusion="Synthetic. " * 500,
                    **(
                        {"hypotheses": cited.hypotheses, "sec_financials": cited.sec_financials}
                        if (lead, worker) == (4, 20)
                        else {}
                    ),
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
        assert material["leads"][0]["turns"][1]["owner_feedback"] == owner_feedback
        assert (
            material["agents"][-1]["evidence_hypotheses"]
            == worker_evidence_summary(cited)["evidence_hypotheses"]
        )
        assert material["agents"][0]["sec_financials"] is None
        assert material["agents"][-1]["sec_financials"]["observations"][0]["value"] == 321
        assert material["agents"][-1]["findings"].endswith("…")
        assert len({a["files"][0]["input_name"] for a in material["agents"]}) == 80
        confirmed = team_workspace_files(conn, request.id, base, text)
        assert len(confirmed) == 160 and not any("other.csv" in name for name in confirmed)
        prepared = PreparedResearch("", [], {}, {}, None, "synthetic")
        files = load_files(conn, staged_files(prepared, {}, team_files=confirmed))
        assert len(files) == 64
        assert sum(name.endswith(".csv") for name in files) == 32
        assert sum(name.endswith(".png") for name in files) == 32
        for lead in range(1, 5):
            assert files[f"lead-{lead}-agent-16-2-figure.png"] == png
            assert (
                files[f"lead-{lead}-agent-15-2-series.csv"] == f"lead,worker\n{lead},15\n".encode()
            )
        assert "could not be staged" in prepared.instructions
        with pytest.raises(ValueError):
            team_workspace_files(conn, uuid4(), base, text)
        with pytest.raises(ValueError, match="differs"):
            team_workspace_files(
                conn, request.id, base, text.replace("lead-1-agent-1-2-series.csv", "other.csv")
            )
        with pytest.raises(ValueError, match="missing"):
            team_workspace_files(conn, request.id, "root/different-team", text)
        record(base + "/lead-1/agent-1/analyst-pass-3")
        with pytest.raises(ValueError, match="conflicting"):
            swarm_handoff(conn, request.id, base, config)
