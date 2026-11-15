"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { api } from "@/lib/workflow";
import { stableRequestId } from "@/lib/evaluations";
import { reportText, type ReportFeedbackCreate, type ReportView } from "@/lib/reports";

export function ReportReview({
  view,
  disabled,
  onRefresh,
}: {
  view: ReportView;
  disabled: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [scope, setScope] = useState("");
  const [kind, setKind] = useState<ReportFeedbackCreate["kind"]>("comment");
  const [value, setValue] = useState<ReportFeedbackCreate["value"]>(null);
  const [reason, setReason] = useState("");
  const [anchor, setAnchor] = useState<ReportFeedbackCreate["anchor"]>(null);
  const [previous, setPrevious] = useState<ReportView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const retry = useRef<{ body: string; id: string } | null>(null);
  const submitting = useRef(false);
  const selection = useRef<HTMLTextAreaElement>(null);
  const record = view.revision;
  const section = record.sections.find((s) => s.id === scope);
  const oldSection = previous?.revision.sections.find((s) => s.id === scope);
  useEffect(() => {
    if (!record.replaces_id) return;
    let active = true;
    api<ReportView>(`reports/${record.replaces_id}`)
      .then((v) => {
        if (active) setPrevious(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [record.replaces_id]);
  const missingComparison = kind === "preference" && (!previous || (scope && !oldSection));
  return (
    <section className="report-review" aria-label="Editorial feedback">
      <h2>Editorial feedback</h2>
      <p>
        Whole-report review: <strong>{view.review_status}</strong>
      </p>
      <p className="field-hint">
        Feedback is tied to saved revision {record.version}. Section decisions stay local to their
        section. Human feedback is not automatically used as training data.
      </p>
      {disabled && (
        <p className="source-notice">
          Save or discard unsaved edits before reviewing this revision.
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (disabled || submitting.current || missingComparison) return;
          submitting.current = true;
          setBusy(true);
          setError("");
          const body = {
            report_hash: record.content_hash,
            section_id: scope || null,
            section_hash: scope ? record.section_hashes[scope] : null,
            anchor,
            kind,
            value,
            reason,
          };
          try {
            await api(`reports/${record.id}/feedback`, {
              ...body,
              id: stableRequestId(retry, body),
            });
            await onRefresh();
            setReason("");
            setAnchor(null);
            retry.current = null;
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Unable to save feedback.");
          } finally {
            submitting.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={disabled || busy}>
          <label>
            Feedback scope
            <select
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setAnchor(null);
              }}
            >
              <option value="">Whole report</option>
              {record.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.heading}
                </option>
              ))}
            </select>
          </label>
          <label>
            Feedback type
            <select
              value={kind}
              onChange={(e) => {
                const k = e.target.value as typeof kind;
                setKind(k);
                setValue(k === "comment" ? null : k === "decision" ? "accept" : "prefer_current");
                setAnchor(null);
              }}
            >
              <option value="comment">Comment</option>
              <option value="decision">Accept or reject</option>
              <option value="preference" disabled={!record.replaces_id}>
                Preference against previous revision
              </option>
            </select>
          </label>
          {kind === "decision" && (
            <label>
              Review decision
              <select
                value={value ?? "accept"}
                onChange={(e) => setValue(e.target.value as typeof value)}
              >
                <option value="accept">Accept</option>
                <option value="reject">Reject</option>
              </select>
            </label>
          )}
          {kind === "preference" && (
            <>
              <label>
                Preferred revision
                <select
                  value={value ?? "prefer_current"}
                  onChange={(e) => setValue(e.target.value as typeof value)}
                >
                  <option value="prefer_current">Current revision</option>
                  <option value="prefer_previous">Previous revision</option>
                  <option value="tie">No preference</option>
                </select>
              </label>
              {missingComparison ? (
                <p className="field-hint">
                  The comparison is loading or this section did not exist in the preceding revision.
                </p>
              ) : (
                <details className="report-comparison" open>
                  <summary>Compare the saved versions</summary>
                  <label>
                    Previous revision text
                    <textarea
                      readOnly
                      rows={8}
                      value={
                        scope
                          ? reportText({ ...previous!.revision, sections: [oldSection!] })
                          : reportText(previous!.revision)
                      }
                    />
                  </label>
                  <label>
                    Current revision text
                    <textarea
                      readOnly
                      rows={8}
                      value={
                        scope ? reportText({ ...record, sections: [section!] }) : reportText(record)
                      }
                    />
                  </label>
                </details>
              )}
            </>
          )}
          {section && kind === "comment" && (
            <>
              <label>
                Select text to anchor this comment
                <textarea readOnly rows={6} value={section.body} ref={selection} />
              </label>
              <Button
                className="button small"
                onClick={() => {
                  const input = selection.current;
                  if (!input || input.selectionStart === input.selectionEnd) {
                    setError("Select text in the saved section first.");
                    return;
                  }
                  setError("");
                  setAnchor({
                    start: Array.from(input.value.slice(0, input.selectionStart)).length,
                    end: Array.from(input.value.slice(0, input.selectionEnd)).length,
                    quote: input.value.slice(input.selectionStart, input.selectionEnd),
                  });
                }}
              >
                Use selected text
              </Button>
              {anchor && (
                <div>
                  <blockquote>{anchor.quote}</blockquote>
                  <p className="field-hint">
                    Characters {anchor.start}–{anchor.end} (Unicode code points)
                  </p>
                  <Button className="button small" onClick={() => setAnchor(null)}>
                    Clear text anchor
                  </Button>
                </div>
              )}
            </>
          )}
          <label>
            Feedback reason
            <textarea
              required
              maxLength={6000}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <Button
          className="button primary"
          type="submit"
          disabled={disabled || busy || !!missingComparison}
        >
          Save editorial feedback
        </Button>
      </form>
      <div className="report-feedback-list">
        {view.feedback.map((f) => (
          <article key={f.id}>
            <strong>
              {f.kind} · {f.value?.replaceAll("_", " ") ?? "comment"}
            </strong>
            <p className="field-hint">
              {f.section_id
                ? record.sections.find((s) => s.id === f.section_id)?.heading
                : "Whole report"}{" "}
              · {new Date(f.created_at).toLocaleString()}
            </p>
            <p className="report-prose">{f.reason}</p>
            {f.anchor && <blockquote>{f.anchor.quote}</blockquote>}
          </article>
        ))}
      </div>
    </section>
  );
}
