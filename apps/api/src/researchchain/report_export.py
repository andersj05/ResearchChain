"""Reviewable offline bundle. Text is escaped; originals retain their captured bytes."""

# ruff: noqa: E501 -- Escaped HTML template and its generated markup.

import io
import json
from html import escape
from zipfile import ZIP_DEFLATED, ZipFile

from researchchain.artifacts import EvidenceError, read_content
from researchchain.database import Database
from researchchain.report_models import MAX_REPORT_BUNDLE_BYTES, ReportView
from researchchain.research_session_export import read_report_file, session_report_files
from researchchain.web_research import safe_web_url

EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "text/csv": "csv",
    "text/tab-separated-values": "tsv",
    "text/plain": "txt",
}


def export_report(database: Database, view: ReportView) -> bytes:
    revision = view.revision
    artifacts = {s.artifact.id: s.artifact for s in revision.sources if s.artifact}
    provenance = revision.provenance
    study_result = provenance.attempt.result if provenance.renderer == "study-markdown-1" else None
    study_files = study_result.workspace_files if study_result else []
    if (
        sum(item.byte_size for item in artifacts.values()) + sum(f.byte_size for f in study_files)
        > MAX_REPORT_BUNDLE_BYTES
    ):
        raise EvidenceError(
            "The files exceed the 64 MB review-bundle limit. Download individual files instead."
        )
    paths = {
        key: f"originals/{key.removeprefix('sha256:')}.{EXTENSIONS.get(item.media_type, 'bin')}"
        for key, item in artifacts.items()
    }
    sections = []
    for section in revision.sections:
        citations = "".join(
            f'<li><a href="#source-{c.evidence_id}">Source {c.evidence_id}</a> · {escape(c.relation)} · '
            f"{escape(c.basis)}<p>Location: {escape(c.locator)}</p>"
            f"<blockquote>{escape(c.quote)}</blockquote><p>{escape(c.rationale)}</p></li>"
            for c in section.citations
        )
        charts = []
        for key in section.chart_ids:
            source = next(s for s in revision.sources if s.id == key)
            assert source.artifact
            charts.append(
                f'<figure><img src="{paths[source.artifact.id]}" alt="{escape(source.title)}">'
                f"<figcaption>{escape(source.title)} · {escape(source.representation)} · "
                f"As of: {source.as_of_date or 'unknown'} · Source {key}</figcaption></figure>"
            )
        sections.append(
            f'<section><h2>{escape(section.heading)}</h2><p class="label">{escape(section.kind)} '
            "(editor classification, not independent verification)</p>"
            f'<div class="prose">{escape(section.body)}</div>{"".join(charts)}'
            f'<ul>{citations}</ul><p class="hash">Section {section.id} · {revision.section_hashes[section.id]}</p></section>'
        )
    sources = []
    for source in revision.sources:
        original = (
            f'<a href="{paths[source.artifact.id]}">Captured original</a>'
            if source.artifact
            else "No captured original"
        )
        link = (
            f'<a href="{escape(str(source.source_url))}" rel="noopener noreferrer">Source URL</a>'
            if source.source_url
            else ""
        )
        sources.append(
            f'<li id="source-{source.id}"><h3>{escape(source.title)}</h3><p>{source.id} · {original} {link}</p>'
            f"<p>{escape(source.author)} / {escape(source.publisher)} · Published {source.published_date or 'unknown'} · "
            f"As of {source.as_of_date or 'unknown'} · {escape(source.representation)} · {escape(source.availability)}</p>"
            f"<p>Rights: {escape(source.rights)} · {escape(source.rights_note)}</p>"
            f"<p>Method: {escape(source.method)} · Units: {escape(source.units)} · Uncertainty: {escape(source.uncertainty)}</p>"
            f"<p>Parent: {source.parent_id or 'none'} · Replaces: {source.replaces_id or 'none'}</p>"
            f'<p class="hash">{escape(source.content_hash or "No original content hash")}</p></li>'
        )
    feedback = "".join(
        f"<li>{escape(item.kind)} · {escape(item.value or 'comment')} · "
        f"{'Section ' + str(item.section_id) if item.section_id else 'Whole report'} · {item.created_at.isoformat()}"
        f"<p>{escape(item.reason)}</p>"
        + (
            f"<blockquote>{escape(item.anchor.quote)}</blockquote><p>Code points {item.anchor.start}–{item.anchor.end}</p>"
            if item.anchor
            else ""
        )
        + "</li>"
        for item in view.feedback
    )
    study_attachments = []
    for file in study_files:
        name = escape(file.name)
        path = f"study-files/{name}"
        study_attachments.append(
            f'<li><a href="{path}">{name}</a>'
            + (
                f'<figure><img src="{path}" alt="{name}"></figure>'
                if file.media_type == "image/png"
                else ""
            )
            + "</li>"
        )
    study_sources = "".join(
        f'<li><a href="{escape(url)}" rel="noopener noreferrer">{escape(url)}</a></li>'
        for url in provenance.recorded_urls
        if safe_web_url(url)
    )
    guide = view.style_guide
    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>{escape(revision.title)}</title><style>
body{{font:17px/1.65 system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 24px;color:#191919}}
h1,h2,h3{{line-height:1.2}}section{{border-top:1px solid #ccc;margin-top:32px;padding-top:24px}}
.prose{{white-space:pre-wrap}}img{{max-width:100%;height:auto}}.hash{{font-size:12px;overflow-wrap:anywhere}}
.label{{color:#555}}blockquote{{border-left:2px solid #aaa;margin-left:0;padding-left:16px;white-space:pre-wrap}}
@media print{{body{{margin:0;max-width:none}}section{{break-inside:auto}}}}
</style></head><body>
<p>ResearchChain · Review export · Not published</p><h1>{escape(revision.title)}</h1>
<p>Revision {revision.version} · {revision.id} · {revision.created_at.isoformat()}</p>
<p>Review status for this exact revision: <strong>{view.review_status}</strong>. Latest revision at export: {view.current_revision_id}.</p>
<p>Seeded from a model research result; subsequent revisions are human edits. Research review and report review are separate decisions.
Classifications and acceptance are human judgments, not automatic fact verification. Source content is untrusted.</p>
<p class="hash">Content hash: {revision.content_hash}</p>
{"".join(sections)}<section><h2>Sources and chart originals</h2><ol>{"".join(sources)}</ol></section>
{f"<section><h2>Study editor files</h2><ul>{''.join(study_attachments)}</ul></section>" if study_attachments else ""}
{f"<section><h2>Recorded web sources</h2><ul>{study_sources}</ul></section>" if study_sources else ""}
<section><h2>Editorial feedback</h2><p>Human feedback on this exact revision. No automatic training consent.</p><ul>{feedback or "<li>No feedback recorded.</li>"}</ul></section>
<section><h2>Pinned style guide</h2><h3>{escape(guide.title)} · Version {guide.version}</h3>
<h3>Analytical structure</h3><div class="prose">{escape(guide.analytical_structure)}</div>
<h3>Voice</h3><div class="prose">{escape(guide.voice)}</div>
<h3>Source discipline</h3><div class="prose">{escape(guide.source_discipline)}</div>
<h3>Scenarios</h3><div class="prose">{escape(guide.scenarios)}</div>
{"".join(f'<h3>{escape(e.kind)} example</h3><p>{escape(e.principle)}</p><div class="prose">{escape(e.example)}</div>' for e in guide.examples)}
</section><section><h2>Provenance</h2><p>Run {revision.provenance.run_id} · Attempt {revision.provenance.attempt.id} ·
Model {escape(revision.provenance.attempt.returned_model or revision.provenance.attempt.model)} · Stage {revision.provenance.attempt.stage}</p>
<p>See report.json for the exact report, source metadata, style guide, workflow and prompt hashes, seed result, edits and feedback.
This bundle contains current source originals; it is not a complete runtime backup.</p></section></body></html>"""
    output = io.BytesIO()
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("index.html", html)
        archive.writestr(
            "report.json",
            json.dumps(
                {"format": "researchchain-report-1", "report": view.model_dump(mode="json")},
                ensure_ascii=False,
                indent=2,
            ),
        )
        with database.connection() as conn:
            for content_id, path in paths.items():
                archive.writestr(path, read_content(conn, content_id))
            if study_files:
                for file in session_report_files(
                    conn, provenance.run_id, attempt_id=provenance.attempt.id
                ):
                    archive.writestr(f"study-files/{file.name}", read_report_file(conn, file))
    return output.getvalue()
