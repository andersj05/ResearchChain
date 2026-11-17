"use client";

import { useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { api } from "@/lib/workflow";
import { stableRequestId } from "@/lib/evaluations";
import type { StyleGuide, StyleGuideCreate } from "@/lib/reports";

const starter: Omit<StyleGuideCreate, "id"> = {
  title: "Research report guide",
  analytical_structure:
    "Open with the research question and conditional conclusion. Explain the mechanism, compare alternative explanations, then describe falsifiers, scenarios, and unresolved evidence needs.",
  voice:
    "Use direct, specific prose. Make the analytical link between observations explicit. Keep uncertainty visible and avoid rhetorical certainty.",
  source_discipline:
    "Cite the captured source and date. Preserve units, periods, and uncertainty. Distinguish original numerical data from estimates and visual interpretations.",
  scenarios:
    "State the conditions that would produce each outcome. Describe what would invalidate the scenario. Do not present a speculative pathway as an established forecast.",
  examples: [
    {
      kind: "structure",
      principle: "Move from evidence to mechanism and alternatives.",
      example:
        "The source reports X. One explanation is A, which would predict Y. Explanation B remains possible because Z has not been measured.",
    },
    {
      kind: "voice",
      principle: "Use concrete uncertainty.",
      example:
        "This chart shows a co-movement. It does not establish which variable caused the other to change.",
    },
  ],
  change_note: "Initial editorial guide.",
};

export function StyleGuideEditor({
  previous,
  onSave,
  onCancel,
}: {
  previous?: StyleGuide;
  onSave: (value: StyleGuide) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Omit<StyleGuideCreate, "id">>(
    previous
      ? {
          title: previous.title,
          replaces_id: previous.id,
          analytical_structure: previous.analytical_structure,
          voice: previous.voice,
          source_discipline: previous.source_discipline,
          scenarios: previous.scenarios,
          examples: previous.examples,
          change_note: "",
        }
      : starter,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const retry = useRef<{ body: string; id: string } | null>(null);
  const submitting = useRef(false);
  return (
    <form
      className="report-form"
      aria-label="Style guide editor"
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitting.current) return;
        submitting.current = true;
        setBusy(true);
        setError("");
        try {
          onSave(
            await api<StyleGuide>("style-guides", { ...draft, id: stableRequestId(retry, draft) }),
          );
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Unable to save style guide.");
        } finally {
          submitting.current = false;
          setBusy(false);
        }
      }}
    >
      <h2>
        {previous ? `Revise ${previous.title} · v${previous.version}` : "Create a style guide"}
      </h2>
      <p className="muted">
        These starting examples are general editorial guidance. Adapt them to your voice and
        analytical structure. Guides are pinned to individual report revisions.
      </p>
      <fieldset disabled={busy}>
        <label>
          Guide title
          <input
            required
            maxLength={240}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        {(
          [
            ["analytical_structure", "Analytical structure"],
            ["voice", "Prose voice"],
            ["source_discipline", "Source discipline"],
            ["scenarios", "Scenarios and uncertainty"],
            ["change_note", "Guide change note"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <textarea
              required
              maxLength={6000}
              rows={key === "change_note" ? 2 : 4}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </label>
        ))}
        <h3>Editorial examples</h3>
        {draft.examples.map((example, index) => (
          <fieldset key={index} className="report-example">
            <legend>
              {example.kind === "structure" ? "Analytical structure" : "Prose voice"} example{" "}
              {index + 1}
            </legend>
            <label>
              Principle
              <input
                required
                maxLength={6000}
                value={example.principle}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    examples: draft.examples.map((item, i) =>
                      i === index ? { ...item, principle: e.target.value } : item,
                    ),
                  })
                }
              />
            </label>
            <label>
              Example text
              <textarea
                required
                maxLength={6000}
                rows={3}
                value={example.example}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    examples: draft.examples.map((item, i) =>
                      i === index ? { ...item, example: e.target.value } : item,
                    ),
                  })
                }
              />
            </label>
          </fieldset>
        ))}
      </fieldset>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions">
        <Button type="submit" className="button primary" disabled={busy}>
          Save style revision
        </Button>
        <Button className="button" disabled={busy} onClick={onCancel}>
          Cancel style editing
        </Button>
      </div>
    </form>
  );
}

export function StyleGuideContent({ guide }: { guide: StyleGuide }) {
  return (
    <details className="report-guide">
      <summary>
        {guide.title} · Style v{guide.version}
      </summary>
      {(
        [
          ["analytical_structure", "Analytical structure"],
          ["voice", "Voice"],
          ["source_discipline", "Source discipline"],
          ["scenarios", "Scenarios"],
        ] as const
      ).map(([key, label]) => (
        <div key={key}>
          <h3>{label}</h3>
          <p className="report-prose">{guide[key]}</p>
        </div>
      ))}
      {guide.examples.map((e, i) => (
        <div key={i}>
          <h3>{e.kind} example</h3>
          <p>{e.principle}</p>
          <blockquote className="report-prose">{e.example}</blockquote>
        </div>
      ))}
      <p className="field-hint">
        Editorial development guidance. It is not automatically sent to research runs or evaluation
        cases.
      </p>
    </details>
  );
}
