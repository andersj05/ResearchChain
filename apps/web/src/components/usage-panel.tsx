"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { Input } from "@ui-sdk/react/input";
import type { components } from "@researchchain/contracts";
import { useOwner } from "@/components/access-context";
import { api, ApiError } from "@/lib/workflow";

type Snapshot = components["schemas"]["UsageSnapshot"];
type Draft = { revision: number; maximum: string; paused: boolean; dirty: boolean };

function savedDraft(value: Snapshot): Draft {
  return {
    revision: value.policy.revision,
    maximum: String(value.policy.max_requests_24h),
    paused: value.policy.paused,
    dirty: false,
  };
}

export function UsagePanel() {
  const { owner } = useOwner();
  return <Allowance key={`${owner.workspace_id}.${owner.owner_id}`} />;
}

function Allowance() {
  const { active } = useOwner();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const epoch = useRef(0);
  const mutating = useRef(false);

  useEffect(() => {
    const request = ++epoch.current;
    let current = true;
    if (!active || mutating.current) return;
    async function read() {
      setBusy(true);
      try {
        const value = await api<Snapshot>("usage");
        if (current && request === epoch.current) {
          setSnapshot(value);
          setDraft((previous) => (previous?.dirty ? previous : savedDraft(value)));
          setUncertain(false);
          setError("");
        }
      } catch {
        if (current && request === epoch.current) {
          setError("Request allowance is unavailable. Refresh before changing limits.");
          setUncertain(true);
        }
      } finally {
        if (current && request === epoch.current) setBusy(false);
      }
    }
    void read();
    return () => {
      current = false;
    };
  }, [active, refresh]);

  const changedElsewhere = Boolean(
    snapshot && draft && draft.revision !== snapshot.policy.revision,
  );
  const maximum = Number(draft?.maximum);
  const valid = Number.isInteger(maximum) && maximum >= 1 && maximum <= 10000;

  async function save() {
    if (!active || busy || mutating.current || uncertain || changedElsewhere || !draft || !valid)
      return;
    const request = ++epoch.current;
    mutating.current = true;
    setSaving(true);
    setBusy(true);
    setUncertain(true);
    setError("");
    setNotice("");
    try {
      const value = await api<Snapshot>("usage/policy", {
        expected_revision: draft.revision,
        max_requests_24h: maximum,
        paused: draft.paused,
      });
      if (request === epoch.current) {
        setSnapshot(value);
        setDraft(savedDraft(value));
        setUncertain(false);
        setNotice(value.policy.paused ? "New model requests are paused." : "Request limits saved.");
      }
    } catch (caught) {
      if (request === epoch.current) {
        setError(
          caught instanceof ApiError && caught.status === 409
            ? "Request limits changed elsewhere. Refresh the allowance and review the saved limits."
            : "The save could not be confirmed. Refresh the allowance to check the result before saving again.",
        );
      }
    } finally {
      mutating.current = false;
      setSaving(false);
      if (request === epoch.current) setBusy(false);
      else setRefresh((value) => value + 1);
    }
  }

  return (
    <section className="operations-card request-allowance" aria-labelledby="allowance-title">
      <div className="allowance-heading">
        <h2 id="allowance-title">Request allowance</h2>
        <Button
          className="button secondary"
          disabled={!active || busy}
          onClick={() => {
            setNotice("");
            setRefresh((value) => value + 1);
          }}
        >
          Refresh allowance
        </Button>
      </div>
      <p>
        A shared limit for research and connection tests in this workspace. Requests are counted
        before they start, including requests that later fail.
      </p>
      {snapshot && (
        <>
          <p className="operations-observed">
            Checked {new Date(snapshot.observed_at).toLocaleString()}.
            {error && " The previous snapshot is still shown."}
          </p>
          <dl>
            <div>
              <dt>Admitted in the last 24 hours</dt>
              <dd>{snapshot.admitted_requests_24h.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Limit per 24 hours</dt>
              <dd>{snapshot.policy.max_requests_24h.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Unused slots</dt>
              <dd>{snapshot.remaining_requests.toLocaleString()}</dd>
            </div>
            <div>
              <dt>New requests</dt>
              <dd>
                {snapshot.policy.paused
                  ? "Paused"
                  : snapshot.remaining_requests === 0
                    ? "Allowance reached"
                    : "Allowed"}
              </dd>
            </div>
          </dl>
          {snapshot.next_slot_at && !snapshot.policy.paused && (
            <p>
              At this limit, a slot is expected after{" "}
              {new Date(snapshot.next_slot_at).toLocaleString()}. Refresh to check current usage.
            </p>
          )}
        </>
      )}
      {error && (
        <p className="operations-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="allowance-notice" role="status">
          {notice}
        </p>
      )}
      {changedElsewhere && (
        <p className="operations-error">
          Saved limits changed while you were editing. Load them before making another change.
        </p>
      )}
      {draft && (
        <form
          className="allowance-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="allowance-maximum">
            Requests per 24 hours
            <Input
              type="number"
              min={1}
              max={10000}
              step={1}
              required
              value={draft.maximum}
              disabled={!active || busy}
              onValueChange={(value) =>
                setDraft((current) => current && { ...current, maximum: value, dirty: true })
              }
            />
          </label>
          <label className="allowance-pause">
            <input
              type="checkbox"
              checked={draft.paused}
              disabled={!active || busy}
              onChange={(event) => {
                const paused = event.target.checked;
                setDraft((current) => current && { ...current, paused, dirty: true });
              }}
            />
            Pause new model requests
          </label>
          <div className="allowance-actions">
            <Button
              type="submit"
              className="button"
              disabled={!active || busy || uncertain || changedElsewhere || !valid || !draft.dirty}
            >
              {saving ? "Saving…" : "Save request limits"}
            </Button>
            <Button
              className="button secondary"
              disabled={!active || busy || !snapshot || uncertain}
              onClick={() => {
                if (snapshot) {
                  setDraft(savedDraft(snapshot));
                  setNotice("Saved limits loaded.");
                }
              }}
            >
              Load saved limits
            </Button>
          </div>
        </form>
      )}
      {!snapshot && busy && <p role="status">Loading request allowance…</p>}
      <p>
        Pausing prevents later requests; it does not stop work already admitted. Run cleanup does
        not reset the count. This is a request limit, not a token or billing cap.
      </p>
    </section>
  );
}
