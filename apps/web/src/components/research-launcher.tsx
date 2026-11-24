"use client";

import { useEffect, useRef, useState } from "react";
import { useOwner } from "./access-context";
import { DiscoverySources } from "./discovery-sources";
import { useModelCatalog } from "./model-picker";
import { ResearchBriefOptions, ResearchPlanConnection } from "./research-brief-options";
import { ownerStoragePrefix } from "@/lib/access";
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
  const hasMaterial = draft.start_from_sources
    ? draft.evidence_ids.length > 0
    : !!draft.brief.trim();

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
  }, [active, key, busy, pending, check]);

  async function start() {
    if (
      !active ||
      !loaded ||
      inFlight.current ||
      admitted.current ||
      readingSample ||
      editingSource
    )
      return;
    if (
      pending
        ? !account || account.id !== pending.provider_account_id
        : !ready || !account || !hasMaterial
    )
      return;
    const request: ResearchSessionStart = pending ?? {
      ...draft,
      start_from_sources: draft.start_from_sources ?? false,
      id: crypto.randomUUID(),
      model,
      provider_account_id: account!.id,
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

  return (
    <section className={styles.launch} aria-labelledby="research-title">
      <h1 id="research-title">{fromSession ? "Revise research" : "Start research"}</h1>
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
        <p role="status">Loading the previous brief and research settings…</p>
      )}
      <fieldset className={styles.startMode} disabled={frozen || editingSource || readingSample}>
        <legend className="sr-only">Study starting point</legend>
        <label>
          <input
            type="radio"
            name="study-start"
            checked={!draft.start_from_sources}
            onChange={() => update({ start_from_sources: false })}
          />
          Start with a brief
        </label>
        <label>
          <input
            type="radio"
            name="study-start"
            checked={!!draft.start_from_sources}
            onChange={() => update({ start_from_sources: true })}
          />
          Start from sources
        </label>
      </fieldset>
      {draft.start_from_sources && (
        <DiscoverySources
          ids={draft.evidence_ids}
          disabled={frozen}
          onChange={(evidence_ids) => update({ evidence_ids })}
          onEditing={setEditingSource}
        />
      )}
      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
        <fieldset disabled={frozen}>
          <label className={styles.briefLabel} htmlFor="research-brief">
            {draft.start_from_sources ? "Context for the lead (optional)" : "Research brief"}
          </label>
          <textarea
            id="research-brief"
            className={draft.start_from_sources ? styles.shortBrief : styles.brief}
            required={!draft.start_from_sources}
            rows={draft.start_from_sources ? 2 : 6}
            maxLength={10000}
            value={draft.brief}
            placeholder={
              draft.start_from_sources
                ? "What made you save this material?"
                : "What should the team investigate? Describe your question, working view and the report you want."
            }
            onChange={(event) => update({ brief: event.target.value })}
          />
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
            />
            Allow live web search
          </label>
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
        {startError && (
          <p role="alert" className={styles.notice}>
            {startError}
          </p>
        )}
        {pending && !busy && (
          <div className={styles.recovery}>
            <p role="status">
              {unconfirmed === pending.id
                ? "This request has no saved session yet."
                : "Checking whether the session started."}{" "}
              A retry uses the same brief and request ID.
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
        <div className={styles.launchFooter}>
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
          <button
            type="submit"
            className="button primary"
            disabled={
              !active ||
              !loaded ||
              busy ||
              readingSample ||
              editingSource ||
              (pending
                ? catalog.loading || !!catalog.error || account?.id !== pending.provider_account_id
                : !ready || !hasMaterial)
            }
          >
            {busy
              ? "Starting research…"
              : pending
                ? "Retry start"
                : draft.start_from_sources
                  ? "Ask the lead for a first reading"
                  : "Start research"}
          </button>
        </div>
        {account && manageConnection && (
          <ResearchPlanConnection catalog={catalog} connected disabled={busy} />
        )}
      </form>
    </section>
  );
}
