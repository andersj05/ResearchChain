"""Local evidence desk API. URL registration never fetches the remote source."""

from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, Response
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

from researchchain.artifacts import MAX_ARTIFACT_BYTES, ArtifactStore
from researchchain.database import Database
from researchchain.evidence import ClaimStore, EvidenceStore
from researchchain.evidence_models import (
    ArtifactInfo,
    ClaimCreate,
    ClaimPage,
    ClaimRecord,
    ContentId,
    EvidenceCreate,
    EvidencePage,
    EvidenceRecord,
    UploadRights,
)


def evidence_router(database: Database) -> APIRouter:
    router = APIRouter(prefix="/api")
    artifacts = ArtifactStore(database)
    evidence = EvidenceStore(database)
    claims = ClaimStore(database)

    @router.post(
        "/artifacts",
        response_model=ArtifactInfo,
        status_code=201,
        operation_id="upload_artifact",
        openapi_extra={
            "requestBody": {
                "required": True,
                "content": {
                    "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
                },
            }
        },
    )
    async def upload_artifact(
        request: Request,
        name: Annotated[str, Query(min_length=1, max_length=240)],
        rights: Annotated[UploadRights, Query()],
    ) -> ArtifactInfo:
        declared = request.headers.get("content-length")
        if declared:
            try:
                size = int(declared)
            except ValueError as error:
                raise HTTPException(400, "Invalid content length.") from error
            if size < 0 or size > MAX_ARTIFACT_BYTES:
                raise HTTPException(413, "Originals must be at most 20 MB.")
        content = bytearray()
        try:
            async for chunk in request.stream():
                if len(content) + len(chunk) > MAX_ARTIFACT_BYTES:
                    raise HTTPException(413, "Originals must be at most 20 MB.")
                content.extend(chunk)
        except ClientDisconnect as error:
            raise HTTPException(400, "Upload interrupted. Retry the original file.") from error
        if declared and len(content) != int(declared):
            raise HTTPException(400, "Upload length does not match the original.")
        return await run_in_threadpool(artifacts.put, bytes(content), name)

    @router.get("/artifacts/{content_id}", response_model=ArtifactInfo, operation_id="get_artifact")
    def get_artifact(content_id: ContentId) -> ArtifactInfo:
        return artifacts.get(content_id)

    @router.get("/artifacts/{content_id}/content", operation_id="artifact_content")
    def artifact_content(content_id: ContentId, preview: bool = False) -> Response:
        artifact, content = artifacts.content(content_id)
        inline = preview and artifact.media_type in ("image/png", "image/jpeg", "image/webp")
        disposition = "inline" if inline else "attachment"
        return Response(
            content=content,
            media_type=artifact.media_type,
            headers={
                "Content-Disposition": (
                    f"{disposition}; filename*=UTF-8''{quote(artifact.name, safe='')}"
                ),
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; sandbox",
                "Cache-Control": "no-store",
            },
        )

    @router.post(
        "/evidence", response_model=EvidenceRecord, status_code=201, operation_id="create_evidence"
    )
    def create_evidence(request: EvidenceCreate) -> EvidenceRecord:
        return evidence.create(request)

    @router.get("/evidence", response_model=EvidencePage, operation_id="list_evidence")
    def list_evidence(
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> EvidencePage:
        return evidence.list(limit, offset)

    @router.get(
        "/evidence/{evidence_id}", response_model=EvidenceRecord, operation_id="get_evidence"
    )
    def get_evidence(evidence_id: UUID) -> EvidenceRecord:
        return evidence.get(evidence_id)

    @router.post(
        "/claims", response_model=ClaimRecord, status_code=201, operation_id="create_claim"
    )
    def create_claim(request: ClaimCreate) -> ClaimRecord:
        return claims.create(request)

    @router.get("/claims", response_model=ClaimPage, operation_id="list_claims")
    def list_claims(
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> ClaimPage:
        return claims.list(limit, offset)

    @router.get("/claims/{claim_id}", response_model=ClaimRecord, operation_id="get_claim")
    def get_claim(claim_id: UUID) -> ClaimRecord:
        return claims.get(claim_id)

    return router
