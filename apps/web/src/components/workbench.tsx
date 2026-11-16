"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Undo2, Redo2, CheckCheck, ExternalLink } from "lucide-react";
import { useOwner } from "@/components/access-context";
import { AccessControls } from "@/components/access-controls";
import { importLegacyDraft, legacyDraftAvailable, ownerStoragePrefix } from "@/lib/access";
import { OperationsDesk } from "@/components/operations-desk";
import { ReportDesk } from "@/components/report-desk";
import { EvaluationDesk } from "@/components/evaluation-desk";
import { EvidenceDesk } from "@/components/evidence-desk";
import { RunSetup } from "@/components/run-setup";
import { readPendingRun, retainPendingRun, forgetPendingRun } from "@/lib/run-requests";
import { Button } from "@ui-sdk/react/button";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { historyShortcut, useWorkflowHistory } from "@/components/canvas/use-workflow-history";
import { WorkflowEditor } from "@/components/workflow-editor";
import { formatTime, RunInspector, RunStatus } from "@/components/run-inspector";
import {
  api,
  ApiError,
  type ValidationIssue,
  initialWorkflow,
  researchWorkflow,
  exampleWorkflow,
  admissionTimeout,
  type CommandReceipt,
  type RunRequest,
  type RunSnapshot,
  type RunSummary,
  type Workflow,
  type WorkflowRevision,
  type RevisionSummary,
  type ValidationResult,
} from "@/lib/workflow";

const legacyKey = "researchchain.workflow.v0.1";

export function Workbench() {
  const { owner, active: accessActive } = useOwner();
  const storagePrefix = ownerStoragePrefix(owner);
  const storageKey = storagePrefix + ".workflow.v0.1";
  const pendingKey = storagePrefix + ".run.pending";
  const [legacyAvailable, setLegacyAvailable] = useState(() =>
    legacyDraftAvailable(legacyKey, storagePrefix),
  );
  const {
    workflow,
    change: recordChange,
    replace: replaceWorkflow,
    initialize,
    travel,
    canUndo,
    canRedo,
    seal,
  } = useWorkflowHistory(initialWorkflow);
  const [documentEpoch, setDocumentEpoch] = useState(0);
  const importInput = useRef<HTMLInputElement>(null);
  const [diagnostics, setDiagnostics] = useState<ValidationIssue[]>([]);
  const [revision, setRevision] = useState<WorkflowRevision | null>(null);
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
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
  const [setupOpen, setSetupOpen] = useState(false);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [artifacts, setArtifacts] = useState<RunRequest["artifacts"]>([]);
  const [edited, setEdited] = useState(false);
  const [providerAccount, setProviderAccount] = useState<string | null>(null);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const pendingStart = useRef<RunRequest | null>(null);
  const runReadEpoch = useRef(0);
  const selectedRunId = useRef<string | null>(null);
  const busyRef = useRef(false);
  const saved = revision !== null && JSON.stringify(workflow) === JSON.stringify(revision.workflow);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const parameters = new URL(window.location.href).searchParams;
        const pending = readPendingRun(pendingKey);
        if (pending) {
          pendingStart.current = pending;
          setBrief(pending.brief);
          setEvidenceIds(pending.evidence_ids ?? []);
          setArtifacts(pending.artifacts ?? []);
          setProviderAccount(pending.provider_account_id ?? null);
        }
        const [savedRevisions, recentRuns] = await Promise.all([
          api<RevisionSummary[]>("revisions"),
          api<RunSummary[]>("runs"),
        ]);
        const revisionId = parameters.get("revision") ?? savedRevisions[0]?.id;
        const latest = revisionId
          ? await api<WorkflowRevision>(`revisions/${encodeURIComponent(revisionId)}`)
          : null;
        if (!active) return;
        setRevisions(savedRevisions);
        setRuns(recentRuns);
        if (latest) {
          setRevision(latest);
          initialize(latest.workflow);
          setSelected(latest.workflow.start_node);
        }
        const runId = parameters.get("run");
        if (runId) {
          selectedRunId.current = runId;
          const restored = await api<RunSnapshot>(`runs/${encodeURIComponent(runId)}`);
          if (!active) return;
          setRun(restored);
          forgetPendingRun(pendingKey, restored.id);
          if (pendingStart.current?.id === restored.id) pendingStart.current = null;
          setTab("runs");
          setMessage("Saved run restored.");
        } else {
          setMessage(
            latest
              ? `Loaded revision ${latest.number}.`
              : "Ready. Edit the workflow, then save or run it.",
          );
        }
        const view = parameters.get("view");
        if (
          view &&
          [
            "workflow",
            "runs",
            "revisions",
            "evidence",
            "evaluations",
            "reports",
            "operations",
          ].includes(view)
        )
          setTab(view);
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
  }, [initialize, pendingKey]);

  const pollId =
    executingId ??
    (run?.execution_pending || run?.status === "running" || run?.status === "queued"
      ? run.id
      : null);
  useEffect(() => {
    if (!pollId || !accessActive) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const epoch = runReadEpoch.current;
      try {
        const snapshot = await api<RunSnapshot>(`runs/${pollId}`);
        if (active && epoch === runReadEpoch.current && selectedRunId.current === pollId) {
          setRun(snapshot);
          setRuns((previous) =>
            previous.map((item) =>
              item.id === snapshot.id ? { ...item, status: snapshot.status } : item,
            ),
          );
          if (
            !snapshot.execution_pending &&
            snapshot.status !== "queued" &&
            snapshot.status !== "running"
          )
            setMessage(`Run ${snapshot.status}. Progress saved.`);
        }
      } catch (cause) {
        if (
          active &&
          epoch === runReadEpoch.current &&
          !(cause instanceof ApiError && cause.status === 404)
        ) {
          setError("Progress could not be refreshed. The run may still be executing.");
        }
      } finally {
        if (active) timer = setTimeout(poll, 1000);
      }
    }
    timer = setTimeout(poll, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pollId, accessActive]);

  useEffect(() => {
    if (!edited || saved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [edited, saved]);

  function change(next: Workflow, group?: string) {
    setEdited(true);
    recordChange(next, group);
    setDiagnostics([]);
    setError("");
    setMessage("Draft changed. Save a revision to keep these changes.");
  }

  async function action(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    seal();
    setError("");
    setDiagnostics([]);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed.");
      setDiagnostics(cause instanceof ApiError ? cause.issues : []);
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
    selectedRunId.current = id;
    const url = new URL(window.location.href);
    url.searchParams.set("run", id);
    url.searchParams.set("view", "runs");
    window.history.replaceState(null, "", url);
  }

  function switchTab(value: string | null) {
    const next = value ?? "workflow";
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(null, "", url);
  }

  function rememberRevision(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("revision", id);
    window.history.replaceState(null, "", url);
  }

  async function openRun(id: string) {
    selectedRunId.current = id;
    const epoch = ++runReadEpoch.current;
    const result = await api<RunSnapshot>(`runs/${id}`);
    if (epoch === runReadEpoch.current && selectedRunId.current === id) {
      setRun(result);
      setSetupOpen(false);
      setTab("runs");
      rememberRun(id);
      forgetPendingRun(pendingKey, id);
      if (pendingStart.current?.id === id) pendingStart.current = null;
    }
    return result;
  }

  async function saveRevision() {
    const result = await api<WorkflowRevision>("revisions", workflow);
    setRevision(result);
    replaceWorkflow(result.workflow);
    setRevisions((previous) =>
      [result, ...previous.filter((item) => item.id !== result.id)]
        .sort((a, b) => b.number - a.number)
        .slice(0, 50),
    );
    setMessage(`Revision ${result.number} saved.`);
    rememberRevision(result.id);
    return result;
  }

  async function loadRevision(id: string) {
    const result = await api<WorkflowRevision>(`revisions/${id}`);
    change(result.workflow);
    setDocumentEpoch((value) => value + 1);
    setRevision(result);
    setSelected(result.workflow.start_node);
    rememberRevision(result.id);
    switchTab("workflow");
    setMessage(`Loaded revision ${result.number}. Undo restores your previous draft.`);
  }

  async function startRun() {
    const pinned = await saveRevision();
    if (
      !pendingStart.current ||
      pendingStart.current.revision_id !== pinned.id ||
      pendingStart.current.brief !== brief ||
      JSON.stringify(pendingStart.current.evidence_ids) !== JSON.stringify(evidenceIds) ||
      JSON.stringify(pendingStart.current.artifacts) !== JSON.stringify(artifacts) ||
      pendingStart.current.provider_account_id !== (workflow.research ? providerAccount : null)
    ) {
      pendingStart.current = {
        id: crypto.randomUUID(),
        revision_id: pinned.id,
        brief,
        artifacts,
        evidence_ids: evidenceIds,
        provider_account_id: workflow.research ? providerAccount : null,
      };
    }
    const request = pendingStart.current;
    retainPendingRun(pendingKey, request);
    runReadEpoch.current += 1;
    rememberRun(request.id);
    setRun(null);
    setExecutingId(request.id);
    setSetupOpen(false);
    setTab("runs");
    setMessage("Saving run request…");
    try {
      await api<CommandReceipt>("runs", request, admissionTimeout);
      forgetPendingRun(pendingKey, request.id);
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
    } finally {
      setExecutingId(null);
    }
  }

  async function resumeRun(decision: "approve" | "reject", interruptId?: string, feedback = "") {
    if (!run?.review || !run.checkpoint_id) return;
    runReadEpoch.current += 1;
    setExecutingId(run.id);
    try {
      await api<CommandReceipt>(
        `runs/${run.id}/resume`,
        {
          decision,
          checkpoint_id: run.checkpoint_id,
          interrupt_id: interruptId ?? run.review.interrupt_id,
          feedback,
        },
        admissionTimeout,
      );
      setMessage("Review decision saved.");
    } finally {
      setExecutingId(null);
      // Idempotent responses may describe an older review. Read current state.
      await openRun(run.id);
      await refreshHistory();
    }
  }

  function undoRedo(direction: "undo" | "redo") {
    if (travel(direction)) {
      setEdited(true);
      setError("");
      setDiagnostics([]);
      setMessage(direction === "undo" ? "Last edit undone." : "Last edit redone.");
    }
  }

  async function importWorkflow(file: File) {
    if (file.size > 10 * 1024 * 1024) throw new Error("Workflow files must be smaller than 10 MB.");
    let document: unknown;
    try {
      document = JSON.parse(await file.text());
    } catch {
      throw new Error("This file is not valid JSON. The current draft has been kept.");
    }
    const validated = await api<ValidationResult>("workflows/validate", document);
    change(validated.workflow);
    setDocumentEpoch((value) => value + 1);
    setSelected(validated.workflow.start_node);
    setMessage("Workflow imported and validated. Undo restores your previous draft.");
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
    <main
      className="studio"
      onKeyDown={(event) => {
        if (event.defaultPrevented || tab !== "workflow" || setupOpen || busy) return;
        const direction = historyShortcut(event.nativeEvent);
        if (direction) {
          event.preventDefault();
          undoRedo(direction);
        }
      }}
    >
      <header className="topbar">
        <Link className="brand" href="/" aria-label="ResearchChain home">
          <span>ResearchChain</span>
        </Link>
        <span className="workspace-divider" aria-hidden="true">
          /
        </span>
        <span className="workspace-label">EquityCats</span>
        <span className="workspace-divider breadcrumb-extra" aria-hidden="true">
          /
        </span>
        <span className="breadcrumb-title">{workflow.name || "Untitled workflow"}</span>
        <span className="local-badge">Local workspace</span>
        <AccessControls key={accessActive ? "active" : "locked"} />
      </header>
      <Tabs className="workbench-tabs" value={tab} onValueChange={switchTab}>
        <div className="navigation-bar">
          <TabsList className="workspace-tabs" aria-label="Workspace">
            <TabsTab value="workflow">Workflow</TabsTab>
            <TabsTab value="evidence">Evidence</TabsTab>
            <TabsTab value="runs">Runs</TabsTab>
            <TabsTab value="reports">Reports</TabsTab>
            <TabsTab value="evaluations">Evaluations</TabsTab>
            <TabsTab value="revisions">Revisions</TabsTab>
            <TabsTab value="operations">Operations</TabsTab>
          </TabsList>
          <div className="actions workspace-actions">
            {tab === "workflow" && (
              <>
                <span className={`save-state ${saved ? "" : "unsaved"}`}>
                  <i aria-hidden="true" />
                  {saved ? `Revision ${revision.number}` : "Unsaved draft"}
                </span>
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
              </>
            )}
            <RunSetup
              open={setupOpen}
              onOpenChange={setSetupOpen}
              brief={brief}
              onBriefChange={setBrief}
              evidenceIds={evidenceIds}
              onEvidenceChange={setEvidenceIds}
              research={workflow.research}
              onResearch={(research) => change({ ...workflow, research })}
              accountId={providerAccount}
              onAccount={setProviderAccount}
              name={workflow.name}
              revision={saved ? revision.number : null}
              busy={busy}
              loaded={loaded}
              error={error}
              onStart={() => action(startRun)}
            />
          </div>
        </div>
        {error && !setupOpen && (
          <div className="error workspace-error" role="alert">
            {diagnostics.length ? (
              <>
                <strong>Workflow needs attention</strong>
                <ul className="validation-issues">
                  {diagnostics.map((issue, index) => (
                    <li key={index}>
                      {issue.path && <code>{issue.path}: </code>}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              error
            )}
          </div>
        )}
        <TabsPanel className="workflow-view" value="workflow" keepMounted>
          <h1 className="sr-only">Workflow</h1>
          <section className="workspace" aria-label="Workflow editor">
            <details className="builder-guide">
              <summary>Build your agent</summary>
              <p>
                Start a New workflow, name it in Workflow settings, then add the steps you want
                before Finish. Templates are optional examples.
              </p>
              <ol>
                <li>
                  Add model prompt and write your Instructions. Custom instructions let you define
                  the task; research stages are optional.
                </li>
                <li>
                  Add human review to pause for your judgment. In a later model step, select its
                  Context input and Reviewer feedback. Connections determine which information it
                  receives.
                </li>
                <li>
                  Add sources in Evidence. Run workflow lets you choose the brief, sources and
                  model. Set Execution limits and Research limits before starting.
                </li>
                <li>
                  Inspect saved requests, outputs and review checkpoints in Runs. Iterate from this
                  run restores its workflow and inputs for editing, then start a separate run.
                </li>
              </ol>
              <p>
                Available tools: captured evidence, model prompts, notes, human reviews, conditions,
                parallel branches, loops, subgraphs and JavaScript code steps. Code steps have typed
                inputs and saved results. Web browsing, external tool registration and per-step
                model selection are not available. One model is selected per workflow; custom output
                uses a structured envelope with an answer up to 6,000 characters.
              </p>
              <p>
                Save a revision for durable history. Save draft or Export JSON also keeps your work.
                Unsaved edits stay on this page; save before refreshing. Use Reports and Evaluations
                when they help your own process.
              </p>
            </details>
            <WorkflowEditor
              key={documentEpoch}
              onSeal={seal}
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
                  disabled={!loaded || busy}
                  onClick={() => {
                    change(structuredClone(initialWorkflow));
                    setDocumentEpoch((value) => value + 1);
                    setSelected(initialWorkflow.start_node);
                    setBrief("");
                    setEvidenceIds([]);
                    setArtifacts([]);
                    setProviderAccount(null);
                    setMessage(
                      "New workflow. Add your steps before Finish. Undo restores the previous workflow; saved revisions and runs are kept.",
                    );
                  }}
                >
                  New workflow
                </Button>
                <Button
                  className="button small"
                  disabled={!loaded || busy}
                  onClick={() => {
                    change(structuredClone(exampleWorkflow));
                    setDocumentEpoch((value) => value + 1);
                    setSelected(exampleWorkflow.start_node);
                    setMessage(
                      "Demo loaded. Notes do not call a model. Undo restores your previous draft.",
                    );
                  }}
                >
                  Use no-model demo
                </Button>
                <Button
                  className="button small"
                  disabled={!loaded || busy}
                  onClick={() => {
                    change(structuredClone(researchWorkflow));
                    setDocumentEpoch((value) => value + 1);
                    setSelected(researchWorkflow.start_node);
                    setMessage("Research template loaded. Undo restores your previous draft.");
                  }}
                >
                  Use research template
                </Button>
                <Button
                  className="button small"
                  disabled={busy || !canUndo}
                  onClick={() => undoRedo("undo")}
                  aria-keyshortcuts="Control+Z Meta+Z"
                >
                  <Undo2 size={14} aria-hidden="true" /> Undo last edit
                </Button>
                <Button
                  className="button small"
                  disabled={busy || !canRedo}
                  onClick={() => undoRedo("redo")}
                  aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
                >
                  <Redo2 size={14} aria-hidden="true" /> Redo last edit
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
                  <CheckCheck size={14} aria-hidden="true" /> Validate workflow
                </Button>
              </div>
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
                        setDocumentEpoch((value) => value + 1);
                        setSelected(validated.workflow.start_node);
                        setMessage("Saved draft loaded and validated.");
                      })
                    }
                  >
                    Load saved draft
                  </Button>
                  {legacyAvailable && (
                    <Button
                      className="button"
                      disabled={!loaded || busy}
                      onClick={() =>
                        action(async () => {
                          const raw = importLegacyDraft(legacyKey, storagePrefix);
                          const validated = await api<ValidationResult>(
                            "workflows/validate",
                            JSON.parse(raw),
                          );
                          localStorage.setItem(storageKey, JSON.stringify(validated.workflow));
                          change(validated.workflow);
                          setDocumentEpoch((value) => value + 1);
                          setSelected(validated.workflow.start_node);
                          setLegacyAvailable(false);
                          setMessage(
                            "Older browser draft imported for this owner. The original was kept.",
                          );
                        })
                      }
                    >
                      Import my draft saved before sign-in
                    </Button>
                  )}
                  <input
                    ref={importInput}
                    type="file"
                    accept=".json,application/json"
                    aria-label="Import workflow JSON"
                    hidden
                    disabled={!loaded || busy}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void action(() => importWorkflow(file));
                    }}
                  />
                  <Button
                    className="button"
                    disabled={!loaded || busy}
                    onClick={() => importInput.current?.click()}
                  >
                    Import JSON
                  </Button>
                  <Button className="button" disabled={!loaded || busy} onClick={exportWorkflow}>
                    Export JSON
                  </Button>
                </div>
              </details>
              <span className="muted editor-footnote">Edits apply to future runs.</span>
            </div>
          </section>
        </TabsPanel>
        <TabsPanel className="evidence-view" value="evidence">
          <EvidenceDesk />
        </TabsPanel>
        <TabsPanel className="reports-view" value="reports">
          <ReportDesk />
        </TabsPanel>
        <TabsPanel className="evaluations-view" value="evaluations">
          <EvaluationDesk />
        </TabsPanel>
        <TabsPanel className="operations-view" value="operations">
          <OperationsDesk onOpenRuns={() => switchTab("runs")} />
        </TabsPanel>
        <TabsPanel className="runs-view" value="runs">
          <h1 className="sr-only">Runs</h1>
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
              <p className="muted">Latest 20 runs</p>
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
              onResume={(value, interruptId, feedback) =>
                action(() => resumeRun(value, interruptId, feedback))
              }
              onCancel={async () => {
                if (!run) return;
                runReadEpoch.current += 1;
                try {
                  await api(`runs/${run.id}/cancel`, {});
                  const result = await openRun(run.id);
                  await refreshHistory();
                  setMessage(`Run ${result.status}.`);
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "Cancellation failed.");
                }
              }}
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
                    runReadEpoch.current += 1;
                    setExecutingId(run.id);
                    try {
                      await api<CommandReceipt>(`runs/${run.id}/recover`, {}, admissionTimeout);
                    } finally {
                      setExecutingId(null);
                    }
                    await openRun(run.id);
                    await refreshHistory();
                    setMessage("Run recovered from saved progress.");
                  }
                })
              }
              onIterate={() =>
                action(async () => {
                  if (!run) return;
                  await loadRevision(run.revision_id);
                  setBrief(run.brief);
                  setEvidenceIds(run.evidence_ids ?? []);
                  setArtifacts(run.artifacts);
                  setProviderAccount(run.research_manifest?.account_id ?? null);
                  setMessage(
                    "Run copied to the editor with its brief and sources. Edit, then Run workflow to start a separate experiment. The original run is unchanged.",
                  );
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
        <TabsPanel className="revisions-view" value="revisions">
          <div className="view-heading">
            <div>
              <p className="eyebrow">Workflow history</p>
              <h1>Revisions</h1>
              <p className="muted">Saved versions of your research process.</p>
            </div>
          </div>
          <section className="revisions-panel" aria-label="Saved revisions">
            <div className="section-heading">
              <div>
                <h2>Saved revisions</h2>
                <p className="muted">Latest 50 · load any revision to continue editing.</p>
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
        <p role="status" aria-label="Workspace status" aria-live="polite">
          {busy ? "Working…" : message}
        </p>
        <a className="text-link" href="http://127.0.0.1:8000/docs" target="_blank" rel="noreferrer">
          API reference <ExternalLink size={12} aria-hidden="true" />
        </a>
      </footer>
    </main>
  );
}
