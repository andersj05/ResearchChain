import type { components } from "@researchchain/contracts";

export type EvaluationArchive = components["schemas"]["EvaluationArchive"];
export type EvaluationBundle = components["schemas"]["EvaluationBundle"];
export type EvaluationCalibration = components["schemas"]["EvaluationCalibration"];
export type EvaluationCandidate = components["schemas"]["EvaluationCandidate"];
export type EvaluationCandidateCreate = components["schemas"]["EvaluationCandidateCreate"];
export type EvaluationCase = components["schemas"]["EvaluationCase"];
export type EvaluationChecks = components["schemas"]["EvaluationChecks"];
export type EvaluationComparison = components["schemas"]["EvaluationComparison"];
export type EvaluationComparisonSummary = components["schemas"]["EvaluationComparisonSummary"];
export type EvaluationDataset = components["schemas"]["EvaluationDataset"];
export type EvaluationDatasetCreate = components["schemas"]["EvaluationDatasetCreate"];
export type EvaluationDatasetSummary = components["schemas"]["EvaluationDatasetSummary"];
export type EvaluationEdit = components["schemas"]["EvaluationEdit"];
export type EvaluationFeedbackCreate = components["schemas"]["EvaluationFeedbackCreate"];
export type EvaluationGates = components["schemas"]["EvaluationGates"];
export type EvaluationInputs = components["schemas"]["EvaluationInputs"];
export type EvaluationJudge = components["schemas"]["EvaluationJudge"];
export type EvaluationJudgeCreate = components["schemas"]["EvaluationJudgeCreate"];
export type EvaluationRatings = components["schemas"]["EvaluationRatings"];
export type EvaluationReference = components["schemas"]["EvaluationReference"];
export type EvaluationReferenceCreate = components["schemas"]["EvaluationReferenceCreate"];
export type ImportedEvaluationOutput = components["schemas"]["ImportedEvaluationOutput"];

export const trackLabels = {
  frozen_writing: "Frozen-evidence writing",
  full_research: "Full research",
} as const;
export const ratingLabels = {
  analytical_depth: "Analytical depth",
  counterarguments: "Counterarguments",
  scenarios: "Scenarios",
  clarity: "Clarity",
  voice: "Voice",
  edit_burden: "Edit burden",
} as const;
export const gateLabels = {
  factual_accuracy: "Factual accuracy",
  numerical_accuracy: "Numerical accuracy",
  citation_support: "Citation support",
} as const;
export function evaluationCasePath(dataset: string, caseId: string, tail: string) {
  return `evaluations/datasets/${encodeURIComponent(dataset)}/cases/${encodeURIComponent(caseId)}/${tail}`;
}
export function stableRequestId(
  cache: { current: { body: string; id: string } | null },
  body: unknown,
) {
  const serialized = JSON.stringify(body);
  if (cache.current?.body !== serialized)
    cache.current = { body: serialized, id: crypto.randomUUID() };
  return cache.current.id;
}
export function downloadEvaluation(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
