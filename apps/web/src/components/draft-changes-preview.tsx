import { useState } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import { X } from "lucide-react";
import { historyShortcut } from "@/components/canvas/use-workflow-history";
import { compareWorkflowDraft } from "@/lib/workflow-draft-comparison";
import type { SettingChange } from "@/lib/workflow-comparison";
import { reachableWorkflowGraphs, scopeKey, type GraphCrumb } from "@/lib/workflow-editing";
import type { Workflow, WorkflowRevision } from "@/lib/workflow";
import styles from "./draft-changes-preview.module.css";

function ChangeRows({ changes }: { changes: SettingChange[] }) {
  if (!changes.length) return null;
  return (
    <dl className={styles.rows}>
      {changes.map(({ name, before, after }) => (
        <div className={styles.row} key={name}>
          <dt>{name}</dt>
          <dd>
            <span>Saved</span>
            <p>{before === undefined ? "Not set" : before || "Empty"}</p>
          </dd>
          <dd>
            <span>Draft</span>
            <p>{after === undefined ? "Not set" : after || "Empty"}</p>
          </dd>
        </div>
      ))}
    </dl>
  );
}

type DraftStep = { id: string; path: GraphCrumb[] };

function DraftChanges({
  saved,
  draft,
  onOpenStep,
}: {
  saved: Workflow;
  draft: Workflow;
  onOpenStep: (step: DraftStep) => void;
}) {
  const comparison = compareWorkflowDraft(saved, draft);
  if (comparison.kind === "matched")
    return <p className={styles.message}>The draft matches the saved revision.</p>;
  if (comparison.kind === "layout")
    return <p className={styles.message}>Only canvas positions changed.</p>;
  if (comparison.kind === "other")
    return (
      <p className={styles.message}>The draft changes document details outside this preview.</p>
    );

  const scopes = new Map(
    [...reachableWorkflowGraphs(draft)].map(({ graph, path }) => [
      scopeKey(path.at(-1)?.ref ?? null),
      { graph, path },
    ]),
  );
  return (
    <div className={styles.groups}>
      {comparison.settings.length > 0 && (
        <details open>
          <summary>Workflow settings</summary>
          <ChangeRows changes={comparison.settings} />
        </details>
      )}
      {comparison.graphs.map((graph) => {
        const scope =
          graph.afterScope === undefined ? undefined : scopes.get(scopeKey(graph.afterScope));
        return (
          <details key={graph.key} open>
            <summary>{graph.label}</summary>
            <ChangeRows changes={graph.settings} />
            {graph.steps.map((step) => {
              const destination =
                step.status !== "Removed" &&
                scope?.graph.nodes.filter((node) => node.id === step.id).length === 1
                  ? scope.path
                  : undefined;
              return (
                <details key={step.id} open={graph.steps.length === 1}>
                  <summary>
                    {step.label} · {step.status}
                  </summary>
                  {destination && (
                    <button
                      className={`button small ${styles.openStep}`}
                      type="button"
                      aria-label={`Open draft step ${step.label || step.id} in ${graph.label}`}
                      onClick={() => onOpenStep({ id: step.id, path: destination })}
                    >
                      Open draft step
                    </button>
                  )}
                  <ChangeRows changes={step.settings} />
                </details>
              );
            })}
          </details>
        );
      })}
    </div>
  );
}

export function DraftChangesPreview({
  revision,
  draft,
  disabled,
  onOpenStep,
}: {
  revision: WorkflowRevision;
  draft: Workflow;
  disabled: boolean;
  onOpenStep: (id: string, path: GraphCrumb[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ step: DraftStep; draft: Workflow }>();
  const destination = pending?.draft === draft ? pending.step : undefined;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setPending(undefined);
        setOpen(next);
      }}
      onOpenChangeComplete={(next) => {
        if (next) return;
        setPending(undefined);
        if (destination) onOpenStep(destination.id, destination.path);
      }}
    >
      <DialogTrigger className="button" disabled={disabled}>
        Draft changes
      </DialogTrigger>
      <DialogBackdrop className="dialog-backdrop" />
      <DialogContent
        className={`run-dialog ${styles.dialog}`}
        finalFocus={destination ? "none" : undefined}
        onKeyDown={(event) => {
          if (historyShortcut(event.nativeEvent)) event.stopPropagation();
        }}
      >
        <div className="dialog-heading">
          <DialogTitle>Draft changes</DialogTitle>
          <DialogClose className="button icon-button ghost" aria-label="Close draft changes">
            <X size={16} aria-hidden="true" />
          </DialogClose>
        </div>
        <DialogDescription>Compared with saved revision {revision.number}.</DialogDescription>
        {open && (
          <DraftChanges
            saved={revision.workflow}
            draft={draft}
            onOpenStep={(step) => {
              setPending({ step, draft });
              setOpen(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
