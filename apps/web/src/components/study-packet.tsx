import Image from "next/image";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  ImageIcon,
  Link2,
  MessagesSquare,
  Table2,
  X,
} from "lucide-react";
import { contentUrl, evidenceUrl, type EvidenceRecord } from "@/lib/evidence";
import { SourceChartDialog } from "./source-chart-dialog";
import styles from "./source-intake.module.css";

const kinds = {
  image: ["Chart", ImageIcon],
  discussion: ["Conversation", MessagesSquare],
  text: ["Note", FileText],
  link: ["Link only", Link2],
  report: ["Report", FileText],
  dataset: ["Dataset", Table2],
} as const;

function sourceCount(count: number) {
  return `${count} ${count === 1 ? "source" : "sources"}`;
}

export function packetSize(records: (EvidenceRecord | undefined)[]) {
  return records.reduce((sum, item) => {
    const file = item?.artifact;
    if (!file) return sum;
    return (
      sum +
      (file.media_type.startsWith("image/") || file.media_type === "application/pdf"
        ? 4 * Math.ceil(file.byte_size / 3)
        : file.byte_size)
    );
  }, 0);
}

export function StudyPacket({
  ids,
  records,
  onChange,
  disabled,
  limit,
  size,
  error,
  appendNotice,
  retry,
}: {
  ids: string[];
  records: (EvidenceRecord | undefined)[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  limit: number;
  size: number;
  error: string;
  appendNotice?: string;
  retry?: () => void;
}) {
  const [previewId, setPreviewId] = useState<string>();
  const [sourceToMove, setSourceToMove] = useState<string>();
  const [destination, setDestination] = useState<{ sourceId: string; index: number }>();
  const [edit, setEdit] = useState<{
    ids: string[];
    focusId: string;
    message: string;
    restoreIds?: string[];
  }>();
  const opener = useRef<HTMLButtonElement>(null);
  const packetId = useId();
  const charts = records.flatMap((record) =>
    record?.artifact?.media_type.startsWith("image/")
      ? [
          {
            id: record.id,
            title: record.title,
            artifactId: record.artifact.id,
            attribution: [record.author || record.publisher, record.as_of_date]
              .filter(Boolean)
              .join(" · "),
          },
        ]
      : [],
  );
  const appliedEdit = edit?.ids === ids ? edit : undefined;
  const canUndoBulkUnpin = !!appliedEdit?.restoreIds;
  const bulkUnpinId = `${packetId}-unpin-all`;
  const undoId = `${packetId}-undo-unpin-all`;
  const sourceIndex = Math.max(0, ids.indexOf(sourceToMove ?? ""));
  const sourceId = ids[sourceIndex];
  const destinationIndex =
    destination && destination.sourceId === sourceId
      ? Math.min(destination.index, ids.length - 1)
      : sourceIndex;
  useLayoutEffect(() => {
    if (appliedEdit) document.getElementById(appliedEdit.focusId)?.focus();
  }, [appliedEdit]);

  function move(index: number, destination: number, focusId: string, title: string) {
    const id = ids[index];
    if (disabled || !id || !ids[destination] || index === destination) return;
    const next = [...ids];
    next.splice(index, 1);
    next.splice(destination, 0, id);
    setEdit({
      ids: next,
      focusId,
      message: `${title} moved to position ${destination + 1} of ${ids.length}.`,
    });
    onChange(next);
  }
  function unpin(id: string, index: number, title: string) {
    const next = ids.filter((item) => item !== id);
    const neighbor = ids[index + 1] ?? ids[index - 1];
    setEdit({
      ids: next,
      focusId: neighbor ? `${packetId}-${neighbor}-unpin` : "packet-heading",
      message: `Unpinned ${title}. ${sourceCount(next.length)} in the packet.`,
    });
    onChange(next);
  }
  function unpinAll() {
    const next: string[] = [];
    setEdit({
      ids: next,
      focusId: undoId,
      message: `Unpinned ${sourceCount(ids.length)}. Undo is available.`,
      restoreIds: ids,
    });
    onChange(next);
  }
  function undoUnpinAll() {
    const restore = appliedEdit?.restoreIds;
    if (!restore) return;
    setEdit({
      ids: restore,
      focusId: bulkUnpinId,
      message: `Restored ${sourceCount(restore.length)} in reading order.`,
    });
    onChange(restore);
  }
  return (
    <section className={styles.packet} aria-labelledby="packet-heading">
      <header>
        <h2 id="packet-heading" tabIndex={-1}>
          Study packet
        </h2>
        <div className={styles.packetActions}>
          <span>{sourceCount(ids.length)}</span>
          {ids.length > 1 && (
            <button
              id={bulkUnpinId}
              type="button"
              className="button small"
              disabled={disabled}
              onClick={unpinAll}
            >
              Unpin all
            </button>
          )}
          {canUndoBulkUnpin && (
            <button
              id={undoId}
              type="button"
              className="button small"
              disabled={disabled}
              aria-label="Undo unpin all"
              onClick={undoUnpinAll}
            >
              Undo
            </button>
          )}
        </div>
      </header>
      {appendNotice && <p role="status">{appendNotice}</p>}
      <p className="sr-only" role="status">
        {appliedEdit?.message ?? sourceCount(ids.length)}
      </p>
      {ids.length > 1 && (
        <details className={styles.moveSource}>
          <summary>Move a source</summary>
          <form
            aria-label="Set reading order"
            onSubmit={(event) => {
              event.preventDefault();
              if (!sourceId) return;
              const title = records[sourceIndex]?.title ?? `Source ${sourceId.slice(0, 8)}`;
              move(sourceIndex, destinationIndex, `${packetId}-${sourceId}-source`, title);
              setDestination(undefined);
            }}
          >
            <fieldset disabled={disabled}>
              <label>
                Source
                <select
                  value={sourceId}
                  onChange={(event) => {
                    setSourceToMove(event.target.value);
                    setDestination(undefined);
                  }}
                >
                  {ids.map((id, index) => (
                    <option key={id} value={id}>
                      {index + 1}. {records[index]?.title ?? `Source ${id.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                New position
                <select
                  value={destinationIndex}
                  onChange={(event) => {
                    if (sourceId) setDestination({ sourceId, index: Number(event.target.value) });
                  }}
                >
                  {ids.map((id, index) => (
                    <option key={id} value={index}>
                      {index + 1}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button small"
                type="submit"
                disabled={sourceIndex === destinationIndex}
              >
                Move source
              </button>
            </fieldset>
          </form>
        </details>
      )}
      {ids.length ? (
        <>
          <ol aria-label="Pinned material" className={styles.pins}>
            {ids.map((id, index) => {
              const item = records[index];
              const [label, Icon] = kinds[item?.kind ?? "text"];
              const title = item?.title ?? `Source ${id.slice(0, 8)}`;
              const upId = `${packetId}-${id}-up`;
              const downId = `${packetId}-${id}-down`;
              return (
                <li key={id}>
                  {item?.artifact?.media_type.startsWith("image/") ? (
                    <button
                      type="button"
                      className={styles.thumb}
                      aria-label={`Preview chart ${title}`}
                      aria-haspopup="dialog"
                      onClick={(event) => {
                        opener.current = event.currentTarget;
                        setPreviewId(id);
                      }}
                    >
                      <Image
                        unoptimized
                        src={contentUrl(item.artifact.id)}
                        width={54}
                        height={40}
                        alt=""
                      />
                    </button>
                  ) : (
                    <span className={styles.thumb}>
                      <Icon size={19} strokeWidth={1.5} />
                    </span>
                  )}
                  <a
                    id={`${packetId}-${id}-source`}
                    href={evidenceUrl(id)}
                    target="_blank"
                    rel="noopener"
                    className={styles.pinLink}
                  >
                    <span>
                      <strong>{title}</strong>
                      <small>
                        {item
                          ? [label, item.author || item.publisher, item.as_of_date]
                              .filter(Boolean)
                              .join(" · ")
                          : "Loading source details…"}
                      </small>
                    </span>
                  </a>
                  <div className={styles.pinTools}>
                    {ids.length > 1 && (
                      <>
                        <Button
                          id={upId}
                          className={styles.icon}
                          disabled={disabled || index === 0}
                          focusableWhenDisabled={!disabled}
                          aria-label={`Move ${title} up`}
                          onClick={() => move(index, index - 1, upId, title)}
                        >
                          <ChevronUp size={15} aria-hidden />
                        </Button>
                        <Button
                          id={downId}
                          className={styles.icon}
                          disabled={disabled || index === ids.length - 1}
                          focusableWhenDisabled={!disabled}
                          aria-label={`Move ${title} down`}
                          onClick={() => move(index, index + 1, downId, title)}
                        >
                          <ChevronDown size={15} aria-hidden />
                        </Button>
                      </>
                    )}
                    <button
                      id={`${packetId}-${id}-unpin`}
                      type="button"
                      className={styles.icon}
                      aria-label={`Unpin ${title}`}
                      disabled={disabled}
                      onClick={() => unpin(id, index, title)}
                    >
                      <X size={15} aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className={styles.meta}>
            Source content uses at least{" "}
            {(size / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} MB of the{" "}
            {(limit / 1_000_000).toLocaleString()} MB request limit.
          </p>
          {retry && (
            <button className="text-link" type="button" onClick={retry}>
              Retry source details
            </button>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </>
      ) : (
        <p className={styles.empty}>
          Pin the charts, notes and conversations you want the lead to read together.
        </p>
      )}
      <SourceChartDialog
        charts={charts}
        selectedId={previewId}
        onSelect={setPreviewId}
        opener={opener}
      />
    </section>
  );
}
