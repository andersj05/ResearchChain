from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import FastAPI, Query, Request, Response
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from researchchain.access_api import AccessMiddleware, access_router
from researchchain.access_config import AccessConfig
from researchchain.access_models import AccessError
from researchchain.access_service import AccessService
from researchchain.artifacts import EvidenceError
from researchchain.database import Database
from researchchain.dispatch import RunQueue
from researchchain.dispatch_models import CommandReceipt, DispatchError
from researchchain.evaluation_api import evaluation_router
from researchchain.evidence_api import evidence_router
from researchchain.models import (
    CancelResult,
    Health,
    ResumeRequest,
    RevisionSummary,
    RunRequest,
    RunSnapshot,
    RunSummary,
    ValidationResult,
    Workflow,
    WorkflowRevision,
)
from researchchain.providers.credentials import ConnectionError as ProviderConnectionError
from researchchain.registry import NodeTypeSpec, node_types
from researchchain.report_api import report_router
from researchchain.research import ResearchProvider
from researchchain.research_models import ProviderStatus
from researchchain.revisions import ConflictError, NotFoundError, RevisionStore
from researchchain.runtime import RunStore


def create_app(
    database: Database | None = None,
    provider: ResearchProvider | None = None,
    access: AccessService | None = None,
) -> FastAPI:
    database = database or Database.from_env()
    config = AccessConfig.from_env(database)
    access = access or AccessService(config)
    if access.config.workspace_id != config.workspace_id:
        raise ValueError("Owner access must be bound to this database workspace.")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        database.ready()
        yield

    app = FastAPI(
        title="ResearchChain API",
        version="0.3.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        description="Private owner workspace. Sign in through /api/access; mutations require "
        "the session's X-ResearchChain-CSRF header and the configured browser Origin.",
    )
    app.state.access = access
    app.add_middleware(AccessMiddleware, access=access)
    app.include_router(access_router(access))

    @app.exception_handler(AccessError)
    async def access_error(request: Request, error: AccessError) -> JSONResponse:
        headers = {"Retry-After": "60"} if error.status == 429 else None
        return JSONResponse({"detail": str(error)}, status_code=error.status, headers=headers)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError) -> Response:
        if request.url.path.startswith("/api/access/"):
            return JSONResponse({"detail": "Invalid sign-in request."}, status_code=422)
        return await request_validation_exception_handler(request, error)

    app.include_router(evidence_router(database))
    app.include_router(evaluation_router(database))
    app.include_router(report_router(database))
    runs = RunStore(database, provider)
    queue = RunQueue(runs)
    app.state.runs = runs
    revisions = RevisionStore(database)

    @app.exception_handler(DispatchError)
    async def dispatch_error(request: Request, error: DispatchError) -> JSONResponse:
        return JSONResponse(
            status_code=error.status,
            content={"detail": str(error)},
            headers={"Retry-After": "1"} if error.status == 429 else None,
        )

    @app.exception_handler(NotFoundError)
    async def not_found(request: Request, error: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(error)})

    @app.exception_handler(ConflictError)
    async def conflict(request: Request, error: ConflictError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(error)})

    @app.exception_handler(ProviderConnectionError)
    async def provider_error(request: Request, error: ProviderConnectionError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(error)})

    @app.get("/api/providers/chatgpt", response_model=ProviderStatus, operation_id="chatgpt_status")
    def chatgpt_status() -> ProviderStatus:
        return runs.provider.status()

    @app.exception_handler(EvidenceError)
    async def invalid_evidence(request: Request, error: EvidenceError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(error)})

    @app.exception_handler(psycopg.Error)
    async def database_error(request: Request, error: psycopg.Error) -> JSONResponse:
        # Never expose connection strings, server details, or query parameters.
        return JSONResponse(
            status_code=503,
            content={
                "detail": "Database unavailable or busy. Check Postgres and migrations, "
                "then refresh the run before retrying."
            },
        )

    @app.get("/api/health", response_model=Health, operation_id="health")
    def health() -> Health | JSONResponse:
        try:
            database.ready()
        except (psycopg.Error, RuntimeError):
            return JSONResponse(
                status_code=503,
                content={"detail": "The service is not ready."},
            )
        return Health()

    @app.get("/api/node-types", response_model=list[NodeTypeSpec], operation_id="node_types")
    def registered_types() -> list[NodeTypeSpec]:
        return node_types()

    @app.post("/api/workflows/validate", response_model=ValidationResult, operation_id="validate")
    def validate(workflow: Workflow) -> ValidationResult:
        return ValidationResult(node_count=len(workflow.nodes), workflow=workflow)

    @app.post(
        "/api/revisions",
        response_model=WorkflowRevision,
        status_code=201,
        operation_id="save_revision",
    )
    def save_revision(workflow: Workflow) -> WorkflowRevision:
        return revisions.save(workflow)

    @app.get("/api/revisions", response_model=list[RevisionSummary], operation_id="list_revisions")
    def list_revisions(limit: Annotated[int, Query(ge=1, le=100)] = 50) -> list[RevisionSummary]:
        return revisions.list(limit)

    @app.get(
        "/api/revisions/{revision_id}", response_model=WorkflowRevision, operation_id="get_revision"
    )
    def get_revision(revision_id: UUID) -> WorkflowRevision:
        return revisions.get(revision_id)

    @app.post("/api/runs", response_model=CommandReceipt, status_code=202, operation_id="start_run")
    def start_run(request: RunRequest) -> CommandReceipt:
        return queue.start(request)

    @app.get("/api/runs", response_model=list[RunSummary], operation_id="list_runs")
    def list_runs(limit: Annotated[int, Query(ge=1, le=50)] = 20) -> list[RunSummary]:
        return runs.list(limit)

    @app.get("/api/runs/{run_id}", response_model=RunSnapshot, operation_id="get_run")
    def get_run(run_id: UUID) -> RunSnapshot:
        return runs.get(run_id)

    @app.post(
        "/api/runs/{run_id}/resume",
        response_model=CommandReceipt,
        status_code=202,
        operation_id="resume_run",
    )
    def resume_run(run_id: UUID, request: ResumeRequest) -> CommandReceipt:
        return queue.resume(run_id, request)

    @app.post(
        "/api/runs/{run_id}/recover",
        response_model=CommandReceipt,
        status_code=202,
        operation_id="recover_run",
    )
    def recover_run(run_id: UUID) -> CommandReceipt:
        return queue.recover(run_id)

    @app.post("/api/runs/{run_id}/cancel", response_model=CancelResult, operation_id="cancel_run")
    def cancel_run(run_id: UUID) -> CancelResult:
        return runs.cancel(run_id)

    return app


app = create_app()
