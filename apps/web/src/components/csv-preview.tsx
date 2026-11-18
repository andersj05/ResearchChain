import { useMemo } from "react";

const rowLimit = 50;
const columnLimit = 20;

function parseRows(text: string) {
  const body = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  // Match one quoted or unquoted field at the current position, then its separator.
  const field = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))(\r\n|[,\r\n]|$)/y;
  let row: string[] = [];
  while (field.lastIndex < body.length) {
    const match = field.exec(body);
    if (!match) return null;
    row.push(match[1]?.replaceAll('""', '"') ?? match[2]!);
    if (match[3] === ",") {
      if (field.lastIndex === body.length) row.push("");
    } else {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  const [header, ...data] = rows;
  return header && data.every((item) => item.length === header.length) ? { header, data } : null;
}

export function CsvPreview({ text }: { text: string }) {
  const parsed = useMemo(() => parseRows(text), [text]);
  if (!parsed) {
    return (
      <>
        <p className="field-hint">Showing raw CSV.</p>
        <pre tabIndex={0}>{text}</pre>
      </>
    );
  }

  const { header, data } = parsed;
  const rows = data.slice(0, rowLimit);
  const columns = header.slice(0, columnLimit);
  const limits = [
    rows.length < data.length && `${rows.length} of ${data.length} data rows`,
    columns.length < header.length && `${columns.length} of ${header.length} columns`,
  ]
    .filter(Boolean)
    .join(" and ");
  return (
    <div className="csv-preview">
      {limits && <p className="field-hint">Showing {limits}.</p>}
      <div className="csv-table-scroll" tabIndex={0} role="region" aria-label="CSV preview table">
        <table>
          <thead>
            <tr>
              {columns.map((value, index) => (
                <th key={index} scope="col">
                  {value}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.slice(0, columnLimit).map((value, position) => (
                  <td key={position}>{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary>Show raw CSV</summary>
        <pre tabIndex={0}>{text}</pre>
      </details>
    </div>
  );
}
