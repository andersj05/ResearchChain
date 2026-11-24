"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/workflow";
import {
  evidenceUrl,
  rightsLabels,
  uploadOriginal,
  type EvidenceCreate,
  type EvidenceRecord,
} from "@/lib/evidence";
import { useSourceDetails } from "@/lib/use-evidence-library";
import { EvidencePicker } from "./evidence-picker";
import styles from "./research-desk.module.css";

const kindLabels = { image: "Chart", text: "Note", discussion: "Conversation" } as const;
type Kind = keyof typeof kindLabels;

function CaptureMaterial({
  kind,
  disabled,
  onPin,
  onCancel,
}: {
  kind: Kind;
  disabled: boolean;
  onPin: (record: EvidenceRecord) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState<NonNullable<EvidenceCreate["rights"]>>("unknown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const identity = useRef("");
  const saving = useRef(false);
  async function save() {
    if (saving.current || disabled) return;
    saving.current = true;
    setBusy(true);
    setError("");
    identity.current ||= crypto.randomUUID();
    try {
      const artifact = file ? await uploadOriginal(file, rights) : null;
      const record = await api<EvidenceRecord>("evidence", {
        id: identity.current,
        title: title.trim(),
        kind,
        author,
        rights,
        as_of_date: date || null,
        representation: kind === "image" ? "chart_screenshot" : "original",
        artifact_id: artifact?.id ?? null,
        text: kind === "image" ? "" : text,
      } satisfies EvidenceCreate);
      onPin(record);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not pin this material.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className={styles.capture}
      aria-label={`Add ${kindLabels[kind].toLowerCase()}`}
      onChange={() => {
        identity.current = "";
        setError("");
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={disabled || busy}>
        <legend>{kindLabels[kind]}</legend>
        {kind === "image" && (
          <label>
            Chart file
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              required
              onChange={(event) => {
                const chosen = event.target.files?.[0] ?? null;
                if (!title || title === file?.name.slice(0, 240))
                  setTitle(chosen?.name.slice(0, 240) ?? "");
                setFile(chosen);
              }}
            />
          </label>
        )}
        <label>
          Source title
          <input
            required
            maxLength={240}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {kind !== "image" && (
          <label>
            {kind === "discussion" ? "Conversation excerpt" : "Note text"}
            <textarea
              required
              rows={3}
              maxLength={200000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        )}
        <div className={styles.captureFields}>
          <label>
            As of
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            {kind === "discussion" ? "Speaker or desk" : "Author or source"}
            <input maxLength={240} value={author} onChange={(e) => setAuthor(e.target.value)} />
          </label>
          <label>
            Usage rights
            <select
              value={rights}
              required
              onChange={(e) => setRights(e.target.value as typeof rights)}
            >
              <option value="unknown" disabled>
                Select rights
              </option>
              {(["owned", "permission", "open_license", "public_domain"] as const).map((value) => (
                <option key={value} value={value}>
                  {rightsLabels[value]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className={styles.materialActions}>
          <button
            type="submit"
            className="button primary"
            disabled={
              rights === "unknown" || !title.trim() || (kind === "image" ? !file : !text.trim())
            }
          >
            {busy ? "Pinning…" : `Pin ${kindLabels[kind].toLowerCase()}`}
          </button>
          <button className="text-link" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function DiscoverySources({
  ids,
  disabled,
  onChange,
  onEditing,
}: {
  ids: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
  onEditing: (editing: boolean) => void;
}) {
  const [kind, setKind] = useState<Kind>();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const sources = useSourceDetails(ids);
  const triggers = useRef<Partial<Record<Kind, HTMLButtonElement | null>>>({});
  function close() {
    setKind(undefined);
    onEditing(false);
    if (kind) requestAnimationFrame(() => triggers.current[kind]?.focus());
  }
  return (
    <section className={styles.packet} aria-labelledby="packet-title">
      <h2 id="packet-title">This week’s material</h2>
      <p className="field-hint">
        Pin what caught your attention. The lead will bring back a question before anyone starts an
        assignment.
      </p>
      {ids.length > 0 && (
        <ul className={styles.pinnedList} aria-label="Pinned material">
          {ids.map((id) => {
            const item = sources.items.get(id);
            return (
              <li key={id}>
                <div>
                  <a href={evidenceUrl(id)} target="_blank" rel="noopener">
                    {item?.title ?? `Source ${id.slice(0, 8)}`}
                  </a>
                  {item && (
                    <small>
                      {[
                        kindLabels[item.kind as Kind] ?? item.kind,
                        item.as_of_date,
                        item.author || item.publisher,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  )}
                </div>
                <button
                  className="text-link"
                  type="button"
                  disabled={disabled || !!kind}
                  onClick={() => onChange(ids.filter((other) => other !== id))}
                  aria-label={`Unpin ${item?.title ?? "source"}`}
                >
                  Unpin
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!!sources.unresolved.length && (
        <button type="button" className="text-link" onClick={sources.retry}>
          Retry source details
        </button>
      )}
      <div className={styles.materialActions}>
        {(Object.keys(kindLabels) as Kind[]).map((value) => (
          <button
            key={value}
            type="button"
            className="button small"
            ref={(el) => {
              triggers.current[value] = el;
            }}
            disabled={disabled || !!kind || ids.length >= 100}
            onClick={() => {
              setKind(value);
              onEditing(true);
              setLibraryOpen(false);
            }}
          >
            Add {kindLabels[value].toLowerCase()}
          </button>
        ))}
        <button
          type="button"
          className="text-link"
          aria-expanded={libraryOpen}
          disabled={disabled || !!kind}
          onClick={() => setLibraryOpen(!libraryOpen)}
        >
          Choose saved sources
        </button>
      </div>
      {kind && (
        <CaptureMaterial
          key={kind}
          kind={kind}
          disabled={disabled}
          onCancel={close}
          onPin={(item) => {
            if (!ids.includes(item.id)) onChange([...ids, item.id]);
            close();
          }}
        />
      )}
      {libraryOpen && (
        <EvidencePicker
          label="Saved sources"
          selected={ids}
          onChange={onChange}
          disabled={disabled}
        />
      )}
    </section>
  );
}
