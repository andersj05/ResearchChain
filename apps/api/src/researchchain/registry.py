"""The public node registry: configuration schemas and typed connection ports."""

from typing import Any

from pydantic import Field

from researchchain.graph import (
    INPUT_PORTS,
    OUTPUT_PORTS,
    CodeConfig,
    ForkConfig,
    LoopConfig,
    NodeKind,
    PortType,
    ResearchConfig,
    RouteConfig,
    StrictModel,
    SubgraphConfig,
)


class PortSpec(StrictModel):
    name: str
    type: PortType


class NodeTypeSpec(StrictModel):
    kind: NodeKind
    label: str
    inputs: list[PortSpec]
    outputs: list[PortSpec]
    config_schema: dict[str, Any] = Field(default_factory=dict)


def node_types() -> list[NodeTypeSpec]:
    configurations: dict[str, type[StrictModel]] = {
        "route": RouteConfig,
        "fork": ForkConfig,
        "loop": LoopConfig,
        "subgraph": SubgraphConfig,
        "research": ResearchConfig,
        "code": CodeConfig,
    }
    labels: dict[NodeKind, str] = {
        "note": "Research note",
        "review": "Human review",
        "finish": "Finish",
        "route": "Condition",
        "fork": "Parallel branches",
        "join": "Join",
        "loop": "Bounded loop",
        "subgraph": "Subgraph",
        "research": "Hypothesis research",
        "code": "Custom code",
    }
    result = []
    for kind, label in labels.items():
        controls = [] if kind == "finish" else ["next"]
        if kind == "route":
            controls = ["true", "false"]
        elif kind == "fork":
            controls = ["<branch name>"]
        result.append(
            NodeTypeSpec(
                kind=kind,
                label=label,
                inputs=[
                    PortSpec(name="in", type="control"),
                    *[
                        PortSpec(name=key, type=value)
                        for key, value in INPUT_PORTS.get(kind, {}).items()
                    ],
                ],
                outputs=[
                    *[PortSpec(name=name, type="control") for name in controls],
                    *[
                        PortSpec(name=key, type=value)
                        for key, value in OUTPUT_PORTS.get(kind, {}).items()
                    ],
                ],
                config_schema=configurations[kind].model_json_schema()
                if kind in configurations
                else {},
            )
        )
    return result
