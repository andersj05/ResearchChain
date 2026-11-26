"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { Button } from "@ui-sdk/react/button";
import { EvidencePicker } from "@/components/evidence-picker";
import {
  ReportSectionSources,
  ReportSource,
  type SectionReferenceDraft,
} from "@/components/report-sources";
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
import { useReportDraftSources } from "@/lib/use-report-draft-sources";
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
import positionStyles from "./report-section-position.module.css";

function usesReportSource(section: ReportSection, id: string) {
  return (
    section.citations?.some((citation) => citation.evidence_id === id) ||
    section.chart_ids?.includes(id)
  );
}

export function ReportEditor({
  view,
  styles,
  checkingRevision,
  headingRef,
  initialSectionId,
  onOpen,
  onOpenHistory,
  onRefresh,
}: {
  view: ReportView;
  styles: StyleGuide[];
  checkingRevision: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  initialSectionId?: string;
  onOpen: (id: string, sectionId?: string) => Promise<void>;
  onOpenHistory: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const { owner } = useOwner();
  const storagePrefix = ownerStoragePrefix(owner);
  const record = view.revision;
  const study = record.provenance.renderer === "study-markdown-1" ? record.provenance : null;
  const provenanceParams = new URLSearchParams({ view: "runs", run: record.provenance.run_id });
  if (study) provenanceParams.set("attempt", study.attempt.id);
  const { studyFiles, studyUrls } = useMemo(
    () => ({
      studyFiles: study?.attempt.result?.workspace_files ?? [],
      studyUrls: new Set(study?.recorded_urls),
    }),
    [study],
  );
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
  const [referenceDrafts, setReferenceDrafts] = useState(
    () => new Map<string, SectionReferenceDraft>(),
  );
  const [sourceRemovalNotice, setSourceRemovalNotice] = useState("");
  const savedSourceIds = useMemo(() => record.sources.map(({ id }) => id), [record.sources]);
  const addedSourceIds = useMemo(
    () => draft.evidence_ids.filter((id) => !savedSourceIds.includes(id)),
    [draft.evidence_ids, savedSourceIds],
  );
  const addedSources = useReportDraftSources(addedSourceIds);
  const [selected, setSelected] = useState(
    () =>
      recovery.draft.sections.find((item) => item.id === initialSectionId)?.id ??
      record.sections[0]!.id,
  );
  const [sectionSearch, setSectionSearch] = useState("");
  const [moveTarget, setMoveTarget] = useState<{ sectionId: string; targetId: string }>();
  const [moveNotice, setMoveNotice] = useState("");
  const sectionFilterInput = useRef<HTMLInputElement>(null);
  const outlineId = useId();
  const sectionHeadingInput = useRef<HTMLInputElement>(null);
  const [outlineOrigin, setOutlineOrigin] = useState<{ id: string; keyboard: boolean }>();
  const outlineJumpPending = useRef(false);
  const [showDraftPreview, setShowDraftPreview] = useState(false);
  const sectionTextId = useId();
  const previewId = `${sectionTextId}-preview`;
  const sectionText = useRef<HTMLTextAreaElement>(null);
  const restoreSectionFocus = useRef(false);
  const [history, setHistory] = useState<ReportSummary[]>([]);
  const [recovered, setRecovered] = useState(recovery.recovered);
  const [recoveryError, setRecoveryError] = useState(recovery.error);
  const [invalidRecovery, setInvalidRecovery] = useState<string | null>(recovery.invalid);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<{ section: ReportSection; index: number } | null>(null);
  const [awaitingNote, setAwaitingNote] = useState(false);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const noteMessageId = useId();
  const retry = useRef<{ body: string; id: string } | null>(recovery.pending);
  const acting = useRef(false);
  const [pendingBody, setPendingBody] = useState<string | null>(recovery.pending?.body ?? null);
  const draftBody = useMemo(() => JSON.stringify(draft), [draft]);
  const originalBody = useMemo(() => JSON.stringify(original), [original]);
  const dirty = draftBody !== originalBody;
  const hasUnfinishedWork = dirty || referenceDrafts.size > 0;
  const stale = view.current_revision_id !== record.id;
  const retryingSave = stale && pendingBody === draftBody;
  const saveDisabled =
    checkingRevision || busy || !dirty || !!invalidRecovery || (stale && !retryingSave);
  const noteMissing = !draft.change_note.trim();
  const showSaveContinuation = awaitingNote && dirty && !stale && !invalidRecovery;
  const showNoteMessage = showSaveContinuation && noteMissing;
  const sectionIndex = Math.max(
    0,
    draft.sections.findIndex((item) => item.id === selected),
  );
  const section = draft.sections[sectionIndex]!;
  const chosenIndex =
    moveTarget?.sectionId === section.id
      ? draft.sections.findIndex((item) => item.id === moveTarget.targetId)
      : -1;
  const destinationIndex = chosenIndex < 0 ? sectionIndex : chosenIndex;
  const longOutline = draft.sections.length >= 8;
  const sectionQuery = sectionSearch.trim().toLowerCase();
  const searchingSections = Boolean(sectionQuery);
  const indexedSections = useMemo(
    () =>
      draft.sections.map((item, index) => ({
        item,
        index,
        text: searchingSections ? `${item.heading}\n${item.body}`.toLowerCase() : "",
      })),
    [draft.sections, searchingSections],
  );
  const visibleSections = searchingSections
    ? indexedSections.filter(({ text }) => text.includes(sectionQuery))
    : indexedSections;
  const guide = styles.find((s) => s.id === draft.style_guide_id) ?? view.style_guide;
  const draftMarkdown = useMemo(
    () =>
      showDraftPreview && study ? (
        <ResearchMarkdown text={section.body} sources={studyUrls} files={studyFiles} />
      ) : null,
    [section.body, showDraftPreview, study, studyUrls, studyFiles],
  );

  useLayoutEffect(() => {
    if (showDraftPreview || !restoreSectionFocus.current) return;
    restoreSectionFocus.current = false;
    sectionText.current?.focus({ preventScroll: true });
  }, [showDraftPreview]);

  useLayoutEffect(() => {
    if (!outlineOrigin || !outlineJumpPending.current) return;
    outlineJumpPending.current = false;
    const input = sectionHeadingInput.current;
    if (!input || input.matches(":disabled")) return;
    if (outlineOrigin.keyboard) input.focus({ preventScroll: true });
    input.scrollIntoView({ block: "center" });
  }, [outlineOrigin]);

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
    setSourceRemovalNotice("");
    setDraft(next);
    const changed = JSON.stringify(next) !== JSON.stringify(original);
    if (!changed) setAwaitingNote(false);
    try {
      if (changed)
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
  function changeReportSources(ids: string[]) {
    const evidenceIds = [...new Set([...savedSourceIds, ...ids])];
    for (const id of addedSourceIds) {
      if (evidenceIds.includes(id)) continue;
      const usedIn = draft.sections.find((section) => usesReportSource(section, id));
      if (usedIn) {
        setSourceRemovalNotice(
          `Remove references or chart placements using this source in “${usedIn.heading || "Untitled section"}” first.`,
        );
        return;
      }
      if (removed && usesReportSource(removed.section, id)) {
        setSourceRemovalNotice(
          "Restore the removed section and remove its references or chart placements before removing this source.",
        );
        return;
      }
      const openIn = draft.sections.find(
        (section) => referenceDrafts.get(section.id)?.citation.evidence_id === id,
      );
      if (openIn) {
        setSourceRemovalNotice(
          `Cancel the open reference in “${openIn.heading || "Untitled section"}” before removing this source.`,
        );
        return;
      }
    }
    changeDraft({ ...draft, evidence_ids: evidenceIds });
  }
  function changeReferenceDraft(sectionId: string, draft: SectionReferenceDraft | null) {
    if (!draft) setSourceRemovalNotice("");
    setReferenceDrafts((current) => {
      if (!draft && !current.has(sectionId)) return current;
      const next = new Map(current);
      if (draft) next.set(sectionId, draft);
      else next.delete(sectionId);
      return next;
    });
  }
  function selectSection(id: string) {
    setSelected(id);
    setMoveTarget(undefined);
    setMoveNotice("");
  }
  function selectFromOutline(id: string, keyboard: boolean) {
    selectSection(id);
    const compact = !locked && window.matchMedia("(max-width: 760px)").matches;
    outlineJumpPending.current = compact;
    setOutlineOrigin(compact ? { id, keyboard } : undefined);
  }
  function backToSections(id: string) {
    const target =
      document.getElementById(`${outlineId}-${id}`) ??
      sectionFilterInput.current ??
      document.getElementById(outlineId);
    setOutlineOrigin(undefined);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "center" });
  }
  function moveSectionTo(destination: number) {
    if (locked || destination === sectionIndex || !draft.sections[destination]) return;
    const sections = [...draft.sections];
    sections.splice(sectionIndex, 1);
    sections.splice(destination, 0, section);
    setSelected(section.id);
    setMoveTarget(undefined);
    setMoveNotice(
      `${section.heading.trim() || "Section"} moved to position ${destination + 1} of ${sections.length}.`,
    );
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
  function saveRevision() {
    if (saveDisabled || acting.current) return;
    if (noteMissing && !retryingSave) {
      setAwaitingNote(true);
      noteInput.current?.focus({ preventScroll: true });
      noteInput.current?.scrollIntoView({ block: "center" });
      return;
    }
    return action(async () => {
      const id = stableRequestId(retry, draft);
      setPendingBody(draftBody);
      try {
        localStorage.setItem(storageKey, JSON.stringify({ draft, pending: retry.current }));
      } catch {
        setRecoveryError(
          "Download your draft if this request is interrupted; browser recovery is unavailable.",
        );
      }
      const saved = await api<ReportRevision>("reports/revisions", { ...draft, id });
      await onOpen(saved.id, section.id);
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* The server has the saved revision. */
      }
    });
  }
  const locked = busy || stale || !!invalidRecovery;
  return (
    <section className="report-editor" aria-label="Report editor">
      <header className="report-toolbar">
        <div>
          <h2 ref={headingRef} tabIndex={-1}>
            {record.title}
          </h2>
          <p>
            Revision {record.version} ·{" "}
            {record.author === "human" ? "Human revision" : "Research seed"} · {view.review_status}
          </p>
        </div>
        <div className="actions">
          <Button className="button primary" disabled={saveDisabled} onClick={saveRevision}>
            {retryingSave ? "Retry pending save" : "Save report revision"}
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
                setSourceRemovalNotice("");
                setReferenceDrafts(new Map());
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
            {(longOutline || sectionSearch) && (
              <div className="report-outline-search">
                <label>
                  Find a section
                  <input
                    ref={sectionFilterInput}
                    type="search"
                    value={sectionSearch}
                    maxLength={240}
                    placeholder="Heading or text"
                    aria-controls={outlineId}
                    onChange={(event) => setSectionSearch(event.target.value)}
                  />
                </label>
                {sectionSearch && (
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      setSectionSearch("");
                      sectionFilterInput.current?.focus();
                    }}
                  >
                    Clear search
                  </button>
                )}
              </div>
            )}
            <nav
              id={outlineId}
              className="report-outline"
              aria-label="Report sections"
              tabIndex={-1}
            >
              {visibleSections.map(({ item, index }) => (
                <Button
                  key={item.id}
                  id={`${outlineId}-${item.id}`}
                  className={
                    item.id === section.id ? "report-outline-item selected" : "report-outline-item"
                  }
                  aria-current={item.id === section.id ? "true" : undefined}
                  onClick={(event) => selectFromOutline(item.id, event.detail === 0)}
                >
                  {index + 1}. {item.heading}
                </Button>
              ))}
              {!visibleSections.length && (
                <p className="report-outline-empty" role="status">
                  No sections match your search.
                </p>
              )}
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
                  selectSection(next.id);
                }}
              >
                Add section
              </Button>
              <Button
                className="button small"
                disabled={sectionIndex === 0}
                onClick={() => moveSectionTo(sectionIndex - 1)}
              >
                Move earlier
              </Button>
              <Button
                className="button small"
                disabled={sectionIndex === draft.sections.length - 1}
                onClick={() => moveSectionTo(sectionIndex + 1)}
              >
                Move later
              </Button>
              <Button
                className="button small"
                disabled={draft.sections.length === 1}
                onClick={() => {
                  if (removed) changeReferenceDraft(removed.section.id, null);
                  setRemoved({
                    section,
                    index: sectionIndex,
                  });
                  setMoveTarget(undefined);
                  setMoveNotice("");
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
                    selectSection(removed.section.id);
                    setRemoved(null);
                  }}
                >
                  Restore removed section
                </Button>
              )}
            </div>
            {longOutline && (
              <details className={positionStyles.details}>
                <summary>Move to position</summary>
                <div className={positionStyles.fields}>
                  <label>
                    New position
                    <select
                      value={draft.sections[destinationIndex]!.id}
                      onChange={(event) =>
                        setMoveTarget({ sectionId: section.id, targetId: event.target.value })
                      }
                    >
                      {indexedSections.map(({ item, index }) => (
                        <option key={item.id} value={item.id}>
                          {index + 1}.{" "}
                          {index === sectionIndex
                            ? "Current position"
                            : `${index < sectionIndex ? "Before" : "After"} ${item.heading.trim() || "untitled section"}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    className="button small"
                    disabled={locked || destinationIndex === sectionIndex}
                    focusableWhenDisabled={!locked}
                    onClick={() => moveSectionTo(destinationIndex)}
                  >
                    Move section
                  </Button>
                </div>
              </details>
            )}
            <p className="sr-only" role="status">
              {moveNotice}
            </p>
            {outlineOrigin && !locked && (
              <button
                type="button"
                className="button small report-back-to-sections"
                aria-controls={outlineId}
                onClick={() => backToSections(outlineOrigin.id)}
              >
                Back to sections
              </button>
            )}
            <label>
              Section heading
              <input
                ref={sectionHeadingInput}
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
          </fieldset>
          <div className="report-section-text-controls">
            <label htmlFor={sectionTextId}>Section text</label>
            <button
              type="button"
              className="button small"
              aria-controls={previewId}
              aria-expanded={showDraftPreview}
              onClick={() => {
                restoreSectionFocus.current = showDraftPreview;
                setShowDraftPreview(!showDraftPreview);
              }}
            >
              {showDraftPreview ? "Return to section text" : "Preview draft section"}
            </button>
          </div>
          <textarea
            id={sectionTextId}
            ref={sectionText}
            className="report-body"
            hidden={showDraftPreview}
            disabled={locked}
            maxLength={60000}
            rows={18}
            value={section.body}
            onChange={(e) => editSection({ ...section, body: e.target.value })}
          />
          {!showDraftPreview && (
            <p className="field-hint">
              {Array.from(section.body).length.toLocaleString()} characters
            </p>
          )}
          <div
            id={previewId}
            key={`${previewId}-${section.id}`}
            className="report-section-draft-preview"
            role="region"
            aria-label="Unsaved section preview"
            tabIndex={0}
            hidden={!showDraftPreview}
          >
            {showDraftPreview && (
              <>
                <h3>{section.heading || "Untitled section"}</h3>
                {draftMarkdown ?? <div className="report-prose">{section.body}</div>}
              </>
            )}
          </div>
          <ReportSectionSources
            key={section.id}
            section={section}
            sources={[...record.sources, ...addedSources.sources]}
            sourceBases={{ ...view.source_bases, ...addedSources.sourceBases }}
            draftSourceLookup={addedSources}
            disabled={locked}
            onChange={editSection}
            referenceDraft={referenceDrafts.get(section.id)}
            onReferenceDraftChange={(draft) => changeReferenceDraft(section.id, draft)}
          />
          <label>
            Revision change note
            <textarea
              ref={noteInput}
              disabled={locked}
              aria-required="true"
              aria-invalid={showNoteMessage || undefined}
              aria-describedby={showNoteMessage ? noteMessageId : undefined}
              maxLength={6000}
              rows={2}
              value={draft.change_note}
              onChange={(e) => changeDraft({ ...draft, change_note: e.target.value })}
              placeholder="What changed and why?"
            />
          </label>
          {showNoteMessage && (
            <p id={noteMessageId} className="error" role="alert">
              Add a change note before saving this revision.
            </p>
          )}
          {dirty && (
            <div className="actions">
              {showSaveContinuation && (
                <Button
                  className="button primary"
                  disabled={saveDisabled || noteMissing}
                  onClick={saveRevision}
                >
                  Continue saving revision
                </Button>
              )}
              <Button
                className="button"
                disabled={busy}
                onClick={() => {
                  changeDraft(original);
                  setReferenceDrafts(new Map());
                  setRecovered(false);
                  setRemoved(null);
                  retry.current = null;
                  setPendingBody(null);
                }}
              >
                Discard unsaved edits
              </Button>
            </div>
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
              Use selected sources in references and charts. Saving pins new sources to this
              revision.
            </p>
            {record.sources.map((s) => (
              <ReportSource key={s.id} source={s} />
            ))}
            <EvidencePicker
              label="Report source snapshots"
              selected={draft.evidence_ids}
              disabled={locked}
              onChange={changeReportSources}
            />
            {addedSources.loading && <p role="status">Loading draft sources…</p>}
            {addedSources.unavailable && (
              <div className="source-notice" role="alert">
                <p>Some draft sources could not be loaded for references or charts.</p>
                <Button className="button small" onClick={addedSources.retry}>
                  Retry draft sources
                </Button>
              </div>
            )}
            {sourceRemovalNotice && (
              <p className="error" role="alert">
                {sourceRemovalNotice}
              </p>
            )}
          </details>
          <details>
            <summary>Revision history</summary>
            <p className="field-hint">
              Latest 100 revisions.
              {hasUnfinishedWork &&
                " Other revisions open in a new tab to keep this draft in place."}
            </p>
            {history.map((h) => {
              const isOpen = h.id === record.id;
              const openInNewTab = hasUnfinishedWork && !isOpen && !busy;
              const content = (
                <>
                  <strong>
                    Revision {h.version} · {h.author === "human" ? "Human" : "Research seed"}
                    {openInNewTab && " (new tab)"}
                  </strong>
                  <span>{h.change_note}</span>
                </>
              );
              return openInNewTab ? (
                <a
                  className="report-history-item"
                  key={h.id}
                  href={`/?${new URLSearchParams({ view: "reports", report: h.id })}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {content}
                </a>
              ) : (
                <Button
                  className="report-history-item"
                  key={h.id}
                  disabled={busy || isOpen}
                  onClick={() => action(() => onOpenHistory(h.id))}
                >
                  {content}
                </Button>
              );
            })}
          </details>
          <details>
            <summary>Research provenance</summary>
            <p>
              {!study && "Run "}
              <a href={`/?${provenanceParams}`} target="_blank" rel="noopener noreferrer">
                {study ? "Inspect source pass" : record.provenance.run_id.slice(0, 8)}
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
