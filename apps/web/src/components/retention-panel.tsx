"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import type { components } from "@researchchain/contracts";
import { useOwner } from "@/components/access-context";
import { api, ApiError } from "@/lib/workflow";

type Request = components["schemas"]["RetentionRequest"];
type Preview = components["schemas"]["RetentionPreview"];
type Receipt = components["schemas"]["RetentionReceipt"];
type View = components["schemas"]["RetentionView"];
type Saved = { request: Request; applying: boolean };

function bytes(value: number) {
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KiB`;
}

export function RetentionPanel() {
  const { owner } = useOwner();
  const identity = `researchchain.owner.${owner.workspace_id}.${owner.owner_id}.retention`;
  return <Cleanup key={identity} storageKey={identity} />;
}

function Cleanup({ storageKey }: { storageKey: string }) {
  const { active } = useOwner();
  const [days, setDays] = useState(30);
  const [limit, setLimit] = useState(5);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [history, setHistory] = useState<Receipt[] | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);

  useEffect(() => {
    let current = true;
    if (!active) return;
    async function restore() {
      setBusy(true);
      try {
        const text = localStorage.getItem(storageKey);
        if (!text) return;
        const value = JSON.parse(text) as Saved;
        if (!value.request || !/^[0-9a-f-]{36}$/.test(value.request.id)) {
          throw new Error("The saved cleanup request is invalid. Start a new preview.");
        }
        if (current) {
          setSaved(value);
          setDays(value.request.older_than_days ?? 30);
          setLimit(value.request.max_runs ?? 5);
        }
        const found = await api<View>(`retention/previews/${value.request.id}`);
        if (current) {
          setPreview(found.preview);
          setReceipt(found.receipt ?? null);
          setNotice(
            found.receipt
              ? ""
              : value.applying
                ? "No completed receipt is available yet. Check the result before confirming again."
                : "Saved preview restored. Review it before confirming.",
          );
        }
      } catch (caught) {
        if (current)
          setError(
            caught instanceof ApiError && caught.status === 404
              ? "The preview was not saved. Retry the same preview request."
              : caught instanceof Error
                ? caught.message
                : "Could not restore cleanup.",
          );
      } finally {
        if (current) setBusy(false);
      }
    }
    void restore();
    return () => {
      current = false;
    };
  }, [active, storageKey]);

  function persist(value: Saved | null) {
    try {
      if (value) localStorage.setItem(storageKey, JSON.stringify(value));
      else localStorage.removeItem(storageKey);
      setSaved(value);
      return true;
    } catch {
      setError(
        "Browser storage is unavailable. Cleanup needs a saved request ID so it can recover safely.",
      );
      return false;
    }
  }

  async function action(work: () => Promise<void>) {
    if (!active || inFlight.current || busy) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Cleanup is unavailable.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function create() {
    await action(async () => {
      const value = saved ?? {
        request: {
          id: crypto.randomUUID(),
          older_than_days: days,
          max_runs: limit,
        },
        applying: false,
      };
      if (!persist(value)) return;
      setNotice("");
      const result = await api<Preview>("retention/previews", value.request, 60000);
      setPreview(result);
      setReceipt(null);
      setConfirmation("");
    });
  }

  async function check() {
    if (!saved) return;
    await action(async () => {
      const result = await api<View>(`retention/previews/${saved.request.id}`);
      setPreview(result.preview);
      setReceipt(result.receipt ?? null);
      setNotice(
        result.receipt
          ? ""
          : "No completed cleanup receipt is available. Nothing is resubmitted by this check.",
      );
    });
  }

  async function confirm() {
    if (!preview || !saved || confirmation !== "DELETE" || receipt) return;
    await action(async () => {
      if (!persist({ ...saved, applying: true })) return;
      setNotice("");
      try {
        const result = await api<Receipt>(
          `retention/previews/${preview.id}/apply`,
          {
            digest: preview.digest,
            confirmation: "DELETE",
          },
          60000,
        );
        setReceipt(result);
        setConfirmation("");
      } catch (caught) {
        if (caught instanceof ApiError && [409, 410, 422].includes(caught.status ?? 0)) {
          persist({ ...saved, applying: false });
          setConfirmation("");
        } else {
          setNotice(
            "The result is not confirmed. Use Check cleanup result; a refresh will never repeat deletion.",
          );
        }
        throw caught;
      }
    });
  }

  function reset() {
    if (!active || busy || (saved?.applying && !receipt) || !persist(null)) return;
    setPreview(null);
    setReceipt(null);
    setConfirmation("");
    setError("");
    setNotice("");
  }

  return (
    <section className="retention-panel operations-card" aria-labelledby="cleanup-title">
      <div className="retention-heading">
        <div>
          <h2 id="cleanup-title">Run cleanup</h2>
          <p>
            Keep research by default. Preview old terminal runs before permanently deleting their
            history.
          </p>
        </div>
        <Button
          className="button secondary"
          disabled={busy || !active}
          onClick={() =>
            action(async () => {
              setHistory(await api<Receipt[]>("retention/receipts"));
            })
          }
        >
          View cleanup receipts
        </Button>
      </div>
      <p>
        Evidence, reports, evaluations, workflow revisions and referenced originals stay. Paused
        reviews, unfinished work and uncertain model outcomes are protected. Unrelated uploads,
        exports and backups are retained.
      </p>
      {error && (
        <p className="operations-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="retention-notice" role="status">
          {notice}
        </p>
      )}
      {busy && <p role="status">Checking cleanup…</p>}
      {!preview && (
        <div className="retention-controls">
          <label>
            Runs created before
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              disabled={busy || !active || !!saved}
            >
              <option value={30}>30 days ago</option>
              <option value={7}>7 days ago</option>
              <option value={90}>90 days ago</option>
              <option value={365}>1 year ago</option>
              <option value={0}>Now — all creation dates</option>
            </select>
          </label>
          <label>
            Maximum runs
            <select
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
              disabled={busy || !active || !!saved}
            >
              <option value={1}>1</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
            </select>
          </label>
          <Button className="button secondary" disabled={busy || !active} onClick={create}>
            {saved ? "Retry preview" : "Preview cleanup"}
          </Button>
        </div>
      )}
      {preview && !receipt && (
        <div className="retention-review">
          <h3>Review cleanup</h3>
          <p>
            Runs created before {new Date(preview.cutoff).toLocaleString()}. Preview expires{" "}
            {new Date(preview.expires_at).toLocaleString()}.
          </p>
          <p className="retention-total">
            {preview.runs.length} runs and {preview.originals.length} originals (
            {bytes(preview.original_bytes)}) selected for permanent deletion.{" "}
            {preview.retained_originals} referenced originals will stay.
          </p>
          {preview.runs.length > 0 ? (
            <>
              <ul className="retention-runs" aria-label="Selected runs">
                {preview.runs.map((run) => (
                  <li key={run.run_id}>
                    <a href={`/?run=${run.run_id}`} target="_blank" rel="noreferrer">
                      <code>{run.run_id}</code> — Open run
                    </a>
                    <span>
                      {run.status} · Created {new Date(run.created_at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
              <p>
                Deletion includes the selected runs’ checkpoints, decisions, attempts and execution
                history. Storage files may not shrink immediately.
              </p>
              {preview.originals.length > 0 && (
                <details>
                  <summary>Originals to delete ({preview.originals.length})</summary>
                  <ul className="retention-originals">
                    {preview.originals.map((item) => (
                      <li key={item.artifact_id}>
                        <code>{item.artifact_id}</code> · {bytes(item.byte_size)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <label className="retention-confirm">
                Type DELETE to confirm this selection
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy || !active}
                />
              </label>
              <Button
                className="button danger"
                disabled={busy || !active || confirmation !== "DELETE"}
                onClick={confirm}
              >
                Permanently delete selected runs
              </Button>
            </>
          ) : (
            <p>No eligible runs match this preview. Nothing will be deleted.</p>
          )}
          {preview.more_eligible > 0 && (
            <p>{preview.more_eligible} additional eligible runs are outside this batch.</p>
          )}
          {Object.keys(preview.protected_runs).length > 0 && (
            <div className="retention-protected">
              <h3>Protected runs</h3>
              <ul>
                {Object.entries(preview.protected_runs).map(([reason, count]) => (
                  <li key={reason}>
                    {reason}: {count}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {receipt && (
        <div className="retention-receipt" role="status">
          <h3>Cleanup complete</h3>
          <p>
            Deleted {receipt.run_ids.length} runs and {receipt.original_ids.length} originals (
            {bytes(receipt.original_bytes)}) on {new Date(receipt.applied_at).toLocaleString()}.
          </p>
          <p>
            Receipt <code>{receipt.preview_id}</code>. Retrying this confirmation returns this same
            receipt.
          </p>
        </div>
      )}
      {saved && (
        <div className="retention-actions">
          <Button className="button secondary" disabled={busy || !active} onClick={check}>
            Check cleanup result
          </Button>
          {(!saved.applying || receipt) && (
            <Button className="button secondary" disabled={busy || !active} onClick={reset}>
              {receipt ? "Start another preview" : "Discard preview"}
            </Button>
          )}
        </div>
      )}
      {history && (
        <div className="retention-history">
          <h3>Recent cleanup receipts</h3>
          {history.length === 0 ? (
            <p>No cleanup has completed.</p>
          ) : (
            <ul>
              {history.map((item) => (
                <li key={item.preview_id}>
                  {new Date(item.applied_at).toLocaleString()}: {item.run_ids.length} runs,{" "}
                  {item.original_ids.length} originals — <code>{item.preview_id}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
