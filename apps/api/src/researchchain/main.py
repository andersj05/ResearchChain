from fastapi import FastAPI, HTTPException

from researchchain.models import (
    Health,
    ResumeRequest,
    RunRequest,
    RunSnapshot,
    ValidationResult,
    Workflow,
)
from researchchain.runtime import RunStore


def create_app() -> FastAPI:
    app = FastAPI(title="ResearchChain API", version="0.1.0")
    runs = RunStore()

    @app.get("/api/health", response_model=Health, operation_id="health")
    def health() -> Health:
        return Health()

    @app.post("/api/workflows/validate", response_model=ValidationResult, operation_id="validate")
    def validate(workflow: Workflow) -> ValidationResult:
        return ValidationResult(node_count=len(workflow.nodes), workflow=workflow)

    @app.post("/api/runs", response_model=RunSnapshot, status_code=201, operation_id="start_run")
    def start_run(request: RunRequest) -> RunSnapshot:
        try:
            return runs.start(request)
        except OverflowError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    @app.get("/api/runs/{run_id}", response_model=RunSnapshot, operation_id="get_run")
    def get_run(run_id: str) -> RunSnapshot:
        try:
            return runs.get(run_id)
        except KeyError as error:
            raise HTTPException(
                status_code=404, detail="Run not found in this API process."
            ) from error

    @app.post("/api/runs/{run_id}/resume", response_model=RunSnapshot, operation_id="resume_run")
    def resume_run(run_id: str, request: ResumeRequest) -> RunSnapshot:
        try:
            return runs.resume(run_id, request.decision)
        except KeyError as error:
            raise HTTPException(
                status_code=404, detail="Run not found in this API process."
            ) from error
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    return app


app = create_app()
