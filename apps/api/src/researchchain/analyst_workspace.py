"""Run a Codex research action in a disposable container and validate its exports."""

import base64
import json
import re
import shutil
import struct
import subprocess
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any
from uuid import uuid4

from pydantic import Field, field_validator

from researchchain.graph import StrictModel

IMAGE = "researchchain/analyst-python:1"
MAX_FILES = 64
MAX_INPUT_BYTES = 24 * 1024 * 1024
MAX_INPUT_FILE_BYTES = 8 * 1024 * 1024
MAX_EXPORT_BYTES = 6 * 1024 * 1024
MAX_EXPORT_FILE_BYTES = 2 * 1024 * 1024
FILENAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\Z")
EXPORT_TYPES = {".png", ".csv", ".tsv", ".md", ".py", ".txt", ".json"}


class PythonRequest(StrictModel):
    purpose: str = Field(min_length=1, max_length=1500)
    script: str = Field(min_length=1, max_length=48000)

    @field_validator("purpose", "script")
    @classmethod
    def valid_text(cls, value: str) -> str:
        if "\x00" in value or not value.strip():
            raise ValueError("The Python action needs nonempty text without null bytes.")
        value.encode("utf-8")
        return value


@dataclass
class PythonRun:
    exit_code: int
    output: str
    files: dict[str, bytes]


def python_tool() -> dict[str, Any]:
    return {
        "type": "function",
        "name": "run_python",
        "description": (
            "Run your Python script with NumPy, Matplotlib and the standard library. "
            "Read staged files from the current directory. Write up to 11 flat named PNG, "
            "CSV, TSV, JSON, Markdown, Python or text exports under outputs/. "
            "Use plain filenames with letters, digits, dots, hyphens and underscores. "
            "Print observations for the next pass. The script is retained as analysis.py. "
            "The filesystem is temporary and network access is disabled."
        ),
        "inputSchema": PythonRequest.model_json_schema(),
    }


def _request(request: PythonRequest, files: dict[str, bytes]) -> bytes:
    if (
        len(files) > MAX_FILES
        or sum(map(len, files.values())) > MAX_INPUT_BYTES
        or any(len(data) > MAX_INPUT_FILE_BYTES for data in files.values())
    ):
        raise ValueError("Python workspace inputs exceed 64 files, 8 MiB per file or 24 MiB total.")
    if any(not FILENAME.fullmatch(name) or name == "outputs" for name in files):
        raise ValueError("The Python workspace received an invalid input filename.")
    return json.dumps(
        {
            "script": request.script,
            "files": {name: base64.b64encode(data).decode("ascii") for name, data in files.items()},
        }
    ).encode()


def _receipt(raw: bytes, script: str) -> PythonRun:
    if len(raw) > 9 * 1024 * 1024:
        raise ValueError("The Python runner returned an oversized receipt.")
    receipt = json.loads(raw)
    if not isinstance(receipt, dict) or not (
        type(receipt.get("exit_code")) is int
        and isinstance(receipt.get("output"), str)
        and len(receipt["output"]) <= 8192
        and isinstance(receipt.get("files"), dict)
        and len(receipt["files"]) <= 11
    ):
        raise ValueError("The Python runner returned an invalid receipt.")
    files = {"analysis.py": script.encode()}
    size = len(files["analysis.py"])
    for name, encoded in receipt["files"].items():
        ext = PurePosixPath(name).suffix.lower()
        if not (
            FILENAME.fullmatch(name)
            and name.lower() != "analysis.py"
            and ext in EXPORT_TYPES
            and isinstance(encoded, str)
        ):
            raise ValueError("The Python runner returned an invalid artifact name.")
        data = base64.b64decode(encoded, validate=True)
        size += len(data)
        if not data or len(data) > MAX_EXPORT_FILE_BYTES or size > MAX_EXPORT_BYTES:
            raise ValueError("The Python runner returned an oversized or empty artifact.")
        if ext == ".png":
            if not (data.startswith(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR") and len(data) >= 33):
                raise ValueError("The Python runner returned an invalid PNG chart.")
            width, height = struct.unpack(">II", data[16:24])
            if not (width and height and width * height <= 32_000_000):
                raise ValueError("The PNG chart exceeds the display limit of 32 megapixels.")
        elif "\x00" in data.decode("utf-8-sig"):
            raise ValueError("The Python runner returned an invalid text artifact.")
        files[name] = data
    output = receipt["output"].replace("\x00", "\ufffd").encode("utf-8", "replace").decode()
    return PythonRun(receipt["exit_code"], output, files)


def run_python(
    request: PythonRequest, files: dict[str, bytes], guard: Callable[[], None]
) -> PythonRun:
    payload = _request(request, files)
    docker = shutil.which("docker")
    if not docker:
        raise ValueError("Install Docker and build the research Python image on the worker.")
    name = "researchchain-python-" + uuid4().hex
    args = [
        docker,
        "run",
        "--name",
        name,
        "--rm",
        "--pull=never",
        "--interactive",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--cap-add=SETUID",
        "--cap-add=SETGID",
        "--cap-add=KILL",
        "--security-opt=no-new-privileges",
        "--cpus=1",
        "--memory=512m",
        "--memory-swap=512m",
        "--pids-limit=64",
        "--ulimit",
        "nofile=256:256",
        "--ulimit",
        "core=0:0",
        "--tmpfs",
        "/work:rw,nosuid,nodev,noexec,size=64m,mode=1777",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777",
    ]
    # Docker CLI can inject proxy credentials from the owner's client configuration.
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "FTP_PROXY", "ALL_PROXY", "NO_PROXY"):
        for spelling in (key, key.lower()):
            args.extend(["--env", spelling + "="])
    args.append(IMAGE)
    guard()
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    with subprocess.Popen(
        args,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        creationflags=flags,
    ) as process:
        received: list[bytes] = []

        def exchange() -> None:
            received.append(process.communicate(payload)[0])

        transport = threading.Thread(target=exchange, daemon=True)
        transport.start()
        deadline = time.monotonic() + 120
        try:
            while transport.is_alive():
                guard()
                if time.monotonic() >= deadline:
                    raise ValueError("The Python container exceeded its 120 second runtime limit.")
                transport.join(timeout=0.2)
        finally:
            if transport.is_alive():
                # Terminating just the Docker client can leave the actual script running.
                process.kill()
                try:
                    subprocess.run(
                        [docker, "rm", "--force", name],
                        timeout=10,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        creationflags=flags,
                        check=False,
                    )
                finally:
                    transport.join(timeout=5)
    if process.returncode or not received:
        raise ValueError(
            "The Python container could not complete. Check Docker, the 512 MiB memory limit "
            "and the worker image built with docker build -t " + IMAGE + " docker/analyst-python."
        )
    return _receipt(received[0], request.script)
