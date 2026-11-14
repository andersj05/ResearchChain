"use client";

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
  name,
  revision,
  busy,
  loaded,
  error,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brief: string;
  onBriefChange: (value: string) => void;
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
            if (brief.trim() && !busy) void onStart();
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
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <div className="dialog-actions">
            <DialogClose className="button" disabled={busy}>
              Cancel
            </DialogClose>
            <Button className="button primary" type="submit" disabled={busy || !brief.trim()}>
              {busy ? "Starting…" : "Start run"}
              <Play size={14} aria-hidden="true" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
