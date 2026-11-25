import type { EvidenceInput } from "./evidence";

export const captureRights = ["owned", "permission", "open_license", "public_domain"] as const;

export type ResearchCaptureDraft = {
  kind: "text" | "discussion" | "link";
  title: string;
  body: string;
  url: string;
  rights: (typeof captureRights)[number] | "unknown";
  author: string;
  date: string;
  command: EvidenceInput | null;
};

const blankDraft: ResearchCaptureDraft = {
  kind: "text",
  title: "",
  body: "",
  url: "",
  rights: "unknown",
  author: "",
  date: "",
  command: null,
};

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

function readCommand(draft: ResearchCaptureDraft): EvidenceInput | null {
  const command = draft.command;
  if (
    !command ||
    typeof command.id !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(command.id) ||
    !boundedText(command.title, 240) ||
    !command.title.trim() ||
    command.kind !== draft.kind ||
    command.rights !== draft.rights ||
    command.author !== draft.author.trim() ||
    command.as_of_date !== (draft.date || null)
  )
    return null;

  const fields = {
    id: command.id,
    title: command.title,
    kind: draft.kind,
    rights: draft.rights,
    author: command.author,
    as_of_date: command.as_of_date,
  };
  if (draft.kind === "link") {
    return command.availability === "reference_only" && command.source_url === draft.url.trim()
      ? { ...fields, availability: "reference_only", source_url: command.source_url }
      : null;
  }
  return command.text === draft.body ? { ...fields, text: command.text } : null;
}

export function readResearchCaptureDraft(key: string): ResearchCaptureDraft {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > 2_500_000) return blankDraft;
    const draft: ResearchCaptureDraft = JSON.parse(raw);
    if (
      !draft ||
      !["text", "discussion", "link"].includes(draft.kind) ||
      (draft.rights !== "unknown" && !captureRights.includes(draft.rights)) ||
      !boundedText(draft.title, 240) ||
      !boundedText(draft.body, 200000) ||
      !boundedText(draft.url, 2000) ||
      !boundedText(draft.author, 240) ||
      !boundedText(draft.date, 16)
    )
      return blankDraft;
    return { ...draft, command: readCommand(draft) };
  } catch {
    return blankDraft;
  }
}

export function storeResearchCaptureDraft(key: string, draft: ResearchCaptureDraft | null) {
  try {
    if (
      draft &&
      Object.keys(blankDraft).some((field) => {
        const name = field as keyof ResearchCaptureDraft;
        return draft[name] !== blankDraft[name];
      })
    ) {
      sessionStorage.setItem(key, JSON.stringify(draft));
    } else {
      sessionStorage.removeItem(key);
    }
  } catch {
    // Keep the current entry usable in memory if tab storage is unavailable.
  }
}
