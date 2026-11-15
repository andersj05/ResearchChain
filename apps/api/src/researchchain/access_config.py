"""One configured database/schema is one owner-controlled workspace."""

import hashlib
import ipaddress
import json
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from psycopg.conninfo import conninfo_to_dict

from researchchain.access_models import AccessError
from researchchain.database import Database
from researchchain.providers.credentials import default_directory


@dataclass(frozen=True)
class AccessConfig:
    workspace_id: str
    directory: Path
    origin: str = "http://127.0.0.1:3000"
    session_seconds: int = 12 * 60 * 60
    idle_seconds: int = 30 * 60
    grant_seconds: int = 5 * 60

    def __post_init__(self) -> None:
        try:
            parsed = urlsplit(self.origin)
            port = parsed.port
        except ValueError:
            raise AccessError("Configure one valid workbench origin.", 503) from None
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or port == 0
            or any(c.isspace() or c in "\\%" for c in self.origin)
            or parsed.query
            or parsed.fragment
            or parsed.path not in {"", "/"}
        ):
            raise AccessError("Configure one valid workbench origin.", 503)
        try:
            loopback = (
                parsed.hostname == "localhost" or ipaddress.ip_address(parsed.hostname).is_loopback
            )
        except ValueError:
            loopback = False
        if parsed.scheme != "https" and not loopback:
            raise AccessError("Non-loopback workbench origins require HTTPS.", 503)
        host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
        default_port = 443 if parsed.scheme == "https" else 80
        canonical = f"{parsed.scheme}://{host}"
        if port is not None and port != default_port:
            canonical += f":{port}"
        if self.origin != canonical:
            raise AccessError(
                "Use a canonical workbench origin without a path or default port.", 503
            )
        if not 60 <= self.idle_seconds <= self.session_seconds <= 86400:
            raise AccessError("Session limits must be bounded between one minute and one day.", 503)

    @classmethod
    def from_env(cls, database: Database) -> "AccessConfig":
        options = conninfo_to_dict(database.url)
        if not options.get("host") or not options.get("dbname") or options.get("service"):
            raise AccessError("Workbench access requires an explicit database host and name.", 503)
        # Credentials and roles are deliberately absent: rotating a database
        # password must not change workspace identity or resurrect sessions.
        binding = {
            "host": options["host"],
            "hostaddr": options.get("hostaddr"),
            "port": str(options.get("port", "5432")),
            "database": options["dbname"],
            "schema": database.schema,
        }
        workspace = hashlib.sha256(json.dumps(binding, sort_keys=True).encode()).hexdigest()
        root = Path(
            os.environ.get(
                "RESEARCHCHAIN_ACCESS_DIRECTORY",
                str(default_directory().parent / "access"),
            )
        )
        return cls(
            workspace,
            root / workspace,
            origin=os.environ.get("RESEARCHCHAIN_PUBLIC_ORIGIN", "http://127.0.0.1:3000"),
        )

    @property
    def secure(self) -> bool:
        return self.origin.startswith("https://")

    @property
    def cookie_name(self) -> str:
        origin_hash = hashlib.sha256(self.origin.encode()).hexdigest()[:12]
        prefix = "__Host-" if self.secure else ""
        return f"{prefix}rc_session_{self.workspace_id[:16]}_{origin_hash}"

    @property
    def hosts(self) -> frozenset[str]:
        # Next's loopback rewrite uses the API host. Forwarded headers never
        # define trust, an origin, a workspace, or an owner.
        host = urlsplit(self.origin).hostname
        assert host
        return frozenset({host, "127.0.0.1", "localhost", "::1"})
