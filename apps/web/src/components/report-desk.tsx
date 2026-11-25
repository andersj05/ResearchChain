"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { ReportCreateForm } from "@/components/report-create";
import { ReportEditor } from "@/components/report-editor";
import { StyleGuideContent, StyleGuideEditor } from "@/components/style-guide-editor";
import { api } from "@/lib/workflow";
import type { ReportSummary, ReportView, StyleGuide } from "@/lib/reports";

function StudyReportMatches({ runId, attemptId }: { runId: string; attemptId: string }) {
  const [matches, setMatches] = useState<ReportSummary[] | "failed">();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ study_run_id: runId, study_attempt_id: attemptId });
    api<ReportSummary[]>(`reports?${params}`).then(
      (items) => {
        if (active) setMatches(items);
      },
      () => {
        if (active) setMatches("failed");
      },
    );
    return () => {
      active = false;
    };
  }, [runId, attemptId, retry]);

  if (!matches)
    return (
      <p className="report-banner" role="status">
        Checking for saved reports from this editor pass…
      </p>
    );
  if (matches === "failed")
    return (
      <div className="report-banner source-notice" role="alert">
        <p>Could not check for saved reports from this editor pass.</p>
        <button
          className="button small"
          type="button"
          onClick={() => {
            setMatches(undefined);
            setRetry((count) => count + 1);
          }}
        >
          Retry report lookup
        </button>
      </div>
    );
  if (!matches.length) return null;
  return (
    <section className="report-list" aria-labelledby="study-report-matches">
      <h2 id="study-report-matches">Saved reports from this editor pass</h2>
      {matches.map((report) => (
        <a
          className="report-list-row report-browser-row"
          href={`/?${new URLSearchParams({ view: "reports", report: report.id })}`}
          key={report.id}
        >
          <strong>Open {report.title}</strong>
          <span>
            Revision {report.version} · {new Date(report.created_at).toLocaleString()}
          </span>
          <span>{report.change_note}</span>
        </a>
      ))}
      <p className="field-hint">You can also use the form below to create a separate report.</p>
    </section>
  );
}

export function ReportDesk({ visit }: { visit: number }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [styles, setStyles] = useState<StyleGuide[]>([]);
  const [view, setView] = useState<ReportView | null>(null);
  const [savedSection, setSavedSection] = useState<{ revisionId: string; sectionId: string }>();
  const [page, setPage] = useState<"reports" | "styles">("reports");
  const [study, setStudy] = useState(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get("report")) return null;
    const runId = params.get("fromStudy");
    const attemptId = params.get("reportAttempt");
    return runId && attemptId ? { runId, attemptId } : null;
  });
  const [creating, setCreating] = useState(!!study);
  const [styleEdit, setStyleEdit] = useState<StyleGuide | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [checkedVisit, setCheckedVisit] = useState(0);
  const [error, setError] = useState("");
  const [epoch, setEpoch] = useState(0);
  const styleWrites = useRef(0);
  useEffect(() => {
    let active = true;
    const styleVersion = styleWrites.current;
    async function load() {
      try {
        const params = new URL(window.location.href).searchParams;
        const fromStudy =
          !params.get("report") && params.get("fromStudy") && params.get("reportAttempt");
        const [items, guides] = await Promise.all([
          fromStudy ? [] : api<ReportSummary[]>("reports"),
          api<StyleGuide[]>("style-guides"),
        ]);
        const id = new URL(window.location.href).searchParams.get("report");
        const saved = id ? await api<ReportView>(`reports/${encodeURIComponent(id)}`) : null;
        if (active) {
          setReports(items);
          // A list read started before a save must not remove the saved guide.
          if (styleVersion === styleWrites.current) setStyles(guides);
          if (saved && id === new URLSearchParams(window.location.search).get("report"))
            setView(saved);
          setCheckedVisit(visit);
          setError("");
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load reports.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [epoch, visit]);
  function remember(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("report", id);
    else url.searchParams.delete("report");
    url.searchParams.delete("fromStudy");
    url.searchParams.delete("reportAttempt");
    url.searchParams.set("view", "reports");
    setStudy(null);
    window.history.replaceState(null, "", url);
  }
  async function open(id: string, sectionId?: string) {
    const saved = await api<ReportView>(`reports/${id}`);
    setSavedSection(sectionId ? { revisionId: saved.revision.id, sectionId } : undefined);
    setView(saved);
    setPage("reports");
    setCreating(false);
    setStyleEdit(undefined);
    remember(id);
  }
  function leave() {
    setSavedSection(undefined);
    setView(null);
    remember(null);
    setEpoch((e) => e + 1);
  }
  function cancelCreate() {
    setCreating(false);
    if (study) leave();
  }
  const visibleReports = reports
    .filter((report) =>
      `${report.title} ${report.change_note}`.toLowerCase().includes(search.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : Date.parse(b.created_at) - Date.parse(a.created_at),
    );
  return (
    <section className="report-desk" aria-label="Reports">
      <header className="evidence-header">
        <div>
          <p className="eyebrow">Research → editorial review</p>
          <h1>Reports</h1>
          <p className="muted">Develop the argument. Keep the evidence visible.</p>
        </div>
        <div className="actions">
          {view ? (
            <Button className="button" onClick={leave}>
              All reports
            </Button>
          ) : (
            <Button
              className="button"
              onClick={() => {
                if (study) leave();
                setCreating(true);
                setPage("reports");
                setStyleEdit(undefined);
              }}
            >
              New report
            </Button>
          )}
          <Button
            className="button"
            onClick={() => {
              leave();
              setPage(page === "styles" ? "reports" : "styles");
              setCreating(false);
              setStyleEdit(undefined);
            }}
          >
            {page === "styles" ? "Report list" : "Style guides"}
          </Button>
          <Button className="button" onClick={() => setEpoch((e) => e + 1)}>
            Refresh reports
          </Button>
        </div>
      </header>
      {error && (
        <p className="error report-banner" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status" className="report-banner">
          Loading reports…
        </p>
      ) : styleEdit !== undefined ? (
        <StyleGuideEditor
          key={styleEdit?.id ?? "new"}
          previous={styleEdit ?? undefined}
          onCancel={() => setStyleEdit(undefined)}
          onSave={(guide) => {
            styleWrites.current += 1;
            setStyles((items) => [guide, ...items.filter((s) => s.id !== guide.id)]);
            setStyleEdit(undefined);
            setPage(study ? "reports" : "styles");
          }}
        />
      ) : view ? (
        <ReportEditor
          key={view.revision.id}
          view={view}
          styles={styles}
          checkingRevision={checkedVisit !== visit}
          initialSectionId={
            savedSection?.revisionId === view.revision.id ? savedSection.sectionId : undefined
          }
          onOpen={open}
          onRefresh={async () => setView(await api<ReportView>(`reports/${view.revision.id}`))}
        />
      ) : page === "styles" ? (
        <div className="report-list">
          <div className="section-heading">
            <h2>Style guide revisions</h2>
            <Button className="button primary" onClick={() => setStyleEdit(null)}>
              New style guide
            </Button>
          </div>
          <p className="muted">
            Version both analytical structure and prose voice. Existing reports keep their pinned
            guide until you explicitly change it.
          </p>
          {!styles.length && <p>Create a guide to start drafting reports.</p>}
          {styles.map((guide) => (
            <article className="report-list-row" key={guide.id}>
              <StyleGuideContent guide={guide} />
              <Button className="button small" onClick={() => setStyleEdit(guide)}>
                Revise {guide.title} v{guide.version}
              </Button>
            </article>
          ))}
        </div>
      ) : creating ? (
        <>
          {study && <StudyReportMatches key={`${study.attemptId}-${epoch}`} {...study} />}
          {styles.length ? (
            <ReportCreateForm
              key={study?.attemptId ?? "new"}
              study={study ?? undefined}
              styles={styles}
              onCancel={cancelCreate}
              onCreate={async (r) => open(r.id)}
            />
          ) : (
            <div className="report-list">
              <h2>Create a style guide first</h2>
              <p>
                Capture analytical structure, source discipline and voice before starting the
                report.
              </p>
              <Button className="button primary" onClick={() => setStyleEdit(null)}>
                New style guide
              </Button>
              {study && (
                <Button className="button" onClick={cancelCreate}>
                  Cancel report creation
                </Button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="report-list">
          <h2>Recent reports</h2>
          <p className="field-hint">
            Latest 100 reports. Every save preserves a revision; publication is a separate action.
          </p>
          <div className="collection-toolbar">
            <label>
              Find a recent report
              <input
                type="search"
                placeholder="Title or change note…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label>
              Sort reports
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="recent">Recently updated</option>
                <option value="title">Title</option>
              </select>
            </label>
          </div>
          <p className="collection-count">
            {visibleReports.length} shown · {reports.length} recent reports
          </p>
          {reports.length > 0 && !visibleReports.length && (
            <p className="muted">No reports match this search.</p>
          )}
          {!reports.length && (
            <p className="muted">
              Start from a completed research result, then draft and review its sections here.
            </p>
          )}
          {visibleReports.map((r) => (
            <Button
              className="report-list-row report-browser-row"
              key={r.id}
              onClick={async () => {
                try {
                  await open(r.id);
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "Unable to open report.");
                }
              }}
            >
              <strong>{r.title}</strong>
              <span className="report-origin">
                {r.author === "human" ? "Human edit" : "Research draft"}
              </span>
              <span>
                Revision {r.version} · {new Date(r.created_at).toLocaleString()}
              </span>
              <span>{r.change_note}</span>
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
