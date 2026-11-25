import Image from "next/image";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
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
  retry,
}: {
  ids: string[];
  records: (EvidenceRecord | undefined)[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  limit: number;
  size: number;
  error: string;
  retry?: () => void;
}) {
  const [previewId, setPreviewId] = useState<string>();
  const [edit, setEdit] = useState<{ ids: string[]; focusId: string; message: string }>();
  const opener = useRef<HTMLButtonElement>(null);
  const packetId = useId();
  const charts = records.filter(
    (record): record is EvidenceRecord => !!record?.artifact?.media_type.startsWith("image/"),
  );
  const chartIndex = charts.findIndex((item) => item.id === previewId);
  const chart = charts[chartIndex];
  const appliedEdit = edit?.ids === ids ? edit : undefined;
  useLayoutEffect(() => {
    if (appliedEdit) document.getElementById(appliedEdit.focusId)?.focus();
  }, [appliedEdit]);

  function move(index: number, distance: -1 | 1, focusId: string, title: string) {
    const destination = index + distance;
    const id = ids[index];
    const neighbor = ids[destination];
    if (!id || !neighbor) return;
    const next = [...ids];
    next[index] = neighbor;
    next[destination] = id;
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
  return (
    <section className={styles.packet} aria-labelledby="packet-heading">
      <header>
        <h2 id="packet-heading" tabIndex={-1}>
          Study packet
        </h2>
        <span>{sourceCount(ids.length)}</span>
      </header>
      <p className="sr-only" role="status">
        {appliedEdit?.message ?? sourceCount(ids.length)}
      </p>
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
                          onClick={() => move(index, -1, upId, title)}
                        >
                          <ChevronUp size={15} aria-hidden />
                        </Button>
                        <Button
                          id={downId}
                          className={styles.icon}
                          disabled={disabled || index === ids.length - 1}
                          focusableWhenDisabled={!disabled}
                          aria-label={`Move ${title} down`}
                          onClick={() => move(index, 1, downId, title)}
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
      <Dialog
        open={!!chart}
        onOpenChange={(open) => {
          if (!open) setPreviewId(undefined);
        }}
      >
        <DialogBackdrop className="dialog-backdrop" />
        <DialogContent
          className={styles.chartDialog}
          initialFocus="content"
          finalFocus={() => opener.current}
        >
          {chart?.artifact && (
            <>
              <header>
                <div>
                  <DialogTitle>{chart.title}</DialogTitle>
                  <DialogDescription>
                    {[
                      `Chart ${chartIndex + 1} of ${charts.length}`,
                      chart.author || chart.publisher,
                      chart.as_of_date,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </DialogDescription>
                </div>
                <DialogClose aria-label="Close chart preview" className="button icon-button">
                  <X size={18} />
                </DialogClose>
              </header>
              <Image
                className={styles.original}
                unoptimized
                src={contentUrl(chart.artifact.id)}
                alt={chart.title}
                width={1200}
                height={720}
              />
              <footer>
                <a href={evidenceUrl(chart.id)} target="_blank" rel="noopener">
                  Open source record
                </a>
                <div>
                  <button
                    type="button"
                    className="button small"
                    disabled={!chartIndex}
                    onClick={() => setPreviewId(charts[chartIndex - 1]?.id)}
                  >
                    Previous chart
                  </button>
                  <button
                    type="button"
                    className="button small"
                    disabled={chartIndex === charts.length - 1}
                    onClick={() => setPreviewId(charts[chartIndex + 1]?.id)}
                  >
                    Next chart
                  </button>
                </div>
              </footer>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
