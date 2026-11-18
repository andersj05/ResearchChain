import { useId, useState } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import { historyShortcut } from "@/components/canvas/use-workflow-history";
import styles from "./workflow-step-text.module.css";

const maxLength = 6000;

export function WorkflowStepText({
  name,
  label,
  value,
  placeholder,
  disabled,
  onChange,
  onApply,
}: {
  name: string;
  label: "Instructions" | "Review question";
  value: string;
  placeholder?: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onApply: (value: string) => void;
}) {
  const id = useId();
  const [edit, setEdit] = useState<{ original: string; text: string }>();
  const stale = edit && edit.original !== value;

  return (
    <Dialog
      open={edit !== undefined}
      onOpenChange={(open) => setEdit(open ? { original: value, text: value } : undefined)}
    >
      <div className={styles.fieldHeading}>
        <label htmlFor={id}>{label}</label>
        <DialogTrigger
          className="button small"
          aria-label={`Expand ${label.toLowerCase()}`}
          disabled={disabled}
        >
          Expand
        </DialogTrigger>
      </div>
      <textarea
        id={id}
        rows={4}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <DialogBackdrop className="dialog-backdrop" />
      <DialogContent
        className={`run-dialog ${styles.dialog}`}
        onKeyDown={(event) => {
          if (historyShortcut(event.nativeEvent)) event.stopPropagation();
        }}
      >
        <DialogTitle>Edit {label.toLowerCase()}</DialogTitle>
        <DialogDescription>{name}</DialogDescription>
        {edit && (
          <textarea
            className={styles.editor}
            aria-label={label}
            maxLength={maxLength}
            placeholder={placeholder}
            value={edit.text}
            onChange={(event) => setEdit({ ...edit, text: event.target.value })}
          />
        )}
        {stale && <p role="status">The draft text changed. Reopen this editor to update it.</p>}
        <div className="dialog-actions">
          <DialogClose className="button">Cancel</DialogClose>
          <button
            type="button"
            className="button primary"
            disabled={disabled || !edit || stale || edit.text === value}
            onClick={() => {
              if (!edit || stale) return;
              onApply(edit.text);
              setEdit(undefined);
            }}
          >
            Apply to draft
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
