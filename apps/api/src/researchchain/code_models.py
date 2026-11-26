"""Pinned contracts for pure JavaScript code steps."""

from pydantic import Field

from researchchain.graph import CodeRuntime, StrictModel


class CodeInputs(StrictModel):
    text: str = Field(default="", max_length=200000)
    number: float = Field(default=0, allow_inf_nan=False)
    brief: str = Field(max_length=10000)
    artifact_count: int = Field(ge=0)
    iteration: int = Field(ge=0)


class CodeOutputs(StrictModel):
    text: str = Field(max_length=24000)
    number: float = Field(allow_inf_nan=False, strict=True)


class CodeExecution(StrictModel):
    # A historical receipt without this field predates the second runtime.
    runtime: CodeRuntime = "quickjs-ng-0.18.0.1"
    source_sha256: str
    inputs: CodeInputs
    outputs: CodeOutputs
    duration_ms: int = Field(ge=0)
