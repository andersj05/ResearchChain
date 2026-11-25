"use client";

import { useEffect, useRef, useState } from "react";
import { useOwner } from "./access-context";
import { DiscoverySources } from "./discovery-sources";
import { StudyPacket, packetSize } from "./study-packet";
import type { EvidenceRecord } from "@/lib/evidence";
import { useSourceDetails } from "@/lib/use-evidence-library";
import { useModelCatalog } from "./model-picker";
import { ResearchBriefOptions, ResearchPlanConnection } from "./research-brief-options";
import { ownerStoragePrefix } from "@/lib/access";
import { storeResearchCaptureDraft } from "@/lib/research-capture-draft";
import { sessionModelProblem } from "@/lib/model-settings";
import {
  api,
  admissionTimeout,
  ApiError,
  researchDefaults,
  type CommandReceipt,
} from "@/lib/workflow";
import {
  editableResearchBrief,
  initializeResearchBrief,
  newStudyModelProfiles,
  readResearchBrief,
  sessionUrl,
  storeResearchBrief,
  type ResearchBrief,
  type ResearchSessionSetup,
  type ResearchSessionStart,
} from "@/lib/research-sessions";
import styles from "./research-desk.module.css";

export function ResearchLauncher({ fromSession }: { fromSession: string | null }) {
  const { active, owner } = useOwner();
  const key = `${ownerStoragePrefix(owner)}.research-brief.${fromSession ?? "new"}`;
  const captureKey = `${key}.capture`;
  const [saved] = useState(() => readResearchBrief(key));
  const [form, setForm] = useState(() => initializeResearchBrief(saved, fromSession));
  const { draft, awaitingModelCatalog } = form;
  const [pending, setPending] = useState<ResearchSessionStart | null>(saved?.pending ?? null);
  const [loaded, setLoaded] = useState(Boolean(saved) || !fromSession);
  const [refreshSetup, setRefreshSetup] = useState(0);
  const [check, setCheck] = useState(0);
  const [unconfirmed, setUnconfirmed] = useState<string>();
  const [setupError, setSetupError] = useState("");
  const [startError, setStartError] = useState("");
  const [busy, setBusy] = useState(false);
  const [readingSample, setReadingSample] = useState(false);
  const [editingSource, setEditingSource] = useState(false);
  const [captured, setCaptured] = useState<Map<string, EvidenceRecord>>(() => new Map());
  const details = useSourceDetails(draft.evidence_ids.filter((id) => !captured.has(id)));
  const records = draft.evidence_ids.map((id) => captured.get(id) ?? details.items.get(id));
  const limit = draft.max_input_bytes ?? 8_000_000;
  const size = packetSize(records);
  const packetError =
    size >= limit
      ? "The source content fills the request limit. Unpin files to leave room for the lead’s instructions."
      : records.filter((item) => item?.artifact).length > 64
        ? "The analyst workspace holds 64 source files. Unpin files before starting this study."
        : "";
  const [manageConnection, setManageConnection] = useState(false);
  const inFlight = useRef(false);
  const admitted = useRef(false);
  const mounted = useRef(false);
  const catalog = useModelCatalog(active);
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
    };
  }, []);

  useEffect(() => {
    if (!active || !fromSession || loaded) return;
    let current = true;
    void api<ResearchSessionSetup>(
      `research-sessions/${encodeURIComponent(fromSession)}/setup`,
    ).then(
      (setup) => {
        if (current) {
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
        admitted.current = true;
        storeResearchBrief(key, null);
        storeResearchCaptureDraft(captureKey, null);
        window.location.assign(sessionUrl(pending.id));
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
  }, [active, key, captureKey, busy, pending, check]);

  async function start() {
    if (!canStart || !account || inFlight.current || admitted.current) return;
    const request: ResearchSessionStart = pending ?? {
      ...draft,
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
      if (!mounted.current) return;
      if (receipt.run_id !== request.id)
        throw new Error("The server returned a different session. Check this start request.");
      admitted.current = true;
      storeResearchBrief(key, null);
      storeResearchCaptureDraft(captureKey, null);
      window.location.assign(sessionUrl(receipt.run_id));
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof ApiError && [400, 422].includes(cause.status ?? 0)) setPending(null);
      setStartError(
        cause instanceof Error ? cause.message : "The server has not confirmed the start.",
      );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function update(patch: Partial<ResearchBrief>) {
    if (frozen || inFlight.current) return;
    setForm((previous) => ({ ...previous, draft: { ...previous.draft, ...patch } }));
    setStartError("");
  }

  function pin(source: EvidenceRecord) {
    setCaptured((previous) => new Map(previous).set(source.id, source));
    setForm((previous) =>
      previous.draft.evidence_ids.includes(source.id)
        ? previous
        : {
            ...previous,
            draft: { ...previous.draft, evidence_ids: [...previous.draft.evidence_ids, source.id] },
          },
    );
    setStartError("");
  }

  const count = draft.evidence_ids.length;
  let nextStep = (
    <a href="#packet-heading">
      {count} {count === 1 ? "source" : "sources"} pinned
    </a>
  );
  if (!loaded) nextStep = <>Restoring saved setup…</>;
  else if (pending) nextStep = <a href="#first-reading-setup">Check the start request</a>;
  else if (editingSource) nextStep = <>Pin or clear the material in progress.</>;
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
      <h1 id="research-title">{fromSession ? "Revisit material" : "New study"}</h1>
      <p className={styles.intro}>
        Gather the week’s material. The lead will suggest a sentence for you to investigate.
      </p>
      <nav className={styles.jumps} aria-label="Study sections">
        <a href="#packet-heading">Study packet ({draft.evidence_ids.length})</a>
        <a href="#study-settings">Research settings</a>
      </nav>
      {fromSession && (
        <p className={styles.origin}>
          Starting from a <a href={sessionUrl(fromSession)}>previous study</a>.
        </p>
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
          known={Array.from(captured.values())}
          onPin={pin}
          disabled={frozen}
          onChange={(evidence_ids) => update({ evidence_ids })}
          onEditing={setEditingSource}
        />
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
            retry={details.unresolved.length ? details.retry : undefined}
          />
          <fieldset disabled={frozen}>
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
                connected={!!catalog.status?.accounts.some((item) => item.signed_in && item.active)}
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
              {model && <span>{model}</span>}
            </div>
          )}
          {account && manageConnection && (
            <ResearchPlanConnection catalog={catalog} connected disabled={busy} />
          )}
        </aside>
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
          />
          <label className={styles.web}>
            <input
              type="checkbox"
              checked={draft.web_search}
              onChange={(event) => update({ web_search: event.target.checked })}
            />{" "}
            Allow live web search
          </label>
        </fieldset>
      </form>
      <div className={styles.launchBar}>
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
