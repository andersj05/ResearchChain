"""Local operator actions for isolated browser fixtures; never the owner workspace."""

import json
import os
import sys
from uuid import uuid4

from researchchain.access_config import AccessConfig
from researchchain.access_models import AccessState
from researchchain.access_service import AccessService
from researchchain.database import Database

database = Database.from_env()
if not database.schema.startswith("e2e_") or not os.environ.get(
    "RESEARCHCHAIN_TEST_OWNER_PASSWORD"
):
    raise SystemExit("Run this helper only through the isolated browser-test runner.")
access = AccessService(AccessConfig.from_env(database))
command = sys.argv[1]
if command == "link":
    print(json.dumps({"code": access.issue_link("Synthetic owner").get_secret_value()}))
elif command == "revoke":
    access.revoke(all_sessions=True)
elif command == "unenroll":
    with access.store.locked():
        access.store.write(AccessState(workspace_id=access.config.workspace_id))
elif command == "replace-owner":
    with access.store.locked():
        state = access.store.read()
        assert state
        state.owner_id = uuid4()
        state.owner_name = "Another synthetic owner"
        state.sessions = {}
        state.grants = {}
        access.store.write(state)
elif command == "reset":
    issued = access.exchange(access.issue_link("Synthetic owner").get_secret_value())
    access.set_password(
        issued.token.get_secret_value(), os.environ["RESEARCHCHAIN_TEST_OWNER_PASSWORD"]
    )
    access.revoke(all_sessions=True)
else:
    raise SystemExit("Unknown synthetic access operation.")
