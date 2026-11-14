"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@ui-sdk/react/button";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { WorkflowEditor } from "@/components/workflow-editor";
import { formatTime, RunInspector, RunStatus } from "@/components/run-inspector";
import {
  api,
  initialWorkflow,
  type RunRequest,
  type RunSnapshot,
  type RunSummary,
  type Workflow,
  type WorkflowRevision,
  type RevisionSummary,
  type ValidationResult,
} from "@/lib/workflow";

const storageKey = "researchchain.workflow.v0.1";

export function Workbench() {
  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);
  const [revision, setRevision] = useState<WorkflowRevision | null>(null);
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [history, setHistory] = useState<Workflow[]>([]);
  const [selected, setSelected] = useState(initialWorkflow.start_node);
  const [brief, setBrief] = useState(
    "What evidence would distinguish sector rotation from a broad increase in correlation?",
  );
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [tab, setTab] = useState("workflow");
  const [message, setMessage] = useState("Loading saved workspace…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const pendingStart = useRef<RunRequest | null>(null);
  const busyRef = useRef(false);
  const saved = revision !== null && JSON.stringify(workflow) === JSON.stringify(revision.workflow);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [savedRevisions, recentRuns] = await Promise.all([
          api<RevisionSummary[]>("revisions"),
          api<RunSummary[]>("runs"),
        ]);
        const latest = savedRevisions[0]
          ? await api<WorkflowRevision>(`revisions/${savedRevisions[0].id}`)
          : null;
        if (!active) return;
        setRevisions(savedRevisions);
        setRuns(recentRuns);
        if (latest) {
          setRevision(latest);
          setWorkflow(latest.workflow);
          setSelected(latest.workflow.start_node);
        }
        const runId = new URL(window.location.href).searchParams.get("run");
        if (runId) {
          const restored = await api<RunSnapshot>(`runs/${encodeURIComponent(runId)}`);
          if (!active) return;
          setRun(restored);
          setTab("runs");
          setMessage("Saved run restored.");
        } else {
          setMessage(
            latest
              ? `Loaded revision ${latest.number}.`
              : "Ready. Edit the workflow, then save or run it.",
          );
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Unable to load the workspace.");
          setMessage("The draft is editable. Refresh history when the API is available.");
        }
      } finally {
        if (active) setLoaded(true);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  function change(next: Workflow) {
    setHistory((previous) => [...previous.slice(-49), workflow]);
    setWorkflow(next);
    setError("");
    setMessage("Draft changed. Save a revision to keep these changes.");
  }

  async function action(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function refreshHistory() {
    const [savedRevisions, recentRuns] = await Promise.all([
      api<RevisionSummary[]>("revisions"),
      api<RunSummary[]>("runs"),
    ]);
    setRevisions(savedRevisions);
    setRuns(recentRuns);
  }

  function rememberRun(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("run", id);
    window.history.replaceState(null, "", url);
  }

  async function openRun(id: string) {
    const result = await api<RunSnapshot>(`runs/${id}`);
    setRun(result);
    setTab("runs");
    rememberRun(id);
    return result;
  }

  async function saveRevision() {
    const result = await api<WorkflowRevision>("revisions", workflow);
    setRevision(result);
    setRevisions((previous) =>
      [result, ...previous.filter((item) => item.id !== result.id)]
        .sort((a, b) => b.number - a.number)
        .slice(0, 50),
    );
    setMessage(`Revision ${result.number} saved.`);
    return result;
  }

  async function loadRevision(id: string) {
    const result = await api<WorkflowRevision>(`revisions/${id}`);
    change(result.workflow);
    setRevision(result);
    setSelected(result.workflow.start_node);
    setTab("workflow");
    setMessage(`Loaded revision ${result.number}. Undo restores your previous draft.`);
  }

  async function startRun() {
    const pinned = await saveRevision();
    if (
      !pendingStart.current ||
      pendingStart.current.revision_id !== pinned.id ||
      pendingStart.current.brief !== brief
    ) {
      pendingStart.current = {
        id: crypto.randomUUID(),
        revision_id: pinned.id,
        brief,
        artifacts: [],
      };
    }
    const request = pendingStart.current;
    rememberRun(request.id);
    try {
      await api<RunSnapshot>("runs", request);
      const result = await openRun(request.id);
      pendingStart.current = null;
      setMessage(`Run ${result.status}. Progress saved.`);
      await refreshHistory();
    } catch (cause) {
      // A lost reply does not mean execution failed. Locate the accepted run;
      // retries retain the same ID if the request never reached the server.
      await openRun(request.id).catch(() => undefined);
      await refreshHistory().catch(() => undefined);
      throw cause;
    }
  }

  async function resumeRun(decision: "approve" | "reject") {
    if (!run?.review || !run.checkpoint_id) return;
    try {
      await api<RunSnapshot>(`runs/${run.id}/resume`, {
        decision,
        checkpoint_id: run.checkpoint_id,
        interrupt_id: run.review.interrupt_id,
      });
      setMessage("Review decision saved.");
    } finally {
      // Idempotent responses may describe an older review. Read current state.
      await openRun(run.id);
      await refreshHistory();
    }
  }

  function saveDraft() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(workflow));
      setMessage("Draft saved in this browser.");
    } catch {
      setError("Browser storage is unavailable. Export JSON to keep the draft.");
    }
  }

  function exportWorkflow() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(workflow, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "researchchain-workflow.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("Workflow exported as JSON.");
  }

  return (
    <main className="studio">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="ResearchChain home">
          <span className="brand-mark">R</span>ResearchChain
        </Link>
        <span className="workspace-divider" aria-hidden="true">
          /
        </span>
        <span className="workspace-label">EquityCats</span>
        <span className="local-badge">Local workspace</span>
      </header>
      <Tabs value={tab} onValueChange={(value) => setTab(value ?? "workflow")}>
        <TabsList className="workspace-tabs" aria-label="Workspace">
          <TabsTab value="workflow">Workflow</TabsTab>
          <TabsTab value="runs">Runs</TabsTab>
          <TabsTab value="revisions">Revisions</TabsTab>
        </TabsList>
        <div className="page-heading">
          <div>
            <h1>{{ workflow: "Workflow", runs: "Runs", revisions: "Revisions" }[tab]}</h1>
            <p>
              {
                {
                  workflow: "Design the process behind your research.",
                  runs: "Saved progress. Every review in context.",
                  revisions: "A permanent record of how your workflow changes.",
                }[tab]
              }
            </p>
          </div>
          <a
            className="text-link"
            href="http://127.0.0.1:8000/docs"
            target="_blank"
            rel="noreferrer"
          >
            API reference ↗
          </a>
        </div>
        <div className="notice" aria-live="polite">
          <p role="status">{message}</p>
          {busy && <span className="working">Working…</span>}
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <TabsPanel value="workflow" keepMounted>
          <section className="workspace" aria-label="Workflow editor">
            <div className="workspace-header">
              <div className="workflow-title">
                <strong>{workflow.name || "Untitled workflow"}</strong>
                <span className="version">
                  {saved ? `Revision ${revision.number}` : "Unsaved draft"}
                </span>
              </div>
              <div className="actions">
                <Button
                  className="button"
                  disabled={!loaded || busy}
                  onClick={() =>
                    action(async () => {
                      await saveRevision();
                    })
                  }
                >
                  Save revision
                </Button>
                <Button
                  className="button primary"
                  disabled={!loaded || busy || !brief.trim()}
                  onClick={() => action(startRun)}
                >
                  Run workflow <span aria-hidden="true">↗</span>
                </Button>
              </div>
            </div>
            <WorkflowEditor
              workflow={workflow}
              selected={selected}
              onSelect={setSelected}
              onChange={change}
              disabled={!loaded || busy}
            />
            <div className="editor-footer">
              <div className="actions">
                <Button
                  className="button small"
                  disabled={busy || !history.length}
                  onClick={() => {
                    const previous = history.at(-1);
                    if (previous) {
                      setWorkflow(previous);
                      setHistory(history.slice(0, -1));
                      setMessage("Last edit undone.");
                    }
                  }}
                >
                  Undo last edit
                </Button>
                <Button
                  className="button small"
                  disabled={!loaded || busy}
                  onClick={() =>
                    action(async () => {
                      await api("workflows/validate", workflow);
                      setMessage("Workflow valid. Ready to run.");
                    })
                  }
                >
                  Validate workflow
                </Button>
              </div>
              <span className="muted">Edits apply to future runs.</span>
            </div>
          </section>
          <section className="brief-panel">
            <div>
              <h2>Research brief</h2>
              <p className="muted">The question this run should explore.</p>
            </div>
            <div>
              <label className="sr-only" htmlFor="brief">
                Research brief
              </label>
              <textarea
                id="brief"
                rows={3}
                maxLength={10000}
                value={brief}
                disabled={busy}
                onChange={(event) => setBrief(event.target.value)}
              />
              <p className="muted">
                Notes and human reviews are available. Research tools and model calls come next.
              </p>
            </div>
          </section>
          <details className="draft-tools">
            <summary>Local draft &amp; export</summary>
            <div className="actions">
              <Button className="button" disabled={!loaded || busy} onClick={saveDraft}>
                Save draft
              </Button>
              <Button
                className="button"
                disabled={!loaded || busy}
                onClick={() =>
                  action(async () => {
                    const stored = localStorage.getItem(storageKey);
                    if (!stored) throw new Error("No saved draft in this browser yet.");
                    const validated = await api<ValidationResult>(
                      "workflows/validate",
                      JSON.parse(stored),
                    );
                    change(validated.workflow);
                    setSelected(validated.workflow.start_node);
                    setMessage("Saved draft loaded and validated.");
                  })
                }
              >
                Load saved draft
              </Button>
              <Button className="button" disabled={!loaded || busy} onClick={exportWorkflow}>
                Export JSON
              </Button>
            </div>
          </details>
        </TabsPanel>
        <TabsPanel value="runs">
          <div className="runs-layout">
            <aside className="run-history" aria-label="Recent runs">
              <div className="section-heading">
                <h2>Recent runs</h2>
                <Button
                  className="button small"
                  disabled={!loaded || busy}
                  onClick={() =>
                    action(async () => {
                      await refreshHistory();
                      setMessage("History refreshed.");
                    })
                  }
                >
                  Refresh history
                </Button>
              </div>
              <p className="muted">Latest 20 · stored in Postgres</p>
              {runs.length ? (
                <ul>
                  {runs.map((item) => (
                    <li key={item.id}>
                      <Button
                        className="run-row"
                        aria-pressed={run?.id === item.id}
                        disabled={busy}
                        onClick={() =>
                          action(async () => {
                            await openRun(item.id);
                            setMessage("Saved run opened.");
                          })
                        }
                      >
                        <strong>{item.workflow_name}</strong>
                        <RunStatus status={item.status} />
                        <span className="run-row-meta">
                          <span>Revision {item.revision_number}</span>
                          <span>{formatTime(item.created_at)}</span>
                        </span>
                        <span className="code-label">{item.id.slice(0, 8)}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">{loaded ? "Your runs will appear here." : "Loading runs…"}</p>
              )}
            </aside>
            <RunInspector
              run={run}
              busy={busy}
              onResume={(value) => action(() => resumeRun(value))}
              onRefresh={() =>
                action(async () => {
                  if (run) {
                    await openRun(run.id);
                    await refreshHistory();
                    setMessage("Run refreshed.");
                  }
                })
              }
              onRecover={() =>
                action(async () => {
                  if (run) {
                    await api(`runs/${run.id}/recover`, {});
                    await openRun(run.id);
                    await refreshHistory();
                    setMessage("Run recovered from saved progress.");
                  }
                })
              }
              onOpenRevision={() =>
                action(async () => {
                  if (run) await loadRevision(run.revision_id);
                })
              }
            />
          </div>
        </TabsPanel>
        <TabsPanel value="revisions">
          <section className="revisions-panel" aria-label="Saved revisions">
            <div className="section-heading">
              <div>
                <h2>Saved revisions</h2>
                <p className="muted">Latest 50 · identical drafts share a revision.</p>
              </div>
              <Button
                className="button"
                disabled={!loaded || busy}
                onClick={() =>
                  action(async () => {
                    await refreshHistory();
                    setMessage("History refreshed.");
                  })
                }
              >
                Refresh history
              </Button>
            </div>
            {revisions.length ? (
              <div className="revision-table">
                <table>
                  <thead>
                    <tr>
                      <th>Revision</th>
                      <th>Workflow</th>
                      <th>Saved</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {revisions.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>Revision {item.number}</strong>
                          <span className="code-label">{item.content_hash.slice(0, 10)}</span>
                        </td>
                        <td>{item.name}</td>
                        <td>
                          <time dateTime={item.created_at}>{formatTime(item.created_at)}</time>
                        </td>
                        <td>
                          <Button
                            className="button small"
                            disabled={busy}
                            aria-label={`Load revision ${item.number}`}
                            onClick={() => action(() => loadRevision(item.id))}
                          >
                            Load revision
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <h2>No saved revisions yet</h2>
                <p>Save your workflow to create its first revision.</p>
              </div>
            )}
          </section>
        </TabsPanel>
      </Tabs>
      <footer>
        <span>ResearchChain</span>
        <span>Local development</span>
      </footer>
    </main>
  );
}
