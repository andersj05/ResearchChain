import type { ExtraProps } from "react-markdown";
import styles from "./research-reader.module.css";

type Element = NonNullable<ExtraProps["node"]>;
type Content = Element["children"][number];
export const reportHeadingPrefix = "study-report-section-";
const minimumSections = 4;

function textOf(node: Content): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return "";
  if (node.tagName === "br") return " ";
  if (node.tagName === "img") return String(node.properties.alt ?? "");
  return node.children.map(textOf).join("");
}

function slugFor(label: string) {
  const slug = label
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+/u, "");
  return [...slug].slice(0, 64).join("").replace(/-+$/u, "") || "section";
}

function element(
  tagName: string,
  children: Content[],
  properties: Element["properties"] = {},
): Element {
  return { type: "element", tagName, properties, children };
}

export function reportContents() {
  return (tree: { type: string; children?: Content[] }) => {
    if (tree.type !== "root" || !tree.children) return;
    // Only heading elements produced by the Markdown parser can become sections.
    // Raw HTML and headings quoted inside the report remain outside the index.
    const headings = tree.children.flatMap((node) => {
      if (node.type !== "element" || !/^h[1-6]$/u.test(node.tagName)) return [];
      const label = textOf(node).replace(/\s+/gu, " ").trim();
      return label ? [{ node, label, level: Number(node.tagName[1]) }] : [];
    });
    const title = headings[0]?.level === 1 ? headings[0].node : undefined;
    const sections = title ? headings.slice(1) : headings;
    if (sections.length < minimumSections) return;

    const topLevel = sections.reduce((level, section) => Math.min(level, section.level), 6);
    const used = new Set<string>();
    const nextSuffix = new Map<string, number>();
    const items = sections.map(({ node, label, level }) => {
      const base = reportHeadingPrefix + slugFor(label);
      let suffix = nextSuffix.get(base) ?? 1;
      let id = suffix === 1 ? base : `${base}-${suffix}`;
      while (used.has(id)) id = `${base}-${++suffix}`;
      nextSuffix.set(base, suffix + 1);
      used.add(id);
      node.properties.id = id;
      const link = element("a", [{ type: "text", value: label }], {
        href: `#${encodeURIComponent(id)}`,
        dataReportContentsLink: true,
      });
      return element(
        "li",
        [link],
        level > topLevel ? { className: [styles.contentsSubsection!] } : {},
      );
    });
    tree.children.splice(
      title ? tree.children.indexOf(title) + 1 : 0,
      0,
      element(
        "nav",
        [
          element("details", [
            element("summary", [{ type: "text", value: "Contents" }]),
            element("ol", items),
          ]),
        ],
        { ariaLabel: "Report contents", className: [styles.contents!] },
      ),
    );
  };
}
