"use client";

import { useRef, useState } from "react";
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
import { ideaGenerationWorkflow, type AgentSummary } from "@/lib/workflow";

export type StartingWorkflow = "blank" | "current" | "ideas";

export function AgentSwitcher({
  agents,
  active,
  disabled,
  onSelect,
  onCreate,
  onLatest,
}: {
  agents: AgentSummary[];
  active: AgentSummary | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onCreate: (id: string, name: string, starter: StartingWorkflow) => Promise<void>;
  onLatest: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [starter, setStarter] = useState<StartingWorkflow>("blank");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const requestId = useRef<string | null>(null);
  return (
    <div className="agent-switcher">
      <label htmlFor="active-agent">Agent</label>
      <select
        id="active-agent"
        value={active?.id ?? ""}
        disabled={disabled}
        onChange={(event) => onSelect(event.target.value)}
      >
        <option value="">Unassigned workflow</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>
      {active && (
        <Button className="button small" disabled={disabled} onClick={onLatest}>
          Load latest
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(value, details) => {
          if (creating) {
            details.cancel();
            return;
          }
          setOpen(value);
          if (!value) {
            setName("");
            setStarter("blank");
            setError("");
            requestId.current = null;
          }
        }}
      >
        <DialogTrigger className="button small" disabled={disabled}>
          New agent
        </DialogTrigger>
        <DialogBackdrop className="dialog-backdrop" />
        <DialogContent className="run-dialog" initialFocus="#new-agent-name">
          <DialogTitle>Create an agent</DialogTitle>
          <DialogDescription>
            Give your agent a name, then build its steps and prompts. Existing drafts and runs stay
            available.
          </DialogDescription>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (creating) return;
              setCreating(true);
              setError("");
              requestId.current ??= crypto.randomUUID();
              try {
                await onCreate(requestId.current, name.trim(), starter);
                setOpen(false);
                setName("");
                setStarter("blank");
                requestId.current = null;
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Could not create the agent.");
              } finally {
                setCreating(false);
              }
            }}
          >
            <label htmlFor="new-agent-name">Agent name</label>
            <input
              id="new-agent-name"
              required
              maxLength={120}
              value={name}
              disabled={creating}
              onChange={(event) => {
                setName(event.target.value);
                requestId.current = null;
              }}
            />
            <label htmlFor="starting-workflow">Starting workflow</label>
            <select
              id="starting-workflow"
              value={starter}
              disabled={creating}
              onChange={(event) => {
                const next = event.target.value as StartingWorkflow;
                setStarter(next);
                if (next === "ideas" && !name.trim()) setName(ideaGenerationWorkflow.name);
                requestId.current = null;
              }}
            >
              <option value="blank">Blank workflow</option>
              <option value="current">Copy the current workflow</option>
              <option value="ideas">Idea generation demo</option>
            </select>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <DialogClose className="button" disabled={creating}>
                Cancel
              </DialogClose>
              <Button type="submit" className="button primary" disabled={creating || !name.trim()}>
                {creating ? "Creating…" : "Create agent"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
