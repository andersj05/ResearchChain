"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@ui-sdk/react/button";
import { WorkflowCanvas } from "@/components/canvas/workflow-canvas";
import {
  api,
  initialWorkflow,
  type RunSnapshot,
  type Workflow,
  type WorkflowNode,
  type ValidationResult,
} from "@/lib/workflow";

const storageKey = "researchchain.workflow.v0.1";

export function Workbench() {
  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);
  const [history, setHistory] = useState<Workflow[]>([]);
  const [selected, setSelected] = useState(initialWorkflow.start_node);
  const [brief, setBrief] = useState(
    "What evidence would distinguish sector rotation from a broad increase in correlation?",
  );
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [message, setMessage] = useState(
    "Ready to explore. Edit a node, then validate or run the workflow.",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const node = workflow.nodes.find((item) => item.id === selected);

  function change(next: Workflow) {
    setHistory((previous) => [...previous.slice(-49), workflow]);
    setWorkflow(next);
    setError("");
    setMessage("Draft changed. Validate before starting a new run.");
  }

  function editNode(patch: Partial<WorkflowNode>) {
    change({
      ...workflow,
      nodes: workflow.nodes.map((item) => (item.id === selected ? { ...item, ...patch } : item)),
    });
  }

  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed.");
    } finally {
      setBusy(false);
    }
  }

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(workflow));
      setMessage("Draft saved in this browser.");
    } catch {
      setError("Browser storage is unavailable. Use Export JSON to keep the draft.");
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
          <span className="brand-mark">
            R<span>↗</span>
          </span>
          ResearchChain
        </Link>
        <span className="workspace-label">EQUITYCATS / RESEARCH LAB</span>
        <span className="local-badge">
          <i /> Local workspace
        </span>
      </header>
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKFLOW STUDIO</p>
          <h1>Make room for better thinking.</h1>
          <p>Shape the process. Challenge the thesis. Keep judgment in the loop.</p>
        </div>
        <a className="text-link" href="http://127.0.0.1:8000/docs" target="_blank" rel="noreferrer">
          API reference ↗
        </a>
      </div>
      <section className="workspace" aria-label="Workflow editor">
        <div className="workspace-header">
          <div>
            <span className="status-dot" />
            <strong>{workflow.name}</strong>
            <span className="version">v0.1</span>
          </div>
          <div className="actions">
            <Button className="button" onClick={save}>
              Save draft
            </Button>
            <Button className="button" onClick={exportWorkflow}>
              Export JSON
            </Button>
            <Button
              className="button primary"
              disabled={busy || !brief.trim()}
              onClick={() =>
                action(async () => {
                  const result = await api<RunSnapshot>("runs", { workflow, brief });
                  setRun(result);
                  setMessage(`Run ${result.status}. Workflow snapshot captured.`);
                })
              }
            >
              Run workflow <span aria-hidden="true">↗</span>
            </Button>
          </div>
        </div>
        <div className="editor-grid">
          <aside className="library">
            <p className="eyebrow">BUILDING BLOCKS</p>
            <h2>Your workflow</h2>
            <p className="muted">
              Start with a question.
              <br />
              Leave space to reconsider.
            </p>
            <div className="node-library">
              {(["note", "review"] as const).map((kind) => (
                <Button
                  key={kind}
                  className="library-button"
                  disabled={workflow.nodes.length >= 32}
                  onClick={() => {
                    const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`;
                    change({
                      ...workflow,
                      nodes: [
                        ...workflow.nodes,
                        {
                          id,
                          kind,
                          label: kind === "note" ? "New research note" : "New human review",
                          instructions: "",
                          position: { x: 100, y: 340 },
                        },
                      ],
                    });
                    setSelected(id);
                  }}
                >
                  <span>{kind === "note" ? "◇" : "◎"}</span>
                  <div>
                    <strong>{kind === "note" ? "Research note" : "Human review"}</strong>
                    <small>
                      {kind === "note" ? "Record a question or premise" : "Pause for a decision"}
                    </small>
                  </div>
                  <span>+</span>
                </Button>
              ))}
            </div>
            <label>
              Workflow name
              <input
                value={workflow.name}
                maxLength={120}
                onChange={(event) => change({ ...workflow, name: event.target.value })}
              />
            </label>
            <label>
              Start node
              <select
                value={workflow.start_node}
                onChange={(event) => change({ ...workflow, start_node: event.target.value })}
              >
                {workflow.nodes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="stack-actions">
              <Button
                className="button"
                disabled={!history.length}
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
                className="button"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    const saved = localStorage.getItem(storageKey);
                    if (!saved) throw new Error("No saved draft in this browser yet.");
                    const candidate: unknown = JSON.parse(saved);
                    const validated = await api<ValidationResult>("workflows/validate", candidate);
                    change(validated.workflow);
                    setMessage("Saved draft loaded and validated.");
                  })
                }
              >
                Load saved draft
              </Button>
            </div>
            <div className="scope-note">
              <span className="eyebrow">FOUNDATION</span>
              <p>
                Notes → review → finish.
                <br />
                Loops and subgraphs are next.
              </p>
            </div>
          </aside>
          <div className="canvas-panel">
            <WorkflowCanvas
              workflow={workflow}
              selected={selected}
              onSelect={setSelected}
              onMove={(positions) =>
                change({
                  ...workflow,
                  nodes: workflow.nodes.map((item) => ({
                    ...item,
                    position: positions[item.id] ?? item.position,
                  })),
                })
              }
            />
            <p id="canvas-help" className="canvas-help">
              Drag to move · Alt + arrows to nudge · Scroll to pan · Ctrl/⌘ + scroll to zoom. Edit
              connections in the inspector.
            </p>
          </div>
          <aside className="inspector" aria-label="Node inspector">
            <p className="eyebrow">NODE INSPECTOR</p>
            {node ? (
              <>
                <h2>{node.label}</h2>
                <span className="code-label">{node.id}</span>
                <label>
                  Label
                  <input
                    value={node.label}
                    maxLength={100}
                    onChange={(event) => editNode({ label: event.target.value })}
                  />
                </label>
                <label>
                  Node type
                  <select
                    value={node.kind}
                    onChange={(event) =>
                      editNode({ kind: event.target.value as WorkflowNode["kind"] })
                    }
                  >
                    <option value="note">Research note</option>
                    <option value="review">Human review</option>
                    <option value="finish">Finish</option>
                  </select>
                </label>
                <label>
                  Instructions
                  <textarea
                    rows={5}
                    maxLength={6000}
                    value={node.instructions}
                    onChange={(event) => editNode({ instructions: event.target.value })}
                  />
                </label>
                <label>
                  Next node
                  <select
                    value={workflow.edges.find((edge) => edge.source === node.id)?.target ?? ""}
                    onChange={(event) =>
                      change({
                        ...workflow,
                        edges: [
                          ...workflow.edges.filter((edge) => edge.source !== node.id),
                          ...(event.target.value
                            ? [{ source: node.id, target: event.target.value }]
                            : []),
                        ],
                      })
                    }
                  >
                    <option value="">No connection</option>
                    {workflow.nodes
                      .filter((item) => item.id !== node.id)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                  </select>
                </label>
                <Button
                  className="button danger"
                  onClick={() => {
                    change({
                      ...workflow,
                      nodes: workflow.nodes.filter((item) => item.id !== node.id),
                      edges: workflow.edges.filter(
                        (edge) => edge.source !== node.id && edge.target !== node.id,
                      ),
                    });
                    setSelected("");
                  }}
                >
                  Remove node
                </Button>
              </>
            ) : (
              <p className="muted">Select a node to edit its instructions and connections.</p>
            )}
          </aside>
        </div>
        <div className="statusbar">
          <p role="status">{message}</p>
          <Button
            className="button"
            disabled={busy}
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
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="run-panel">
        <div className="brief-panel">
          <p className="eyebrow">START WITH AN IDEA</p>
          <h2>What are you thinking?</h2>
          <label className="sr-only" htmlFor="brief">
            Research brief
          </label>
          <textarea
            id="brief"
            rows={3}
            maxLength={10000}
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
          />
          <p className="muted">
            This development workflow records your notes. Research tools and model calls are not
            connected yet.
          </p>
        </div>
        <div className="run-inspector" aria-label="Run inspector">
          <p className="eyebrow">RUN INSPECTOR</p>
          {run ? (
            <>
              <h2>Run {run.status}</h2>
              <p className="muted">
                {run.workflow.name} · Captured at run start. Editor changes apply to future runs.
              </p>
              <ol className="event-list">
                {run.events.map((event) => (
                  <li key={event.node_id}>
                    <strong>{event.label}</strong>
                    <span>{event.detail}</span>
                  </li>
                ))}
              </ol>
              {run.review && (
                <div className="review-box">
                  <strong>{run.review.question}</strong>
                  <div className="actions">
                    {(["approve", "reject"] as const).map((decision) => (
                      <Button
                        className={`button ${decision === "approve" ? "primary" : ""}`}
                        key={decision}
                        disabled={busy}
                        onClick={() =>
                          action(async () => {
                            const result = await api<RunSnapshot>(`runs/${run.id}/resume`, {
                              decision,
                            });
                            setRun(result);
                            setMessage(`Run ${result.status}.`);
                          })
                        }
                      >
                        {decision === "approve" ? "Approve and continue" : "Reject and stop"}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <h2>The process, in plain sight.</h2>
              <p className="muted">
                Run a workflow to inspect completed steps and answer a human review. Runs reset when
                the local API restarts.
              </p>
              <div className="empty-run">
                <span>01 · FRAME</span>
                <span>02 · CHALLENGE</span>
                <span>03 · REVIEW</span>
              </div>
            </>
          )}
        </div>
      </section>
      <footer>
        ResearchChain <span>Custom tools for independent thinking.</span>
      </footer>
    </main>
  );
}
