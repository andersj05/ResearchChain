import { useState } from "react";
import { contentUrl, evidenceUrl } from "@/lib/evidence";
import { useSourceDetails } from "@/lib/use-evidence-library";
import {
  changedSettings,
  compareWorkflowGraphs,
  type SettingChange,
} from "@/lib/workflow-comparison";
import type { RunSnapshot } from "@/lib/workflow";

function runSettings(run: RunSnapshot) {
  const research = run.research_manifest?.settings ?? run.workflow.research;
  const limits = research?.limits;
  const budgets = run.workflow.budgets;
  const manifest = run.research_manifest;
  return {
    "Research brief": run.brief,
    "Workflow format": run.workflow.schema_version,
    "Executor version": run.compiler_version,
    Provider: research?.provider === "chatgpt_plan" ? "ChatGPT plan" : undefined,
    Connection: manifest
      ? `${manifest.account_label} · ${manifest.account_id.slice(-8)}`
      : undefined,
    "Default model": research?.model,
    "Model attempts allowed": limits?.max_model_calls,
    "Evidence reads allowed": limits?.max_tool_calls,
    "Total tokens allowed":
      limits?.max_total_tokens === "as_needed" ? "As needed" : limits?.max_total_tokens,
    "Bytes per request": limits?.max_input_bytes,
    "Characters per response": limits?.max_output_characters,
    "Seconds per response": limits?.max_response_seconds,
    "Step executions allowed": budgets?.max_node_executions ?? 256,
    "Active seconds allowed": budgets?.max_active_seconds ?? 120,
    "Parallel steps allowed": budgets?.max_concurrency ?? 4,
    "Model prompt versions": run.research_manifest?.prompt_versions,
    "Model prompt hashes": run.research_manifest?.prompt_hashes,
    "Environment tool settings": run.research_manifest?.tool_config,
  };
}

function changedReviews(before: RunSnapshot, after: RunSnapshot) {
  const reviews = (run: RunSnapshot) =>
    Object.fromEntries(
      run.events.flatMap((event) => {
        if (event.kind !== "review" || !event.review_response) return [];
        const { decision, feedback } = event.review_response;
        const path = (event.path ?? `root/${event.node_id}`).replaceAll("/", " › ");
        const text = decision === "approve" ? "Approved" : "Rejected";
        return [[path, feedback ? `${text}\n${feedback}` : text]];
      }),
    );
  return changedSettings(reviews(before), reviews(after));
}

function inputFiles(run: RunSnapshot) {
  const pinned = new Set(run.research_manifest?.evidence.map((source) => source.original));
  return run.artifacts.filter((item) => !pinned.has(item.id));
}

function listChanges<T>(before: T[], after: T[], key: (item: T) => string) {
  const entries = (items: T[]) => {
    const occurrences = new Map<string, number>();
    return items.map((item) => {
      const id = key(item);
      const index = occurrences.get(id) ?? 0;
      occurrences.set(id, index + 1);
      return { id: JSON.stringify([id, index]), item };
    });
  };
  const oldEntries = entries(before);
  const newEntries = entries(after);
  const oldKeys = new Set(oldEntries.map((entry) => entry.id));
  const newKeys = new Set(newEntries.map((entry) => entry.id));
  const oldOrder = oldEntries.map((entry) => entry.id).filter((id) => newKeys.has(id));
  const newOrder = newEntries.map((entry) => entry.id).filter((id) => oldKeys.has(id));
  return {
    added: newEntries.filter((entry) => !oldKeys.has(entry.id)),
    removed: oldEntries.filter((entry) => !newKeys.has(entry.id)),
    reordered: oldOrder.some((id, index) => id !== newOrder[index]),
  };
}

function SettingsRows({ changes }: { changes: SettingChange[] }) {
  if (!changes.length) return null;
  return (
    <dl className="comparison-changes">
      {changes.map(({ name, before, after }) => (
        <div key={name} data-long={Math.max(before?.length ?? 0, after?.length ?? 0) > 200}>
          <dt>{name}</dt>
          <dd>
            <span>Comparison run</span>
            <p>{before === undefined ? "—" : before || "Empty"}</p>
          </dd>
          <dd>
            <span>Open run</span>
            <p>{after === undefined ? "—" : after || "Empty"}</p>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function diffInputs(before: RunSnapshot, after: RunSnapshot) {
  return {
    sources: listChanges(before.evidence_ids ?? [], after.evidence_ids ?? [], (id) => id),
    files: listChanges(inputFiles(before), inputFiles(after), (item) =>
      JSON.stringify([item.id, item.name, item.media_type]),
    ),
  };
}

function PinnedSourceOrder({ before, after }: { before: RunSnapshot; after: RunSnapshot }) {
  const [open, setOpen] = useState(false);
  const groups = [
    { title: "Comparison run", run: before },
    { title: "Open run", run: after },
  ];
  const ids = [...new Set([...(before.evidence_ids ?? []), ...(after.evidence_ids ?? [])])];
  const { items } = useSourceDetails(open ? ids : []);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Pinned source order</summary>
      {open && (
        <div className="comparison-inputs">
          {groups.map(({ title, run }) => (
            <section aria-label={`${title} source order`} key={title}>
              <h4>{title}</h4>
              <ol>
                {run.evidence_ids?.map((id, index) => {
                  const item = items.get(id);
                  const pinned = run.research_manifest?.evidence.find(
                    (item) => item.evidence_id === id,
                  );
                  const asOf = item?.as_of_date ?? pinned?.as_of_date;
                  return (
                    <li key={`${id}:${index}`}>
                      <a href={evidenceUrl(id)} target="_blank" rel="noreferrer">
                        {item?.title ??
                          `${pinned?.publisher || "Pinned source"} · ${id.slice(0, 8)}`}
                      </a>
                      {asOf && <small> As of {asOf}</small>}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </details>
  );
}

function PinnedInputChanges({
  before,
  after,
  diff,
}: {
  before: RunSnapshot;
  after: RunSnapshot;
  diff: ReturnType<typeof diffInputs>;
}) {
  const { sources, files } = diff;
  const groups = [
    {
      title: "Only in the comparison run",
      sourceIds: sources.removed,
      files: files.removed,
      run: before,
    },
    { title: "Only in the open run", sourceIds: sources.added, files: files.added, run: after },
  ];
  return (
    <>
      {sources.reordered && <PinnedSourceOrder before={before} after={after} />}
      {files.reordered && <p className="field-hint">The order of shared input files changed.</p>}
      <div className="comparison-inputs">
        {groups.map(({ title, run, sourceIds, files: items }) => (
          <div key={title}>
            <h4>{title}</h4>
            <ul>
              {sourceIds.map(({ id: key, item: id }) => {
                const source = run.research_manifest?.evidence.find(
                  (item) => item.evidence_id === id,
                );
                return (
                  <li key={key}>
                    <a href={evidenceUrl(id)} target="_blank" rel="noreferrer">
                      {source?.publisher || "Pinned source"} · {id.slice(0, 8)}
                    </a>
                    {source?.as_of_date && <small> As of {source.as_of_date}</small>}
                  </li>
                );
              })}
              {items.map(({ id, item }) => (
                <li key={id}>
                  <a href={contentUrl(item.id)} target="_blank" rel="noreferrer">
                    {item.name}
                  </a>
                </li>
              ))}
              {!sourceIds.length && !items.length && <li className="muted">No unique inputs</li>}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}

export function RunSetupChanges({ before, after }: { before: RunSnapshot; after: RunSnapshot }) {
  const settings = changedSettings(runSettings(before), runSettings(after));
  const reviews = changedReviews(before, after);
  const graphs =
    before.revision_id === after.revision_id
      ? []
      : compareWorkflowGraphs(before.workflow, after.workflow);
  const inputs = diffInputs(before, after);
  const inputsChanged = Object.values(inputs).some(
    (change) => change.reordered || change.added.length > 0 || change.removed.length > 0,
  );
  const stepCount = graphs.reduce((count, graph) => count + graph.steps.length, 0);
  const changed = !!(settings.length || reviews.length || graphs.length || inputsChanged);
  return (
    <details className="comparison-setup">
      <summary>
        Setup changes{" "}
        {stepCount > 0 && (
          <small className="muted">
            · {stepCount} {stepCount === 1 ? "step" : "steps"}
          </small>
        )}
      </summary>
      {!changed && <p className="muted">The recorded setup matches.</p>}
      {settings.length > 0 && (
        <details open>
          <summary>Run settings and brief</summary>
          <SettingsRows changes={settings} />
        </details>
      )}
      {inputsChanged && (
        <details open>
          <summary>Pinned inputs</summary>
          <PinnedInputChanges before={before} after={after} diff={inputs} />
        </details>
      )}
      {reviews.length > 0 && (
        <details>
          <summary>Recorded judgments</summary>
          <SettingsRows changes={reviews} />
        </details>
      )}
      {graphs.map((graph) => (
        <details key={graph.key} open={graph.key === "root"}>
          <summary>{graph.label}</summary>
          <SettingsRows changes={graph.settings} />
          {graph.steps.map((step) => (
            <details key={step.id}>
              <summary>
                {step.label} · {step.status}
              </summary>
              <SettingsRows changes={step.settings} />
            </details>
          ))}
        </details>
      ))}
    </details>
  );
}
