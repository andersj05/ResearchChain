"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/workflow";
import { rightsLabels, type EvidenceInput, type EvidenceRecord } from "@/lib/evidence";
import {
  captureRights,
  readResearchCaptureDraft,
  storeResearchCaptureDraft,
  type ResearchCaptureDraft,
} from "@/lib/research-capture-draft";
import { EvidencePicker } from "./evidence-picker";
import { SourceChartDialog, type ChartPreviewSource } from "./source-chart-dialog";
import { SourceFileBatch, type Attribution } from "./source-file-batch";
import styles from "./source-intake.module.css";

type SavedChart = ChartPreviewSource & { source: EvidenceRecord };
const chartMediaTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

function savedChart(source: EvidenceRecord): SavedChart | null {
  const artifact = source.artifact;
  if (
    source.kind !== "image" ||
    (source.availability ?? "available") !== "available" ||
    !artifact ||
    !/^sha256:[a-f0-9]{64}$/u.test(artifact.id) ||
    !chartMediaTypes.has(artifact.media_type)
  )
    return null;
  return {
    id: source.id,
    title: source.title,
    artifactId: artifact.id,
    attribution: [
      source.author || source.publisher,
      source.as_of_date
        ? `As of ${source.as_of_date}`
        : source.published_date && `Published ${source.published_date}`,
    ]
      .filter(Boolean)
      .join(" · "),
    source,
  };
}

export function DiscoverySources({
  storageKey,
  ids,
  known,
  disabled,
  children,
  onChange,
  onPin,
  onEditing,
}: {
  storageKey: string;
  ids: string[];
  known: EvidenceRecord[];
  disabled: boolean;
  children: ReactNode;
  onChange: (ids: string[]) => void;
  onPin: (item: EvidenceRecord) => void;
  onEditing: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => readResearchCaptureDraft(storageKey));
  const { kind, title, body, url, rights, author, date, command } = draft;
  const [error, setError] = useState("");
  const [filePending, setFilePending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ charts: SavedChart[]; id: string }>();
  const previewOpener = useRef<HTMLButtonElement>(null);
  const rightsSelect = useRef<HTMLSelectElement>(null);
  const writing = useRef(false);
  const touched = !!(title || body || url);
  const editing = touched || filePending;
  const locked = disabled || saving;
  const packetFull = ids.length >= 100;
  const viewedChart = preview?.charts.find((chart) => chart.id === preview.id)?.source;
  const chartPinned = !!viewedChart && ids.includes(viewedChart.id);
  const attribution: Attribution = { author: author.trim(), as_of_date: date || null, rights };
  const label = kind === "link" ? "link" : kind === "discussion" ? "conversation" : "note";
  const needsRights = kind !== "link" && rights === "unknown";
  const canPinText = !!(kind === "link" ? url.trim() : body.trim()) && !needsRights;

  useLayoutEffect(() => {
    onEditing(editing);
  }, [editing, onEditing]);

  useEffect(() => {
    storeResearchCaptureDraft(storageKey, draft);
  }, [draft, storageKey]);

  function changeDraft(patch: Partial<Omit<ResearchCaptureDraft, "command">>) {
    setDraft((current) => ({ ...current, ...patch, command: null }));
    setError("");
  }
  async function pinText() {
    if (locked || writing.current || packetFull || !canPinText) return;
    writing.current = true;
    setSaving(true);
    setError("");
    try {
      const request: EvidenceInput = command ?? {
        id: crypto.randomUUID(),
        title:
          title.trim() ||
          (kind === "link" ? new URL(url).hostname : body.trim().split("\n")[0]!.slice(0, 120)),
        kind,
        rights,
        author: attribution.author,
        as_of_date: attribution.as_of_date,
        ...(kind === "link"
          ? { availability: "reference_only", source_url: url.trim() }
          : { text: body }),
      };
      const pending = { ...draft, command: request };
      setDraft(pending);
      storeResearchCaptureDraft(storageKey, pending);
      const item = await api<EvidenceRecord>("evidence", request);
      if (item.id !== request.id) throw new Error("The server returned a different source record.");
      onPin(item);
      changeDraft({ title: "", body: "", url: "" });
    } catch (cause) {
      if (cause instanceof ApiError && [400, 422].includes(cause.status ?? 0))
        setDraft((current) => ({ ...current, command: null }));
      setError(cause instanceof Error ? cause.message : "Could not pin this source.");
    } finally {
      writing.current = false;
      setSaving(false);
    }
  }
  return (
    <>
      <section className={styles.panel} aria-labelledby="intake-heading">
        <h2 id="intake-heading" tabIndex={-1}>
          Add material
        </h2>
        <fieldset disabled={locked} className={styles.provenance}>
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
              onChange={(e) => changeDraft({ rights: e.target.value as typeof rights })}
            >
              <option value="unknown">Select rights</option>
              {captureRights.map((r) => (
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
              onChange={(e) => changeDraft({ author: e.target.value })}
            />
          </label>
          <label>
            As of
            <input
              type="date"
              value={date}
              onChange={(e) => changeDraft({ date: e.target.value })}
            />
          </label>
        </fieldset>
        <SourceFileBatch
          count={ids.length}
          disabled={locked}
          attribution={attribution}
          onPin={onPin}
          onSaving={setSaving}
          onPending={setFilePending}
        />
        <form
          aria-label="Paste a source"
          className={styles.paste}
          onSubmit={(event) => {
            event.preventDefault();
            void pinText();
          }}
        >
          <fieldset disabled={locked || packetFull}>
            <legend>Paste a source</legend>
            <div className={styles.kinds} role="group" aria-label="Pasted source type">
              {(["text", "discussion", "link"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={kind === value}
                  disabled={value === "link" ? !!body : !!url}
                  onClick={() => {
                    if (value !== kind) changeDraft({ kind: value });
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
                onChange={(e) => changeDraft({ title: e.target.value })}
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
                  onChange={(e) => changeDraft({ url: e.target.value })}
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
                  onChange={(e) => changeDraft({ body: e.target.value })}
                />
              </label>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {command && !saving && (
              <p className="field-hint" role="status">
                The last pin has no receipt. Retrying sends the same request.
              </p>
            )}
            <div className={styles.actions}>
              <button className="button" type="submit" disabled={!canPinText}>
                {saving && command
                  ? `Pinning ${label}…`
                  : command
                    ? `Retry pin ${label}`
                    : `Pin ${label}`}
              </button>
              {touched && (
                <button
                  className="text-link"
                  type="button"
                  onClick={() => changeDraft({ title: "", body: "", url: "" })}
                >
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
      {children}
      <section
        id="saved-sources"
        className={styles.panel}
        aria-label="Source library"
        tabIndex={-1}
      >
        <EvidencePicker
          label="Saved sources"
          selected={ids}
          onChange={onChange}
          onAdd={onPin}
          allowBatchPin
          attachedCharts={known}
          showSelected={false}
          disabled={locked || filePending}
          renderResultAction={(source, visible) => {
            const chart = savedChart(source);
            return (
              chart && (
                <button
                  type="button"
                  className="button small"
                  aria-haspopup="dialog"
                  aria-label={`Preview chart ${chart.title}${chart.attribution ? ` · ${chart.attribution}` : ""}`}
                  disabled={locked || filePending}
                  onClick={(event) => {
                    previewOpener.current = event.currentTarget;
                    setPreview({
                      id: chart.id,
                      charts: visible.map(savedChart).filter((item) => item !== null),
                    });
                  }}
                >
                  Preview
                </button>
              )
            );
          }}
        />
      </section>
      <SourceChartDialog
        charts={preview?.charts ?? []}
        selectedId={locked || filePending ? undefined : preview?.id}
        onSelect={(id) => setPreview((current) => (id && current ? { ...current, id } : undefined))}
        opener={previewOpener}
        action={
          viewedChart && (
            <button
              type="button"
              className="button primary"
              disabled={locked || filePending || chartPinned || packetFull}
              onClick={() => {
                onPin(viewedChart);
                setPreview(undefined);
              }}
            >
              {chartPinned ? "Chart pinned" : packetFull ? "Packet full" : "Pin this chart"}
            </button>
          )
        }
      />
    </>
  );
}
