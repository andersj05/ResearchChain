"""Pinned setup for a brief-led research session."""

from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import Field, StringConstraints, field_validator, model_validator

from researchchain.graph import (
    MAX_RESEARCH_CALLS,
    MAX_RESPONSE_SECONDS,
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
from researchchain.research_discovery import DISCOVERY_PROMPT
from researchchain.revisions import NotFoundError

SESSION_VERSION = "brief-led-1"
SOURCE_LED_BRIEF = "Source-led study"
ReviewMode = Literal["when_needed", "always", "never"]
StudyTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=160, pattern=r"^[^\x00\r\n]*$")
]


class ResearchSessionSetup(StrictModel):
    brief: str = Field(max_length=10000, pattern=r"^[^\x00]*$")
    title: StudyTitle | None = Field(default=None, exclude_if=lambda value: value is None)
    start_from_sources: bool = Field(default=False, exclude_if=lambda value: not value)
    style_excerpt: str = Field(default="", max_length=32000, pattern=r"^[^\x00]*$")
    model: ModelSlug
    reasoning_effort: ReasoningEffort | None = Field(default=None, exclude_if=lambda x: x is None)
    verbosity: ResponseVerbosity | None = Field(default=None, exclude_if=lambda x: x is None)
    lead: ModelOverride | None = Field(default=None, exclude_if=lambda x: x is None)
    researcher: ModelOverride | None = Field(default=None, exclude_if=lambda x: x is None)
    editor: ModelOverride | None = Field(default=None, exclude_if=lambda x: x is None)
    swarm: SwarmConfig | None = Field(default=None, exclude_if=lambda x: x is None)
    evidence_ids: list[UUID] = Field(default_factory=list, max_length=100)
    max_input_bytes: int = Field(
        default=4_000_000, ge=1000, le=8_000_000, exclude_if=lambda value: value == 4_000_000
    )
    max_agents: int = Field(default=3, ge=1, le=4)
    max_passes: int | None = Field(default=6, ge=2, le=12)
    max_active_seconds: int | None = Field(default=1800, ge=60, le=3600)
    web_search: bool = False
    review_mode: ReviewMode = "when_needed"
    baseline_run_id: UUID | None = None

    @field_validator("title")
    @classmethod
    def omit_blank_title(cls, value: str | None) -> str | None:
        return value or None

    @field_validator("lead", "researcher", "editor")
    @classmethod
    def omit_empty_override(cls, value: ModelOverride | None) -> ModelOverride | None:
        return value if value and value.model_dump(exclude_none=True) else None

    @model_validator(mode="after")
    def validate_inputs(self) -> Self:
        if self.start_from_sources and not self.evidence_ids:
            raise ValueError("Pin at least one source to start a discovery study.")
        if self.start_from_sources and not self.brief.strip():
            self.brief = SOURCE_LED_BRIEF
        elif not self.brief.strip():
            raise ValueError("Write a research brief to start a session.")
        if len(self.evidence_ids) != len(set(self.evidence_ids)):
            raise ValueError("Select each evidence record only once.")
        if self.swarm is None and (self.max_passes is None or self.max_active_seconds is None):
            raise ValueError("As-needed execution settings require a research swarm.")
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
    swarm = setup.swarm
    nodes: list[WorkflowNode] = []
    if setup.start_from_sources:
        nodes.extend(
            [
                WorkflowNode(
                    id="discovery",
                    kind="research",
                    label="Read the source material",
                    instructions=DISCOVERY_PROMPT,
                    position=Position(x=0, y=0),
                    config=ResearchConfig(
                        stage="custom",
                        prompt_version="custom-1",
                        **(setup.lead.model_dump(exclude_none=True) if setup.lead else {}),
                    ),
                ),
                WorkflowNode(
                    id="working_sentence",
                    kind="review",
                    label="Choose a working sentence",
                    instructions="Choose a working sentence, write your own or park the study.",
                    position=Position(x=300, y=0),
                ),
            ]
        )
    team = WorkflowNode(
        id="team",
        kind="research",
        label="Research team",
        instructions=(
            "Choose the investigations that best answer the owner's brief. Researchers may "
            "follow leads, test competing explanations and revise their findings. Save the "
            "sources, data and analysis files that support material claims."
        ),
        position=Position(x=300 * len(nodes), y=0),
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
    if setup.start_from_sources:
        team.instructions += (
            " The owner's working sentence is in human_feedback. Commission a concrete test of "
            "that wording using the pinned first reading and its rivals. Include the comparison "
            "and a result that would weaken the sentence in the assignment. Keep the owner's "
            "judgment distinct from evidence."
        )
        team.inputs = {
            "context": ValueSource(source="output", node_id="discovery", port="text"),
            "feedback": ValueSource(source="output", node_id="working_sentence", port="feedback"),
        }
    if swarm and (
        setup.max_passes is None or setup.max_active_seconds is None or swarm.max_lead_turns is None
    ):
        team.instructions += (
            " Finish an assignment when its main test is answered or another investigation "
            "is unlikely to change the conclusion. Record what would still change the result."
        )
        if setup.web_search:
            team.instructions += (
                " Use live web search throughout the investigation to verify material or "
                "time-sensitive claims, seek independent primary sources and check competing "
                "explanations. Lead researchers should delegate those checks and evaluate what "
                "the returned evidence supports. Cite observed sources with their as-of dates."
            )
        if swarm.allow_consultations:
            team.instructions += (
                " Leads should bring a concrete thesis and its alternatives to the owner when "
                "their judgment could change the investigation or the trade conclusion. Ask "
                "while there is still time to follow up on the answer."
            )
    nodes.append(team)
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
                position=Position(x=300 * len(nodes), y=0),
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
    researchers = swarm.lead_count * swarm.researchers_per_lead if swarm else setup.max_agents
    if setup.max_passes is None or (swarm and swarm.max_lead_turns is None):
        calls = MAX_RESEARCH_CALLS
    else:
        lead_turns = swarm.lead_count * (swarm.max_lead_turns or 0) if swarm else 0
        calls = (
            1 + int(setup.start_from_sources) + lead_turns + (researchers + 1) * setup.max_passes
        )
    return Workflow(
        schema_version="0.3",
        name="Source-led research" if setup.start_from_sources else "Research session",
        start_node=nodes[0].id,
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
                max_input_bytes=setup.max_input_bytes,
                max_output_characters=100_000,
                max_response_seconds=min(
                    MAX_RESPONSE_SECONDS, setup.max_active_seconds or MAX_RESPONSE_SECONDS
                ),
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
    time_limit = run.workflow.budgets.max_active_seconds
    return ResearchSessionSetup(
        brief=run.brief,
        title=run.research_manifest.tool_config.get("study_title"),
        start_from_sources=run.workflow.start_node == "discovery",
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
        max_input_bytes=run.research_manifest.settings.limits.max_input_bytes,
        max_agents=team.team.max_agents,
        max_passes=team.analyst.max_passes,
        max_active_seconds=int(time_limit) if time_limit is not None else None,
        web_search=bool(team.web_search),
        review_mode="never"
        if judgment is None
        else "always"
        if judgment.instructions
        else "when_needed",
        baseline_run_id=run.baseline_run_id,
    )
