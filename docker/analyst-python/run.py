"""Container entry point. Only the child running the submitted script uses uid 65534."""

import base64
import binascii
import json
import os
import re
import signal
import stat
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

WORK = Path("/work")
EXPORTS = WORK / "outputs"
PROGRAM = WORK / ".current.py"
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\Z")
MAX_FILE = 2 * 1024 * 1024
MAX_TOTAL = 6 * 1024 * 1024
MAX_LOG = 6000


def reap_descendants():
    # This entry point is PID 1 in a private container namespace. Any helpers left by
    # the finished script are adopted here, even if they started their own sessions.
    children = Path("/proc/self/task/1/children")
    while adopted := children.read_text().split():
        for child in map(int, adopted):
            try:
                os.kill(child, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(child, 0)


def collect(script):
    result = {}
    errors = []
    size = len(script)
    with os.scandir(EXPORTS) as entries:
        for idx, entry in enumerate(entries):
            if idx >= 11:
                errors.append("Export at most 11 files per action.")
                break
            name = entry.name
            if (
                not NAME.fullmatch(name)
                or name.lower() == "analysis.py"
                or Path(name).suffix.lower()
                not in {".png", ".csv", ".tsv", ".md", ".py", ".txt", ".json"}
            ):
                errors.append("An export has an unsupported name or extension.")
                continue
            try:
                with os.fdopen(
                    os.open(entry.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK),
                    "rb",
                ) as f:
                    info = os.fstat(f.fileno())
                    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                        raise ValueError
                    data = f.read(min(MAX_FILE, MAX_TOTAL - size) + 1)
                    if not data or len(data) > MAX_FILE or len(data) + size > MAX_TOTAL:
                        raise ValueError
                    if name.lower().endswith(".png"):
                        if (
                            not data.startswith(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
                            or len(data) < 33
                        ):
                            raise ValueError
                        width, height = struct.unpack(">II", data[16:24])
                        if not 0 < width * height <= 32_000_000:
                            raise ValueError
                    else:
                        data.decode("utf-8-sig")
                        if b"\x00" in data:
                            raise ValueError
            except (OSError, ValueError):
                errors.append(
                    f"Skipped {name}: export regular UTF-8 text or PNG within the size limits."
                )
                continue
            size += len(data)
            result[name] = base64.b64encode(data).decode("ascii")
    return result, errors


def main():
    if os.getpid() != 1:
        raise ValueError("The runner requires its own container PID namespace")
    request = json.load(sys.stdin.buffer)
    for name, encoded in request["files"].items():
        if not NAME.fullmatch(name):
            raise ValueError("Invalid input filename")
        (WORK / name).write_bytes(base64.b64decode(encoded, validate=True))
    script = request["script"].encode()
    PROGRAM.write_bytes(script)
    EXPORTS.mkdir(mode=0o777)
    EXPORTS.chmod(0o777)
    with tempfile.TemporaryFile() as log:
        try:
            completed = subprocess.run(
                [sys.executable, "-B", str(PROGRAM)],
                cwd=WORK,
                user=65534,
                group=65534,
                extra_groups=[],
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=90,
                check=False,
            )
            code = completed.returncode
        except subprocess.TimeoutExpired:
            code = 124
        finally:
            reap_descendants()
        log.seek(0)
        raw = log.read(MAX_LOG + 1)
        output = raw[:MAX_LOG].decode("utf-8", errors="replace")
        if len(raw) > MAX_LOG:
            output += "\n[output truncated]"
        if code == 124:
            output += "\n[90 second action limit reached]"
    files, errors = collect(script)
    if errors:
        code = code or 1
        output += "\n" + "\n".join(errors)
    print(json.dumps({"exit_code": code, "output": output, "files": files}))


if __name__ == "__main__":
    try:
        main()
    except (binascii.Error, KeyError, OSError, ValueError):
        sys.exit("Invalid research workspace request or unavailable working directory.")
