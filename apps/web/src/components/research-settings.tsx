"use client";

import { researchDefaults, type ResearchSettings, type Workflow } from "@/lib/workflow";
import { useEffect } from "react";
import { ModelPicker, type ModelCatalog } from "@/components/model-picker";
import { ChatGPTSignIn } from "@/components/chatgpt-signin";
import { Button } from "@ui-sdk/react/button";

function TokenBudget({
  settings,
  onChange,
}: {
  settings: ResearchSettings;
  onChange: (settings: ResearchSettings) => void;
}) {
  const limits = { ...researchDefaults.limits, ...settings.limits };
  const budget = limits.max_total_tokens;
  const defaultTokens = researchDefaults.limits.max_total_tokens;
  const setBudget = (value: typeof budget) =>
    onChange({ ...settings, limits: { ...limits, max_total_tokens: value } });
  return (
    <>
      <label>
        Token budget
        <select
          value={budget === "as_needed" ? "as_needed" : "fixed"}
          onChange={(event) =>
            setBudget(event.target.value === "fixed" ? defaultTokens : "as_needed")
          }
        >
          <option value="fixed">Fixed total</option>
          <option value="as_needed">As needed</option>
        </select>
      </label>
      {budget !== "as_needed" && (
        <>
          <label>
            Total tokens per run
            <input
              type="number"
              required
              min={1}
              max={Number.MAX_SAFE_INTEGER}
              step={1}
              value={budget || ""}
              onChange={(event) => setBudget(event.target.valueAsNumber || 0)}
            />
          </label>
          {budget !== defaultTokens && (
            <Button className="button small" onClick={() => setBudget(defaultTokens)}>
              Use {defaultTokens.toLocaleString("en-US")} tokens
            </Button>
          )}
        </>
      )}
      <p className="field-hint">
        {budget === "as_needed"
          ? "Steps can use tokens as needed within the run’s request and time limits."
          : "Counts input and output across steps. A response can take the run past this limit before the next request stops."}
      </p>
    </>
  );
}

export function ResearchRequestLimitFields({
  settings,
  onSettings,
}: {
  settings: ResearchSettings;
  onSettings: (settings: ResearchSettings, group: string) => void;
}) {
  const limits = { ...researchDefaults.limits, ...settings.limits };
  return (
    <>
      {(
        [
          ["max_model_calls", "Maximum model attempts", 0, 100],
          ["max_tool_calls", "Maximum evidence reads", 0, 100],
          ["max_response_seconds", "Seconds per response", 1, 600],
          ["max_input_bytes", "Bytes per request", 1000, 8000000],
          ["max_output_characters", "Characters per response", 1000, 100000],
        ] as const
      ).map(([key, label, min, max]) => (
        <label key={key}>
          {label}
          <input
            type="number"
            min={min}
            max={max}
            step={1}
            value={limits[key]}
            onChange={(event) =>
              onSettings(
                {
                  ...settings,
                  limits: {
                    ...limits,
                    [key]: Number.isFinite(event.target.valueAsNumber)
                      ? event.target.valueAsNumber
                      : min,
                  },
                },
                `research/${key}`,
              )
            }
          />
        </label>
      ))}
      <p className="field-hint">Cancellation closes the connection; provider usage may continue.</p>
    </>
  );
}

export function ResearchSettingsEditor({
  workflow,
  onChange,
}: {
  workflow: Workflow;
  onChange: (value: Workflow, group?: string) => void;
}) {
  if (!workflow.research) return null;
  return (
    <details className="workflow-settings" id="workflow-research-limits">
      <summary>Research limits</summary>
      <TokenBudget
        settings={workflow.research}
        onChange={(research) => onChange({ ...workflow, research }, "research/max_total_tokens")}
      />
      <ResearchRequestLimitFields
        settings={workflow.research}
        onSettings={(research, group) => onChange({ ...workflow, research }, group)}
      />
    </details>
  );
}

export function ResearchConnection({
  catalog,
  settings,
  onSettings,
  accountId,
  onAccount,
  disabled,
}: {
  catalog: ModelCatalog;
  settings: ResearchSettings;
  onSettings: (settings: ResearchSettings) => void;
  accountId: string | null;
  onAccount: (id: string | null) => void;
  disabled: boolean;
}) {
  const { status, loading, error, refresh } = catalog;
  const connected = status?.accounts.find(
    (item) => item.active && item.signed_in && item.plan_enabled,
  );
  useEffect(() => {
    onAccount(connected?.id ?? null);
  }, [connected?.id, onAccount]);
  const account = status?.accounts?.find((item) => item.id === accountId);
  return (
    <fieldset className="research-connection" disabled={disabled}>
      <legend>ChatGPT plan usage</legend>
      <ModelPicker
        label="Research model"
        catalog={catalog}
        value={settings.model}
        onChange={(model) => onSettings({ ...settings, model })}
      />
      <p className="field-hint" aria-label="Model selection scope">
        Workflow default for steps without an override.
      </p>
      <TokenBudget settings={settings} onChange={onSettings} />
      {loading && <p role="status">Checking connection…</p>}
      {account && <p>Connected as {account.label}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <details className="plan-connection-details" open={!account && !loading}>
        <summary>Manage connection</summary>
        <ChatGPTSignIn
          connected={Boolean(status?.accounts?.some((item) => item.active && item.signed_in))}
          disabled={disabled}
          onConnectionChange={refresh}
        />
        <p className="field-hint">
          Uses your included plan allowance. Keep credit use disabled in{" "}
          <a
            href={status?.usage_url ?? "https://chatgpt.com/settings/usage"}
            target="_blank"
            rel="noreferrer"
          >
            ChatGPT usage settings
          </a>
          . ResearchChain does not switch to API billing.
        </p>
        <Button className="button small" disabled={disabled || loading} onClick={refresh}>
          Refresh connection
        </Button>
      </details>
    </fieldset>
  );
}
