"""Pinned contracts for pure JavaScript code steps."""

from typing import Literal

from pydantic import Field

from researchchain.graph import StrictModel


class CodeInputs(StrictModel):
    text: str = Field(default="", max_length=200000)
    number: float = Field(default=0, allow_inf_nan=False)
    brief: str = Field(max_length=6000)
    artifact_count: int = Field(ge=0)
    iteration: int = Field(ge=0)


class CodeOutputs(StrictModel):
    text: str = Field(max_length=24000)
    number: float = Field(allow_inf_nan=False, strict=True)


class CodeExecution(StrictModel):
    runtime: Literal["quickjs-ng-0.18.0.1"] = "quickjs-ng-0.18.0.1"
    source_sha256: str
    inputs: CodeInputs
    outputs: CodeOutputs
    duration_ms: int = Field(ge=0)
