import { useState } from "react";
import { runInspectionUrl } from "@/lib/run-inspection";

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
};

export function CopyRunLink({
  runId,
  target,
  id,
}: {
  runId: string;
  target: "compare" | "attempt";
  id: string;
}) {
  const [status, setStatus] = useState("");
  const text = copyText[target];
  const copy = async () => {
    const url = runInspectionUrl(window.location.href, runId, target, id);
    window.history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(url.href);
      setStatus(text.success);
    } catch {
      setStatus(text.fallback);
    }
  };
  return (
    <>
      <button className="button small" type="button" onClick={copy}>
        {text.button}
      </button>
      {status && (
        <span className="field-hint" role="status">
          {status}
        </span>
      )}
    </>
  );
}
