import { useRef, useState, type ReactNode } from "react";
import { ChatGPTSignIn } from "./chatgpt-signin";

import { SwarmControls } from "./swarm-controls";
import {
  ModelOptionFields,
  ModelPicker,
  RoleModelSettings,
  type ModelCatalog,
} from "./model-picker";
import { initialSwarm, type ResearchBrief } from "@/lib/research-sessions";
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
    <details open className={styles.option}>
      <summary>
        Writing sample
        <span>{value ? `${value.length.toLocaleString()} characters` : "Optional"}</span>
      </summary>
      <div className={styles.optionBody}>
        <label htmlFor="study-style">Example report excerpt</label>
        <p className="field-hint" id="style-purpose">
          The report writer uses this excerpt for voice and structure. Research agents receive the
          owner’s direction and selected sources.
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

function ResearchLimits({
  draft,
  update,
}: {
  draft: ResearchBrief;
  update: (patch: Partial<ResearchBrief>) => void;
}) {
  const swarm = draft.swarm && { ...initialSwarm, ...draft.swarm };
  return (
    <details
      className={styles.researchLimits}
      open={draft.max_passes !== null || swarm?.max_lead_turns != null}
      onInvalidCapture={(event) => {
        event.currentTarget.open = true;
      }}
    >
      <summary>Optional execution limits</summary>
      <div>
        <label>
          Passes per agent
          <input
            type="number"
            min={2}
            max={12}
            step={1}
            placeholder="As needed"
            value={draft.max_passes ?? ""}
            onChange={(event) =>
              update({ max_passes: event.target.value ? event.target.valueAsNumber : null })
            }
          />
        </label>
        {swarm && (
          <label>
            Turns per lead
            <input
              type="number"
              min={2}
              max={12}
              step={1}
              placeholder="As needed"
              value={swarm.max_lead_turns ?? ""}
              onChange={(event) =>
                update({
                  swarm: {
                    ...swarm,
                    max_lead_turns: event.target.value ? event.target.valueAsNumber : null,
                  },
                })
              }
            />
          </label>
        )}
        <p>With these fields empty, agents decide when their assignments are complete.</p>
      </div>
    </details>
  );
}

export const researchSettingsControlsId = "study-settings-controls";

export function ResearchBriefOptions({
  draft,
  update,
  catalog,
  model,
  disabled,
  awaitingModelCatalog,
  onReadingSample,
  reuseSettings,
}: {
  draft: ResearchBrief;
  update: (patch: Partial<ResearchBrief>) => void;
  catalog: ModelCatalog;
  model: string;
  disabled: boolean;
  awaitingModelCatalog: boolean;
  onReadingSample: (value: boolean) => void;
  reuseSettings?: ReactNode;
}) {
  const modelsDisabled = disabled || awaitingModelCatalog;
  return (
    <div className={styles.options}>
      <details
        open
        className={styles.option}
        onInvalidCapture={(event) => {
          event.currentTarget.open = true;
        }}
      >
        <summary>
          Research settings
          {draft.swarm && <span>Research Swarm · {draft.swarm.lead_count} leads</span>}
        </summary>
        <div
          id={researchSettingsControlsId}
          className={styles.settingGrid}
          role="region"
          aria-label="Research settings"
          tabIndex={-1}
        >
          {reuseSettings}
          <SwarmControls draft={draft} update={update} />
          <label>
            Editorial review
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
          <div className={styles.webSetting}>
            <label>
              <input
                type="checkbox"
                checked={draft.web_search}
                aria-describedby="study-web-scope"
                onChange={(event) => update({ web_search: event.target.checked })}
              />
              Allow live web search
            </label>
            <p id="study-web-scope" className="field-hint">
              Available to the team and editor after you choose a working sentence.
            </p>
          </div>
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
            useSliders
            showOverrideCount={false}
            initiallyOpen
            shared={{ ...draft, model }}
            values={draft}
            catalog={catalog}
            includeEditor
            inheritedLabel="Shared"
            disabled={modelsDisabled}
            onChange={(role, value) => update({ [role]: value })}
          />
          <ResearchLimits draft={draft} update={update} />
        </div>
      </details>
      <WritingSample
        value={draft.style_excerpt}
        onChange={(style_excerpt) => update({ style_excerpt })}
        disabled={disabled}
        onReading={onReadingSample}
      />
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
