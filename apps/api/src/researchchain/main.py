from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse

from researchchain.database import Database
from researchchain.models import (
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
from researchchain.revisions import ConflictError, NotFoundError, RevisionStore
from researchchain.runtime import RunStore


def create_app(database: Database | None = None) -> FastAPI:
    database = database or Database.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        database.ready()
        yield

    app = FastAPI(title="ResearchChain API", version="0.2.0", lifespan=lifespan)
    runs = RunStore(database)
    revisions = RevisionStore(database)

    @app.exception_handler(NotFoundError)
    async def not_found(request: Request, error: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(error)})

    @app.exception_handler(ConflictError)
    async def conflict(request: Request, error: ConflictError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(error)})

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
                content={
                    "detail": "Database is not ready. Start Postgres and run pnpm db:migrate."
                },
            )
        return Health()

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

    @app.post("/api/runs", response_model=RunSnapshot, status_code=201, operation_id="start_run")
    def start_run(request: RunRequest) -> RunSnapshot:
        return runs.start(request)

    @app.get("/api/runs", response_model=list[RunSummary], operation_id="list_runs")
    def list_runs(limit: Annotated[int, Query(ge=1, le=50)] = 20) -> list[RunSummary]:
        return runs.list(limit)

    @app.get("/api/runs/{run_id}", response_model=RunSnapshot, operation_id="get_run")
    def get_run(run_id: UUID) -> RunSnapshot:
        return runs.get(run_id)

    @app.post("/api/runs/{run_id}/resume", response_model=RunSnapshot, operation_id="resume_run")
    def resume_run(run_id: UUID, request: ResumeRequest) -> RunSnapshot:
        return runs.resume(run_id, request)

    @app.post("/api/runs/{run_id}/recover", response_model=RunSnapshot, operation_id="recover_run")
    def recover_run(run_id: UUID) -> RunSnapshot:
        return runs.recover(run_id)

    return app


app = create_app()
