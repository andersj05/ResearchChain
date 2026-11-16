"""Owner-authored steps preserve the existing journal and legacy prompt contracts."""

import json
from uuid import uuid4

import pytest
from graph_fixtures import chain, node
from pydantic import ValidationError
from test_research_contracts import result_document
from test_research_runtime import FakeProvider, approve

from researchchain.graph import Workflow
from researchchain.models import RunRequest
from researchchain.research_models import ResearchResult
from researchchain.research_prompt import prompt_hashes
from researchchain.revisions import RevisionStore
from researchchain.runtime import RunStore


def test_legacy_prompt_hashes_stay_pinned():
    assert prompt_hashes() == {
        "hypothesize": "a4c165e74a0a4921367fa2e24a807a55ffef70e2bbad77925516d8cee9c51843",
        "challenge": "efe069707f69094bb0ea1bcc13c9906bebb6fc3176e7b317b84724a52e4a1aca",
        "revise": "744efd1ab2ccb832fdebbd49cf441b2b463e785075108861764bc0b5ec43ea0a",
    }


def test_only_custom_steps_allow_no_hypotheses():
    value = result_document("custom")
    value["hypotheses"] = []
    assert ResearchResult.model_validate(value).hypotheses == []
    for stage in ["hypothesize", "challenge", "revise"]:
        value["stage"] = stage
        with pytest.raises(ValidationError, match="at least one"):
            ResearchResult.model_validate(value)


def test_custom_step_feedback_and_recovery(database):
    config = {"type": "research", "stage": "custom", "prompt_version": "custom-1"}
    document = chain(
        node("draft", "research", config=config, instructions="Write a short outline in my voice."),
        node("review", "review"),
        node(
            "edit",
            "research",
            config=config,
            instructions="Apply my feedback.",
            inputs={
                "context": {"source": "output", "node_id": "draft", "port": "text"},
                "feedback": {"source": "output", "node_id": "review", "port": "feedback"},
            },
        ),
        node("finish", "finish"),
    )
    document.update(schema_version="0.3", research={"model": "test-model"})
    revision = RevisionStore(database).save(Workflow.model_validate(document))
    provider = FakeProvider()
    store = RunStore(database, provider)
    request = RunRequest(
        id=uuid4(),
        revision_id=revision.id,
        brief="My own task",
        provider_account_id=provider.account.id,
    )
    first = store.start(request)
    assert first.status == "paused"
    assert first.model_attempts[0].result.hypotheses == []
    assert "Write a short outline in my voice." in provider.calls[0].instructions
    assert "Every hypothesis needs" not in provider.calls[0].instructions
    assert first.research_manifest.prompt_versions["custom"] == "custom-1"
    # A new runtime instance reads saved checkpoints and executes only the remaining step.
    resumed = RunStore(database, provider).resume(
        first.id, approve(first, "Make the outline shorter.")
    )
    assert resumed.status == "completed"
    assert len(provider.calls) == 2
    packet = json.loads(provider.calls[1].input_items[0]["content"][0]["text"])
    assert packet["human_feedback"] == "Make the outline shorter."
    assert packet["prior_result"]["conclusion"] == "Synthetic custom answer."
    assert store.get(first.id).workflow == revision.workflow
