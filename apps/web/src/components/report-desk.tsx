"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { ReportCreateForm } from "@/components/report-create";
import { ReportEditor } from "@/components/report-editor";
import { StyleGuideContent, StyleGuideEditor } from "@/components/style-guide-editor";
import { api } from "@/lib/workflow";
import type { ReportSummary, ReportView, StyleGuide } from "@/lib/reports";

export function ReportDesk() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [styles, setStyles] = useState<StyleGuide[]>([]);
  const [view, setView] = useState<ReportView | null>(null);
  const [page, setPage] = useState<"reports" | "styles">("reports");
  const [creating, setCreating] = useState(false);
  const [styleEdit, setStyleEdit] = useState<StyleGuide | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [epoch, setEpoch] = useState(0);
  const styleWrites = useRef(0);
  useEffect(() => {
    let active = true;
    const styleVersion = styleWrites.current;
    async function load() {
      try {
        const [items, guides] = await Promise.all([
          api<ReportSummary[]>("reports"),
          api<StyleGuide[]>("style-guides"),
        ]);
        const id = new URL(window.location.href).searchParams.get("report");
        const saved = id ? await api<ReportView>(`reports/${encodeURIComponent(id)}`) : null;
        if (active) {
          setReports(items);
          // A list read started before a save must not remove the saved guide.
          if (styleVersion === styleWrites.current) setStyles(guides);
          if (saved) setView(saved);
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
  }, [epoch]);
  function remember(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("report", id);
    else url.searchParams.delete("report");
    url.searchParams.set("view", "reports");
    window.history.replaceState(null, "", url);
  }
  async function open(id: string) {
    const saved = await api<ReportView>(`reports/${id}`);
    setView(saved);
    setPage("reports");
    setCreating(false);
    setStyleEdit(undefined);
    remember(id);
  }
  function leave() {
    setView(null);
    remember(null);
    setEpoch((e) => e + 1);
  }
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
            setPage("styles");
          }}
        />
      ) : view ? (
        <ReportEditor
          key={view.revision.id}
          view={view}
          styles={styles}
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
        styles.length ? (
          <ReportCreateForm
            styles={styles}
            onCancel={() => setCreating(false)}
            onCreate={async (r) => open(r.id)}
          />
        ) : (
          <div className="report-list">
            <h2>Create a style guide first</h2>
            <p>
              Capture analytical structure, source discipline and voice before starting the report.
            </p>
            <Button className="button primary" onClick={() => setStyleEdit(null)}>
              New style guide
            </Button>
          </div>
        )
      ) : (
        <div className="report-list">
          <h2>Recent reports</h2>
          <p className="field-hint">
            Latest 100 reports. Every save preserves a revision; publication is a separate action.
          </p>
          {!reports.length && (
            <p className="muted">
              Start from a completed research result, then draft and review its sections here.
            </p>
          )}
          {reports.map((r) => (
            <Button
              className="report-list-row"
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
