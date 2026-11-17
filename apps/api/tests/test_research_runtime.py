import asyncio
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from uuid import uuid4

import pytest
from access_fixtures import owner_client
from graph_fixtures import split
from run_fixtures import run_request
from test_research_contracts import research_document, result_document

from researchchain.artifacts import read_content
from researchchain.database import Database
from researchchain.graph import Workflow
from researchchain.main import create_app
from researchchain.models import ResumeRequest, RunRequest, RunSnapshot
from researchchain.providers.chatgpt_plan import Completion
from researchchain.research import ResearchExecutor
from researchchain.research_models import ProviderAccount, ProviderModel, ProviderStatus
from researchchain.revisions import ConflictError, RevisionStore
from researchchain.runtime import RunStore


class FakeProvider:
    """Only synthetic text; no credentials or external network calls in tests."""

    def __init__(self) -> None:
        self.calls: list[Any] = []
        self.block = False
        self.started = threading.Event()
        self.released = threading.Event()
        self.cancelled = threading.Event()
        self.crash = False
        self.invalid = False
        self.usage: dict[str, int] = {"input_tokens": 25, "output_tokens": 15}
        self.account = ProviderAccount(
            id="oaiapp_fixture",
            label="Synthetic",
            email=None,
            signed_in=True,
            plan_enabled=True,
            active=True,
        )

    def status(self) -> ProviderStatus:
        return ProviderStatus(
            accounts=[self.account],
            models=[ProviderModel(slug="test-model", display_name="Fixture model")],
        )

    def pin_account(self, account_id: str, model: str) -> ProviderAccount:
        assert account_id == self.account.id and model == "test-model"
        return self.account

    async def complete(self, manifest: Any, prepared: Any, on_delta: Any) -> Completion:
        self.calls.append(prepared)
        on_delta('{"schema_version":')
        self.started.set()
        if self.crash:
            raise RuntimeError("Simulated worker interruption")
        try:
            while self.block and not self.released.is_set():
                await asyncio.sleep(0.02)
        except asyncio.CancelledError:
            self.cancelled.set()
            raise
        stage = (
            "hypothesize"
            if prepared.previous is None
            else "challenge"
            if prepared.previous.stage == "hypothesize"
            else "revise"
        )
        if "Stage: custom\n" in prepared.instructions:
            stage = "custom"
        result = result_document(stage)
        if stage == "custom":
            result["hypotheses"] = []
            result["conclusion"] = "Synthetic custom answer."
        if self.invalid:
            result["hypotheses"][0]["assessment"] = "supported"
        return Completion(
            "test-model", json.dumps(result), "response_fixture", self.usage, "test-model-snapshot"
        )


def setup_run(database: Database, **limits: Any) -> tuple[RunStore, RunRequest, FakeProvider]:
    document = research_document()
    document["research"]["limits"] = limits
    revision = RevisionStore(database).save(Workflow.model_validate(document))
    provider = FakeProvider()
    return (
        RunStore(database, provider),
        RunRequest(
            id=uuid4(),
            revision_id=revision.id,
            brief="Synthetic test brief",
            provider_account_id=provider.account.id,
        ),
        provider,
    )


def approve(snapshot: RunSnapshot, feedback: str = "") -> ResumeRequest:
    assert snapshot.review and snapshot.checkpoint_id
    return ResumeRequest(
        checkpoint_id=snapshot.checkpoint_id,
        interrupt_id=snapshot.review.interrupt_id,
        decision="approve",
        feedback=feedback,
    )


def test_research_flow_pins_records_and_review_feedback(database: Database) -> None:
    store, request, provider = setup_run(database)
    first = store.start(request)
    assert first.status == "paused" and len(provider.calls) == 1
    assert first.research_manifest
    assert first.research_manifest.settings.model == "test-model"
    assert first.research_manifest.account_id == provider.account.id
    assert first.research_manifest.workflow_revision_id == request.revision_id
    assert len(first.research_manifest.prompt_hashes) == 3
    assert first.model_attempts[0].returned_model == "test-model-snapshot"
    review = approve(first, "Please investigate the alternative explanation.")
    revised = store.resume(request.id, review)
    assert revised.status == "paused" and revised.review.node_id == "final_review"
    assert [attempt.stage for attempt in revised.model_attempts] == [
        "hypothesize",
        "challenge",
        "revise",
    ]
    assert len(provider.calls) == 3
    assert revised.usage.model_calls == revised.usage.tool_calls == 3
    assert revised.usage.input_tokens == 75 and revised.usage.output_tokens == 45
    assert revised.usage.usage_complete
    with database.connection() as conn:
        attempt = revised.model_attempts[1]
        assert attempt.input_artifact_id and attempt.response_artifact_id
        content = read_content(conn, attempt.input_artifact_id)
        assert review.feedback.encode() in content
        assert b"test-model" in content
    assert store.resume(request.id, review) == revised
    with pytest.raises(ConflictError, match="different recorded decision"):
        store.resume(request.id, review.model_copy(update={"feedback": "Changed opinion"}))
    assert store.resume(request.id, approve(revised)).status == "completed"
    assert store.start(request) == first  # Retried command returns its original receipt.
    assert len(provider.calls) == 3
    with pytest.raises(ConflictError, match="different provider"):
        store.start(request.model_copy(update={"provider_account_id": "oaiapp_other"}))


@pytest.mark.parametrize(
    "limit,reason",
    [
        ({"max_model_calls": 0}, "Model-call"),
        ({"max_tool_calls": 0}, "Evidence-tool"),
    ],
)
def test_limits_block_before_provider(database: Database, limit: Any, reason: str) -> None:
    store, request, provider = setup_run(database, **limit)
    result = store.start(request)
    assert result.status == "limited" and reason in result.stop_reason
    assert not provider.calls and not result.model_attempts


@pytest.mark.parametrize("usage", [None, {}])
def test_token_admission_stops_next_call(database: Database, usage: Any) -> None:
    store, request, provider = setup_run(database, max_total_tokens=30)
    if usage is not None:
        provider.usage = usage
    first = store.start(request)
    # The plan route cannot hard-cap the in-flight response; reported usage is
    # charged before admitting the next call, including an overrun of 10 here.
    assert first.status == "paused"
    next_result = store.resume(request.id, approve(first))
    assert next_result.status == "limited" and "token budget" in next_result.stop_reason
    assert len(provider.calls) == 1
    assert next_result.usage.usage_complete == bool(provider.usage)


def test_input_budget_and_invalid_output_are_not_successes(database: Database) -> None:
    store, request, provider = setup_run(database, max_input_bytes=1000)
    result = store.start(request)
    assert result.status == "failed" and not provider.calls
    assert result.model_attempts[0].status == "failed"
    store, request, provider = setup_run(database)
    provider.invalid = True
    result = store.start(request)
    assert result.status == "failed" and result.model_attempts[0].result is None
    assert result.model_attempts[0].response_artifact_id
    assert result.usage.input_tokens == 25
    assert "schema" in result.stop_reason


def test_running_snapshot_and_cancellation_do_not_wait_for_model(database: Database) -> None:
    store, request, provider = setup_run(database)
    provider.block = True
    with ThreadPoolExecutor(max_workers=2) as pool:
        execution = pool.submit(store.start, request)
        try:
            assert provider.started.wait(timeout=5)
            live = pool.submit(store.get, request.id).result(timeout=3)
            assert live.status == "running" and not live.reviews
            assert live.model_attempts[0].status == "requesting"
            assert live.model_attempts[0].output_characters > 0
            assert live.usage.active_seconds > 0
            assert store.list()[0].status == "running"
            assert store.cancel(request.id).status == "cancelled"
            final = execution.result(timeout=5)
            assert final.status == "cancelled" and provider.cancelled.is_set()
            assert final.model_attempts[0].status == "cancelled"
            assert final.model_attempts[0].response_artifact_id
            assert not final.usage.usage_complete
        finally:
            provider.released.set()


def test_active_time_limit_closes_provider_task(database: Database) -> None:
    store, request, provider = setup_run(database)
    document = research_document()
    document["budgets"] = {"max_active_seconds": 0.4}
    revision = RevisionStore(database).save(Workflow.model_validate(document))
    request.revision_id = revision.id
    provider.block = True
    result = store.start(request)
    assert result.status == "limited" and "time limit" in result.stop_reason
    assert provider.cancelled.is_set() and result.model_attempts[0].status == "limited"


def test_recovery_does_not_resend_uncertain_request(database: Database) -> None:
    store, request, provider = setup_run(database)
    provider.crash = True
    with pytest.raises(RuntimeError, match="worker interruption"):
        store.start(request)
    assert store.get(request.id).status == "interrupted"
    recovered = store.recover(request.id)
    assert recovered.status == "failed" and len(provider.calls) == 1
    assert recovered.model_attempts[0].status == "unknown"
    assert "will not be resent" in recovered.stop_reason


def test_recovery_reuses_completed_result_before_checkpoint(
    database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, request, provider = setup_run(database)
    original = ResearchExecutor.finish

    def finish_then_interrupt(*args: Any, **kwargs: Any) -> None:
        original(*args, **kwargs)
        raise RuntimeError("Simulated checkpoint interruption")

    with monkeypatch.context() as patch:
        patch.setattr(ResearchExecutor, "finish", finish_then_interrupt)
        with pytest.raises(RuntimeError, match="checkpoint interruption"):
            store.start(request)
    recovered = store.recover(request.id)
    assert recovered.status == "paused" and len(provider.calls) == 1
    assert recovered.model_attempts[0].status == "completed"


def test_provider_api_and_account_required_before_start(database: Database) -> None:
    store, request, provider = setup_run(database)
    with owner_client(create_app(database, provider)) as client:
        result = client.get("/api/providers/chatgpt")
        assert result.status_code == 200
        assert result.json()["accounts"][0]["id"] == "oaiapp_fixture"
        assert "token" not in result.text
        body = request.model_dump(mode="json")
        body.pop("provider_account_id")
        result = run_request(client, "/api/runs", json=body)
        assert result.status_code == 422 and not provider.calls
        assert store.list() == []


def test_concurrent_readers_do_not_hide_a_completed_review(database: Database) -> None:
    store, request, _ = setup_run(database)
    first = store.start(request)
    with store._locked(request.id):
        current = store.get(request.id)
    assert current.status == "paused"
    assert current.review == first.review


def test_parallel_research_charges_usage_before_admitting_another_call(database: Database) -> None:
    class SlowProvider(FakeProvider):
        async def complete(self, manifest: Any, prepared: Any, on_delta: Any) -> Completion:
            await asyncio.sleep(0.2)
            return await super().complete(manifest, prepared, on_delta)

    document = split()
    document.update(
        schema_version="0.3", research={"model": "test-model", "limits": {"max_total_tokens": 30}}
    )
    for node in document["nodes"]:
        if node["id"] in {"left", "right"}:
            node.update(kind="research", config={"type": "research"})
    revision = RevisionStore(database).save(Workflow.model_validate(document))
    provider = SlowProvider()
    result = RunStore(database, provider).start(
        RunRequest(
            id=uuid4(),
            revision_id=revision.id,
            brief="Synthetic parallel test",
            provider_account_id=provider.account.id,
        )
    )
    assert result.status == "limited"
    assert len(provider.calls) == 1
    assert result.usage.input_tokens + result.usage.output_tokens == 40
