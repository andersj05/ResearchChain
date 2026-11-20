"""Pinned setup for a brief-led research session."""

from typing import Literal, Self
from uuid import UUID

from pydantic import Field, model_validator

from researchchain.graph import (
    AnalystConfig,
    ExecutionBudgets,
    ModelSlug,
    Position,
    ResearchConfig,
    ResearchLimits,
    ResearchSettings,
    ResearchTeamConfig,
    StrictModel,
    ValueSource,
    Workflow,
    WorkflowEdge,
    WorkflowNode,
)
from researchchain.models import RunSnapshot
from researchchain.revisions import NotFoundError

SESSION_VERSION = "brief-led-1"
ReviewMode = Literal["when_needed", "always", "never"]


class ResearchSessionSetup(StrictModel):
    brief: str = Field(min_length=1, max_length=10000, pattern=r"^[^\x00]*$")
    style_excerpt: str = Field(default="", max_length=32000, pattern=r"^[^\x00]*$")
    model: ModelSlug
    evidence_ids: list[UUID] = Field(default_factory=list, max_length=100)
    max_agents: int = Field(default=3, ge=1, le=4)
    max_passes: int = Field(default=6, ge=2, le=12)
    max_active_seconds: int = Field(default=1800, ge=60, le=3600)
    web_search: bool = False
    review_mode: ReviewMode = "when_needed"
    baseline_run_id: UUID | None = None

    @model_validator(mode="after")
    def validate_inputs(self) -> Self:
        if not self.brief.strip():
            raise ValueError("Write a research brief to start a session.")
        if len(self.evidence_ids) != len(set(self.evidence_ids)):
            raise ValueError("Select each evidence record only once.")
        return self


class ResearchSessionStart(ResearchSessionSetup):
    id: UUID
    provider_account_id: str = Field(pattern=r"^oaiapp_[a-zA-Z0-9_-]{1,180}$")

    @model_validator(mode="after")
    def validate_baseline(self) -> Self:
        if self.id == self.baseline_run_id:
            raise ValueError("A research session cannot be its own baseline.")
        return self


def session_workflow(setup: ResearchSessionSetup) -> Workflow:
    analyst = AnalystConfig(max_passes=setup.max_passes, workspace=True)
    team = WorkflowNode(
        id="team",
        kind="research",
        label="Research team",
        instructions=(
            "Choose the investigations that best answer the owner's brief. Researchers may "
            "follow leads, test competing explanations and revise their findings. Save the "
            "sources, data and analysis files that support material claims."
        ),
        position=Position(x=0, y=0),
        config=ResearchConfig(
            stage="custom",
            prompt_version="custom-1",
            team=ResearchTeamConfig(max_agents=setup.max_agents),
            analyst=analyst,
            web_search="auto" if setup.web_search else False,
        ),
    )
    nodes = [team]
    report_inputs = {"context": ValueSource(source="output", node_id="team", port="text")}
    if setup.review_mode != "never":
        nodes.append(
            WorkflowNode(
                id="judgment",
                kind="review",
                label="Editorial judgment",
                instructions=(
                    "What should the editor emphasize, qualify or revisit in these findings?"
                    if setup.review_mode == "always"
                    else ""
                ),
                inputs={
                    "question": ValueSource(source="output", node_id="team", port="review_question")
                },
                position=Position(x=300, y=0),
            )
        )
        report_inputs["feedback"] = ValueSource(
            source="output", node_id="judgment", port="feedback"
        )
    nodes.append(
        WorkflowNode(
            id="report",
            kind="research",
            label="Report editor",
            instructions=(
                "Write the report requested in the owner's brief. Reconcile the team's "
                "findings with their recorded sources and any owner feedback. Open the "
                "researchers' supporting files when useful. Use your Python workspace to "
                "save the full Markdown report as report.md in the output directory. "
                "When the evidence supports a figure, copy or generate its PNG alongside "
                "the report and link it by relative file name. Label sources, units and "
                "dates. Never invent data to fill a chart. Summarize the result and any "
                "missing evidence in your final conclusion."
            ),
            config=ResearchConfig(
                stage="custom",
                prompt_version="custom-1",
                analyst=analyst,
                style_excerpt=setup.style_excerpt,
                web_search="auto" if setup.web_search else False,
            ),
            position=Position(x=300 * len(nodes), y=0),
            inputs=report_inputs,
        )
    )
    nodes.append(
        WorkflowNode(
            id="finish", kind="finish", label="Finish", position=Position(x=300 * len(nodes), y=0)
        )
    )
    calls = 1 + (setup.max_agents + 1) * setup.max_passes
    return Workflow(
        schema_version="0.3",
        name="Research session",
        start_node="team",
        nodes=nodes,
        edges=[
            WorkflowEdge(source=a.id, target=b.id) for a, b in zip(nodes, nodes[1:], strict=False)
        ],
        budgets=ExecutionBudgets(
            max_active_seconds=setup.max_active_seconds, max_concurrency=setup.max_agents
        ),
        research=ResearchSettings(
            model=setup.model,
            limits=ResearchLimits(
                max_model_calls=calls,
                max_tool_calls=calls,
                max_input_bytes=4_000_000,
                max_output_characters=100_000,
                max_response_seconds=min(600, setup.max_active_seconds),
                max_total_tokens="as_needed",
            ),
        ),
    )


def session_setup(run: RunSnapshot) -> ResearchSessionSetup:
    if (
        not run.research_manifest
        or run.research_manifest.tool_config.get("session") != SESSION_VERSION
    ):
        raise NotFoundError("Research session not found.")
    nodes = {node.id: node for node in run.workflow.nodes}
    team, editor, judgment = nodes["team"].config, nodes["report"].config, nodes.get("judgment")
    assert isinstance(team, ResearchConfig) and team.team and team.analyst
    assert isinstance(editor, ResearchConfig)
    return ResearchSessionSetup(
        brief=run.brief,
        style_excerpt=editor.style_excerpt or "",
        model=run.research_manifest.settings.model,
        evidence_ids=run.evidence_ids,
        max_agents=team.team.max_agents,
        max_passes=team.analyst.max_passes,
        max_active_seconds=int(run.workflow.budgets.max_active_seconds),
        web_search=bool(team.web_search),
        review_mode="never"
        if judgment is None
        else "always"
        if judgment.instructions
        else "when_needed",
        baseline_run_id=run.baseline_run_id,
    )
