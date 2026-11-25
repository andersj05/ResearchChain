"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { EvidencePicker } from "@/components/evidence-picker";
import { ReportSectionSources, ReportSource } from "@/components/report-sources";
import { ReportReview } from "@/components/report-review";
import { ResearchMarkdown } from "@/components/research-markdown";
import { StyleGuideContent } from "@/components/style-guide-editor";
import { useOwner } from "@/components/access-context";
import {
  apiFetch,
  importLegacyDraft,
  legacyDraftAvailable,
  ownerStoragePrefix,
} from "@/lib/access";
import { contentDownloadUrl } from "@/lib/evidence";
import { sessionUrl } from "@/lib/research-sessions";
import { api, ApiError } from "@/lib/workflow";
import { stableRequestId } from "@/lib/evaluations";
import {
  downloadDraft,
  downloadReportFile,
  kindLabels,
  parseRecovery,
  reportDraft,
  reportText,
  type ReportDraft,
  type ReportRevision,
  type ReportSection,
  type ReportSummary,
  type ReportView,
  type StyleGuide,
} from "@/lib/reports";

export function ReportEditor({
  view,
  styles,
  onOpen,
  onRefresh,
}: {
  view: ReportView;
  styles: StyleGuide[];
  onOpen: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const { owner } = useOwner();
  const storagePrefix = ownerStoragePrefix(owner);
  const record = view.revision;
  const study = record.provenance.renderer === "study-markdown-1" ? record.provenance : null;
  const studyFiles = study?.attempt.result?.workspace_files ?? [];
  const studyUrls = new Set(study?.recorded_urls);
  const [original] = useState(() => reportDraft(record));
  const legacyKey = `researchchain.report.draft.${record.id}`;
  const storageKey = `${storagePrefix}.report.draft.${record.id}`;
  const [legacyAvailable, setLegacyAvailable] = useState(() =>
    legacyDraftAvailable(legacyKey, storagePrefix),
  );
  const [recovery] = useState(() => {
    let raw: string | null = null;
    try {
      raw = typeof window === "undefined" ? null : localStorage.getItem(storageKey);
      const saved = raw ? parseRecovery(raw, record.id) : null;
      return {
        draft: saved?.draft ?? original,
        pending: saved?.pending ?? null,
        recovered: !!saved,
        error: "",
        invalid: null as string | null,
      };
    } catch (cause) {
      return {
        draft: original,
        pending: null,
        recovered: false,
        error: cause instanceof Error ? cause.message : "Browser recovery unavailable.",
        invalid: raw,
      };
    }
  });
  const [draft, setDraft] = useState<ReportDraft>(recovery.draft);
  const [selected, setSelected] = useState(record.sections[0]!.id);
  const [history, setHistory] = useState<ReportSummary[]>([]);
  const [recovered, setRecovered] = useState(recovery.recovered);
  const [recoveryError, setRecoveryError] = useState(recovery.error);
  const [invalidRecovery, setInvalidRecovery] = useState<string | null>(recovery.invalid);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<{ section: ReportSection; index: number } | null>(null);
  const retry = useRef<{ body: string; id: string } | null>(recovery.pending);
  const acting = useRef(false);
  const [pendingBody, setPendingBody] = useState<string | null>(recovery.pending?.body ?? null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  const stale = view.current_revision_id !== record.id;
  const section = draft.sections.find((s) => s.id === selected) ?? draft.sections[0]!;
  const guide = styles.find((s) => s.id === draft.style_guide_id) ?? view.style_guide;

  useEffect(() => {
    let active = true;
    api<ReportSummary[]>(`reports/${record.id}/history`)
      .then((items) => {
        if (active) setHistory(items);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [record.id]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function changeDraft(next: ReportDraft) {
    setDraft(next);
    try {
      if (JSON.stringify(next) !== JSON.stringify(original))
        localStorage.setItem(storageKey, JSON.stringify({ draft: next, pending: retry.current }));
      else localStorage.removeItem(storageKey);
    } catch {
      setRecoveryError(
        "Browser draft recovery is unavailable or full. Download your draft before leaving.",
      );
    }
  }
  function editSection(next: ReportSection) {
    changeDraft({ ...draft, sections: draft.sections.map((s) => (s.id === next.id ? next : s)) });
  }
  function move(offset: number) {
    const sections = [...draft.sections];
    const i = sections.findIndex((s) => s.id === section.id);
    const moving = sections[i];
    const adjacent = sections[i + offset];
    if (!moving || !adjacent) return;
    sections[i] = adjacent;
    sections[i + offset] = moving;
    changeDraft({ ...draft, sections });
  }
  async function action(work: () => Promise<void>) {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to complete report action.");
      if (cause instanceof ApiError && cause.status === 409) {
        retry.current = null;
        setPendingBody(null);
        changeDraft(draft);
        await onRefresh().catch(() => undefined);
      }
    } finally {
      acting.current = false;
      setBusy(false);
    }
  }
  const locked = busy || stale || !!invalidRecovery;
  return (
    <section className="report-editor" aria-label="Report editor">
      <header className="report-toolbar">
        <div>
          <h2>{record.title}</h2>
          <p>
            Revision {record.version} ·{" "}
            {record.author === "human" ? "Human revision" : "Research seed"} · {view.review_status}
          </p>
        </div>
        <div className="actions">
          <Button
            className="button primary"
            disabled={
              busy ||
              !dirty ||
              !!invalidRecovery ||
              (stale && pendingBody !== JSON.stringify(draft))
            }
            onClick={() =>
              action(async () => {
                const id = stableRequestId(retry, draft);
                setPendingBody(JSON.stringify(draft));
                try {
                  localStorage.setItem(
                    storageKey,
                    JSON.stringify({ draft, pending: retry.current }),
                  );
                } catch {
                  setRecoveryError(
                    "Download your draft if this request is interrupted; browser recovery is unavailable.",
                  );
                }
                const saved = await api<ReportRevision>("reports/revisions", { ...draft, id });
                await onOpen(saved.id);
                try {
                  localStorage.removeItem(storageKey);
                } catch {
                  /* The server has the saved revision. */
                }
              })
            }
          >
            {stale && pendingBody === JSON.stringify(draft)
              ? "Retry pending save"
              : "Save report revision"}
          </Button>
          <Button
            className="button"
            disabled={busy || dirty}
            onClick={() =>
              action(async () => {
                const response = await apiFetch(`/api/reports/${record.id}/export`, {
                  cache: "no-store",
                  signal: AbortSignal.timeout(60000),
                });
                if (!response.ok) {
                  const body = await response.json();
                  throw new Error(body.detail ?? "Export failed.");
                }
                downloadReportFile(`report-${record.id}.zip`, await response.blob());
              })
            }
          >
            Export review bundle
          </Button>
          <Button className="button" onClick={() => downloadDraft(draft)}>
            Download draft JSON
          </Button>
        </div>
      </header>
      <p className="report-save-state" role="status">
        {dirty ? "Unsaved edits" : `Saved revision ${record.version}`}
        {recovered && dirty ? " · Recovered from this browser" : ""}
      </p>
      {legacyAvailable && (
        <div className="report-banner source-notice">
          <p>An older draft for this revision was saved before owner sign-in.</p>
          <Button
            className="button"
            disabled={busy || dirty || !!invalidRecovery}
            onClick={() =>
              action(async () => {
                const raw = importLegacyDraft(legacyKey, storagePrefix);
                const saved = parseRecovery(raw, record.id);
                localStorage.setItem(storageKey, raw);
                retry.current = saved.pending;
                setPendingBody(saved.pending?.body ?? null);
                setDraft(saved.draft);
                setRecovered(true);
                setLegacyAvailable(false);
              })
            }
          >
            Import my older report draft
          </Button>
        </div>
      )}
      {error && (
        <p className="error report-banner" role="alert">
          {error}
        </p>
      )}
      {recoveryError && (
        <div className="report-banner source-notice" role="alert">
          <p>{recoveryError}</p>
          {invalidRecovery && (
            <div className="actions">
              <Button
                className="button"
                onClick={() =>
                  downloadReportFile(
                    "report-recovery.json",
                    new Blob([invalidRecovery], { type: "application/json" }),
                  )
                }
              >
                Download recovery record
              </Button>
              <Button
                className="button"
                onClick={() => {
                  setInvalidRecovery(null);
                  setRecoveryError("");
                  changeDraft(original);
                }}
              >
                Discard invalid recovery
              </Button>
            </div>
          )}
        </div>
      )}
      {stale && (
        <div className="report-banner source-notice">
          <p>
            A newer revision exists. Your draft is retained for this revision. Download it to
            compare or reapply changes.
          </p>
          <Button
            className="button"
            disabled={busy}
            onClick={() => action(() => onOpen(view.current_revision_id))}
          >
            Open latest revision
          </Button>
        </div>
      )}
      <div className="report-layout">
        <main className="report-writing">
          <fieldset disabled={locked}>
            <div className="report-fields">
              <label>
                Report title
                <input
                  maxLength={240}
                  value={draft.title}
                  onChange={(e) => changeDraft({ ...draft, title: e.target.value })}
                />
              </label>
              <label>
                Pinned style guide
                <select
                  value={draft.style_guide_id}
                  onChange={(e) => changeDraft({ ...draft, style_guide_id: e.target.value })}
                >
                  {[view.style_guide, ...styles.filter((s) => s.id !== view.style_guide.id)].map(
                    (s) => (
                      <option key={s.id} value={s.id}>
                        {s.title} · v{s.version}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>
            <nav className="report-outline" aria-label="Report sections">
              {draft.sections.map((s, i) => (
                <Button
                  key={s.id}
                  className={
                    s.id === section.id ? "report-outline-item selected" : "report-outline-item"
                  }
                  aria-current={s.id === section.id ? "true" : undefined}
                  onClick={() => setSelected(s.id)}
                >
                  {i + 1}. {s.heading}
                </Button>
              ))}
            </nav>
            <div className="actions">
              <Button
                className="button small"
                disabled={draft.sections.length >= 40}
                onClick={() => {
                  const next: ReportSection = {
                    id: crypto.randomUUID(),
                    heading: "New section",
                    body: "",
                    kind: "interpretation",
                    citations: [],
                    chart_ids: [],
                  };
                  changeDraft({ ...draft, sections: [...draft.sections, next] });
                  setSelected(next.id);
                }}
              >
                Add section
              </Button>
              <Button
                className="button small"
                disabled={draft.sections[0]!.id === section.id}
                onClick={() => move(-1)}
              >
                Move earlier
              </Button>
              <Button
                className="button small"
                disabled={draft.sections.at(-1)?.id === section.id}
                onClick={() => move(1)}
              >
                Move later
              </Button>
              <Button
                className="button small"
                disabled={draft.sections.length === 1}
                onClick={() => {
                  setRemoved({
                    section,
                    index: draft.sections.findIndex((s) => s.id === section.id),
                  });
                  changeDraft({
                    ...draft,
                    sections: draft.sections.filter((s) => s.id !== section.id),
                  });
                }}
              >
                Remove section
              </Button>
              {removed && (
                <Button
                  className="button small"
                  onClick={() => {
                    const sections = [...draft.sections];
                    sections.splice(removed.index, 0, removed.section);
                    changeDraft({ ...draft, sections });
                    setSelected(removed.section.id);
                    setRemoved(null);
                  }}
                >
                  Restore removed section
                </Button>
              )}
            </div>
            <label>
              Section heading
              <input
                maxLength={240}
                value={section.heading}
                onChange={(e) => editSection({ ...section, heading: e.target.value })}
              />
            </label>
            <label>
              Section classification
              <select
                value={section.kind}
                onChange={(e) =>
                  editSection({ ...section, kind: e.target.value as ReportSection["kind"] })
                }
              >
                {Object.entries(kindLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p className="field-hint">
              Classification is your editorial judgment. Facts require captured supporting
              references; split sections when their claims need different labels.
            </p>
            <label>
              Section text
              <textarea
                className="report-body"
                maxLength={60000}
                rows={18}
                value={section.body}
                onChange={(e) => editSection({ ...section, body: e.target.value })}
              />
            </label>
            <p className="field-hint">
              {Array.from(section.body).length.toLocaleString()} characters
            </p>
          </fieldset>
          <ReportSectionSources
            key={section.id}
            section={section}
            view={view}
            disabled={locked}
            onChange={editSection}
          />
          <label>
            Revision change note
            <textarea
              disabled={locked}
              maxLength={6000}
              rows={2}
              value={draft.change_note}
              onChange={(e) => changeDraft({ ...draft, change_note: e.target.value })}
              placeholder="What changed and why?"
            />
          </label>
          {dirty && (
            <Button
              className="button"
              disabled={busy}
              onClick={() => {
                changeDraft(original);
                setRecovered(false);
                setRemoved(null);
                retry.current = null;
                setPendingBody(null);
              }}
            >
              Discard unsaved edits
            </Button>
          )}
          <details className="report-preview">
            <summary>Preview the saved report</summary>
            {study ? (
              record.sections.map((saved) => (
                <section key={saved.id}>
                  <h3>{saved.heading}</h3>
                  <ResearchMarkdown text={saved.body} sources={studyUrls} files={studyFiles} />
                </section>
              ))
            ) : (
              <pre>{reportText(record)}</pre>
            )}
          </details>
          <ReportReview view={view} disabled={dirty || busy} onRefresh={onRefresh} />
        </main>
        <aside className="report-context" aria-label="Report context">
          <StyleGuideContent guide={guide} />
          {study && (
            <details>
              <summary>Original study and files</summary>
              <p>
                <a href={sessionUrl(study.run_id)}>Open original study</a>
              </p>
              <ul>
                {studyFiles.map((file) => (
                  <li key={file.name}>
                    <a href={contentDownloadUrl(file.artifact_id, file.name)} download>
                      {file.name}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details open>
            <summary>Source snapshots ({record.sources.length})</summary>
            <p className="field-hint">
              Sources are pinned. Save additional sources before attaching their references or
              charts.
            </p>
            {record.sources.map((s) => (
              <ReportSource key={s.id} source={s} />
            ))}
            <EvidencePicker
              label="Report source snapshots"
              selected={draft.evidence_ids}
              disabled={locked}
              onChange={(ids) =>
                changeDraft({
                  ...draft,
                  evidence_ids: [...new Set([...record.sources.map((s) => s.id), ...ids])],
                })
              }
            />
          </details>
          <details>
            <summary>Revision history</summary>
            <p className="field-hint">
              Latest 100 revisions. Opening a revision keeps unsaved edits in this browser.
            </p>
            {history.map((h) => (
              <Button
                className="report-history-item"
                key={h.id}
                disabled={busy || h.id === record.id}
                onClick={() => action(() => onOpen(h.id))}
              >
                <strong>
                  Revision {h.version} · {h.author === "human" ? "Human" : "Research seed"}
                </strong>
                <span>{h.change_note}</span>
              </Button>
            ))}
          </details>
          <details>
            <summary>Research provenance</summary>
            <p>
              Run{" "}
              <a
                href={`/?view=runs&run=${record.provenance.run_id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {record.provenance.run_id.slice(0, 8)}
              </a>{" "}
              · {record.provenance.attempt.stage}
            </p>
            <p>{record.provenance.attempt.returned_model ?? record.provenance.attempt.model}</p>
            <p className="field-hint">
              The research result is the seed. Report edits do not modify the original run or
              approve its research review.
            </p>
            <p className="report-prose">{record.provenance.brief}</p>
            <p className="code-label">{record.content_hash}</p>
          </details>
        </aside>
      </div>
    </section>
  );
}
