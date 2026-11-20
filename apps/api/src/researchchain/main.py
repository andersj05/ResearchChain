import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated
from urllib.parse import urlsplit
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
from researchchain.agent_models import (
    AgentCreate,
    AgentDetail,
    AgentSave,
    AgentSummary,
    AgentVersion,
)
from researchchain.agents import AgentStore
from researchchain.artifacts import EvidenceError
from researchchain.database import Database
from researchchain.dispatch import RunQueue
from researchchain.dispatch_models import CommandReceipt, DispatchError
from researchchain.evaluation_api import evaluation_router
from researchchain.evidence_api import evidence_router
from researchchain.models import (
    CancelResult,
    Health,
    PendingReviewsPage,
    RecentRunSummary,
    ResumeRequest,
    RevisionSummary,
    RunArchivePage,
    RunArchiveQuery,
    RunRequest,
    RunSnapshot,
    ValidationResult,
    Workflow,
    WorkflowRevision,
)
from researchchain.operations import OperationsStore
from researchchain.operations_models import OperationsSnapshot
from researchchain.provider_signin import SignInService
from researchchain.provider_signin_api import signin_router
from researchchain.providers.credentials import ConnectionError as ProviderConnectionError
from researchchain.registry import NodeTypeSpec, node_types
from researchchain.report_api import ZIP_RESPONSE, report_router, zip_download
from researchchain.research import ResearchProvider
from researchchain.research_models import ProviderStatus
from researchchain.research_session_export import export_session_report
from researchchain.research_sessions import (
    ResearchSessionSetup,
    ResearchSessionStart,
    session_setup,
)
from researchchain.retention_api import retention_router
from researchchain.retention_models import RetentionError
from researchchain.revisions import ConflictError, NotFoundError, RevisionStore
from researchchain.runtime import RunStore
from researchchain.usage_api import usage_router
from researchchain.usage_models import UsageError


def create_app(
    database: Database | None = None,
    provider: ResearchProvider | None = None,
    access: AccessService | None = None,
    signin: SignInService | None = None,
) -> FastAPI:
    database = database or Database.from_env()
    config = AccessConfig.from_env(database)
    access = access or AccessService(config)
    if access.config.workspace_id != config.workspace_id:
        raise ValueError("Owner access must be bound to this database workspace.")

    local_origin = urlsplit(config.origin).hostname in {"127.0.0.1", "localhost", "::1"}
    signin = (
        (signin or SignInService(enabled=provider is None))
        if local_origin
        else SignInService(enabled=False)
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        database.ready()
        try:
            yield
        finally:
            await asyncio.to_thread(signin.close)

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
    app.include_router(signin_router(signin))

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
    app.include_router(retention_router(database))
    app.include_router(usage_router(database))
    runs = RunStore(database, provider)
    queue = RunQueue(runs)
    app.state.runs = runs
    revisions = RevisionStore(database)
    agents = AgentStore(database)

    @app.exception_handler(DispatchError)
    async def dispatch_error(request: Request, error: DispatchError) -> JSONResponse:
        return JSONResponse(
            status_code=error.status,
            content={"detail": str(error)},
            headers={"Retry-After": "1"} if error.status == 429 else None,
        )

    @app.exception_handler(RetentionError)
    async def retention_error(request: Request, error: RetentionError) -> JSONResponse:
        return JSONResponse(
            status_code=error.status,
            content={"detail": str(error)},
            headers={"Retry-After": "1"} if error.status == 429 else None,
        )

    @app.exception_handler(UsageError)
    async def usage_error(request: Request, error: UsageError) -> JSONResponse:
        return JSONResponse(status_code=error.status, content={"detail": str(error)})

    @app.exception_handler(NotFoundError)
    async def not_found(request: Request, error: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(error)})

    @app.exception_handler(ConflictError)
    async def conflict(request: Request, error: ConflictError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(error)})

    @app.exception_handler(ProviderConnectionError)
    async def provider_error(request: Request, error: ProviderConnectionError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(error)})

    @app.get("/api/operations", response_model=OperationsSnapshot, operation_id="operations_status")
    def operations_status() -> OperationsSnapshot:
        return OperationsStore(database).snapshot()

    @app.get("/api/providers/chatgpt", response_model=ProviderStatus, operation_id="chatgpt_status")
    def chatgpt_status() -> ProviderStatus:
        return runs.provider.status()

    @app.exception_handler(EvidenceError)
    async def invalid_evidence(request: Request, error: EvidenceError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(error)})

    @app.exception_handler(psycopg.Error)
    async def database_error(request: Request, error: psycopg.Error) -> JSONResponse:
        if error.sqlstate in {"RC001", "RC002"}:
            return JSONResponse(
                status_code=410,
                content={"detail": "Referenced research was deleted. Refresh before continuing."},
            )
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

    @app.get("/api/agents", response_model=list[AgentSummary], operation_id="list_agents")
    def list_agents(limit: Annotated[int, Query(ge=1, le=1000)] = 100) -> list[AgentSummary]:
        return agents.list(limit)

    @app.post(
        "/api/agents", response_model=AgentDetail, status_code=201, operation_id="create_agent"
    )
    def create_agent(request: AgentCreate) -> AgentDetail:
        return agents.create(request)

    @app.get("/api/agents/{agent_id}", response_model=AgentDetail, operation_id="get_agent")
    def get_agent(agent_id: UUID) -> AgentDetail:
        return agents.get(agent_id)

    @app.post(
        "/api/agents/{agent_id}/revisions",
        response_model=AgentDetail,
        status_code=201,
        operation_id="save_agent",
    )
    def save_agent(agent_id: UUID, request: AgentSave) -> AgentDetail:
        return agents.save(agent_id, request)

    @app.get(
        "/api/agents/{agent_id}/revisions",
        response_model=list[AgentVersion],
        operation_id="agent_versions",
    )
    def agent_versions(
        agent_id: UUID, limit: Annotated[int, Query(ge=1, le=1000)] = 100
    ) -> list[AgentVersion]:
        return agents.versions(agent_id, limit)

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

    @app.post(
        "/api/research-sessions",
        response_model=CommandReceipt,
        status_code=202,
        operation_id="start_research_session",
    )
    def start_research_session(request: ResearchSessionStart) -> CommandReceipt:
        return queue.start_session(request)

    @app.get(
        "/api/research-sessions",
        response_model=list[RecentRunSummary],
        operation_id="list_research_sessions",
    )
    def list_research_sessions(
        limit: Annotated[int, Query(ge=1, le=50)] = 20,
    ) -> list[RecentRunSummary]:
        return runs.list(limit, sessions_only=True)

    @app.get(
        "/api/research-sessions/{run_id}/setup",
        response_model=ResearchSessionSetup,
        operation_id="get_research_session_setup",
    )
    def get_research_session_setup(run_id: UUID) -> ResearchSessionSetup:
        return session_setup(runs.get(run_id))

    @app.get(
        "/api/research-sessions/{run_id}/report.zip",
        operation_id="export_research_session_report",
        response_class=Response,
        responses=ZIP_RESPONSE,
    )
    def download_session_report(run_id: UUID) -> Response:
        return zip_download(export_session_report(runs.database, run_id), f"research-{run_id}.zip")

    @app.get("/api/runs", response_model=list[RecentRunSummary], operation_id="list_runs")
    def list_runs(
        limit: Annotated[int, Query(ge=1, le=50)] = 20, agent_id: UUID | None = None
    ) -> list[RecentRunSummary]:
        return runs.list(limit, agent_id)

    @app.get("/api/runs/search", response_model=RunArchivePage, operation_id="search_runs")
    def search_runs(query: Annotated[RunArchiveQuery, Query()]) -> RunArchivePage:
        return runs.search(query)

    @app.get(
        "/api/runs/reviews", response_model=PendingReviewsPage, operation_id="list_pending_reviews"
    )
    def list_pending_reviews(
        limit: Annotated[int, Query(ge=1, le=50)] = 20,
        offset: Annotated[int, Query(ge=0, le=2_147_483_647)] = 0,
        agent_id: UUID | None = None,
    ) -> PendingReviewsPage:
        return runs.pending_reviews(limit, offset, agent_id)

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
