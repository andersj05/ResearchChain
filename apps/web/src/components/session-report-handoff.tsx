import { useRef, useState } from "react";
import { api, type RunSnapshot } from "@/lib/workflow";
import { useOwner } from "./access-context";
import styles from "./research-session.module.css";

type ReportRequest = NonNullable<RunSnapshot["owner_report_request"]>;

export function SessionReportHandoff({
  run,
  onRequested,
  onRefresh,
}: {
  run: RunSnapshot;
  onRequested: (request: ReportRequest) => void;
  onRefresh: () => void;
}) {
  const { active } = useOwner();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  const sending = useRef(false);
  if (run.owner_report_request) {
    return (
      <details className={styles.guidance}>
        <summary>Report requested</summary>
        <div className={styles.guidanceBody}>
          <p>The report editor will use the findings confirmed at the handoff.</p>
          {run.owner_report_request.text && <p>{run.owner_report_request.text}</p>}
        </div>
      </details>
    );
  }
  if (!run.can_request_report && !error) return null;

  async function writeReport() {
    if (!run.can_request_report || !active || sending.current) return;
    const id = requestId.current ?? crypto.randomUUID();
    requestId.current = id;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt = await api<ReportRequest>(`research-sessions/${run.id}/write-report`, {
        id,
        text: text.trim(),
      });
      onRequested(receipt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The handoff could not be confirmed.");
      onRefresh();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <details className={styles.guidance}>
      <summary>Write report now</summary>
      <form
        className={styles.guidanceBody}
        onSubmit={(event) => {
          event.preventDefault();
          void writeReport();
        }}
      >
        <p>
          Requests already admitted can finish. The editor then receives the confirmed findings.
        </p>
        <label htmlFor="owner-report-notes">Notes for the editor (optional)</label>
        <textarea
          id="owner-report-notes"
          rows={3}
          maxLength={3000}
          disabled={busy || !active || !run.can_request_report}
          value={text}
          onChange={(event) => {
            requestId.current = null;
            setError("");
            setText(event.target.value);
          }}
        />
        <button
          className="button"
          type="submit"
          disabled={busy || !active || !run.can_request_report}
        >
          {busy ? "Sending findings…" : "Send findings to editor"}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}
