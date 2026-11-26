import { useLayoutEffect, useRef, useState } from "react";
import styles from "./research-session.module.css";

type PendingSuggestion = { value: string };

export function useDraftSuggestion(
  draft: string,
  options: readonly string[],
  save: (value: string) => void,
  focusInput: () => void,
) {
  const [pending, setPending] = useState<PendingSuggestion>();

  function returnToInput() {
    setPending(undefined);
    focusInput();
  }

  function apply(value: string) {
    if (value !== draft) save(value);
    returnToInput();
  }

  function choose(value: string) {
    if (value !== draft && draft.trim() && !options.includes(draft)) {
      setPending({ value });
    } else {
      apply(value);
    }
  }

  function edit(value: string) {
    setPending(undefined);
    save(value);
  }

  function replace() {
    if (pending) apply(pending.value);
  }

  return { pending, choose, edit, keep: returnToInput, replace };
}

export function DraftReplacement({
  suggestion,
  disabled,
  onKeep,
  onReplace,
}: {
  suggestion: PendingSuggestion;
  disabled: boolean;
  onKeep: () => void;
  onReplace: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    keep.current?.focus();
  }, [suggestion]);

  return (
    <fieldset className={styles.draftReplacement} disabled={disabled}>
      <legend>Replace your draft?</legend>
      <p>{suggestion.value}</p>
      <div>
        <button ref={keep} type="button" className="button small" onClick={onKeep}>
          Keep draft
        </button>
        <button type="button" className="button small" onClick={onReplace}>
          Replace draft
        </button>
      </div>
    </fieldset>
  );
}
