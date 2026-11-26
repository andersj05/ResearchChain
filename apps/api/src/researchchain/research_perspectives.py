"""Independent owner answers at a durable multi-lead research checkpoint."""

from collections.abc import Iterable
from typing import Any
from uuid import UUID, uuid5

from langgraph.types import Interrupt, interrupt
from psycopg import Connection
from psycopg.rows import DictRow

from researchchain.compiler import ExecutionStopped
from researchchain.models import LeadPerspective, PerspectiveAnswer, ReviewPrompt

PERSPECTIVE_BATCH = "research-perspectives-1"
LEGACY_REPLAY_STOP_REASON = "The answer did not match a pending lead consultation."


def perspective_id(run_id: UUID, action_path: str) -> str:
    return f"perspective-{uuid5(run_id, action_path)}"


def request_perspectives(
    run_id: UUID,
    node_id: str,
    questions: list[LeadPerspective],
    answered: dict[str, PerspectiveAnswer],
) -> dict[str, str]:
    """Call on the graph thread in replay-stable round order, after all effects are journaled."""
    pending = {item.action_path: item for item in questions}
    if len(pending) != len(questions):
        raise ExecutionStopped("Two lead consultations used the same saved action.", "failed")
    if not pending:
        return {}
    payload = {
        "format": PERSPECTIVE_BATCH,
        "node_id": node_id,
        "questions": [item.model_dump(mode="json") for item in pending.values()],
    }
    while True:
        answer = PerspectiveAnswer.model_validate(interrupt(payload))
        # Retrying after a stop can append an answer to the graph task's replay
        # list even though the task had already consumed it before stopping.
        if answered.get(answer.action_path) != answer:
            break
    if answer.action_path not in pending or answer.interrupt_id != perspective_id(
        run_id, answer.action_path
    ):
        raise ExecutionStopped(
            "A replayed answer could not be matched to its saved lead consultation.", "failed"
        )
    if answer.decision == "reject":
        raise ExecutionStopped("The owner declined this research consultation.", "rejected")
    if not answer.feedback.strip():
        raise ExecutionStopped("The lead consultation requires an owner answer.", "failed")
    answered[answer.action_path] = answer
    return {answer.action_path: answer.feedback}


def checkpoint_reviews(
    run_id: UUID, pending: list[Interrupt[Any]]
) -> list[tuple[str, ReviewPrompt]]:
    """Pair each public review with its underlying LangGraph resume destination."""
    pairs = []
    for item in pending:
        value = item.value
        if value.get("format") == PERSPECTIVE_BATCH:
            for raw in value["questions"]:
                question = LeadPerspective.model_validate(raw)
                pairs.append(
                    (
                        item.id,
                        ReviewPrompt(
                            interrupt_id=perspective_id(run_id, question.action_path),
                            node_id=value["node_id"],
                            path=question.action_path,
                            question=question.question,
                            perspective=question,
                        ),
                    )
                )
        else:
            pairs.append((item.id, ReviewPrompt(interrupt_id=item.id, **value)))
    return pairs


def perspective_answers(
    conn: Connection[DictRow], run_id: UUID, action_paths: Iterable[str]
) -> list[PerspectiveAnswer]:
    by_id = {perspective_id(run_id, path): path for path in action_paths}
    if not by_id:
        return []
    rows = conn.execute(
        "SELECT interrupt_id, decision, feedback FROM run_commands WHERE run_id=%s "
        "AND kind='resume' AND interrupt_id=ANY(%s) ORDER BY created_at,id",
        (run_id, list(by_id)),
    )
    return [PerspectiveAnswer(**row, action_path=by_id[row["interrupt_id"]]) for row in rows]
