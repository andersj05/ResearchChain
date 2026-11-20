"use client";

import { ResearchConnection, ResearchRequestLimitFields } from "@/components/research-settings";
import { ExecutionLimitFields, executionDefaults } from "@/components/execution-limits";
import {
  ideaGenerationBrief,
  researchDefaults,
  type ExecutionBudgets,
  type ResearchSettings,
  type Workflow,
} from "@/lib/workflow";
import { StepModelFields, type ModelCatalog } from "@/components/model-picker";
import { hasModelOverride, modelProfileProblem, stepModelProblem } from "@/lib/model-settings";
import { scopeKey, type StepModelChange } from "@/lib/workflow-editing";
import { researchToolLabels } from "@/lib/workflow-model-plan";
import { EvidencePicker } from "@/components/evidence-picker";
import { EvidenceForm } from "@/components/evidence-form";
import type { EvidenceRecord } from "@/lib/evidence";
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
import { useLayoutEffect, useRef, useState } from "react";

function RunTools({ workflow }: { workflow: Workflow }) {
  const steps = [workflow, ...(workflow.subgraphs ?? [])].flatMap((graph) =>
    graph.nodes.flatMap((node) => {
      const config = node.config;
      if (
        config?.type !== "research" ||
        (!config.web_search && !config.sec_financials && !config.analyst)
      )
        return [];
      const tools = researchToolLabels(config).join(", ");
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
          Active time across the run is limited to{" "}
          {(workflow.budgets ?? executionDefaults).max_active_seconds} seconds. Review pauses are
          excluded.
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
  baselineRunId,
  onClearBaseline,
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
  onExecutionLimits,
  accountId,
  onAccount,
}: {
  research?: ResearchSettings | null;
  catalog: ModelCatalog;
  workflow: Workflow;
  onResearch: (settings: ResearchSettings, group?: string) => void;
  onStepModels: (changes: StepModelChange[]) => void;
  onExecutionLimits: (budgets: ExecutionBudgets, group: string) => void;
  accountId: string | null;
  onAccount: (id: string | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brief: string;
  onBriefChange: (value: string) => void;
  baselineRunId: string | null;
  onClearBaseline: () => void;
  evidenceIds: string[];
  onEvidenceChange: (ids: string[]) => void;
  name: string;
  revision: number | null;
  busy: boolean;
  loaded: boolean;
  error: string;
  onStart: () => Promise<void>;
}) {
  const briefInput = useRef<HTMLTextAreaElement>(null);
  const [chartSources, setChartSources] = useState<EvidenceRecord[] | null>(null);
  const [savingChart, setSavingChart] = useState(false);
  const [attachedCharts, setAttachedCharts] = useState<EvidenceRecord[]>([]);
  const uploadTrigger = useRef<HTMLElement | null>(null);
  const chartEditor = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (chartSources)
      chartEditor.current?.querySelector<HTMLInputElement>('input[type="file"]')?.focus();
    else if (open && uploadTrigger.current) {
      uploadTrigger.current.focus();
      uploadTrigger.current = null;
    }
  }, [chartSources, open]);
  const models = catalog.status?.models ?? [];
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
                    config: node.config,
                  },
                ]
              : [],
          );
        })
      : [];
  const overrides = stepModels.filter(
    ({ config }) =>
      hasModelOverride(config) ||
      hasModelOverride(config.team?.lead) ||
      hasModelOverride(config.team?.researcher),
  );
  const sharedProblem = research ? modelProfileProblem(models, { model: research.model }) : "";
  const incompatible = research
    ? stepModels.flatMap(({ config, label }) => {
        const problem = stepModelProblem(models, research, config);
        return problem ? [`${label} · ${problem}`] : [];
      })
    : [];
  const activeSeconds = (workflow.budgets ?? executionDefaults).max_active_seconds;
  const attempts = research?.limits?.max_model_calls ?? researchDefaults.limits.max_model_calls;
  const sampleBrief = [brief.trimEnd(), ideaGenerationBrief].filter(Boolean).join("\n\n");
  const hasWorkspace = [workflow, ...(workflow.subgraphs ?? [])].some((graph) =>
    graph.nodes.some((node) => node.config?.type === "research" && node.config.analyst?.workspace),
  );
  const ready =
    !research ||
    (!!accountId &&
      !catalog.loading &&
      !catalog.error &&
      !sharedProblem &&
      incompatible.length === 0);
  return (
    <Dialog
      open={open}
      onOpenChange={(value, details) => {
        if (busy || savingChart) details.cancel();
        else {
          if (!value) {
            uploadTrigger.current = null;
            setChartSources(null);
            setAttachedCharts([]);
          }
          onOpenChange(value);
        }
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
            disabled={busy || savingChart}
          >
            <X size={18} aria-hidden="true" />
          </DialogClose>
        </div>
        <DialogDescription>Give this workflow a question to explore.</DialogDescription>
        {open && chartSources && (
          <div ref={chartEditor}>
            <EvidenceForm
              attachChart
              sources={chartSources}
              onSavingChange={setSavingChart}
              onCancel={() => setChartSources(null)}
              onSaved={(source) => {
                setAttachedCharts((previous) => [source, ...previous]);
                onEvidenceChange([...evidenceIds, source.id]);
                setChartSources(null);
              }}
            />
          </div>
        )}
        <form
          hidden={!!chartSources}
          onSubmit={(event) => {
            event.preventDefault();
            if (!chartSources && brief.trim() && !busy && ready) void onStart();
          }}
        >
          <div className="run-context">
            <strong>{name || "Untitled workflow"}</strong>
            <span>{revision ? `Revision ${revision}` : "New revision on start"}</span>
          </div>
          {baselineRunId && (
            <div className="actions">
              <a href={`?view=runs&run=${baselineRunId}`} target="_blank" rel="noopener">
                Baseline run · {baselineRunId.slice(0, 8)}
              </a>
              <Button
                className="button small"
                disabled={busy}
                onClick={() => {
                  onClearBaseline();
                  briefInput.current?.focus();
                }}
              >
                Clear baseline
              </Button>
            </div>
          )}
          <label htmlFor="brief">Research brief</label>
          <textarea
            id="brief"
            ref={briefInput}
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
                  onStepModels(
                    overrides.map(({ scope, nodeId, config }) => ({
                      scope,
                      nodeId,
                      settings: {
                        model: undefined,
                        reasoning_effort: undefined,
                        verbosity: undefined,
                        ...(config.team
                          ? { team: { ...config.team, lead: undefined, researcher: undefined } }
                          : {}),
                      },
                    })),
                  )
                }
              >
                Use workflow default for all steps
              </Button>
              <div className="step-model-fields">
                {stepModels.map(({ scope, nodeId, label, config }) => (
                  <StepModelFields
                    key={`${scopeKey(scope)}/${nodeId}`}
                    label={label}
                    modelLabel={label}
                    catalog={catalog}
                    shared={research}
                    step={config}
                    onChange={(settings) => onStepModels([{ scope, nodeId, settings }])}
                    disabled={busy}
                  />
                ))}
              </div>
            </details>
          )}
          {research && accountId && !catalog.loading && !catalog.error && !ready && (
            <p role="alert" className="error">
              {sharedProblem ||
                `In Step models, choose a replacement for the unavailable setting. ${incompatible[0]}`}
            </p>
          )}
          {open && (
            <details
              className="run-details run-limits"
              onInvalidCapture={(event) => {
                event.currentTarget.open = true;
              }}
            >
              <summary>
                Run limits · {activeSeconds}s active
                {research && ` · ${attempts} model ${attempts === 1 ? "attempt" : "attempts"}`}
              </summary>
              <fieldset disabled={busy}>
                <legend>Workflow execution</legend>
                <ExecutionLimitFields budgets={workflow.budgets} onChange={onExecutionLimits} />
              </fieldset>
              {research && (
                <fieldset disabled={busy}>
                  <legend>Model requests and evidence</legend>
                  <ResearchRequestLimitFields settings={research} onSettings={onResearch} />
                </fieldset>
              )}
            </details>
          )}
          {open && (
            <EvidencePicker
              selected={evidenceIds}
              onChange={onEvidenceChange}
              disabled={busy}
              attachedCharts={attachedCharts}
              onAttachChart={(sources) => {
                uploadTrigger.current = document.activeElement as HTMLElement;
                setChartSources(sources);
              }}
            />
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
