import { useEffect, useRef, useState } from "react";
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
import { api, type RevisionSummary, type Workflow, type WorkflowRevision } from "@/lib/workflow";
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

function earlierRevisions(revision: WorkflowRevision, history: RevisionSummary[]) {
  const currentVersion = history.find((item) => item.id === revision.id)?.agent_version;
  if (currentVersion === undefined) return [];

  const seen = new Set([revision.id]);
  const options: RevisionSummary[] = [];
  for (const item of history) {
    if (
      item.agent_version === undefined ||
      item.agent_version >= currentVersion ||
      seen.has(item.id)
    )
      continue;
    seen.add(item.id);
    options.push(item);
  }
  return options;
}

export function DraftChangesPreview({
  revision,
  history = [],
  draft,
  disabled,
}: {
  revision: WorkflowRevision;
  history?: RevisionSummary[];
  draft: Workflow;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [historical, setHistorical] = useState<{ id: string; saved?: Workflow | "error" }>();
  const requestSequence = useRef(0);
  useEffect(
    () => () => {
      requestSequence.current += 1;
    },
    [],
  );
  const options = earlierRevisions(revision, history);
  const comparison = options.find((item) => item.id === historical?.id);
  const saved = comparison ? historical?.saved : revision.workflow;

  async function selectBaseline(id: string) {
    const request = ++requestSequence.current;
    if (!options.some((item) => item.id === id)) {
      setHistorical(undefined);
      return;
    }
    setHistorical({ id });
    let saved: Workflow | "error" = "error";
    try {
      const result = await api<WorkflowRevision>(`revisions/${encodeURIComponent(id)}`);
      if (result.id === id) saved = result.workflow;
    } catch {
      // The same selection can be retried without changing the draft or its saved revision.
    }
    if (request === requestSequence.current) setHistorical({ id, saved });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          requestSequence.current += 1;
          setHistorical(undefined);
        }
      }}
    >
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
        <DialogDescription>
          Compared with saved revision {(comparison ?? revision).number}.
        </DialogDescription>
        {open && options.length > 0 && (
          <label className={styles.baseline}>
            <span>Compare with</span>
            <select
              value={comparison?.id ?? revision.id}
              onChange={(event) => void selectBaseline(event.target.value)}
            >
              <option value={revision.id}>Current saved revision {revision.number}</option>
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  Version {item.agent_version} · Revision {item.number}
                </option>
              ))}
            </select>
          </label>
        )}
        {open && comparison && saved === undefined && (
          <p className={styles.message} role="status">
            Loading saved revision…
          </p>
        )}
        {open && comparison && saved === "error" && (
          <div className={styles.message}>
            <p className="error" role="alert">
              Could not load the selected saved revision.
            </p>
            <button
              className="button small"
              type="button"
              onClick={() => void selectBaseline(comparison.id)}
            >
              Retry comparison
            </button>
          </div>
        )}
        {open && saved && saved !== "error" && (
          <DraftChanges key={comparison?.id ?? revision.id} saved={saved} draft={draft} />
        )}
      </DialogContent>
    </Dialog>
  );
}
