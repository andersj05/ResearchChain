"use client";

import { ResearchConnection } from "@/components/research-settings";
import { ideaGenerationBrief, type ResearchSettings, type Workflow } from "@/lib/workflow";
import { ModelPicker, type ModelCatalog } from "@/components/model-picker";
import { scopeKey, type StepModelChange } from "@/lib/workflow-editing";
import { EvidencePicker } from "@/components/evidence-picker";
import { Button } from "@ui-sdk/react/button";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import { Play, X } from "lucide-react";

function RunTools({ workflow }: { workflow: Workflow }) {
  const steps = [workflow, ...(workflow.subgraphs ?? [])].flatMap((graph) =>
    graph.nodes.flatMap((node) => {
      const config = node.config;
      if (
        config?.type !== "research" ||
        (!config.web_search && !config.sec_financials && !config.analyst)
      )
        return [];
      const tools = [
        config.analyst ? `Codex analyst, up to ${config.analyst.max_passes ?? 4} passes` : "",
        config.analyst?.workspace ? "Python execution and saved files" : "",
        config.web_search === "auto"
          ? "optional web search"
          : config.web_search
            ? "required web search"
            : "",
        config.sec_financials ? "optional SEC lookup" : "",
      ]
        .filter(Boolean)
        .join(", ");
      return [
        {
          key: `${"id" in graph ? graph.id + "/" + graph.version : "root"}/${node.id}`,
          label: node.label,
          tools,
          sec: config.sec_financials,
          web: config.web_search,
          workspace: config.analyst?.workspace,
        },
      ];
    }),
  );
  if (!steps.length) return null;
  return (
    <details className="run-details">
      <summary>
        External research tools · {steps.length} {steps.length === 1 ? "step" : "steps"}
      </summary>
      <ul>
        {steps.map((step) => (
          <li key={step.key}>
            <strong>{step.label}</strong> · {step.tools}
          </li>
        ))}
      </ul>
      {steps.some((step) => step.web) && (
        <p className="field-hint">Web queries can include your brief and selected evidence.</p>
      )}
      {steps.some((step) => step.workspace) && (
        <p className="field-hint">
          Active time across the run is limited to {workflow.budgets?.max_active_seconds ?? 120}{" "}
          seconds. Review pauses are excluded.
        </p>
      )}
      {steps.some((step) => step.sec) && (
        <p className="field-hint">
          SEC lookups send the selected company and metric. Set RESEARCHCHAIN_SEC_USER_AGENT with an
          operator contact on the worker.
        </p>
      )}
    </details>
  );
}

export function RunSetup({
  open,
  onOpenChange,
  brief,
  onBriefChange,
  evidenceIds,
  onEvidenceChange,
  name,
  revision,
  busy,
  loaded,
  error,
  onStart,
  research,
  catalog,
  workflow,
  onResearch,
  onStepModels,
  accountId,
  onAccount,
}: {
  research?: ResearchSettings | null;
  catalog: ModelCatalog;
  workflow: Workflow;
  onResearch: (settings: ResearchSettings) => void;
  onStepModels: (changes: StepModelChange[]) => void;
  accountId: string | null;
  onAccount: (id: string | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brief: string;
  onBriefChange: (value: string) => void;
  evidenceIds: string[];
  onEvidenceChange: (ids: string[]) => void;
  name: string;
  revision: number | null;
  busy: boolean;
  loaded: boolean;
  error: string;
  onStart: () => Promise<void>;
}) {
  const available = new Set(catalog.status?.models?.map((model) => model.slug));
  const stepModels =
    open && research
      ? [workflow, ...(workflow.subgraphs ?? [])].flatMap((graph) => {
          const scope = "id" in graph ? { id: graph.id, version: graph.version } : null;
          return graph.nodes.flatMap((node) =>
            node.config?.type === "research"
              ? [
                  {
                    scope,
                    nodeId: node.id,
                    label: scope ? `${node.label} · ${graph.name} v${scope.version}` : node.label,
                    model: node.config.model ?? "",
                  },
                ]
              : [],
          );
        })
      : [];
  const overrides = stepModels.filter((step) => step.model);
  const unavailable = overrides.filter((step) => !available.has(step.model));
  const sampleBrief = [brief.trimEnd(), ideaGenerationBrief].filter(Boolean).join("\n\n");
  const hasWorkspace = [workflow, ...(workflow.subgraphs ?? [])].some((graph) =>
    graph.nodes.some((node) => node.config?.type === "research" && node.config.analyst?.workspace),
  );
  const ready =
    !research ||
    (!!accountId &&
      !catalog.loading &&
      !catalog.error &&
      available.has(research.model) &&
      unavailable.length === 0);
  return (
    <Dialog
      open={open}
      onOpenChange={(value, details) => {
        if (busy) details.cancel();
        else onOpenChange(value);
      }}
    >
      <DialogTrigger className="button primary" disabled={!loaded || busy}>
        <Play size={14} aria-hidden="true" /> Run workflow
      </DialogTrigger>
      <DialogBackdrop className="dialog-backdrop" />
      <DialogContent className="run-dialog" initialFocus="#brief">
        <div className="dialog-heading">
          <DialogTitle>Start a research run</DialogTitle>
          <DialogClose
            className="button icon-button ghost"
            aria-label="Close run setup"
            disabled={busy}
          >
            <X size={18} aria-hidden="true" />
          </DialogClose>
        </div>
        <DialogDescription>Give this workflow a question to explore.</DialogDescription>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (brief.trim() && !busy && ready) void onStart();
          }}
        >
          <div className="run-context">
            <strong>{name || "Untitled workflow"}</strong>
            <span>{revision ? `Revision ${revision}` : "New revision on start"}</span>
          </div>
          <label htmlFor="brief">Research brief</label>
          <textarea
            id="brief"
            required
            rows={5}
            maxLength={10000}
            value={brief}
            disabled={busy}
            onChange={(event) => onBriefChange(event.target.value)}
            placeholder="What question should this run explore?"
          />
          {hasWorkspace && !brief.includes(ideaGenerationBrief) && sampleBrief.length <= 10000 && (
            <Button
              className="button small"
              disabled={busy}
              onClick={() => onBriefChange(sampleBrief)}
            >
              {brief.trim() ? "Append synthetic rotation brief" : "Use synthetic rotation brief"}
            </Button>
          )}
          {open && research && (
            <ResearchConnection
              settings={research}
              catalog={catalog}
              onSettings={onResearch}
              accountId={accountId}
              onAccount={onAccount}
              disabled={busy}
            />
          )}
          {research && !!stepModels.length && (
            <details className="step-model-list">
              <summary>
                Step models ({overrides.length} {overrides.length === 1 ? "override" : "overrides"})
              </summary>
              <p className="field-hint">Model changes edit the workflow draft.</p>
              <Button
                className="button small"
                disabled={busy || !overrides.length}
                focusableWhenDisabled
                onClick={() =>
                  onStepModels(overrides.map(({ scope, nodeId }) => ({ scope, nodeId, model: "" })))
                }
              >
                Use workflow default for all steps
              </Button>
              <div className="step-model-fields">
                {stepModels.map(({ scope, nodeId, label, model }) => (
                  <ModelPicker
                    key={`${scopeKey(scope)}/${nodeId}`}
                    label={label}
                    catalog={catalog}
                    value={model}
                    inherited={research.model}
                    onChange={(model) => onStepModels([{ scope, nodeId, model }])}
                    disabled={busy}
                  />
                ))}
              </div>
            </details>
          )}
          {research && accountId && !catalog.loading && !catalog.error && !ready && (
            <p role="alert" className="error">
              {!available.has(research.model) && "Choose an available research model. "}
              {!!unavailable.length &&
                `In Step models, choose a replacement or use the workflow default for ${unavailable.map((step) => step.label).join(", ")}.`}
            </p>
          )}
          {open && (
            <EvidencePicker selected={evidenceIds} onChange={onEvidenceChange} disabled={busy} />
          )}
          {open && <RunTools workflow={workflow} />}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <div className="dialog-actions">
            <DialogClose className="button" disabled={busy}>
              Cancel
            </DialogClose>
            <Button
              className="button primary"
              type="submit"
              disabled={busy || !brief.trim() || !ready}
            >
              {busy ? "Starting…" : "Start run"}
              <Play size={14} aria-hidden="true" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
