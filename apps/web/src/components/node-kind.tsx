import { FileText, Flag, UserRoundCheck } from "lucide-react";
import type { WorkflowNode } from "@/lib/workflow";

export const nodeKinds = {
  note: { label: "Research note", description: "Frame an idea or record evidence", icon: FileText },
  review: {
    label: "Human review",
    description: "Pause for a research decision",
    icon: UserRoundCheck,
  },
  finish: { label: "Finish", description: "Complete this workflow", icon: Flag },
};

export function NodeKindIcon({ kind }: { kind: WorkflowNode["kind"] }) {
  const Icon = nodeKinds[kind].icon;
  return (
    <span className={`kind-icon kind-${kind}`}>
      <Icon size={16} aria-hidden="true" />
    </span>
  );
}
