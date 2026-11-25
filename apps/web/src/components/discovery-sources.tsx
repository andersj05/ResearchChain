"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/workflow";
import {
  rightsLabels,
  type EvidenceCreate,
  type EvidenceInput,
  type EvidenceRecord,
} from "@/lib/evidence";
import { EvidencePicker } from "./evidence-picker";
import { SourceFileBatch, type Attribution } from "./source-file-batch";
import styles from "./source-intake.module.css";

export function DiscoverySources({
  ids,
  known,
  disabled,
  onChange,
  onPin,
  onEditing,
}: {
  ids: string[];
  known: EvidenceRecord[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
  onPin: (item: EvidenceRecord) => void;
  onEditing: (value: boolean) => void;
}) {
  const [rights, setRights] = useState<NonNullable<EvidenceCreate["rights"]>>("unknown");
  const [author, setAuthor] = useState("");
  const [date, setDate] = useState("");
  const [kind, setKind] = useState<"text" | "discussion" | "link">("text");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [filePending, setFilePending] = useState(false);
  const [saving, setSaving] = useState(false);
  const rightsSelect = useRef<HTMLSelectElement>(null);
  const writing = useRef(false);
  const command = useRef<EvidenceInput | null>(null);
  const touched = !!(title || body || url);
  const locked = disabled || saving;
  const attribution: Attribution = { author: author.trim(), as_of_date: date || null, rights };
  const label = kind === "link" ? "link" : kind === "discussion" ? "conversation" : "note";
  const needsRights = kind !== "link" && rights === "unknown";
  const canPinText = !!(kind === "link" ? url.trim() : body.trim()) && !needsRights;

  function changeText(nextTitle: string, nextBody: string, nextUrl: string) {
    setTitle(nextTitle);
    setBody(nextBody);
    setUrl(nextUrl);
    setError("");
    command.current = null;
    onEditing(!!(nextTitle || nextBody || nextUrl) || filePending);
  }
  async function pinText() {
    if (locked || writing.current || ids.length >= 100 || !canPinText) return;
    writing.current = true;
    setSaving(true);
    setError("");
    try {
      command.current ??= {
        ...attribution,
        kind,
        id: crypto.randomUUID(),
        title:
          title.trim() ||
          (kind === "link" ? new URL(url).hostname : body.trim().split("\n")[0]!.slice(0, 120)),
        ...(kind === "link"
          ? { availability: "reference_only", source_url: url.trim() }
          : { text: body }),
      };
      const item = await api<EvidenceRecord>("evidence", command.current);
      onPin(item);
      changeText("", "", "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not pin this source.");
    } finally {
      writing.current = false;
      setSaving(false);
    }
  }
  return (
    <div className={styles.intake}>
      <section className={styles.panel} aria-labelledby="intake-heading">
        <h2 id="intake-heading">Add material</h2>
        <fieldset
          disabled={locked}
          className={styles.provenance}
          onChange={() => {
            command.current = null;
          }}
        >
          <legend>Source details</legend>
          <p id="desk-capture-details" className={styles.provenanceHint}>
            Applies to files and pasted sources. Files, notes and conversations require usage
            rights.
          </p>
          <label>
            Usage rights
            <select
              ref={rightsSelect}
              value={rights}
              aria-describedby="desk-capture-details"
              onChange={(e) => setRights(e.target.value as typeof rights)}
            >
              <option value="unknown">Select rights</option>
              {(["owned", "permission", "open_license", "public_domain"] as const).map((r) => (
                <option key={r} value={r}>
                  {rightsLabels[r]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Author or speaker
            <input
              maxLength={240}
              placeholder="Optional"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </label>
          <label>
            As of
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </fieldset>
        <SourceFileBatch
          count={ids.length}
          disabled={locked}
          attribution={attribution}
          onPin={onPin}
          onSaving={setSaving}
          onPending={(pending) => {
            setFilePending(pending);
            onEditing(pending || touched);
          }}
        />
        <form
          aria-label="Paste a source"
          className={styles.paste}
          onSubmit={(event) => {
            event.preventDefault();
            void pinText();
          }}
        >
          <fieldset disabled={locked || ids.length >= 100}>
            <legend>Paste a source</legend>
            <div className={styles.kinds} role="group" aria-label="Pasted source type">
              {(["text", "discussion", "link"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={kind === value}
                  disabled={value === "link" ? !!body : !!url}
                  onClick={() => {
                    setKind(value);
                    setError("");
                    command.current = null;
                  }}
                >
                  {value === "text" ? "Note" : value === "discussion" ? "Conversation" : "Link"}
                </button>
              ))}
            </div>
            <label className={styles.textLabel}>
              Source title <span>(optional)</span>
              <input
                maxLength={240}
                value={title}
                placeholder="Name this source"
                onChange={(e) => changeText(e.target.value, body, url)}
              />
            </label>
            {kind === "link" ? (
              <label>
                Original URL
                <input
                  type="url"
                  required
                  pattern="https?://.+"
                  maxLength={2000}
                  value={url}
                  placeholder="https://"
                  onChange={(e) => changeText(title, body, e.target.value)}
                />
              </label>
            ) : (
              <label>
                {kind === "discussion" ? "Conversation excerpt" : "Note text"}
                <textarea
                  rows={3}
                  required
                  maxLength={200000}
                  value={body}
                  placeholder={
                    kind === "discussion"
                      ? "Paste the exchange that caught your attention…"
                      : "Paste an observation from the week…"
                  }
                  onChange={(e) => changeText(title, e.target.value, url)}
                />
              </label>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className={styles.actions}>
              <button className="button" type="submit" disabled={!canPinText}>
                Pin {label}
              </button>
              {touched && (
                <button className="text-link" type="button" onClick={() => changeText("", "", "")}>
                  Clear entry
                </button>
              )}
              {kind === "link" && <small>Stores the URL as a reference.</small>}
              {needsRights && !!body.trim() && (
                <small>
                  <button
                    className="text-link"
                    type="button"
                    onClick={() => rightsSelect.current?.focus()}
                  >
                    Select usage rights
                  </button>{" "}
                  to pin this {label}.
                </small>
              )}
            </div>
          </fieldset>
        </form>
      </section>
      <section className={styles.panel} aria-label="Source library">
        <EvidencePicker
          label="Saved sources"
          selected={ids}
          onChange={onChange}
          onAdd={onPin}
          attachedCharts={known}
          showSelected={false}
          disabled={locked || filePending}
        />
      </section>
    </div>
  );
}
