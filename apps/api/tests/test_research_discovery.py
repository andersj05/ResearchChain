import json
from uuid import uuid4

import pytest
from access_fixtures import owner_client
from discovery_fixture import DiscoveryProvider
from pydantic import ValidationError
from test_research_runtime import approve
from test_research_sessions import request

from researchchain.artifacts import read_content
from researchchain.evidence import EvidenceStore
from researchchain.evidence_models import EvidenceCreate
from researchchain.main import create_app
from researchchain.research_discovery import first_reading
from researchchain.research_sessions import session_workflow
from researchchain.runtime import RunStore
from researchchain.worker import RunWorker


def test_source_start_requires_a_packet_and_preserves_brief_limits():
    with pytest.raises(ValidationError, match="Pin at least one"):
        request(start_from_sources=True, brief="")
    with pytest.raises(ValidationError, match="Write a research brief"):
        request(brief="  ")
    graph = session_workflow(
        request(
            start_from_sources=True,
            evidence_ids=[uuid4()],
            swarm={"lead_count": 4, "researchers_per_lead": 20, "max_lead_turns": 12},
            max_passes=12,
        )
    )
    assert graph.start_node == "discovery"
    assert graph.research.limits.max_model_calls == 2 + 48 + 81 * 12


def test_source_only_studies_use_first_pin_as_title_and_find_any_pinned_source(database):
    evidence = EvidenceStore(database)
    sources = [
        evidence.create(
            EvidenceCreate(id=uuid4(), title=title, kind="text", rights="owned", text="Synthetic")
        )
        for title in ["Credit spreads", "Desk call notes", "Sector fund flows"]
    ]
    first = request(start_from_sources=True, brief="", evidence_ids=[s.id for s in sources[:2]])
    second = request(start_from_sources=True, brief="", evidence_ids=[sources[2].id])
    with owner_client(create_app(database, DiscoveryProvider()), workers=False) as client:
        entry = "/api/research-sessions"
        for study in [first, second]:
            assert client.post(entry, json=study.model_dump(mode="json")).status_code == 202
        recent = client.get(entry).json()
        assert {item["id"]: item["study_title"] for item in recent} == {
            str(first.id): "Credit spreads",
            str(second.id): "Sector fund flows",
        }
        search = client.get(
            "/api/runs/search", params={"sessions_only": True, "search": "CALL NOTES"}
        )
        [result] = search.json()["items"]
        assert result["run"]["id"] == str(first.id)
        assert result["run"]["study_title"] == "Credit spreads"
        snapshot = client.get(f"/api/runs/{second.id}").json()
        assert snapshot["study_title"] == "Sector fund flows"
        assert snapshot["brief"] == "Source-led study"


@pytest.mark.parametrize(
    ("sentence", "title"),
    [
        (
            "Firms with debt due next year should lead their sector peers.",
            "Compare refinancing groups",
        ),
        ("Participation should extend beyond the biggest constituents.", "Rebuild participation"),
        ("", None),
    ],
)
def test_reading_pauses_then_routes_the_exact_judgment_or_parks(database, sentence, title):
    source = EvidenceStore(database).create(
        EvidenceCreate(
            id=uuid4(),
            title="Friday conversation",
            kind="discussion",
            rights="owned",
            text="At our desk, the median member was flat.",
            as_of_date="2026-11-20",
        )
    )
    provider = DiscoveryProvider()
    runs = RunStore(database, provider)
    start = request(
        start_from_sources=True, brief="", evidence_ids=[source.id], review_mode="never"
    )
    payload = start.model_dump(mode="json")
    with owner_client(create_app(database, provider), workers=False) as client:
        entry = "/api/research-sessions"
        assert client.post(entry, json={**payload, "brief": ""}).status_code == 202
        assert client.post(entry, json=payload).status_code == 202
        archive = client.get("/api/runs/search?sessions_only=true").json()["items"]
        assert archive[0]["run"]["id"] == str(start.id)
        assert RunWorker(runs).run_once()
        paused = runs.get(start.id)
        assert paused.status == "paused", paused.stop_reason
        assert paused.review.path == "root/working_sentence"
        assert [a.path for a in paused.model_attempts] == ["root/discovery"]
        first = paused.model_attempts[0].result.discovery
        assert first.proposals[0].evidence_ids == [source.id]
        assert first.citations[0].quote == "At our desk, the median member was flat."
        bad = first.model_dump(mode="json")
        with pytest.raises(ValueError, match="working sentence must be distinct"):
            first_reading(json.dumps({**bad, "proposals": bad["proposals"] * 2}), provider.calls[0])
        bad["citations"][0]["quote"] = "Fabricated quote."
        with pytest.raises(ValueError, match="exactly"):
            first_reading(json.dumps(bad), provider.calls[0])
        bad["proposals"][0]["evidence_ids"] = [str(uuid4())]
        with pytest.raises(ValueError, match="cited source content"):
            first_reading(json.dumps(bad), provider.calls[0])
        resume = f"/api/runs/{start.id}/resume"
        body = approve(paused, "  ").model_dump(mode="json")
        assert client.post(resume, json=body).status_code == 409
        body.update(feedback=sentence, decision="approve" if title else "reject")
        assert client.post(resume, json=body).status_code == 202
        assert client.post(resume, json=body).status_code == 202
        assert client.post(resume, json={**body, "feedback": "A different call"}).status_code == 409
        assert RunWorker(runs).run_once()
        final = runs.get(start.id)
        assert client.get(f"{entry}/{start.id}/setup").json()["start_from_sources"]
        if title is None:
            assert final.status == "rejected"
            assert len(final.model_attempts) == 1
            return
        assert final.status == "completed", final.stop_reason
        by_path = {a.path: a for a in final.model_attempts}
        assert by_path["root/team/plan"].result.team_plan.assignments[0].title == title
        with database.connection() as conn:
            for path in ["root/team/plan", "root/team/agent-1"]:
                saved = json.loads(read_content(conn, by_path[path].input_artifact_id))
                packet = json.loads(saved["input"][0]["content"][0]["text"])
                assert packet["human_feedback"] == sentence
                assert packet["prior_result"]["discovery"]["question"] == first.question
                assert "writing_style_reference" not in packet


def test_only_a_link_can_yield_a_question_without_inventing_a_sentence(database):
    source = EvidenceStore(database).create(
        EvidenceCreate(
            id=uuid4(),
            title="Uncaptured note",
            kind="link",
            availability="reference_only",
            source_url="https://example.org/note",
        )
    )
    provider = DiscoveryProvider()
    runs = RunStore(database, provider)
    start = request(start_from_sources=True, brief="", evidence_ids=[source.id])
    with owner_client(create_app(database, provider), workers=False) as client:
        assert (
            client.post("/api/research-sessions", json=start.model_dump(mode="json")).status_code
            == 202
        )
        assert RunWorker(runs).run_once()
        paused = runs.get(start.id)
        assert paused.status == "paused"
        reading = paused.model_attempts[0].result.discovery
        assert reading.question and not reading.proposals
        assert not reading.citations and len(provider.calls) == 1
