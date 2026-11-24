import { useRef, useState } from "react";
import { ChatGPTSignIn } from "./chatgpt-signin";
import { EvidencePicker } from "./evidence-picker";
import { SwarmControls } from "./swarm-controls";
import {
  ModelOptionFields,
  ModelPicker,
  RoleModelSettings,
  type ModelCatalog,
} from "./model-picker";
import type { ResearchBrief } from "@/lib/research-sessions";
import styles from "./research-desk.module.css";

const reviewLabels: Record<ResearchBrief["review_mode"], string> = {
  when_needed: "When the team asks",
  always: "Before the report",
  never: "Continue independently",
};

function WritingSample({
  value,
  onChange,
  disabled,
  onReading,
}: {
  value: string;
  onChange: (sample: string) => void;
  disabled: boolean;
  onReading: (value: boolean) => void;
}) {
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [filename, setFilename] = useState("");
  const readEpoch = useRef(0);
  return (
    <details className={styles.option}>
      <summary>
        Writing sample
        <span>{value ? `${value.length.toLocaleString()} characters` : "Optional"}</span>
      </summary>
      <div className={styles.optionBody}>
        <label htmlFor="study-style">Example report excerpt</label>
        <p className="field-hint" id="style-purpose">
          The report writer uses this excerpt for voice and structure. Research agents receive the
          brief and selected sources.
        </p>
        <textarea
          id="study-style"
          rows={5}
          maxLength={32000}
          value={value}
          aria-describedby="style-purpose"
          disabled={disabled}
          onChange={(event) => {
            readEpoch.current++;
            setReading(false);
            onReading(false);
            setFilename("");
            setError("");
            onChange(event.target.value);
          }}
        />
        <label className={styles.fileLabel}>
          Import a text or Markdown sample
          <input
            type="file"
            accept=".txt,.md,.markdown,text/plain,text/markdown"
            disabled={disabled}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const epoch = ++readEpoch.current;
              setError("");
              setReading(true);
              onReading(true);
              try {
                if (
                  !/\.(txt|md|markdown)$/i.test(file.name) &&
                  !["text/plain", "text/markdown"].includes(file.type)
                )
                  throw new Error("Choose a .txt or Markdown file.");
                if (file.size > 128000)
                  throw new Error("Choose an excerpt of up to 32,000 characters.");
                const text = new TextDecoder("utf-8", { fatal: true }).decode(
                  await file.arrayBuffer(),
                );
                if (text.length > 32000)
                  throw new Error("Choose an excerpt of up to 32,000 characters.");
                if (text.includes("\u0000"))
                  throw new Error("Choose a UTF-8 text or Markdown file.");
                if (readEpoch.current !== epoch) return;
                onChange(text);
                setFilename(file.name);
              } catch (cause) {
                if (readEpoch.current === epoch)
                  setError(
                    cause instanceof TypeError
                      ? "Choose a UTF-8 text or Markdown file."
                      : cause instanceof Error
                        ? cause.message
                        : "Could not read the writing sample.",
                  );
              } finally {
                if (readEpoch.current === epoch) {
                  setReading(false);
                  onReading(false);
                }
              }
            }}
          />
        </label>
        {reading && (
          <p role="status" className="field-hint">
            Reading sample…
          </p>
        )}
        {filename && !reading && (
          <p role="status" className="field-hint">
            Imported {filename}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}

export function ResearchBriefOptions({
  draft,
  update,
  catalog,
  model,
  disabled,
  awaitingModelCatalog,
  onReadingSample,
}: {
  draft: ResearchBrief;
  update: (patch: Partial<ResearchBrief>) => void;
  catalog: ModelCatalog;
  model: string;
  disabled: boolean;
  awaitingModelCatalog: boolean;
  onReadingSample: (value: boolean) => void;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const modelsDisabled = disabled || awaitingModelCatalog;
  const time =
    draft.max_active_seconds % 60 === 0
      ? `${draft.max_active_seconds / 60} min`
      : `${draft.max_active_seconds} s`;
  return (
    <div className={styles.options}>
      <WritingSample
        value={draft.style_excerpt}
        onChange={(style_excerpt) => update({ style_excerpt })}
        disabled={disabled}
        onReading={onReadingSample}
      />
      {!draft.start_from_sources && (
        <details
          className={styles.option}
          onToggle={(event) => setSourcesOpen(event.currentTarget.open)}
        >
          <summary>
            Source material
            <span>
              {draft.evidence_ids.length ? `${draft.evidence_ids.length} selected` : "Optional"}
            </span>
          </summary>
          {sourcesOpen && (
            <div className={styles.optionBody}>
              <EvidencePicker
                selected={draft.evidence_ids}
                onChange={(evidence_ids) => update({ evidence_ids })}
                disabled={disabled}
                label="Pin sources"
              />
              <a className="text-link" href="?view=evidence" target="_blank" rel="noopener">
                Open source library
              </a>
            </div>
          )}
        </details>
      )}
      <details
        className={styles.option}
        onInvalidCapture={(event) => {
          event.currentTarget.open = true;
        }}
      >
        <summary>
          Research settings
          <span>
            {draft.swarm
              ? `${draft.swarm.lead_count} leads`
              : `Up to ${draft.max_agents} ${draft.max_agents === 1 ? "agent" : "agents"}`}{" "}
            · {draft.max_passes} passes · {time}
          </span>
        </summary>
        <div className={styles.settingGrid}>
          <SwarmControls draft={draft} update={update} />
          {!draft.swarm && (
            <label>
              Maximum research agents
              <select
                value={draft.max_agents}
                onChange={(event) => update({ max_agents: Number(event.target.value) })}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Passes per agent
            <input
              type="number"
              required
              min={2}
              max={12}
              step={1}
              value={draft.max_passes || ""}
              onChange={(event) => update({ max_passes: event.target.valueAsNumber || 0 })}
            />
          </label>
          <label>
            Active time limit (seconds)
            <input
              type="number"
              required
              min={60}
              max={3600}
              step={1}
              value={draft.max_active_seconds || ""}
              onChange={(event) => update({ max_active_seconds: event.target.valueAsNumber || 0 })}
            />
          </label>
          <label className={draft.swarm ? styles.fullField : undefined}>
            {draft.swarm || draft.start_from_sources ? "Editorial review" : "Expert review"}
            <select
              value={draft.review_mode}
              onChange={(event) =>
                update({ review_mode: event.target.value as ResearchBrief["review_mode"] })
              }
            >
              {Object.entries(reviewLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className={styles.sharedProfile}>
            <legend>Team defaults</legend>
            <ModelPicker
              label="Research model"
              catalog={catalog}
              value={model}
              onChange={(selected) => update({ model: selected })}
              disabled={modelsDisabled}
            />
            <ModelOptionFields
              scope="Shared"
              useSliders
              catalog={catalog}
              settings={{ ...draft, model }}
              onChange={update}
              disabled={modelsDisabled}
            />
          </fieldset>
          <RoleModelSettings
            key={draft.swarm ? "swarm" : "standard"}
            useSliders
            showOverrideCount={false}
            initiallyOpen={!!draft.swarm}
            shared={{ ...draft, model }}
            values={draft}
            catalog={catalog}
            includeEditor
            inheritedLabel="Shared"
            disabled={modelsDisabled}
            onChange={(role, value) => update({ [role]: value })}
          />
        </div>
      </details>
    </div>
  );
}

export function ResearchPlanConnection({
  catalog,
  disabled,
  connected,
}: {
  catalog: ModelCatalog;
  disabled: boolean;
  connected: boolean;
}) {
  return (
    <div className={styles.connection}>
      <ChatGPTSignIn
        connected={connected}
        disabled={disabled}
        onConnectionChange={catalog.refresh}
      />
      <button
        type="button"
        className="text-link"
        disabled={disabled || catalog.loading}
        onClick={catalog.refresh}
      >
        Refresh connection
      </button>
    </div>
  );
}
