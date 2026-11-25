"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { ReportCreateForm } from "@/components/report-create";
import { ReportEditor } from "@/components/report-editor";
import { StyleGuideContent, StyleGuideEditor } from "@/components/style-guide-editor";
import { api } from "@/lib/workflow";
import type { ReportSummary, ReportView, StyleGuide } from "@/lib/reports";

type ReportListPosition = {
  revisionId: string;
  seriesId: string;
  panelTop: number;
  windowTop: number;
};
type ReportSearchResult = { query: string; items: ReportSummary[] | null };

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
  const [searchResult, setSearchResult] = useState<ReportSearchResult>();
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
  const desk = useRef<HTMLElement>(null);
  const reportHeading = useRef<HTMLHeadingElement>(null);
  const openingHistory = useRef<string | null>(null);
  const listSearch = useRef<HTMLInputElement>(null);
  const listPosition = useRef<ReportListPosition | null>(null);
  const listTransition = useRef<"open" | "return" | null>(null);
  const query = search.trim();
  const showingList = !loading && !view && page === "reports" && !creating;
  const matching = searchResult?.query === query ? searchResult : undefined;

  useEffect(() => {
    if (!showingList || !query) return;
    let active = true;
    const debounce = window.setTimeout(() => {
      void api<ReportSummary[]>(`reports?${new URLSearchParams({ search: query })}`).then(
        (items) => {
          if (active) setSearchResult({ query, items });
        },
        () => {
          if (active) setSearchResult({ query, items: null });
        },
      );
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(debounce);
    };
  }, [epoch, query, showingList, visit]);

  useLayoutEffect(() => {
    const position = listPosition.current;
    const root = desk.current;
    if (!position || !root) return;
    const panel = root.closest<HTMLElement>(".reports-view");
    if (listTransition.current === "open" && view?.revision.id === position.revisionId) {
      listTransition.current = null;
      if (document.activeElement === document.body) {
        window.scrollTo(0, 0);
        if (panel) panel.scrollTop = 0;
        reportHeading.current?.focus({ preventScroll: true });
      }
    }
    if (listTransition.current !== "return" || view) return;
    listTransition.current = null;
    listPosition.current = null;
    const row = [...root.querySelectorAll<HTMLButtonElement>("[data-report-series]")].find(
      (button) => button.dataset.reportSeries === position.seriesId,
    );
    if (!row) {
      listSearch.current?.focus();
      return;
    }
    row.focus({ preventScroll: true });
    window.scrollTo(0, position.windowTop);
    if (panel) panel.scrollTop = position.panelTop;
    row.scrollIntoView({ block: "nearest" });
  }, [view]);

  useLayoutEffect(() => {
    if (openingHistory.current !== view?.revision.id) return;
    openingHistory.current = null;
    if (document.activeElement !== document.body) return;
    const heading = reportHeading.current;
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "center" });
  }, [view]);

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
    // Workbench owns the active tab, which may change before a report request finishes.
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("report", id);
    else url.searchParams.delete("report");
    url.searchParams.delete("fromStudy");
    url.searchParams.delete("reportAttempt");
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
  async function openHistory(id: string) {
    openingHistory.current = id;
    try {
      await open(id);
    } catch (cause) {
      if (openingHistory.current === id) openingHistory.current = null;
      throw cause;
    }
  }
  function leave(restorePosition = false) {
    listTransition.current = restorePosition && listPosition.current ? "return" : null;
    if (!listTransition.current) listPosition.current = null;
    setSavedSection(undefined);
    setView(null);
    remember(null);
    setEpoch((e) => e + 1);
  }
  function cancelCreate() {
    setCreating(false);
    if (study) leave();
  }
  const visibleReports = (
    matching?.items ??
    reports.filter((report) =>
      `${report.title} ${report.change_note}`.toLowerCase().includes(query.toLowerCase()),
    )
  ).toSorted((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title)
      : Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  return (
    <section ref={desk} className="report-desk" aria-label="Reports">
      <header className="evidence-header">
        <div>
          <p className="eyebrow">Research → editorial review</p>
          <h1>Reports</h1>
        </div>
        <div className="actions">
          {view ? (
            <Button className="button" onClick={() => leave(true)}>
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
          <Button
            className="button"
            aria-label="Refresh reports"
            onClick={() => setEpoch((e) => e + 1)}
          >
            Refresh
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
          headingRef={reportHeading}
          initialSectionId={
            savedSection?.revisionId === view.revision.id ? savedSection.sectionId : undefined
          }
          onOpen={open}
          onOpenHistory={openHistory}
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
            Recent reports appear first. Search saved reports by title or change note.
          </p>
          <div className="collection-toolbar">
            <label>
              Find a report
              <input
                ref={listSearch}
                type="search"
                maxLength={200}
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
          <p className="collection-count" role="status">
            {!query
              ? `${reports.length} recent ${reports.length === 1 ? "report" : "reports"}`
              : !matching
                ? "Searching saved reports…"
                : `${visibleReports.length} ${visibleReports.length === 1 ? "match" : "matches"} shown`}
          </p>
          {query && matching?.items === null && (
            <p className="error" role="alert">
              Could not search all saved reports. Refresh to retry.
            </p>
          )}
          {query && matching?.items?.length === 100 && (
            <p className="field-hint">
              Showing up to 100 matches. Narrow the search to refine them.
            </p>
          )}
          {query && matching?.items?.length === 0 && (
            <p className="muted">No reports match this search.</p>
          )}
          {!query && !reports.length && (
            <p className="muted">
              Start from a completed research result, then draft and review its sections here.
            </p>
          )}
          {visibleReports.map((r) => (
            <Button
              className="report-list-row report-browser-row"
              key={r.series_id}
              data-report-series={r.series_id}
              onClick={async () => {
                const position = {
                  revisionId: r.id,
                  seriesId: r.series_id,
                  panelTop: desk.current?.closest<HTMLElement>(".reports-view")?.scrollTop ?? 0,
                  windowTop: window.scrollY,
                };
                listPosition.current = position;
                listTransition.current = "open";
                try {
                  await open(r.id);
                } catch (cause) {
                  if (listPosition.current === position) {
                    listPosition.current = null;
                    listTransition.current = null;
                  }
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
