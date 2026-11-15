"""Owner access, Origin and CSRF are enforced by the shared API middleware."""

from uuid import UUID

from fastapi import APIRouter

from researchchain.database import Database
from researchchain.retention import RetentionStore
from researchchain.retention_models import (
    RetentionConfirm,
    RetentionPreview,
    RetentionReceipt,
    RetentionRequest,
    RetentionView,
)


def retention_router(database: Database) -> APIRouter:
    router = APIRouter(prefix="/api/retention")
    store = RetentionStore(database)

    @router.post("/previews", status_code=201, operation_id="create_retention_preview")
    def preview(request: RetentionRequest) -> RetentionPreview:
        return store.preview(request)

    @router.get("/previews/{key}", operation_id="get_retention_preview")
    def get(key: UUID) -> RetentionView:
        return store.get(key)

    @router.post("/previews/{key}/apply", operation_id="apply_retention_preview")
    def apply(key: UUID, request: RetentionConfirm) -> RetentionReceipt:
        return store.apply(key, request)

    @router.get("/receipts", operation_id="list_retention_receipts")
    def history() -> list[RetentionReceipt]:
        return store.history()

    return router
