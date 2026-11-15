"""Editorial APIs never invoke a provider or publish reports."""

from uuid import UUID

from fastapi import APIRouter
from fastapi.responses import Response

from researchchain.database import Database
from researchchain.report_export import export_report
from researchchain.report_models import (
    ReportCreate,
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
    def list_reports() -> list[ReportSummary]:
        return reports.list()

    @router.post("/reports", status_code=201, operation_id="create_report")
    def create_report(request: ReportCreate) -> ReportRevision:
        return reports.create(request)

    @router.post("/reports/revisions", status_code=201, operation_id="save_report_revision")
    def save_report(request: ReportSave) -> ReportRevision:
        return reports.save(request)

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
        responses={
            200: {
                "content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}}
            }
        },
    )
    def export(key: UUID) -> Response:
        return Response(
            content=export_report(database, reports.get(key)),
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="report-{key}.zip"',
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; sandbox",
            },
        )

    return router
