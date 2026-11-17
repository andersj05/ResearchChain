import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./research-reader.module.css";

export function ResearchMarkdown({ text, sources }: { text: string; sources: Set<string> }) {
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
          // Only recorded provider URLs become outgoing links. Model-authored
          // images must not send a browser request, even when their URL is known.
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
          img: ({ alt }) => <>{alt}</>,
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
