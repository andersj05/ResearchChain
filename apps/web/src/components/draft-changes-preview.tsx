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

function DraftChanges({ saved, draft }: { saved: Workflow; draft: Workflow }) {
  const comparison = compareWorkflowDraft(saved, draft);
  if (comparison.kind === "matched")
    return <p className={styles.message}>The draft matches the saved revision.</p>;
  if (comparison.kind === "layout")
    return <p className={styles.message}>Only canvas positions changed.</p>;
  if (comparison.kind === "other")
    return (
      <p className={styles.message}>The draft changes document details outside this preview.</p>
    );

  return (
    <div className={styles.groups}>
      {comparison.settings.length > 0 && (
        <details open>
          <summary>Workflow settings</summary>
          <ChangeRows changes={comparison.settings} />
        </details>
      )}
      {comparison.graphs.map((graph) => (
        <details key={graph.key} open>
          <summary>{graph.label}</summary>
          <ChangeRows changes={graph.settings} />
          {graph.steps.map((step) => (
            <details key={step.id} open={graph.steps.length === 1}>
              <summary>
                {step.label} · {step.status}
              </summary>
              <ChangeRows changes={step.settings} />
            </details>
          ))}
        </details>
      ))}
    </div>
  );
}

export function DraftChangesPreview({
  revision,
  draft,
  disabled,
}: {
  revision: WorkflowRevision;
  draft: Workflow;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="button" disabled={disabled}>
        Draft changes
      </DialogTrigger>
      <DialogBackdrop className="dialog-backdrop" />
      <DialogContent
        className={`run-dialog ${styles.dialog}`}
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
        {open && <DraftChanges saved={revision.workflow} draft={draft} />}
      </DialogContent>
    </Dialog>
  );
}
