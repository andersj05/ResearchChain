import type { components } from "@researchchain/contracts";

export type ReportRevision = components["schemas"]["ReportRevision"];
export type ReportView = components["schemas"]["ReportView"];
export type ReportSummary = components["schemas"]["ReportSummary"];
export type ReportSave = components["schemas"]["ReportSave"];
export type ReportCreate = components["schemas"]["ReportCreate"];
export type ReportSection = components["schemas"]["ReportSection"];
export type ReportFeedbackCreate = components["schemas"]["ReportFeedbackCreate"];
export type StyleGuide = components["schemas"]["StyleGuide"];
export type StyleGuideCreate = components["schemas"]["StyleGuideCreate"];
export type ReportDraft = Omit<ReportSave, "id">;

export function reportDraft(record: ReportRevision): ReportDraft {
  return {
    base_revision_id: record.id,
    title: record.title,
    style_guide_id: record.style_guide_id,
    evidence_ids: record.sources.map((s) => s.id),
    sections: record.sections,
    change_note: "",
  };
}
export function downloadReportFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadDraft(draft: ReportDraft) {
  downloadReportFile(
    "report-draft.json",
    new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }),
  );
}
export function reportText(record: ReportRevision) {
  return [
    record.title,
    `Style guide: ${record.style_guide_id}`,
    ...record.sections.map((s) =>
      [
        s.heading,
        `Classification: ${s.kind}`,
        s.body,
        ...(s.citations ?? []).map(
          (c) =>
            `Source ${c.evidence_id} · ${c.relation} · ${c.basis}\n${c.locator}\n${c.quote}\n${c.rationale}`,
        ),
        ...(s.chart_ids ?? []).map((id) => `Chart: ${id}`),
      ].join("\n\n"),
    ),
  ].join("\n\n");
}
export const kindLabels = {
  fact: "Established fact",
  interpretation: "Interpretation",
  scenario: "Speculative scenario",
} as const;

export function parseRecovery(
  raw: string,
  revisionId: string,
): { draft: ReportDraft; pending: { body: string; id: string } | null } {
  const value = JSON.parse(raw);
  const draft = value?.draft;
  if (
    !draft ||
    draft.base_revision_id !== revisionId ||
    typeof draft.title !== "string" ||
    typeof draft.style_guide_id !== "string" ||
    typeof draft.change_note !== "string" ||
    !Array.isArray(draft.evidence_ids) ||
    !draft.evidence_ids.every((id: unknown) => typeof id === "string") ||
    !Array.isArray(draft.sections) ||
    !draft.sections.length ||
    !draft.sections.every(
      (s: ReportSection) =>
        s &&
        typeof s.id === "string" &&
        typeof s.heading === "string" &&
        typeof s.body === "string" &&
        typeof s.kind === "string" &&
        Object.hasOwn(kindLabels, s.kind) &&
        Array.isArray(s.citations) &&
        s.citations.every(
          (c) =>
            c &&
            typeof c.evidence_id === "string" &&
            typeof c.basis === "string" &&
            typeof c.relation === "string" &&
            typeof c.locator === "string" &&
            typeof c.quote === "string" &&
            typeof c.rationale === "string",
        ) &&
        Array.isArray(s.chart_ids) &&
        s.chart_ids.every((id) => typeof id === "string"),
    )
  ) {
    throw new Error(
      "The browser recovery record is invalid. Download or recover your draft before editing.",
    );
  }
  const pending =
    value.pending && typeof value.pending.body === "string" && typeof value.pending.id === "string"
      ? value.pending
      : null;
  return { draft, pending };
}
