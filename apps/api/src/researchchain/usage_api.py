"""Owner-authenticated request allowance reads and explicit policy edits."""

from fastapi import APIRouter

from researchchain.database import Database
from researchchain.usage_models import UsagePolicyUpdate, UsageSnapshot
from researchchain.usage_store import UsageStore


def usage_router(database: Database) -> APIRouter:
    router = APIRouter(prefix="/api/usage", tags=["request-allowance"])
    store = UsageStore(database)

    @router.get("", response_model=UsageSnapshot)
    def status() -> UsageSnapshot:
        return store.snapshot()

    @router.post("/policy", response_model=UsageSnapshot)
    def configure(request: UsagePolicyUpdate) -> UsageSnapshot:
        return store.configure(request, "owner")

    return router
