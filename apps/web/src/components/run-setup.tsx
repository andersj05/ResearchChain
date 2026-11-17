"use client";

import { ResearchConnection } from "@/components/research-settings";
import type { ResearchSettings } from "@/lib/workflow";
import type { ModelCatalog } from "@/components/model-picker";
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
  stepModels,
  onResearch,
  accountId,
  onAccount,
}: {
  research?: ResearchSettings | null;
  catalog: ModelCatalog;
  stepModels: { label: string; model: string }[];
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
  const available = new Set(catalog.status?.models?.map((model) => model.slug));
  const unavailable = stepModels.filter((step) => !available.has(step.model));
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
          {!!stepModels.length && (
            <details className="step-model-list">
              <summary>Step model overrides ({stepModels.length})</summary>
              <ul>
                {stepModels.map((step, index) => (
                  <li key={index}>
                    {step.label} · {step.model}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {research && accountId && !catalog.loading && !catalog.error && !ready && (
            <p role="alert" className="error">
              {!available.has(research.model) && "Choose an available research model. "}
              {!!unavailable.length &&
                `Change the unavailable step models in Build: ${unavailable.map((step) => step.label).join(", ")}.`}
            </p>
          )}
          {open && (
            <EvidencePicker selected={evidenceIds} onChange={onEvidenceChange} disabled={busy} />
          )}
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
