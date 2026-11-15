import { apiFetch } from "@/lib/access";
import type { components } from "@researchchain/contracts";

export type EvidenceCreate = components["schemas"]["EvidenceCreate"];
export type EvidenceRecord = components["schemas"]["EvidenceRecord"];
export type EvidencePage = components["schemas"]["EvidencePage"];
export type ArtifactInfo = components["schemas"]["ArtifactInfo"];
export type ClaimCreate = components["schemas"]["ClaimCreate"];
export type ClaimRecord = components["schemas"]["ClaimRecord"];
export type ClaimPage = components["schemas"]["ClaimPage"];
export type ClaimLink = components["schemas"]["ClaimLink"];

export const representationLabels = {
  original: "Original source",
  chart_screenshot: "Chart screenshot",
  ocr_interpretation: "OCR interpretation",
  digitized_estimate: "Digitized estimate",
  numeric_data: "Numeric data",
} as const;
export const availabilityLabels = {
  available: "Captured",
  reference_only: "Link only",
  missing: "Missing",
  paywalled: "Paywalled",
} as const;
export const rightsLabels = {
  unknown: "Unknown",
  owned: "I own this content",
  public_domain: "Public domain",
  open_license: "Open license",
  permission: "Permission granted",
  restricted: "Restricted",
} as const;
export const evidenceUrl = (id: string) => `/?view=evidence&evidence=${encodeURIComponent(id)}`;
export const contentUrl = (id: string) => `/api/artifacts/${encodeURIComponent(id)}/content`;

export async function uploadOriginal(file: File, rights: string): Promise<ArtifactInfo> {
  if (!file.size || file.size > 20 * 1024 * 1024)
    throw new Error("Choose a file between 1 byte and 20 MB.");
  const params = new URLSearchParams({ name: file.name, rights });
  const response = await apiFetch(`/api/artifacts?${params}`, {
    method: "POST",
    body: file,
    headers: { "Content-Type": "application/octet-stream" },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      typeof payload?.detail === "string"
        ? payload.detail
        : "Unable to store the original. Check the file and access rights.",
    );
  }
  const artifact: ArtifactInfo = await response.json();
  if (artifact.byte_size !== file.size)
    throw new Error("The upload was incomplete. Retry the original file.");
  return artifact;
}
