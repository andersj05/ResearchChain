"use client";

import { ResearchConnection } from "@/components/research-settings";
import type { ResearchSettings, Workflow } from "@/lib/workflow";
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
      if (config?.type !== "research" || (!config.web_search && !config.sec_financials)) return [];
      const tools = [
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
      <p className="field-hint">Web queries can include your brief and selected evidence.</p>
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
  workflow,
  onResearch,
  accountId,
  onAccount,
}: {
  research?: ResearchSettings | null;
  workflow: Workflow;
  onResearch: (settings: ResearchSettings) => void;
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
            if (brief.trim() && !busy && (!research || accountId)) void onStart();
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
          <p className="field-hint">
            The run keeps its own saved revision. Later edits won’t change it.
          </p>
          {open && research && (
            <ResearchConnection
              settings={research}
              onSettings={onResearch}
              accountId={accountId}
              onAccount={onAccount}
              disabled={busy}
            />
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
              disabled={busy || !brief.trim() || (!!research && !accountId)}
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
