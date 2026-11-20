"use client";

import { useEffect, useRef, useState } from "react";
import { useOwner } from "./access-context";
import { useModelCatalog } from "./model-picker";
import { ResearchBriefOptions, ResearchPlanConnection } from "./research-brief-options";
import { ownerStoragePrefix } from "@/lib/access";
import {
  api,
  admissionTimeout,
  ApiError,
  researchDefaults,
  type CommandReceipt,
} from "@/lib/workflow";
import {
  blankResearchBrief,
  editableResearchBrief,
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
  const [draft, setDraft] = useState<ResearchBrief>(saved?.draft ?? blankResearchBrief);
  const [pending, setPending] = useState<ResearchSessionStart | null>(saved?.pending ?? null);
  const [loaded, setLoaded] = useState(Boolean(saved) || !fromSession);
  const [refreshSetup, setRefreshSetup] = useState(0);
  const [check, setCheck] = useState(0);
  const [unconfirmed, setUnconfirmed] = useState<string>();
  const [setupError, setSetupError] = useState("");
  const [startError, setStartError] = useState("");
  const [busy, setBusy] = useState(false);
  const [readingSample, setReadingSample] = useState(false);
  const [manageConnection, setManageConnection] = useState(false);
  const inFlight = useRef(false);
  const admitted = useRef(false);
  const mounted = useRef(false);
  const catalog = useModelCatalog(active);
  const account = catalog.status?.accounts.find(
    (item) => item.active && item.signed_in && item.plan_enabled,
  );
  const models = catalog.status?.models ?? [];
  const model =
    draft.model ||
    (models.find((item) => item.slug === researchDefaults.model) ?? models[0])?.slug ||
    "";
  const ready =
    !!account && !catalog.loading && !catalog.error && models.some((item) => item.slug === model);
  const frozen = !active || !loaded || busy || !!pending;

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
          setDraft(editableResearchBrief(setup));
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
    if (loaded && !admitted.current) storeResearchBrief(key, { draft, pending });
  }, [key, loaded, draft, pending]);

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
    if (!active || !loaded || inFlight.current || admitted.current || readingSample) return;
    if (
      pending
        ? !account || account.id !== pending.provider_account_id
        : !ready || !account || !draft.brief.trim()
    )
      return;
    const request: ResearchSessionStart = pending ?? {
      ...draft,
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
    setDraft(exact);
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
    setDraft((previous) => ({ ...previous, ...patch }));
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
      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
        <fieldset disabled={frozen}>
          <label className={styles.briefLabel} htmlFor="research-brief">
            Research brief
          </label>
          <textarea
            id="research-brief"
            className={styles.brief}
            required
            rows={6}
            maxLength={10000}
            value={draft.brief}
            placeholder="What should the team investigate? Describe your question, working view and the report you want."
            onChange={(event) => update({ brief: event.target.value })}
          />
          <ResearchBriefOptions
            draft={draft}
            model={model}
            catalog={catalog}
            update={update}
            disabled={frozen}
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
        ) : !ready ? (
          <p className={styles.notice} role="alert">
            Choose an available model in Research settings.
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
              (pending
                ? catalog.loading || !!catalog.error || account?.id !== pending.provider_account_id
                : !ready || !draft.brief.trim())
            }
          >
            {busy ? "Starting research…" : pending ? "Retry start" : "Start research"}
          </button>
        </div>
        {account && manageConnection && (
          <ResearchPlanConnection catalog={catalog} connected disabled={busy} />
        )}
      </form>
    </section>
  );
}
