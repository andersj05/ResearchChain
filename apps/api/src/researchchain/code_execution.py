"""Bounded, host-free JavaScript transforms in disposable child processes."""

import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from pydantic import ValidationError

from researchchain.code_models import CodeExecution, CodeInputs, CodeOutputs
from researchchain.graph import CodeConfig


class CodeExecutionError(Exception):
    pass


def execute_code(config: CodeConfig, inputs: CodeInputs) -> CodeExecution:
    python = Path(sys.executable)
    if config.runtime == "quickjs-ng-0.18.0.1":
        legacy_env = Path(__file__).resolve().parents[3] / "quickjs-legacy" / ".venv"
        python = legacy_env / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    started = time.monotonic()
    try:
        completed = subprocess.run(
            [str(python), "-I", str(Path(__file__).with_name("_code_runner.py"))],
            input=json.dumps(
                {**config.model_dump(), "inputs": inputs.model_dump()}, ensure_ascii=True
            ).encode("ascii"),
            capture_output=True,
            timeout=config.timeout_seconds + 3,
            # Provider credentials, database configuration and owner secrets must
            # not be inherited. JS has no Python/OS bridge even inside this child.
            env={key: value for key, value in os.environ.items() if key.upper() == "SYSTEMROOT"},
            creationflags=int(getattr(subprocess, "CREATE_NO_WINDOW", 0)),
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise CodeExecutionError(
            "Code exceeded its time limit; the child process was stopped."
        ) from error
    except OSError as error:
        raise CodeExecutionError(
            "The local code runtime could not start. Run pnpm bootstrap."
        ) from error
    if completed.returncode or len(completed.stdout) > 200000:
        raise CodeExecutionError("The code runtime stopped or exceeded its output limit.")
    try:
        response = json.loads(completed.stdout)
        if response.get("error"):
            message = str(response["error"])
            if "interrupted" in message:
                message = "Code exceeded its CPU time limit."
            raise CodeExecutionError(message)
        output = CodeOutputs.model_validate(response["output"])
    except (ValueError, KeyError, TypeError, ValidationError) as error:
        raise CodeExecutionError("Return an object with text and a finite number.") from error
    return CodeExecution(
        runtime=config.runtime,
        source_sha256=hashlib.sha256(config.source.encode()).hexdigest(),
        inputs=inputs,
        outputs=output,
        duration_ms=round((time.monotonic() - started) * 1000),
    )
