"""Pinned setup for a brief-led research session."""

from typing import Literal, Self
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from researchchain.graph import (
    AnalystConfig,
    ExecutionBudgets,
    ModelOverride,
    ModelSlug,
    Position,
    ReasoningEffort,
    ResearchConfig,
    ResearchLimits,
    ResearchSettings,
    ResearchTeamConfig,
    ResponseVerbosity,
    StrictModel,
    SwarmConfig,
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
    reasoning_effort: ReasoningEffort | None = Field(default=None, exclude_if=lambda x: x is None)
    verbosity: ResponseVerbosity | None = Field(default=None, exclude_if=lambda x: x is None)
    lead: ModelOverride | None = Field(default=None, exclude_if=lambda x: x is None)
    researcher: ModelOverride | None = Field(default=None, exclude_if=lambda x: x is None)
    editor: ModelOverride | None = Field(default=None, exclude_if=lambda x: x is None)
    swarm: SwarmConfig | None = Field(default=None, exclude_if=lambda x: x is None)
    evidence_ids: list[UUID] = Field(default_factory=list, max_length=100)
    max_agents: int = Field(default=3, ge=1, le=4)
    max_passes: int = Field(default=6, ge=2, le=12)
    max_active_seconds: int = Field(default=1800, ge=60, le=3600)
    web_search: bool = False
    review_mode: ReviewMode = "when_needed"
    baseline_run_id: UUID | None = None

    @field_validator("lead", "researcher", "editor")
    @classmethod
    def omit_empty_override(cls, value: ModelOverride | None) -> ModelOverride | None:
        return value if value and value.model_dump(exclude_none=True) else None

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
            team=ResearchTeamConfig(
                max_agents=setup.max_agents,
                lead=setup.lead,
                researcher=setup.researcher,
                swarm=setup.swarm,
            ),
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
                **(setup.editor.model_dump(exclude_none=True) if setup.editor else {}),
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
    swarm = setup.swarm
    researchers = swarm.lead_count * swarm.researchers_per_lead if swarm else setup.max_agents
    lead_turns = swarm.lead_count * swarm.max_lead_turns if swarm else 0
    calls = 1 + lead_turns + (researchers + 1) * setup.max_passes
    return Workflow(
        schema_version="0.3",
        name="Research session",
        start_node="team",
        nodes=nodes,
        edges=[
            WorkflowEdge(source=a.id, target=b.id) for a, b in zip(nodes, nodes[1:], strict=False)
        ],
        budgets=ExecutionBudgets(
            max_active_seconds=setup.max_active_seconds,
            max_concurrency=swarm.max_parallel if swarm else setup.max_agents,
        ),
        research=ResearchSettings(
            model=setup.model,
            reasoning_effort=setup.reasoning_effort,
            verbosity=setup.verbosity,
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
        reasoning_effort=run.research_manifest.settings.reasoning_effort,
        verbosity=run.research_manifest.settings.verbosity,
        lead=team.team.lead,
        researcher=team.team.researcher,
        swarm=team.team.swarm,
        editor=ModelOverride(
            model=editor.model, reasoning_effort=editor.reasoning_effort, verbosity=editor.verbosity
        ),
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
