import { runInspectionUrl, type ComparisonPasses } from "@/lib/run-inspection";
import { CopyLinkButton } from "./copy-link-button";

const copyText = {
  compare: {
    button: "Copy comparison link",
    success: "Comparison link copied.",
    fallback: "Copy the comparison link from the address bar.",
  },
  attempt: {
    button: "Copy attempt link",
    success: "Attempt link copied.",
    fallback: "Copy the attempt link from the address bar.",
  },
  passes: {
    button: "Copy pass comparison link",
    success: "Pass comparison link copied.",
    fallback: "Copy the pass comparison link from the address bar.",
  },
  iterations: {
    button: "Copy iteration comparison link",
    success: "Iteration comparison link copied.",
    fallback: "Copy the iteration comparison link from the address bar.",
  },
  review: {
    button: "Copy review link",
    success: "Review link copied.",
    fallback: "Copy the review link from the address bar.",
  },
};

export function CopyRunLink({
  runId,
  target,
  id,
  passes,
  checkpointId,
}: {
  runId: string;
  id: string;
} & (
  | { target: "compare" | "attempt" | "iterations"; passes?: never; checkpointId?: never }
  | {
      target: "passes";
      passes: ComparisonPasses;
      checkpointId?: never;
    }
  | { target: "review"; checkpointId: string; passes?: never }
)) {
  function getUrl() {
    const url = runInspectionUrl(
      window.location.href,
      runId,
      target === "passes" ? "compare" : target,
      id,
    );
    if (passes) {
      url.searchParams.set("passes", `${passes.baselineAttempt ?? ""},${passes.openAttempt ?? ""}`);
    }
    if (checkpointId) url.searchParams.set("checkpoint", checkpointId);
    window.history.replaceState(null, "", url);
    return url;
  }
  return <CopyLinkButton getUrl={getUrl} {...copyText[target]} />;
}
