// Optional exact numeric inputs belong in a ```research-data JSON block in the brief.
// No number is extracted from a chart or model response by this calculation.
const research = JSON.parse(inputs.text);
const packet = {
  research_notes: research.conclusion,
  web_sources: [],
  source_list_truncated: false,
};
const sources = research.web_research?.sources ?? [];
for (const source of sources) {
  if (JSON.stringify(packet).length + JSON.stringify(source).length > 14000) {
    packet.source_list_truncated = true;
    break;
  }
  packet.web_sources.push(source);
}
const blocks = [...inputs.brief.matchAll(/```research-data\s*([\s\S]*?)```/g)];
let analytics = {
  status: "needs_data",
  reason:
    "No research-data block supplied. Request paired numeric observations with dates, units and a source. Chart pixels and web prose are not numeric input.",
};
if (blocks.length > 1) throw new Error("Use one research-data block per run.");
if (blocks.length === 1) {
  const data = JSON.parse(blocks[0][1]);
  const required = ["source", "as_of", "x_label", "x_unit", "y_label", "y_unit"];
  if (required.some((k) => typeof data[k] !== "string" || !data[k].trim() || data[k].length > 400))
    throw new Error("Data needs source, as_of, x_label, x_unit, y_label and y_unit.");
  if (!["supplied_numeric", "estimate"].includes(data.basis))
    throw new Error("basis must be supplied_numeric or estimate.");
  const rows = data.observations;
  if (!Array.isArray(rows) || rows.length < 3 || rows.length > 500)
    throw new Error("Supply 3 to 500 paired observations.");
  const numeric = (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e50;
  if (
    rows.some(
      (r) =>
        !r ||
        typeof r.period !== "string" ||
        !r.period.trim() ||
        r.period.length > 80 ||
        !numeric(r.x) ||
        !numeric(r.y),
    )
  )
    throw new Error(
      "Each observation needs a period and finite numeric x and y; no missing values or numeric strings.",
    );
  if (new Set(rows.map((r) => r.period)).size !== rows.length)
    throw new Error("Observation periods must be distinct and aligned.");
  const n = rows.length;
  const mx = rows.reduce((s, r) => s + r.x, 0) / n,
    my = rows.reduce((s, r) => s + r.y, 0) / n;
  const xx = rows.reduce((s, r) => s + (r.x - mx) ** 2, 0);
  const yy = rows.reduce((s, r) => s + (r.y - my) ** 2, 0);
  const xy = rows.reduce((s, r) => s + (r.x - mx) * (r.y - my), 0);
  if (!(xx > 0)) throw new Error("x must vary to fit this linear model.");
  const slope = xy / xx,
    intercept = my - slope * mx;
  const correlation = yy > 0 ? Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy))) : null;
  const scenarios = data.scenario_x ?? [];
  if (!Array.isArray(scenarios) || scenarios.length > 12 || scenarios.some((x) => !numeric(x)))
    throw new Error("scenario_x must contain at most 12 finite numbers.");
  const minX = Math.min(...rows.map((r) => r.x)),
    maxX = Math.max(...rows.map((r) => r.x));
  analytics = {
    status: "computed",
    method: "Ordinary least squares, y = intercept + slope * x; Pearson sample correlation",
    n,
    provenance: Object.fromEntries([...required, "basis"].map((k) => [k, data[k]])),
    input_verification: "User-supplied values and provenance; not independently verified",
    x_mean: mx,
    y_mean: my,
    x_min: minX,
    x_max: maxX,
    intercept,
    slope,
    correlation,
    r_squared: correlation === null ? null : correlation ** 2,
    scenarios: scenarios.map((x) => ({
      x,
      y: intercept + slope * x,
      extrapolation: x < minX || x > maxX,
    })),
    limitations: [
      "Descriptive sample fit, not a causal estimate or validated forecast.",
      "No lag alignment, detrending, stationarity checks, confounder controls or out-of-sample validation.",
      "Scenario values are assumptions; small samples and time-series levels can produce misleading correlations.",
    ],
  };
}
return {
  text: JSON.stringify({ ...packet, analytics }),
  number: analytics.status === "computed" ? analytics.slope : 0,
};
