"use client";

import {
  api,
  researchDefaults,
  type ProviderStatus,
  type ResearchSettings,
  type Workflow,
} from "@/lib/workflow";
import { useCallback, useEffect, useState } from "react";
import { ChatGPTSignIn } from "@/components/chatgpt-signin";
import { Button } from "@ui-sdk/react/button";

export function ResearchSettingsEditor({
  workflow,
  onChange,
}: {
  workflow: Workflow;
  onChange: (value: Workflow, group?: string) => void;
}) {
  if (!workflow.research) return null;
  const settings = workflow.research;
  const limits = { ...researchDefaults.limits, ...settings.limits };
  return (
    <details className="workflow-settings">
      <summary>Research limits</summary>
      {(
        [
          ["max_model_calls", "Maximum model attempts", 0, 100],
          ["max_tool_calls", "Maximum evidence reads", 0, 100],
          ["max_total_tokens", "Stop after reported tokens", 1, 1000000],
          ["max_response_seconds", "Seconds per response", 1, 120],
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
              onChange(
                {
                  ...workflow,
                  research: {
                    ...settings,
                    limits: {
                      ...limits,
                      [key]: Number.isFinite(event.target.valueAsNumber)
                        ? event.target.valueAsNumber
                        : min,
                    },
                  },
                },
                `research/${key}`,
              )
            }
          />
        </label>
      ))}
      <p className="field-hint">
        Token usage stops the next call. An in-flight response can exceed that threshold.
        Cancellation closes the connection; provider usage may continue.
      </p>
    </details>
  );
}

export function ResearchConnection({
  settings,
  onSettings,
  accountId,
  onAccount,
  disabled,
}: {
  settings: ResearchSettings;
  onSettings: (settings: ResearchSettings) => void;
  accountId: string | null;
  onAccount: (id: string | null) => void;
  disabled: boolean;
}) {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const refreshConnection = useCallback(() => {
    setLoading(true);
    setRefresh((value) => value + 1);
  }, []);
  useEffect(() => {
    let active = true;
    api<ProviderStatus>("providers/chatgpt", undefined, 30000)
      .then((result) => {
        if (!active) return;
        setStatus(result);
        setError(result.error ?? "");
        const account = result.accounts?.find(
          (item) => item.active && item.signed_in && item.plan_enabled,
        );
        onAccount(account?.id ?? null);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Connection unavailable.");
          onAccount(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh, onAccount]);
  const account = status?.accounts?.find((item) => item.id === accountId);
  const available = status?.models?.some((item) => item.slug === settings.model);
  return (
    <fieldset className="research-connection" disabled={disabled || loading}>
      <legend>ChatGPT plan usage</legend>
      <p>
        {loading
          ? "Checking connection…"
          : account
            ? `Connected as ${account.label}`
            : "Connect your ChatGPT account to choose a research model."}
      </p>
      <ChatGPTSignIn
        connected={Boolean(status?.accounts?.some((item) => item.active && item.signed_in))}
        disabled={disabled}
        onConnectionChange={refreshConnection}
      />
      <label>
        Research model
        <select
          required
          value={available ? settings.model : ""}
          onChange={(event) => onSettings({ ...settings, model: event.target.value })}
        >
          <option value="" disabled>
            Select an available model
          </option>
          {status?.models?.map((model) => (
            <option key={model.slug} value={model.slug}>
              {model.display_name}
            </option>
          ))}
        </select>
      </label>
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
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <Button className="button small" disabled={disabled || loading} onClick={refreshConnection}>
        Refresh connection
      </Button>
    </fieldset>
  );
}
