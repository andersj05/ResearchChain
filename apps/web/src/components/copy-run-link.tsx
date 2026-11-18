import { useState } from "react";
import { runInspectionUrl } from "@/lib/run-inspection";

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
  const label = target === "compare" ? "Comparison" : "Attempt";
  const copy = async () => {
    const url = runInspectionUrl(window.location.href, runId, target, id);
    window.history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(url.href);
      setStatus(`${label} link copied.`);
    } catch {
      setStatus(`Copy the ${label.toLowerCase()} link from the address bar.`);
    }
  };
  return (
    <>
      <button className="button small" type="button" onClick={copy}>
        Copy {label.toLowerCase()} link
      </button>
      {status && (
        <span className="field-hint" role="status">
          {status}
        </span>
      )}
    </>
  );
}
