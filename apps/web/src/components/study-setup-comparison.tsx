import { useEffect, useState } from "react";
import { useOwner } from "./access-context";
import { evidenceUrl, type EvidenceRecord } from "@/lib/evidence";
import {
  modelSettingLabel,
  researchRoles,
  resolveModelProfile,
  type ModelProfile,
} from "@/lib/model-settings";
import {
  editableResearchBrief,
  initialSwarm,
  type ResearchBrief,
  type ResearchSessionSetup,
} from "@/lib/research-sessions";
import { useSourceDetails } from "@/lib/use-evidence-library";
import { api } from "@/lib/workflow";
import styles from "./study-setup-comparison.module.css";

const reviewLabels: Record<ResearchBrief["review_mode"], string> = {
  when_needed: "When the team asks",
  always: "Before the report",
  never: "Continue independently",
};

function modelSummary(profile: ModelProfile) {
  return [
    profile.model || "No model selected",
    `${modelSettingLabel(profile.reasoning_effort)} effort`,
    `${modelSettingLabel(profile.verbosity)} detail`,
  ].join(" · ");
}

function settingValues(brief: ResearchBrief) {
  const swarm = brief.swarm ? { ...initialSwarm, ...brief.swarm } : null;
  const values: Record<string, string> = {
    "Study title": brief.title?.trim() || "Untitled",
    "Team structure": swarm ? "Research swarm" : "Single lead",
    "Maximum researchers": swarm
      ? `${swarm.researchers_per_lead} per lead`
      : String(brief.max_agents),
    "Passes per agent": String(brief.max_passes),
    "Active time limit": `${brief.max_active_seconds.toLocaleString()} seconds`,
    "Request size limit": `${(brief.max_input_bytes ?? 8_000_000).toLocaleString()} bytes`,
    "Team web search": brief.web_search ? "On" : "Off",
    "Editorial review": reviewLabels[brief.review_mode],
    "Team defaults": modelSummary(brief),
  };
  if (swarm) {
    values["Research leads"] = String(swarm.lead_count);
    values["Parallel agents"] = String(swarm.max_parallel);
    values["Turns per lead"] = String(swarm.max_lead_turns);
    values["Expert consultations"] = swarm.allow_consultations ? "On" : "Off";
  }
  for (const { key, label } of researchRoles) {
    values[label] = modelSummary(resolveModelProfile(brief, brief[key]));
  }
  return values;
}

function TextChange({ label, before, after }: { label: string; before: string; after: string }) {
  if (before === after) return null;
  return (
    <section className={styles.textChange} aria-label={label}>
      <h3>{label}</h3>
      <div className={styles.columns}>
        <div>
          <h4>Previous study</h4>
          <p>{before || "Empty"}</p>
        </div>
        <div>
          <h4>Draft</h4>
          <p>{after || "Empty"}</p>
        </div>
      </div>
    </section>
  );
}

function SourceList({
  label,
  ids,
  titles,
  ordered = false,
}: {
  label: string;
  ids: string[];
  titles: Map<string, string>;
  ordered?: boolean;
}) {
  if (!ids.length) return null;
  const List = ordered ? "ol" : "ul";
  return (
    <div>
      <h4>{label}</h4>
      <List aria-label={label} className={styles.sourceList}>
        {ids.map((id) => (
          <li key={id}>
            <a href={evidenceUrl(id)} target="_blank" rel="noopener">
              {titles.get(id) ?? `Source ${id.slice(0, 8)}`}
            </a>
          </li>
        ))}
      </List>
    </div>
  );
}

function Comparison({
  previous,
  draft,
  records,
}: {
  previous: ResearchBrief;
  draft: ResearchBrief;
  records: (EvidenceRecord | undefined)[];
}) {
  const previousIds = new Set(previous.evidence_ids);
  const draftIds = new Set(draft.evidence_ids);
  const added = draft.evidence_ids.filter((id) => !previousIds.has(id));
  const removed = previous.evidence_ids.filter((id) => !draftIds.has(id));
  const oldShared = previous.evidence_ids.filter((id) => draftIds.has(id));
  const newShared = draft.evidence_ids.filter((id) => previousIds.has(id));
  const reordered = oldShared.some((id, index) => id !== newShared[index]);
  const sourceChange = !!(added.length || removed.length || reordered);
  const titles = new Map<string, string>();
  for (const record of records) {
    if (record) titles.set(record.id, record.title);
  }
  // The packet already loads current source details. Only read missing removed records here.
  const earlierSources = useSourceDetails(removed.filter((id) => !titles.has(id)));
  for (const record of earlierSources.items.values()) titles.set(record.id, record.title);
  const before = settingValues(previous);
  const after = settingValues(draft);
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (name) => before[name] !== after[name],
  );
  const oldContext = previous.brief.trim();
  const newContext = draft.brief.trim();
  const styleChanged = previous.style_excerpt !== draft.style_excerpt;
  if (!(sourceChange || fields.length || oldContext !== newContext || styleChanged))
    return <p>The draft matches the previous setup.</p>;

  return (
    <>
      {sourceChange && (
        <section aria-label="Study packet changes">
          <h3>Study packet</h3>
          <div className={styles.columns}>
            <SourceList label="Added to draft" ids={added} titles={titles} />
            <SourceList label="Removed from draft" ids={removed} titles={titles} />
          </div>
          {reordered && (
            <div className={styles.order}>
              <p>Reading order changed.</p>
              <div className={styles.columns}>
                <SourceList
                  label="Previous order"
                  ids={previous.evidence_ids}
                  titles={titles}
                  ordered
                />
                <SourceList label="Draft order" ids={draft.evidence_ids} titles={titles} ordered />
              </div>
            </div>
          )}
          {!!earlierSources.unresolved.length && (
            <button className="text-link" type="button" onClick={earlierSources.retry}>
              Retry previous source names
            </button>
          )}
        </section>
      )}
      {!!fields.length && (
        <section aria-labelledby="study-setting-differences">
          <h3 id="study-setting-differences">Research settings</h3>
          <table aria-labelledby="study-setting-differences" className={styles.settings}>
            <thead>
              <tr>
                <th scope="col">Setting</th>
                <th scope="col">Previous study</th>
                <th scope="col">Draft</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((name) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{before[name] ?? "Not used"}</td>
                  <td>{after[name] ?? "Not used"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <TextChange label="Context for the lead" before={oldContext} after={newContext} />
      {styleChanged && (
        <details>
          <summary>Writing sample changed</summary>
          <TextChange
            label="Writing sample"
            before={previous.style_excerpt}
            after={draft.style_excerpt}
          />
        </details>
      )}
    </>
  );
}

export function StudySetupComparison({
  fromSession,
  baseline,
  draft,
  records,
}: {
  fromSession: string;
  baseline?: ResearchSessionSetup;
  draft: ResearchBrief;
  records: (EvidenceRecord | undefined)[];
}) {
  const { active } = useOwner();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<ResearchSessionSetup>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const setup = baseline ?? checked;
  useEffect(() => {
    if (!open || !active || setup) return;
    let current = true;
    void api<ResearchSessionSetup>(
      `research-sessions/${encodeURIComponent(fromSession)}/setup`,
    ).then(
      (value) => {
        if (current) {
          setChecked(value);
          setError("");
        }
      },
      (cause: unknown) => {
        if (current)
          setError(cause instanceof Error ? cause.message : "Could not load the previous setup.");
      },
    );
    return () => {
      current = false;
    };
  }, [open, active, setup, retry, fromSession]);

  return (
    <details className={styles.comparison} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Compare with previous setup</summary>
      {open && active && (
        <div className={styles.body}>
          {setup ? (
            <Comparison previous={editableResearchBrief(setup)} draft={draft} records={records} />
          ) : error ? (
            <div role="alert">
              <p>{error}</p>
              <button
                className="text-link"
                type="button"
                onClick={() => {
                  setError("");
                  setRetry((attempt) => attempt + 1);
                }}
              >
                Retry comparison
              </button>
            </div>
          ) : (
            <p role="status">Loading the previous setup…</p>
          )}
        </div>
      )}
    </details>
  );
}
