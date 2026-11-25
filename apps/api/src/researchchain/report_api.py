"""Editorial APIs never invoke a provider or publish reports."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from researchchain.database import Database
from researchchain.report_export import export_report
from researchchain.report_models import (
    ReportCreate,
    ReportDraftSources,
    ReportFeedback,
    ReportFeedbackCreate,
    ReportRevision,
    ReportSave,
    ReportSummary,
    ReportView,
    StyleGuide,
    StyleGuideCreate,
)
from researchchain.reports import Reports, StyleGuides

ZIP_RESPONSE: dict[int | str, dict[str, Any]] = {
    200: {"content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}}}
}


def zip_download(content: bytes, filename: str) -> Response:
    return Response(
        content=content,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


def report_router(database: Database) -> APIRouter:
    router = APIRouter(prefix="/api")
    reports = Reports(database)
    styles = StyleGuides(database)

    @router.get("/style-guides", operation_id="list_style_guides")
    def list_styles() -> list[StyleGuide]:
        return styles.list()

    @router.post("/style-guides", status_code=201, operation_id="create_style_guide")
    def create_style(request: StyleGuideCreate) -> StyleGuide:
        return styles.create(request)

    @router.get("/style-guides/{key}", operation_id="get_style_guide")
    def get_style(key: UUID) -> StyleGuide:
        return styles.get(key)

    @router.get("/reports", operation_id="list_reports")
    def list_reports(
        study_run_id: UUID | None = None,
        study_attempt_id: UUID | None = None,
        search: Annotated[str, Query(max_length=200, pattern=r"^[^\x00]*$")] = "",
    ) -> list[ReportSummary]:
        if study_run_id is None and study_attempt_id is None:
            return reports.list(search=search)
        if study_run_id is None or study_attempt_id is None:
            raise HTTPException(422, "Supply both the study and its saved editor attempt.")
        return reports.list(study_origin=(study_run_id, study_attempt_id), search=search)

    @router.post("/reports", status_code=201, operation_id="create_report")
    def create_report(request: ReportCreate) -> ReportRevision:
        return reports.create(request)

    @router.post("/reports/revisions", status_code=201, operation_id="save_report_revision")
    def save_report(request: ReportSave) -> ReportRevision:
        return reports.save(request)

    @router.get("/reports/draft-sources", operation_id="read_report_draft_sources")
    def read_draft_sources(
        evidence_id: Annotated[list[UUID], Query(min_length=1, max_length=100)],
    ) -> ReportDraftSources:
        return reports.draft_sources(evidence_id)

    @router.get("/reports/{key}", operation_id="get_report")
    def get_report(key: UUID) -> ReportView:
        return reports.get(key)

    @router.get("/reports/{key}/history", operation_id="report_history")
    def history(key: UUID) -> list[ReportSummary]:
        return reports.list(key)

    @router.post("/reports/{key}/feedback", status_code=201, operation_id="report_feedback")
    def feedback(key: UUID, request: ReportFeedbackCreate) -> ReportFeedback:
        return reports.feedback(key, request)

    @router.get(
        "/reports/{key}/export",
        operation_id="export_report",
        response_class=Response,
        responses=ZIP_RESPONSE,
    )
    def export(key: UUID) -> Response:
        return zip_download(export_report(database, reports.get(key)), f"report-{key}.zip")

    return router
