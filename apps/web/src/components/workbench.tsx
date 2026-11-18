"use client";

import { useEffect, useRef, useState } from "react";
import { Undo2, Redo2, CheckCheck, X } from "lucide-react";
import { useOwner } from "@/components/access-context";
import { AgentSwitcher, type StartingWorkflow } from "@/components/agent-switcher";
import { agentDraftKey, readAgentDraft, type AgentDraft } from "@/lib/agent-drafts";
import { AccessControls } from "@/components/access-controls";
import { importLegacyDraft, legacyDraftAvailable, ownerStoragePrefix } from "@/lib/access";
import { OperationsDesk } from "@/components/operations-desk";
import { ReportDesk } from "@/components/report-desk";
import { EvaluationDesk } from "@/components/evaluation-desk";
import { EvidenceDesk } from "@/components/evidence-desk";
import { RunSetup } from "@/components/run-setup";
import { DraftChangesPreview } from "@/components/draft-changes-preview";
import { readPendingRun, retainPendingRun, forgetPendingRun } from "@/lib/run-requests";
import { Button } from "@ui-sdk/react/button";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { historyShortcut, useWorkflowHistory } from "@/components/canvas/use-workflow-history";
import { WorkflowEditor, type WorkflowEditorNavigation } from "@/components/workflow-editor";
import { workflowStepAtValidationLocation } from "@/lib/workflow-validation";
import { useModelCatalog } from "@/components/model-picker";
import {
  pruneDefinitions,
  updateStepModels,
  workflowStepAtRunPath,
  type GraphCrumb,
} from "@/lib/workflow-editing";
import { CollectionLayout } from "@/components/collection-layout";
import { RunHistory } from "@/components/run-history";
import { RunInspector, type ReviewFocus } from "@/components/run-inspector";
import type { ReviewTarget } from "@/components/review-inbox";
import { bookmarkedReview, reviewPath } from "@/lib/run-inspection";
import { formatTime } from "@/components/run-status";
import {
  api,
  ApiError,
  type ValidationIssue,
  initialWorkflow,
  researchWorkflow,
  ideaWorkflow,
  ideaGenerationWorkflow,
  ideaGenerationBrief,
  discretionaryMacroWorkflow,
  discretionaryMacroBrief,
  exampleWorkflow,
  admissionTimeout,
  type CommandReceipt,
  type RunRequest,
  type RunSnapshot,
  type RecentRunSummary,
  type Workflow,
  type WorkflowRevision,
  type RevisionSummary,
  type ValidationResult,
  type AgentSummary,
  type AgentDetail,
  type AgentVersion,
} from "@/lib/workflow";

const legacyKey = "researchchain.workflow.v0.1";

export function Workbench() {
  const { owner, active: accessActive } = useOwner();
  const storagePrefix = ownerStoragePrefix(owner);
  const [activeAgent, setActiveAgent] = useState<AgentSummary | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const drafts = useRef(new Map<string, AgentDraft>());
  const storageKey =
    storagePrefix + (activeAgent ? `.agent.${activeAgent.id}.workflow` : ".workflow.v0.1");
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
  const [editorDocument, setEditorDocument] = useState<{ epoch: number; path: GraphCrumb[] }>({
    epoch: 0,
    path: [],
  });
  function resetEditor(path: GraphCrumb[] = []) {
    setEditorDocument((previous) => ({ epoch: previous.epoch + 1, path }));
  }
  const importInput = useRef<HTMLInputElement>(null);
  const editorNavigation = useRef<WorkflowEditorNavigation>(null);
  const [diagnostics, setDiagnostics] = useState<{ issues: ValidationIssue[]; draft?: Workflow }>();
  const [revision, setRevision] = useState<WorkflowRevision | null>(null);
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [selected, setSelected] = useState(initialWorkflow.start_node);
  const [brief, setBrief] = useState(
    "What evidence would distinguish sector rotation from a broad increase in correlation?",
  );
  const [baselineRunId, setBaselineRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [runs, setRuns] = useState<RecentRunSummary[]>([]);
  const [tab, setTab] = useState("workflow");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [artifacts, setArtifacts] = useState<RunRequest["artifacts"]>([]);
  const [edited, setEdited] = useState(false);
  const [providerAccount, setProviderAccount] = useState<string | null>(null);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const catalog = useModelCatalog(
    loaded && accessActive && tab === "workflow" && !!workflow.research,
  );
  const pendingStart = useRef<RunRequest | null>(null);
  const runReadEpoch = useRef(0);
  const selectedRunId = useRef<string | null>(null);
  const [reviewFocus, setReviewFocus] = useState<ReviewFocus>();
  const busyRef = useRef(false);
  const saved = revision !== null && JSON.stringify(workflow) === JSON.stringify(revision.workflow);

  useEffect(() => {
    let active = true;
    async function read<T>(path: string): Promise<T> {
      try {
        return await api<T>(path);
      } catch (cause) {
        const transient =
          cause instanceof TypeError ||
          (cause instanceof DOMException && cause.name === "TimeoutError") ||
          (cause instanceof ApiError && (cause.status ?? 0) >= 500);
        if (!active || !transient) throw cause;
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        if (!active) throw cause;
        return api<T>(path);
      }
    }
    async function load() {
      const parameters = new URL(window.location.href).searchParams;
      const view = [
        "workflow",
        "runs",
        "revisions",
        "evidence",
        "evaluations",
        "reports",
        "operations",
      ].find((value) => value === parameters.get("view"));
      try {
        const pending = readPendingRun(pendingKey);
        if (pending) {
          pendingStart.current = pending;
          setBrief(pending.brief);
          setEvidenceIds(pending.evidence_ids ?? []);
          setArtifacts(pending.artifacts ?? []);
          setProviderAccount(pending.provider_account_id ?? null);
        }
        const [savedRevisions, recentRuns, agentList] = await Promise.all([
          read<RevisionSummary[]>("revisions"),
          read<RecentRunSummary[]>("runs"),
          read<AgentSummary[]>("agents?limit=1000"),
        ]);
        if (!active) return;
        setAgents(agentList);
        const runId = parameters.get("run");
        const restored = runId
          ? await read<RunSnapshot>(`runs/${encodeURIComponent(runId)}`).catch((cause) => {
              // An unconfirmed admission may not exist yet. Restore its pinned
              // workflow and inputs so retry keeps the exact request identity.
              if (cause instanceof ApiError && cause.status === 404 && pending?.id === runId)
                return null;
              throw cause;
            })
          : null;
        const unconfirmed = pending?.id === runId ? pending : null;
        let agentId =
          parameters.get("agent") ?? restored?.agent_id ?? unconfirmed?.agent_id ?? null;
        if (!agentId && !parameters.has("revision") && !runId) {
          try {
            agentId = localStorage.getItem(storagePrefix + ".active-agent");
          } catch {
            /* Storage is optional. */
          }
        }
        const detail = agentId
          ? await read<AgentDetail>(`agents/${encodeURIComponent(agentId)}`)
          : null;
        const versions = detail
          ? await read<AgentVersion[]>(`agents/${detail.agent.id}/revisions?limit=1000`)
          : null;
        const revisionId =
          parameters.get("revision") ??
          restored?.revision_id ??
          unconfirmed?.revision_id ??
          detail?.revision.id ??
          savedRevisions[0]?.id;
        if (detail && revisionId && !versions?.some((item) => item.revision.id === revisionId))
          throw new Error("This revision does not belong to the selected agent.");
        const latest = revisionId
          ? await read<WorkflowRevision>(`revisions/${encodeURIComponent(revisionId)}`)
          : null;
        const agentRuns = detail
          ? await read<RecentRunSummary[]>(`runs?agent_id=${detail.agent.id}`)
          : recentRuns;
        const reopenBuild = view === "workflow" && parameters.has("revision");
        let draft =
          detail && (!runId || reopenBuild) ? readAgentDraft(storagePrefix, detail.agent.id) : null;
        if (parameters.has("revision") && draft?.revision?.id !== revisionId) draft = null;
        if (!active) return;
        setAgents(agentList);
        setActiveAgent(draft?.agent ?? detail?.agent ?? null);
        setRevisions(
          versions
            ? versions.map((item) => ({ ...item.revision, agent_version: item.version }))
            : savedRevisions,
        );
        setRuns(agentRuns);
        if (latest) {
          setRevision(draft?.revision ?? latest);
          initialize(draft?.workflow ?? latest.workflow);
          setSelected((draft?.workflow ?? latest.workflow).start_node);
        }
        if (draft) {
          setBrief(draft.brief);
          setBaselineRunId(draft.baselineRunId ?? null);
          setEvidenceIds(draft.evidenceIds);
          setArtifacts(draft.artifacts);
          setProviderAccount(draft.providerAccount);
          setEdited(true);
        }
        if (restored) {
          selectedRunId.current = restored.id;
          setRun(restored);
          forgetPendingRun(pendingKey, restored.id);
          if (pendingStart.current?.id === restored.id) pendingStart.current = null;
          if (!view) setTab("runs");
        } else if (unconfirmed) {
          setBaselineRunId(unconfirmed.baseline_run_id ?? null);
          setMessage(
            "Unconfirmed run restored. Start again with the same inputs to retry this request.",
          );
        }
      } catch (cause) {
        if (active) {
          const detail = cause instanceof Error ? cause.message : "Unable to load the workspace.";
          setError(`${detail} The draft is editable. Refresh history when the API is available.`);
        }
      } finally {
        if (active) {
          if (view) setTab(view);
          setLoaded(true);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [initialize, pendingKey, storagePrefix]);

  useEffect(() => {
    if (!loaded || !activeAgent) return;
    const draft: AgentDraft = {
      agent: activeAgent,
      revision,
      workflow,
      brief,
      baselineRunId,
      evidenceIds,
      artifacts,
      providerAccount,
    };
    drafts.current.set(activeAgent.id, draft);
    try {
      localStorage.setItem(agentDraftKey(storagePrefix, activeAgent.id), JSON.stringify(draft));
    } catch {
      /* The in-memory copy still protects switching in this session. */
    }
  }, [
    loaded,
    activeAgent,
    revision,
    workflow,
    brief,
    baselineRunId,
    evidenceIds,
    artifacts,
    providerAccount,
    storagePrefix,
  ]);

  function retainDraft() {
    drafts.current.set(activeAgent?.id ?? "", {
      agent: activeAgent,
      revision,
      workflow,
      brief,
      baselineRunId,
      evidenceIds,
      artifacts,
      providerAccount,
    });
  }
  function rememberAgent(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("agent", id);
    else url.searchParams.delete("agent");
    url.searchParams.delete("revision");
    url.searchParams.delete("run");
    url.searchParams.delete("compare");
    url.searchParams.delete("passes");
    url.searchParams.delete("attempt");
    url.searchParams.delete("review");
    url.searchParams.delete("checkpoint");
    url.searchParams.set("view", "workflow");
    window.history.replaceState(null, "", url);
    try {
      if (id) localStorage.setItem(storagePrefix + ".active-agent", id);
      else localStorage.removeItem(storagePrefix + ".active-agent");
    } catch {
      /* URL still identifies the agent. */
    }
  }
  async function switchAgent(id: string) {
    retainDraft();
    const detail = id ? await api<AgentDetail>(`agents/${id}`) : null;
    const cached = drafts.current.get(id) ?? (id ? readAgentDraft(storagePrefix, id) : null);
    const next = cached?.workflow ?? detail?.revision.workflow ?? structuredClone(initialWorkflow);
    const versions = id ? await api<AgentVersion[]>(`agents/${id}/revisions?limit=1000`) : null;
    const history = await api<RecentRunSummary[]>(id ? `runs?agent_id=${id}` : "runs");
    setActiveAgent(cached?.agent ?? detail?.agent ?? null);
    setRevision(cached?.revision ?? detail?.revision ?? null);
    initialize(next);
    setEdited(Boolean(cached));
    resetEditor();
    setSelected(next.start_node);
    setBrief(cached?.brief ?? "");
    setBaselineRunId(cached?.baselineRunId ?? null);
    setEvidenceIds(cached?.evidenceIds ?? []);
    setArtifacts(cached?.artifacts ?? []);
    setProviderAccount(cached?.providerAccount ?? null);
    setRevisions(
      versions
        ? versions.map((item) => ({ ...item.revision, agent_version: item.version }))
        : await api<RevisionSummary[]>("revisions"),
    );
    setRuns(history);
    setRun(null);
    selectedRunId.current = null;
    runReadEpoch.current += 1;
    setExecutingId(null);
    setTab("workflow");
    rememberAgent(id || null);
    setMessage("");
  }
  async function createAgent(id: string, name: string, starter: StartingWorkflow) {
    const starters = {
      blank: initialWorkflow,
      current: workflow,
      ideas: ideaGenerationWorkflow,
      macro: discretionaryMacroWorkflow,
    };
    const document = { ...structuredClone(starters[starter]), name };
    const created = await api<AgentDetail>("agents", { id, workflow: document });
    setAgents((previous) => [created.agent, ...previous.filter((item) => item.id !== id)]);
    await switchAgent(created.agent.id);
    if (starter === "ideas") {
      setBrief(ideaGenerationBrief);
      setMessage(`Agent “${name}” created. Open Run workflow to try the synthetic rotation brief.`);
    } else if (starter === "macro") {
      setBrief(discretionaryMacroBrief);
      setMessage(`Agent “${name}” created. Open Run workflow to edit the example macro brief.`);
    } else setMessage(`Agent “${name}” created. Add your steps and save a version.`);
  }
  async function loadLatestAgent() {
    if (!activeAgent) return;
    const detail = await api<AgentDetail>(`agents/${activeAgent.id}`);
    await refreshHistory();
    setAgents((previous) =>
      previous.map((item) => (item.id === detail.agent.id ? detail.agent : item)),
    );
    change(detail.revision.workflow);
    setRevision(detail.revision);
    setActiveAgent(detail.agent);
    resetEditor();
    setSelected(detail.revision.workflow.start_node);
    rememberAgent(detail.agent.id);
    setMessage("Latest saved agent loaded. Undo restores your draft.");
  }

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
    setDiagnostics(undefined);
    setError("");
    setMessage("");
  }

  async function action(work: () => Promise<void>, validationDraft?: Workflow) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    seal();
    setMessage("");
    setError("");
    setDiagnostics(undefined);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed.");
      if (cause instanceof ApiError && cause.issues.length)
        setDiagnostics({ issues: cause.issues, draft: validationDraft });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function refreshHistory() {
    const [savedRevisions, recentRuns] = await Promise.all([
      activeAgent
        ? api<AgentVersion[]>(`agents/${activeAgent.id}/revisions?limit=1000`).then((items) =>
            items.map((item) => ({ ...item.revision, agent_version: item.version })),
          )
        : api<RevisionSummary[]>("revisions"),
      api<RecentRunSummary[]>(activeAgent ? `runs?agent_id=${activeAgent.id}` : "runs"),
    ]);
    setRevisions(savedRevisions);
    setRuns(recentRuns);
  }

  function rememberRun(id: string, fromInbox = false) {
    selectedRunId.current = id;
    const url = new URL(window.location.href);
    const changedRun = url.searchParams.get("run") !== id;
    if (changedRun) {
      url.searchParams.delete("compare");
      url.searchParams.delete("passes");
      url.searchParams.delete("attempt");
    }
    if (changedRun || fromInbox) {
      url.searchParams.delete("review");
      url.searchParams.delete("checkpoint");
    }
    if (fromInbox) {
      url.searchParams.delete("agent");
      url.searchParams.delete("revision");
    }
    url.searchParams.set("run", id);
    url.searchParams.set("view", "runs");
    window.history.replaceState(null, "", url);
  }

  function switchTab(value: string | null) {
    const next = value ?? "workflow";
    setTab(next);
    setMessage("");
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(null, "", url);
  }

  function rememberRevision(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("revision", id);
    window.history.replaceState(null, "", url);
  }

  async function openRun(id: string, target?: ReviewTarget) {
    if (!target) selectedRunId.current = id;
    const epoch = ++runReadEpoch.current;
    const result = await api<RunSnapshot>(`runs/${id}`);
    if (epoch === runReadEpoch.current && (target || selectedRunId.current === id)) {
      if (target) {
        const review = bookmarkedReview(result, target);
        if (!review) {
          if (selectedRunId.current === id) setRun(result);
          throw new Error("That checkpoint changed. Select a current review from the inbox.");
        }
        setReviewFocus({ runId: id, path: reviewPath(review) });
      } else {
        setReviewFocus((previous) => (previous?.runId === id ? previous : undefined));
      }
      setRun(result);
      setSetupOpen(false);
      setTab("runs");
      rememberRun(id, Boolean(target));
      forgetPendingRun(pendingKey, id);
      if (pendingStart.current?.id === id) pendingStart.current = null;
      return true;
    }
    return false;
  }

  async function openInboxReview(target: ReviewTarget) {
    let opened = false;
    await action(async () => {
      opened = await openRun(target.runId, target);
    });
    return opened;
  }

  async function saveRevision() {
    const detail = activeAgent
      ? await api<AgentDetail>(`agents/${activeAgent.id}/revisions`, {
          expected_version: activeAgent.version,
          workflow,
        })
      : null;
    const result = detail?.revision ?? (await api<WorkflowRevision>("revisions", workflow));
    if (detail) {
      setActiveAgent(detail.agent);
      setAgents((previous) =>
        previous.map((item) => (item.id === detail.agent.id ? detail.agent : item)),
      );
    }
    setRevision(result);
    replaceWorkflow(result.workflow);
    if (detail) {
      const history = await api<AgentVersion[]>(`agents/${detail.agent.id}/revisions?limit=1000`);
      setRevisions(history.map((item) => ({ ...item.revision, agent_version: item.version })));
    } else
      setRevisions((previous) =>
        [result, ...previous.filter((item) => item.id !== result.id)]
          .sort((a, b) => b.number - a.number)
          .slice(0, 50),
      );
    setMessage(`Revision ${result.number} saved.`);
    rememberRevision(result.id);
    return result;
  }

  async function loadRevision(
    id: string,
    agentId: string | null = activeAgent?.id ?? null,
    stepPath?: string,
  ) {
    const result = await api<WorkflowRevision>(`revisions/${id}`);
    const destination = stepPath ? workflowStepAtRunPath(result.workflow, stepPath) : undefined;
    if (stepPath && !destination)
      throw new Error("This step is unavailable in the saved revision.");
    const detail = agentId ? await api<AgentDetail>(`agents/${agentId}`) : null;
    const versions = agentId
      ? await api<AgentVersion[]>(`agents/${agentId}/revisions?limit=1000`)
      : null;
    if (versions && !versions.some((item) => item.revision.id === id))
      throw new Error("This revision does not belong to the selected agent.");
    if (agentId !== (activeAgent?.id ?? null)) {
      const cached =
        drafts.current.get(agentId ?? "") ??
        (agentId ? readAgentDraft(storagePrefix, agentId) : null);
      const history = await api<RecentRunSummary[]>(agentId ? `runs?agent_id=${agentId}` : "runs");
      const savedRevisions = versions
        ? versions.map((item) => ({ ...item.revision, agent_version: item.version }))
        : await api<RevisionSummary[]>("revisions");
      retainDraft();
      initialize(result.workflow, cached?.workflow ?? detail?.revision.workflow);
      setEdited(true);
      setRevisions(savedRevisions);
      setRuns(history);
      setBrief(cached?.brief ?? "");
      setBaselineRunId(cached?.baselineRunId ?? null);
      setEvidenceIds(cached?.evidenceIds ?? []);
      setArtifacts(cached?.artifacts ?? []);
      setProviderAccount(cached?.providerAccount ?? null);
      setRun(null);
      selectedRunId.current = null;
      runReadEpoch.current += 1;
      setExecutingId(null);
      rememberAgent(agentId);
    } else change(result.workflow);
    setActiveAgent(detail?.agent ?? null);
    resetEditor(destination?.path);
    setRevision(result);
    setSelected(destination?.step.id ?? result.workflow.start_node);
    rememberRevision(result.id);
    switchTab("workflow");
    setMessage(`Loaded revision ${result.number}. Undo restores your previous draft.`);
  }

  async function startRun() {
    const pinned =
      saved &&
      pendingStart.current?.revision_id === revision?.id &&
      (pendingStart.current.agent_id ?? null) === (activeAgent?.id ?? null)
        ? revision
        : await saveRevision();
    if (
      !pendingStart.current ||
      pendingStart.current.revision_id !== pinned.id ||
      (pendingStart.current.agent_id ?? null) !== (activeAgent?.id ?? null) ||
      pendingStart.current.brief !== brief ||
      (pendingStart.current.baseline_run_id ?? null) !== baselineRunId ||
      JSON.stringify(pendingStart.current.evidence_ids) !== JSON.stringify(evidenceIds) ||
      JSON.stringify(pendingStart.current.artifacts) !== JSON.stringify(artifacts) ||
      pendingStart.current.provider_account_id !== (workflow.research ? providerAccount : null)
    ) {
      pendingStart.current = {
        id: crypto.randomUUID(),
        revision_id: pinned.id,
        agent_id: activeAgent?.id ?? null,
        brief,
        ...(baselineRunId ? { baseline_run_id: baselineRunId } : {}),
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
    try {
      await api<CommandReceipt>("runs", request, admissionTimeout);
      forgetPendingRun(pendingKey, request.id);
      await openRun(request.id);
      pendingStart.current = null;
      setMessage("");
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
      setDiagnostics(undefined);
      setMessage("");
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
    resetEditor();
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

  const showFeedback = !!message && !error && !setupOpen && !busy;
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
        <AgentSwitcher
          agents={agents}
          active={activeAgent}
          disabled={!loaded || busy}
          onSelect={(id) => {
            void action(() => switchAgent(id));
          }}
          onCreate={createAgent}
          onLatest={() => {
            void action(loadLatestAgent);
          }}
        />
        <AccessControls key={accessActive ? "active" : "locked"} />
      </header>
      <Tabs className="workbench-tabs" value={tab} onValueChange={switchTab}>
        <div className="navigation-bar">
          <TabsList className="workspace-tabs" aria-label="Workspace">
            <TabsTab disabled={busy} value="workflow">
              Build
            </TabsTab>
            <TabsTab disabled={busy} value="evidence">
              Sources
            </TabsTab>
            <TabsTab disabled={busy} value="runs">
              Runs
            </TabsTab>
            <TabsTab disabled={busy} value="reports">
              Reports
            </TabsTab>
            <TabsTab disabled={busy} value="evaluations">
              Evaluate
            </TabsTab>
            <TabsTab disabled={busy} value="revisions">
              Versions
            </TabsTab>
            <TabsTab disabled={busy} value="operations">
              Status
            </TabsTab>
          </TabsList>
          {tab === "workflow" && (
            <div className="actions workspace-actions">
              {tab === "workflow" && (
                <>
                  <span className={`save-state ${saved ? "" : "unsaved"}`}>
                    <i aria-hidden="true" />
                    {saved
                      ? activeAgent
                        ? `Version ${activeAgent.version}`
                        : `Revision ${revision.number}`
                      : "Unsaved draft"}
                  </span>
                  {edited && revision && (
                    <DraftChangesPreview
                      key={`${activeAgent?.id ?? "unassigned"}/${revision.id}`}
                      revision={revision}
                      history={activeAgent ? revisions : undefined}
                      draft={workflow}
                      disabled={!loaded || busy}
                    />
                  )}
                  <Button
                    className="button"
                    disabled={!loaded || busy}
                    onClick={() =>
                      action(async () => {
                        await saveRevision();
                      }, workflow)
                    }
                  >
                    Save revision
                  </Button>
                </>
              )}
              <RunSetup
                workflow={setupOpen ? pruneDefinitions(workflow) : workflow}
                open={setupOpen}
                onOpenChange={(open) => {
                  if (open && workflow.research) catalog.refresh();
                  setSetupOpen(open);
                }}
                brief={brief}
                onBriefChange={setBrief}
                baselineRunId={baselineRunId}
                onClearBaseline={() => setBaselineRunId(null)}
                evidenceIds={evidenceIds}
                onEvidenceChange={setEvidenceIds}
                research={workflow.research}
                catalog={catalog}
                onResearch={(research, group) => change({ ...workflow, research }, group)}
                onStepModels={(changes) => change(updateStepModels(workflow, changes))}
                onExecutionLimits={(budgets, group) =>
                  change(
                    {
                      ...workflow,
                      schema_version: workflow.schema_version === "0.3" ? "0.3" : "0.2",
                      budgets,
                    },
                    group,
                  )
                }
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
          )}
        </div>
        <div className={showFeedback ? "workspace-feedback" : "sr-only"}>
          <p role="status" aria-label="Workspace status">
            {busy ? "Working…" : error ? "" : message}
          </p>
          {showFeedback && (
            <button
              className="button icon-button ghost"
              aria-label="Dismiss status"
              onClick={() => setMessage("")}
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        {error && !setupOpen && (
          <div className="error workspace-error" role="alert">
            {diagnostics ? (
              <>
                <strong>Workflow needs attention</strong>
                <ul className="validation-issues">
                  {diagnostics.issues.map((issue, index) => {
                    const target =
                      tab === "workflow" && diagnostics.draft === workflow
                        ? workflowStepAtValidationLocation(workflow, issue.location)
                        : undefined;
                    const action =
                      target?.setting?.action ?? (target?.input ? "Open input" : "Open step");
                    const stepName = target?.step.label || target?.step.id;
                    const description = target?.input
                      ? `${target.input} on ${stepName}`
                      : target?.setting
                        ? `on ${stepName}`
                        : stepName;
                    return (
                      <li key={index}>
                        {issue.path && <code>{issue.path}: </code>}
                        {issue.message}
                        {target && (
                          <>
                            {" "}
                            <Button
                              className="text-link"
                              disabled={busy}
                              aria-label={`${action} ${description}`}
                              onClick={() =>
                                editorNavigation.current?.openStep(
                                  target.step.id,
                                  target.path,
                                  target.input ?? target.setting?.control,
                                )
                              }
                            >
                              {action}
                            </Button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              error
            )}
          </div>
        )}
        <TabsPanel
          className="workflow-view"
          value="workflow"
          keepMounted
          hidden={tab !== "workflow"}
        >
          <h1 className="sr-only">Agent builder</h1>
          <section className="workspace" aria-label="Workflow editor">
            <details className="builder-guide">
              <summary>Build your agent</summary>
              <p>
                Choose New agent, give it a name, then add the steps you want before Finish. Use the
                Agent selector to switch between your agents. Templates are optional examples.
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
                  Add sources in Sources. Run workflow lets you choose the brief, sources and model.
                  Set Execution limits and Research limits before starting.
                </li>
                <li>
                  Inspect saved requests, outputs and review checkpoints in Runs. Iterate from this
                  run restores its workflow and inputs for editing, then start a separate run.
                </li>
              </ol>
              <p id="canvas-help">
                Drag a step or focus it and use Alt + arrows to move it on the 10 px grid. Drag
                between ports to connect them. With a port focused, press Enter, choose a
                destination with the arrows, then press Enter to connect or Escape to cancel. Scroll
                to pan. Hold Ctrl or Command while scrolling to zoom. Double-click a step or use
                Zoom to selected step to read it up close.
              </p>
              <p>
                Choose the workflow model above the graph. Select a model step to override that
                choice or configure its research tools. Use a human review to decide how to proceed.
              </p>
              <p>
                Save a revision for durable history. Save draft or Export JSON also keeps your work.
                Named-agent drafts and run inputs are recovered from this browser after switching or
                refreshing. Saved versions are kept on the server. Use Reports and Evaluations when
                they help your own process.
              </p>
            </details>
            <WorkflowEditor
              catalog={catalog}
              key={editorDocument.epoch}
              initialPath={editorDocument.path}
              navigationRef={editorNavigation}
              onSeal={seal}
              workflow={workflow}
              selected={selected}
              onSelect={setSelected}
              onChange={change}
              disabled={!loaded || busy}
            />
            <div className="editor-footer">
              <div className="actions">
                {!activeAgent && (
                  <Button
                    className="button small"
                    disabled={!loaded || busy}
                    onClick={() => {
                      retainDraft();
                      setActiveAgent(null);
                      rememberAgent(null);
                      change(structuredClone(initialWorkflow));
                      resetEditor();
                      setSelected(initialWorkflow.start_node);
                      setBrief("");
                      setBaselineRunId(null);
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
                )}
                <Button
                  className="button small"
                  disabled={!loaded || busy}
                  onClick={() => {
                    change(structuredClone(exampleWorkflow));
                    resetEditor();
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
                    resetEditor();
                    setSelected(researchWorkflow.start_node);
                    setMessage("Research template loaded. Undo restores your previous draft.");
                  }}
                >
                  Use research template
                </Button>
                <Button
                  className="button small"
                  disabled={!loaded || busy}
                  onClick={() => {
                    change(structuredClone(ideaWorkflow));
                    resetEditor();
                    setSelected(ideaWorkflow.start_node);
                    setMessage("Idea research example loaded. Undo to restore your draft.");
                  }}
                >
                  Use idea research example
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
                    }, workflow)
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
                        resetEditor();
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
                          resetEditor();
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
          <CollectionLayout
            id="runs"
            list={
              <RunHistory
                key={activeAgent?.id ?? "all"}
                runs={runs}
                selected={run?.id}
                agentName={activeAgent?.name}
                agentId={activeAgent?.id}
                busy={busy}
                onOpenReview={openInboxReview}
                loaded={loaded}
                onRefresh={() =>
                  void action(async () => {
                    await refreshHistory();
                    setMessage("History refreshed.");
                  })
                }
                onOpen={(id) =>
                  void action(async () => {
                    await openRun(id);
                  })
                }
              />
            }
            detail={
              <RunInspector
                run={run}
                reviewFocus={reviewFocus}
                recentRuns={runs}
                busy={busy}
                onResume={(value, interruptId, feedback) =>
                  action(() => resumeRun(value, interruptId, feedback))
                }
                onCancel={async () => {
                  if (!run) return;
                  runReadEpoch.current += 1;
                  try {
                    await api(`runs/${run.id}/cancel`, {});
                    await openRun(run.id);
                    await refreshHistory();
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "Cancellation failed.");
                  }
                }}
                onRefresh={() =>
                  action(async () => {
                    if (run) {
                      await openRun(run.id);
                      await refreshHistory();
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
                    }
                  })
                }
                onIterate={(brief, stepPath) =>
                  action(async () => {
                    if (!run) return;
                    await loadRevision(run.revision_id, run.agent_id ?? null, stepPath);
                    setBrief(brief ?? run.brief);
                    setBaselineRunId(run.id);
                    setEvidenceIds(run.evidence_ids ?? []);
                    setArtifacts(run.artifacts);
                    setProviderAccount(run.research_manifest?.account_id ?? null);
                    setMessage(
                      brief
                        ? "Run copied to the editor with the selected reviewer feedback appended to the brief."
                        : `Run copied to ${stepPath ? "the selected step" : "the editor"} with its brief and sources. Edit, then Run workflow to start a separate experiment.`,
                    );
                  })
                }
                onOpenRevision={() =>
                  action(async () => {
                    if (run) await loadRevision(run.revision_id, run.agent_id ?? null);
                  })
                }
              />
            }
          />
        </TabsPanel>
        <TabsPanel className="revisions-view" value="revisions">
          <div className="view-heading">
            <div>
              <p className="eyebrow">Workflow history</p>
              <h1>Versions</h1>
              <p className="muted">
                {activeAgent
                  ? `Saved versions of ${activeAgent.name}.`
                  : "All saved workflow revisions in this workspace."}
              </p>
            </div>
          </div>
          <section className="revisions-panel" aria-label="Saved revisions">
            <div className="section-heading">
              <div>
                <h2>Saved revisions</h2>
                <p className="muted">
                  {activeAgent ? "Agent version history" : "Latest 50 revisions"} · load a revision
                  to continue editing.
                </p>
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
                      <tr key={`${item.id}/${item.agent_version ?? ""}`}>
                        <td>
                          <strong>
                            {item.agent_version
                              ? `Version ${item.agent_version}`
                              : `Revision ${item.number}`}
                          </strong>
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
    </main>
  );
}
