import Image from "next/image";
import { useState, type ReactNode, type RefObject } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { X } from "lucide-react";
import { contentUrl, evidenceUrl } from "@/lib/evidence";
import styles from "./source-intake.module.css";

export type ChartPreviewSource = {
  id: string;
  title: string;
  artifactId: string;
  attribution?: string;
};

function ChartImage({ artifactId, title }: Pick<ChartPreviewSource, "artifactId" | "title">) {
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [originalSize, setOriginalSize] = useState(false);
  return unavailable ? (
    <p className={styles.chartPreviewError} role="alert">
      The original chart could not be loaded.
    </p>
  ) : (
    <>
      <div className={styles.chartViewTools}>
        <button
          className="button small"
          type="button"
          disabled={!loaded}
          aria-pressed={originalSize}
          onClick={() => setOriginalSize(!originalSize)}
        >
          Original size
        </button>
      </div>
      <div
        className={styles.chartViewport}
        role="region"
        aria-label="Chart image"
        tabIndex={originalSize ? 0 : undefined}
        data-original-size={originalSize || undefined}
      >
        <Image
          className={styles.original}
          unoptimized
          src={contentUrl(artifactId)}
          alt={title}
          width={1200}
          height={720}
          loading="eager"
          onLoad={() => setLoaded(true)}
          onError={() => setUnavailable(true)}
        />
      </div>
    </>
  );
}

export function SourceChartDialog({
  charts,
  selectedId,
  onSelect,
  opener,
  action,
}: {
  charts: ChartPreviewSource[];
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  opener: RefObject<HTMLButtonElement | null>;
  action?: ReactNode;
}) {
  const index = charts.findIndex((chart) => chart.id === selectedId);
  const chart = charts[index];
  return (
    <Dialog
      open={!!chart}
      onOpenChange={(open) => {
        if (!open) onSelect(undefined);
      }}
    >
      <DialogBackdrop className="dialog-backdrop" />
      <DialogContent
        className={styles.chartDialog}
        initialFocus="content"
        finalFocus={() => opener.current}
      >
        {chart && (
          <>
            <header>
              <div>
                <DialogTitle>{chart.title}</DialogTitle>
                <DialogDescription>
                  Chart {index + 1} of {charts.length}
                  {chart.attribution && ` · ${chart.attribution}`}
                </DialogDescription>
              </div>
              <DialogClose aria-label="Close chart preview" className="button icon-button">
                <X size={18} aria-hidden />
              </DialogClose>
            </header>
            <ChartImage key={chart.artifactId} artifactId={chart.artifactId} title={chart.title} />
            <footer>
              <a href={evidenceUrl(chart.id)} target="_blank" rel="noopener">
                Open source record
              </a>
              <div>
                <button
                  type="button"
                  className="button small"
                  disabled={!index}
                  onClick={() => onSelect(charts[index - 1]?.id)}
                >
                  Previous chart
                </button>
                <button
                  type="button"
                  className="button small"
                  disabled={index === charts.length - 1}
                  onClick={() => onSelect(charts[index + 1]?.id)}
                >
                  Next chart
                </button>
              </div>
              {action}
            </footer>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
