const indexes = {
  activity: {
    panelId: "research-activity",
    headingId: "research-activity-heading",
    label: "Activity log",
    returnLabel: "Back to activity",
  },
  files: {
    panelId: "study-files",
    headingId: "study-files-heading",
    label: "Saved files",
    returnLabel: "Back to saved files",
  },
};

export type StudyIndexReturn = { index: keyof typeof indexes; targetId: string };

export function focusStudyIndex(index: StudyIndexReturn["index"], targetId: string) {
  const row = document.getElementById(targetId);
  const target = row ?? document.getElementById(indexes[index].headingId);
  target?.focus({ preventScroll: true });
  target?.scrollIntoView({ block: row ? "center" : "start" });
}

export function StudyIndexLink({
  index,
  targetId,
  className,
  onReturn,
}: Pick<StudyIndexReturn, "index"> & {
  targetId?: string;
  className?: string;
  onReturn?: (targetId: string) => void;
}) {
  const { panelId, headingId, label, returnLabel } = indexes[index];
  const href = `#${headingId}`;
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        if (!targetId || !onReturn) {
          const panel = document.getElementById(panelId);
          if (panel instanceof HTMLDetailsElement) panel.open = true;
        }
        if (!targetId) return;
        event.preventDefault();
        if (window.location.hash !== href) window.history.pushState(null, "", href);
        if (onReturn) onReturn(targetId);
        else focusStudyIndex(index, targetId);
      }}
    >
      {targetId ? returnLabel : label}
    </a>
  );
}
