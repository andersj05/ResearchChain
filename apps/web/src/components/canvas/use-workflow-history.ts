"use client";

import { useCallback, useState } from "react";
import { createUndoStack, matchesShortcut } from "@ui-sdk/core";
import type { Workflow } from "@/lib/workflow";

export function useWorkflowHistory(initial: Workflow) {
  const [stack] = useState(() => createUndoStack(initial, { limit: 80, groupDelay: 800 }));
  const [workflow, setWorkflow] = useState(initial);
  function change(next: Workflow, group?: string) {
    if (JSON.stringify(next) === JSON.stringify(workflow)) return;
    stack.record(next, { group });
    setWorkflow(next);
  }
  const initialize = useCallback(
    (next: Workflow) => {
      stack.reset(next);
      setWorkflow(next);
    },
    [stack],
  );
  function replace(next: Workflow) {
    stack.map((value) => (value === workflow ? next : value));
    setWorkflow(next);
  }
  function travel(direction: "undo" | "redo") {
    const next = stack[direction]();
    if (next !== undefined) setWorkflow(next);
    return next;
  }
  return {
    workflow,
    change,
    replace,
    initialize,
    travel,
    seal: () => stack.seal(),
    canUndo: stack.canUndo(),
    canRedo: stack.canRedo(),
  };
}

export function historyShortcut(event: KeyboardEvent) {
  if (matchesShortcut(event, "mod+shift+z") || matchesShortcut(event, "mod+y")) return "redo";
  if (matchesShortcut(event, "mod+z")) return "undo";
  return null;
}
