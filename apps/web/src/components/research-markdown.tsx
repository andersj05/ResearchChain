import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { components } from "@researchchain/contracts";
import { contentUrl } from "@/lib/evidence";
import styles from "./research-reader.module.css";

type WorkspaceFile = components["schemas"]["WorkspaceFile"];

export function ResearchMarkdown({
  text,
  sources,
  files = [],
}: {
  text: string;
  sources: Set<string>;
  files?: WorkspaceFile[];
}) {
  const charts = new Map(
    files.filter((file) => file.media_type === "image/png").map((file) => [file.name, file]),
  );
  return (
    <div className={styles.prose}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          h1: ({ children }) => <h4>{children}</h4>,
          h2: ({ children }) => <h5>{children}</h5>,
          h3: ({ children }) => <h6>{children}</h6>,
          h4: ({ children }) => <h6>{children}</h6>,
          h5: ({ children }) => <h6>{children}</h6>,
          h6: ({ children }) => <h6>{children}</h6>,
          // Outgoing links require a recorded source. Figures can only reference
          // authenticated PNGs in this workspace's saved file inventory.
          a: ({ href, children }) =>
            href && sources.has(href) ? (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ) : (
              <>
                {children}
                {href && typeof children === "string" && children !== href && ` (${href})`}
              </>
            ),
          img: ({ alt, src }) => {
            const name = typeof src === "string" ? src.replace(/^\.\//, "") : "";
            const chart = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(name) && charts.get(name);
            return chart ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${contentUrl(chart.artifact_id)}?preview=true`}
                alt={alt || name}
                loading="lazy"
              />
            ) : (
              <>{alt}</>
            );
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
