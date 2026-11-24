import Image from "next/image";
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
  function move(index: number, distance: number) {
    const next = [...ids];
    [next[index], next[index + distance]] = [ids[index + distance]!, ids[index]!];
    onChange(next);
  }
  return (
    <section className={styles.packet} aria-labelledby="packet-heading">
      <header>
        <h2 id="packet-heading">Study packet</h2>
        <span aria-live="polite">
          {ids.length} {ids.length === 1 ? "source" : "sources"}
        </span>
      </header>
      {ids.length ? (
        <>
          <ol aria-label="Pinned material" className={styles.pins}>
            {ids.map((id, index) => {
              const item = records[index];
              const [label, Icon] = kinds[item?.kind ?? "text"];
              const title = item?.title ?? `Source ${id.slice(0, 8)}`;
              return (
                <li key={id}>
                  <a
                    href={evidenceUrl(id)}
                    target="_blank"
                    rel="noopener"
                    className={styles.pinLink}
                  >
                    <span className={styles.thumb}>
                      {item?.artifact?.media_type.startsWith("image/") ? (
                        <Image
                          unoptimized
                          src={contentUrl(item.artifact.id)}
                          width={54}
                          height={40}
                          alt=""
                        />
                      ) : (
                        <Icon size={19} strokeWidth={1.5} />
                      )}
                    </span>
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
                        <button
                          className={styles.icon}
                          type="button"
                          disabled={disabled || index === 0}
                          aria-label={`Move ${title} up`}
                          onClick={() => move(index, -1)}
                        >
                          <ChevronUp size={15} />
                        </button>
                        <button
                          className={styles.icon}
                          type="button"
                          disabled={disabled || index === ids.length - 1}
                          aria-label={`Move ${title} down`}
                          onClick={() => move(index, 1)}
                        >
                          <ChevronDown size={15} />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className={styles.icon}
                      aria-label={`Unpin ${title}`}
                      disabled={disabled}
                      onClick={() => onChange(ids.filter((v) => v !== id))}
                    >
                      <X size={15} />
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
    </section>
  );
}
