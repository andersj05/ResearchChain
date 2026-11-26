import { useEffect, useRef, type ReactNode } from "react";
import Markdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { components } from "@researchchain/contracts";
import { contentUrl } from "@/lib/evidence";
import { reportContents, reportHeadingPrefix } from "./report-contents";
import { ReportFigureButton, reportFigureActions } from "./report-figures";
import styles from "./research-reader.module.css";

type WorkspaceFile = components["schemas"]["WorkspaceFile"];

function renderHeading(Tag: "h4" | "h5" | "h6") {
  return function Heading({ children, node }: ExtraProps & { children?: ReactNode }) {
    const value = node?.properties.id;
    const id =
      typeof value === "string" && value.startsWith(reportHeadingPrefix) ? value : undefined;
    return (
      <Tag id={id} tabIndex={id ? -1 : undefined}>
        {children}
      </Tag>
    );
  };
}

const heading = renderHeading("h4");
const subheading = renderHeading("h5");
const minorHeading = renderHeading("h6");

export function ResearchMarkdown({
  text,
  sources,
  files = [],
  contents = false,
  inspectFigures = false,
}: {
  text: string;
  sources: Set<string>;
  files?: WorkspaceFile[];
  contents?: boolean;
  inspectFigures?: boolean;
}) {
  const prose = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    if (!contents || !fragment.startsWith(reportHeadingPrefix)) return;
    let id: string;
    try {
      id = decodeURIComponent(fragment);
    } catch {
      return;
    }
    const heading = document.getElementById(id);
    if (!heading || !prose.current?.contains(heading)) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "start" });
  }, [contents, text]);
  const charts = new Map(
    files.filter((file) => file.media_type === "image/png").map((file) => [file.name, file]),
  );
  function figure(src: unknown, alt: unknown) {
    const name = typeof src === "string" ? src.replace(/^\.\//, "") : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(name)) return;
    const chart = charts.get(name);
    if (chart) {
      return {
        src: `${contentUrl(chart.artifact_id)}?preview=true`,
        title: typeof alt === "string" && alt ? alt : name,
        filename: name,
      };
    }
  }
  return (
    <div className={styles.prose} ref={prose}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          ...(contents ? [reportContents] : []),
          ...(inspectFigures && charts.size ? [reportFigureActions] : []),
        ]}
        skipHtml
        components={{
          h1: heading,
          h2: subheading,
          h3: minorHeading,
          h4: minorHeading,
          h5: minorHeading,
          h6: minorHeading,
          // Outgoing links require a recorded source. Figures can only reference
          // authenticated PNGs in this workspace's saved file inventory.
          a: ({ href, children, node }) => {
            if (
              contents &&
              node?.properties.dataReportContentsLink === true &&
              href?.startsWith(`#${reportHeadingPrefix}`)
            ) {
              return <a href={href}>{children}</a>;
            }
            return href && sources.has(href) ? (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ) : (
              <>
                {children}
                {href && typeof children === "string" && children !== href && ` (${href})`}
              </>
            );
          },
          img: ({ alt, src }) => {
            const chart = figure(src, alt);
            return chart ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={chart.src} alt={chart.title} loading="lazy" />
            ) : (
              <>{alt}</>
            );
          },
          button: ({ node }) => {
            if (!inspectFigures) return null;
            const chart = figure(
              node?.properties.dataReportFigureSource,
              node?.properties.dataReportFigureLabel,
            );
            return chart ? <ReportFigureButton {...chart} /> : null;
          },
          table: ({ children }) => (
            <div
              className={styles.tableScroll}
              role="region"
              aria-label="Research table"
              tabIndex={0}
            >
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
