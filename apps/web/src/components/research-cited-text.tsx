import type { ReactNode } from "react";

// Link only URLs actually present in provider source records. Model prose remains
// escaped React text; it cannot supply HTML or invent a verified-source link.
export function ResearchCitedText({ text, sources }: { text: string; sources: Set<string> }) {
  const pieces: ReactNode[] = [];
  const links = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"\]]+)/g;
  let cursor = 0;
  for (const match of text.matchAll(links)) {
    const rawUrl = match[2] ?? match[3]!;
    let url = rawUrl;
    while (!sources.has(url) && /[.,;:!?)]$/.test(url)) url = url.slice(0, -1);
    if (!sources.has(url)) continue;
    pieces.push(text.slice(cursor, match.index));
    pieces.push(
      <a key={match.index} href={url} target="_blank" rel="noreferrer">
        {match[1] ?? url}
      </a>,
    );
    if (!match[1]) pieces.push(rawUrl.slice(url.length));
    cursor = match.index + match[0].length;
  }
  pieces.push(text.slice(cursor));
  return <>{pieces}</>;
}
