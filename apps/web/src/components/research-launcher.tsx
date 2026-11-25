"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type MouseEventHandler,
} from "react";
import { useOwner } from "./access-context";
import { DiscoverySources, type PendingCapture } from "./discovery-sources";
import { StudyPacket, packetSize } from "./study-packet";
import type { EvidenceRecord } from "@/lib/evidence";
import { useSourceDetails } from "@/lib/use-evidence-library";
import { useModelCatalog } from "./model-picker";
import { ResearchBriefOptions, ResearchPlanConnection } from "./research-brief-options";
import { StudySettingsReuse } from "./study-settings-reuse";
import { ownerStoragePrefix } from "@/lib/access";
import { storeResearchCaptureDraft } from "@/lib/research-capture-draft";
import { modelSettingLabel, resolveModelProfile, sessionModelProblem } from "@/lib/model-settings";
import {
  api,
  admissionTimeout,
  ApiError,
  researchDefaults,
  type CommandReceipt,
  type RecentRunSummary,
} from "@/lib/workflow";
import {
  editableResearchBrief,
  initializeResearchBrief,
  newStudyModelProfiles,
  readResearchBrief,
  reusableResearchSettings,
  sessionUrl,
  studySourceLimit,
  storeResearchBrief,
  type ArchivedSourceAppend,
  type ResearchBrief,
  type ResearchSessionSetup,
  type ResearchSessionStart,
} from "@/lib/research-sessions";
import styles from "./research-desk.module.css";

const StudySetupComparison = lazy(() =>
  import("./study-setup-comparison").then(({ StudySetupComparison }) => ({
    default: StudySetupComparison,
  })),
);

function browsingSavedStudies() {
  const query = new URLSearchParams(window.location.search);
  return query.get("studies") === "1" || !!query.get("session");
}

function packetCapacity(records: (EvidenceRecord | undefined)[], limit: number) {
  const size = packetSize(records);
  const error =
    size >= limit
      ? "The source content fills the request limit. Unpin files to leave room for the lead’s instructions."
      : records.filter((item) => item?.artifact).length > 64
        ? "The analyst workspace holds 64 source files. Unpin files before starting this study."
        : "";
  return { size, error };
}

export function ResearchLauncher({
  fromSession,
  recentStudies,
  sourceAppend,
  onSourceAppendHandled,
  onQueuedFiles,
  onOpenPreviousStudy,
}: {
  fromSession: string | null;
  recentStudies?: RecentRunSummary[];
  sourceAppend?: ArchivedSourceAppend;
  onSourceAppendHandled: (append: ArchivedSourceAppend) => void;
  onQueuedFiles: (queued: boolean) => void;
  onOpenPreviousStudy: MouseEventHandler<HTMLAnchorElement>;
}) {
  const { active, owner } = useOwner();
  const key = `${ownerStoragePrefix(owner)}.research-brief.${fromSession ?? "new"}`;
  const captureKey = `${key}.capture`;
  const [saved] = useState(() => readResearchBrief(key));
  const [form, setForm] = useState(() => initializeResearchBrief(saved, fromSession));
  const [baseline, setBaseline] = useState<ResearchSessionSetup>();
  const { draft, awaitingModelCatalog } = form;
  const [pending, setPending] = useState<ResearchSessionStart | null>(saved?.pending ?? null);
  const [confirmedStart, setConfirmedStart] = useState<string>();
  const [loaded, setLoaded] = useState(Boolean(saved) || !fromSession);
  const [refreshSetup, setRefreshSetup] = useState(0);
  const [check, setCheck] = useState(0);
  const [unconfirmed, setUnconfirmed] = useState<string>();
  const [setupError, setSetupError] = useState("");
  const [startError, setStartError] = useState("");
  const [busy, setBusy] = useState(false);
  const [readingSample, setReadingSample] = useState(false);
  const [pendingCapture, setPendingCapture] = useState<PendingCapture>(null);
  const editingSource = pendingCapture !== null;
  const [sourceAppendNotice, setSourceAppendNotice] = useState("");
  const sourceSession = useMemo(
    () => (active && owner.csrf_token ? Symbol() : null),
    [active, owner.csrf_token],
  );
  const [capture, setCapture] = useState(() => ({
    session: sourceSession,
    records: new Map<string, { source: EvidenceRecord; verifiedForPacket: boolean }>(),
  }));
  if (capture.session !== sourceSession) setCapture({ session: sourceSession, records: new Map() });
  const captured = capture.records;
  const capturedRecords = draft.evidence_ids.map((id) => {
    const item = captured.get(id);
    return item?.verifiedForPacket ? item.source : undefined;
  });
  const knownSources = Array.from(captured.values(), (item) => item.source);
  const details = useSourceDetails(
    draft.evidence_ids.filter((_, index) => !capturedRecords[index]),
    sourceSession,
  );
  const records = draft.evidence_ids.map(
    (id, index) => capturedRecords[index] ?? details.items.get(id),
  );
  const limit = draft.max_input_bytes ?? 8_000_000;
  const { size, error: packetError } = packetCapacity(records, limit);
  const [manageConnection, setManageConnection] = useState(false);
  const inFlight = useRef(false);
  const admitted = useRef(false);
  const mounted = useRef(false);
  const deferNavigation = useRef(false);
  const savingSource = useRef(false);
  const launchBar = useRef<HTMLDivElement>(null);
  const catalog = useModelCatalog(active && !confirmedStart);
  const account = catalog.status?.accounts.find(
    (item) => item.active && item.signed_in && item.plan_enabled,
  );
  const models = catalog.status?.models ?? [];
  if (awaitingModelCatalog && account && !catalog.loading && !catalog.error) {
    const profiles = newStudyModelProfiles(models, researchDefaults.model);
    if (profiles) setForm({ draft: { ...draft, ...profiles }, awaitingModelCatalog: false });
  }
  const model =
    draft.model ||
    (models.find((item) => item.slug === researchDefaults.model) ?? models[0])?.slug ||
    "";
  const shared = { ...draft, model };
  const firstReading = resolveModelProfile(shared, draft.lead);
  const firstReadingLabel =
    models.find((item) => item.slug === firstReading.model)?.display_name || firstReading.model;
  const problem = sessionModelProblem(models, shared, draft);
  const ready =
    !!account && !awaitingModelCatalog && !catalog.loading && !catalog.error && !problem;
  const frozen = !active || !loaded || busy || !!pending;
  const hasMaterial = draft.evidence_ids.length > 0 && !packetError && records.every(Boolean);
  const retryable = !!pending?.start_from_sources && unconfirmed === pending.id;
  const canStart =
    active &&
    loaded &&
    !busy &&
    !readingSample &&
    !editingSource &&
    !confirmedStart &&
    (pending
      ? retryable &&
        !catalog.loading &&
        !catalog.error &&
        account?.id === pending.provider_account_id
      : ready && hasMaterial);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (browsingSavedStudies()) deferNavigation.current = true;
    };
  }, []);

  const confirmAdmission = useCallback(
    (runId: string) => {
      admitted.current = true;
      storeResearchBrief(key, null);
      storeResearchCaptureDraft(captureKey, null);
      if (deferNavigation.current || browsingSavedStudies()) {
        setConfirmedStart(runId);
        setStartError("");
      } else window.location.assign(sessionUrl(runId));
    },
    [key, captureKey],
  );

  useEffect(() => {
    const bar = launchBar.current;
    if (!active || !bar || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement.style;
    const clearance = "--first-reading-clearance";
    const measure = () =>
      root.setProperty(clearance, `${Math.ceil(bar.getBoundingClientRect().height) + 12}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.removeProperty(clearance);
    };
  }, [active, confirmedStart]);

  useEffect(() => {
    if (!active || !fromSession || loaded) return;
    let current = true;
    void api<ResearchSessionSetup>(
      `research-sessions/${encodeURIComponent(fromSession)}/setup`,
    ).then(
      (setup) => {
        if (current) {
          setBaseline(setup);
          setForm({ draft: editableResearchBrief(setup), awaitingModelCatalog: false });
          setLoaded(true);
          setSetupError("");
        }
      },
      (cause: unknown) => {
        if (current)
          setSetupError(
            cause instanceof Error ? cause.message : "Could not load the previous research setup.",
          );
      },
    );
    return () => {
      current = false;
    };
  }, [active, fromSession, loaded, refreshSetup]);

  useEffect(() => {
    if (loaded && !admitted.current)
      storeResearchBrief(key, {
        draft,
        pending,
        ...(awaitingModelCatalog && { awaitingModelCatalog: true }),
      });
  }, [key, loaded, draft, pending, awaitingModelCatalog]);

  useEffect(() => {
    if (!active || !pending || busy || admitted.current) return;
    let current = true;
    // A timed-out or interrupted POST may already have admitted the session.
    // Resolve its exact identity with a read before offering an explicit retry.
    void api<ResearchSessionSetup>(
      `research-sessions/${encodeURIComponent(pending.id)}/setup`,
    ).then(
      () => {
        if (!current) return;
        confirmAdmission(pending.id);
      },
      (cause: unknown) => {
        if (!current) return;
        if (cause instanceof ApiError && cause.status === 404) {
          setUnconfirmed(pending.id);
        } else {
          setStartError(
            cause instanceof Error ? cause.message : "Could not check this start request.",
          );
        }
      },
    );
    return () => {
      current = false;
    };
  }, [active, busy, pending, check, confirmAdmission]);

  async function start() {
    if (!canStart || !account || inFlight.current || admitted.current) return;
    deferNavigation.current = false;
    const request: ResearchSessionStart = pending ?? {
      ...draft,
      title: draft.title?.trim() || undefined,
      start_from_sources: true,
      max_input_bytes: limit,
      id: crypto.randomUUID(),
      model,
      provider_account_id: account.id,
      ...(fromSession ? { baseline_run_id: fromSession } : {}),
    };
    inFlight.current = true;
    setBusy(true);
    setStartError("");
    setUnconfirmed(undefined);
    setPending(request);
    const exact = editableResearchBrief(request);
    setForm({ draft: exact, awaitingModelCatalog: false });
    storeResearchBrief(key, { draft: exact, pending: request });
    try {
      const receipt = await api<CommandReceipt>("research-sessions", request, admissionTimeout);
      if (!mounted.current && !browsingSavedStudies()) return;
      if (receipt.run_id !== request.id)
        throw new Error("The server returned a different session. Check this start request.");
      confirmAdmission(receipt.run_id);
    } catch (cause) {
      if (!mounted.current && !browsingSavedStudies()) return;
      if (cause instanceof ApiError && [400, 422].includes(cause.status ?? 0)) setPending(null);
      setStartError(
        cause instanceof Error ? cause.message : "The server has not confirmed the start.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function update(patch: Partial<ResearchBrief>) {
    if (frozen || inFlight.current) return;
    setForm((previous) => ({ ...previous, draft: { ...previous.draft, ...patch } }));
    if (patch.evidence_ids) {
      const selected = new Set(patch.evidence_ids);
      setCapture((previous) => {
        const records = new Map(previous.records);
        let changed = false;
        // Keep the row in Saved sources while requiring a fresh detail after re-pinning it.
        for (const [id, record] of previous.records) {
          if (record.verifiedForPacket && !selected.has(id)) {
            records.set(id, { ...record, verifiedForPacket: false });
            changed = true;
          }
        }
        return changed ? { ...previous, records } : previous;
      });
      setSourceAppendNotice("");
    }
    setStartError("");
  }

  function reuseSettings(setup: ResearchSessionSetup) {
    if (fromSession || frozen || inFlight.current) return false;
    setForm(({ draft }) => ({
      draft: { ...draft, ...reusableResearchSettings(setup) },
      awaitingModelCatalog: false,
    }));
    setSourceAppendNotice("");
    setStartError("");
    return true;
  }

  function pin(source: EvidenceRecord) {
    setCapture((previous) => {
      if (!sourceSession || previous.session !== sourceSession) return previous;
      const verifiedForPacket = previous.records.get(source.id)?.verifiedForPacket ?? true;
      return {
        ...previous,
        records: new Map(previous.records).set(source.id, { source, verifiedForPacket }),
      };
    });
    setForm((previous) =>
      previous.draft.evidence_ids.includes(source.id)
        ? previous
        : {
            ...previous,
            draft: { ...previous.draft, evidence_ids: [...previous.draft.evidence_ids, source.id] },
          },
    );
    setSourceAppendNotice("");
    setStartError("");
  }

  const appendSavedSource = useEffectEvent((append: ArchivedSourceAppend) => {
    if (append !== sourceAppend || append.scope !== fromSession) return;
    const { source } = append;
    const capacityError = packetCapacity([...records, source], limit).error;
    let notice: string;
    if (admitted.current)
      notice = "This study started while you were reading. Open a new setup to add the source.";
    else if (frozen || inFlight.current || savingSource.current)
      notice = "The study setup is busy. Try adding the source after the current request settles.";
    else if (draft.evidence_ids.includes(source.id))
      notice = `${source.title} is already in the study packet.`;
    else if (draft.evidence_ids.length >= studySourceLimit)
      notice = `The study packet holds ${studySourceLimit} sources. Unpin a source to make room.`;
    else if (records.some((record) => !record))
      notice = "Some pinned source details are unavailable. Check the packet and try again.";
    else if (capacityError) notice = `Could not add ${source.title}. ${capacityError}`;
    else {
      pin(source);
      notice = `Added ${source.title} to the study packet.`;
    }
    setSourceAppendNotice(notice);
    onSourceAppendHandled(append);
  });

  useEffect(() => {
    if (!sourceAppend) return;
    let current = true;
    queueMicrotask(() => {
      if (current) appendSavedSource(sourceAppend);
    });
    return () => {
      current = false;
    };
  }, [sourceAppend]);

  if (confirmedStart) {
    return (
      <section className={styles.launch} aria-labelledby="research-title">
        <h1 id="research-title" tabIndex={-1}>
          Study started
        </h1>
        {sourceAppendNotice && <p role="status">{sourceAppendNotice}</p>}
        <div className={styles.intro}>
          <a className="button primary" href={sessionUrl(confirmedStart)}>
            Open study
          </a>
        </div>
      </section>
    );
  }

  const count = draft.evidence_ids.length;
  let nextStep = (
    <a href="#packet-heading">
      {count} {count === 1 ? "source" : "sources"} pinned
    </a>
  );
  if (!loaded) nextStep = <>Restoring saved setup…</>;
  else if (pending) nextStep = <a href="#first-reading-setup">Check the start request</a>;
  else if (pendingCapture)
    nextStep = (
      <>
        {pendingCapture !== "paste" && <a href="#desk-queued-files">Review queued files</a>}
        {pendingCapture === "both" && " · "}
        {pendingCapture !== "files" && <a href="#desk-pasted-source">Finish pasted source</a>}
      </>
    );
  else if (!count) nextStep = <a href="#intake-heading">Pin a source to begin</a>;
  else if (!hasMaterial) nextStep = <a href="#packet-heading">Check your study packet</a>;
  else if (readingSample) nextStep = <>Reading the writing sample…</>;
  else if (!ready)
    nextStep = problem ? (
      <a href="#study-settings">Check research settings</a>
    ) : (
      <a href="#first-reading-setup">Check the research connection</a>
    );

  return (
    <section className={styles.launch} aria-labelledby="research-title">
      <h1 id="research-title" tabIndex={-1}>
        {fromSession ? "Revisit material" : "New study"}
      </h1>
      <p className={styles.intro}>
        Gather the week’s material. The lead will suggest a sentence for you to investigate.
      </p>
      <nav className={styles.jumps} aria-label="Study sections">
        <a href="#saved-sources">Saved sources</a>
        <a href="#packet-heading">Study packet ({draft.evidence_ids.length})</a>
        <a href="#study-settings">Research settings</a>
        <a href="#research-history">Recent research</a>
      </nav>
      {fromSession && (
        <p className={styles.origin}>
          Starting from a{" "}
          <a href={sessionUrl(fromSession)} onClick={onOpenPreviousStudy}>
            previous study
          </a>
          .
        </p>
      )}
      {fromSession && loaded && (
        <Suspense fallback={null}>
          <StudySetupComparison
            fromSession={fromSession}
            baseline={baseline}
            draft={{ ...draft, model, max_input_bytes: limit }}
            records={[...knownSources, ...records]}
          />
        </Suspense>
      )}
      {setupError && (
        <div role="alert" className={styles.notice}>
          <span>{setupError}</span>
          <button className="text-link" type="button" onClick={() => setRefreshSetup((n) => n + 1)}>
            Retry setup
          </button>
        </div>
      )}
      {!loaded && !setupError && (
        <p role="status">Loading the previous sources and research settings…</p>
      )}
      <div className={styles.bench}>
        <DiscoverySources
          storageKey={captureKey}
          ids={draft.evidence_ids}
          known={knownSources}
          onPin={pin}
          disabled={frozen}
          onChange={(evidence_ids) => update({ evidence_ids })}
          onPendingCapture={setPendingCapture}
          onQueuedFiles={onQueuedFiles}
          onSaving={(value) => {
            savingSource.current = value;
          }}
        >
          <aside
            className={styles.composer}
            id="first-reading-setup"
            aria-label="Prepare the first reading"
            tabIndex={-1}
          >
            <StudyPacket
              ids={draft.evidence_ids}
              records={records}
              disabled={frozen || editingSource}
              onChange={(evidence_ids) => update({ evidence_ids })}
              limit={limit}
              size={size}
              error={packetError}
              appendNotice={sourceAppendNotice}
              retry={details.unresolved.length ? details.retry : undefined}
            />
            <fieldset disabled={frozen}>
              <label className={styles.briefLabel} htmlFor="research-name">
                Study title (optional)
              </label>
              <input
                id="research-name"
                className={styles.studyName}
                type="text"
                maxLength={160}
                value={draft.title ?? ""}
                placeholder={
                  draft.brief.trim().split("\n", 1)[0] || records[0]?.title || "Name this study"
                }
                onChange={(event) => update({ title: event.target.value })}
              />
              <label className={styles.briefLabel} htmlFor="research-brief">
                Context for the lead (optional)
              </label>
              <textarea
                id="research-brief"
                className={styles.shortBrief}
                rows={2}
                maxLength={10000}
                value={draft.brief}
                placeholder="What made you save this material?"
                onChange={(event) => update({ brief: event.target.value })}
              />
            </fieldset>
            {catalog.loading ? (
              <p className={styles.planNote} role="status">
                Checking the research connection…
              </p>
            ) : !account || catalog.error ? (
              <div className={styles.connectPrompt}>
                {catalog.error ? (
                  <p className="error" role="alert">
                    {catalog.error}
                  </p>
                ) : (
                  <p>Connect your ChatGPT plan to start research.</p>
                )}
                <ResearchPlanConnection
                  catalog={catalog}
                  disabled={busy}
                  connected={
                    !!catalog.status?.accounts.some((item) => item.signed_in && item.active)
                  }
                />
              </div>
            ) : !ready && !pending ? (
              <p className={styles.notice} role="alert">
                Research settings · {problem}
              </p>
            ) : null}
            {pending && !busy && (
              <div className={styles.recovery}>
                <p role="status">
                  {unconfirmed === pending.id
                    ? "This request has no saved session yet."
                    : "Checking whether the session started."}{" "}
                  {pending.start_from_sources
                    ? "A retry uses the same sources and request ID."
                    : "Use Edit setup to choose sources for a new first reading."}
                </p>
                <button
                  className="text-link"
                  type="button"
                  onClick={() => {
                    setUnconfirmed(undefined);
                    setCheck((n) => n + 1);
                  }}
                >
                  Check session
                </button>
                {unconfirmed === pending.id && (
                  <button
                    className="text-link"
                    type="button"
                    onClick={() => {
                      setPending(null);
                      setUnconfirmed(undefined);
                      setStartError("");
                    }}
                  >
                    Edit setup
                  </button>
                )}
              </div>
            )}
            {(account || model) && (
              <div className={styles.account}>
                {account && (
                  <button
                    className={styles.accountButton}
                    type="button"
                    aria-expanded={manageConnection}
                    onClick={() => setManageConnection(!manageConnection)}
                  >
                    ChatGPT plan · {account.label}
                  </button>
                )}
                <dl className={styles.launchSettings}>
                  {firstReadingLabel && (
                    <div>
                      <dt>First-reading model</dt>
                      <dd>
                        {firstReadingLabel}
                        {!catalog.loading && (
                          <span className={styles.launchProfile}>
                            {modelSettingLabel(firstReading.reasoning_effort)} effort ·{" "}
                            {modelSettingLabel(firstReading.verbosity)} detail
                          </span>
                        )}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Team web search</dt>
                    <dd>{draft.web_search ? "On" : "Off"}</dd>
                  </div>
                </dl>
                <a href="#study-settings">Change research settings</a>
              </div>
            )}
            {account && manageConnection && (
              <ResearchPlanConnection catalog={catalog} connected disabled={busy} />
            )}
          </aside>
        </DiscoverySources>
      </div>
      <form
        id="study-settings"
        className={styles.setup}
        tabIndex={-1}
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
        <fieldset disabled={frozen}>
          <ResearchBriefOptions
            draft={draft}
            model={model}
            catalog={catalog}
            update={update}
            disabled={frozen}
            awaitingModelCatalog={awaitingModelCatalog}
            onReadingSample={setReadingSample}
            reuseSettings={
              !fromSession &&
              !!recentStudies?.length && (
                <StudySettingsReuse
                  studies={recentStudies}
                  disabled={frozen}
                  onApply={reuseSettings}
                />
              )
            }
          />
        </fieldset>
      </form>
      <div ref={launchBar} className={styles.launchBar}>
        {startError && (
          <p id="first-reading-error" className={styles.launchError} role="alert">
            {startError}
          </p>
        )}
        <p id="first-reading-status" role="status">
          {nextStep}
        </p>
        <button
          type="submit"
          form="study-settings"
          className="button primary"
          aria-describedby={
            startError ? "first-reading-status first-reading-error" : "first-reading-status"
          }
          disabled={!canStart}
        >
          {busy
            ? "Starting research…"
            : pending
              ? "Retry start"
              : "Ask the lead for a first reading"}
        </button>
      </div>
    </section>
  );
}
