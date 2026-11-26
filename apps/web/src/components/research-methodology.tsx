"use client";

import { useState, type CSSProperties, type MouseEventHandler, type Ref } from "react";
import {
  ArrowRight,
  BookOpen,
  ClipboardList,
  Files,
  FileText,
  GitBranch,
  Layers,
  Pause,
  PencilLine,
  RotateCcw,
} from "lucide-react";
import styles from "./research-methodology.module.css";

const steps = {
  sources: {
    title: "Source packet",
    role: "You",
    icon: Files,
    x: 16,
    y: 15,
    input: "The charts, reports, notes and conversations that caught your attention.",
    output:
      "Pin originals and their provenance. Your optional context tells the lead what surprised you.",
    next: "Lead’s first reading",
  },
  reading: {
    title: "Lead’s first reading",
    role: "Lead",
    icon: BookOpen,
    x: 50,
    y: 15,
    input: "The pinned packet and your context.",
    output:
      "The lead compares units, dates and coverage, cites the material, and offers up to two working sentences with a rival explanation, a first check and a result that would weaken each. It can leave the question open.",
    next: "Your working sentence",
  },
  sentence: {
    title: "Your working sentence",
    role: "You",
    icon: PencilLine,
    x: 84,
    y: 15,
    input: "The first reading, the cited material and your own sense of what deserves a test.",
    output:
      "Choose a proposal, edit it or write your own. Assign research records your exact wording for the team. Parking ends this study before the team is commissioned.",
    next: "Research assignments or parked study",
  },
  assignments: {
    title: "Research assignments",
    role: "Lead + researchers",
    icon: ClipboardList,
    x: 50,
    y: 50,
    input:
      "Your recorded sentence, the first reading, its rival explanations and the source packet.",
    output:
      "The lead commissions specific comparisons. Open an issued assignment to inspect the researcher’s saved request. In a swarm, enabled consultations can bring a question back to you during the work.",
    next: "Findings",
  },
  findings: {
    title: "Findings",
    role: "Research team",
    icon: Layers,
    x: 16,
    y: 50,
    input: "The assignment, evidence, research passes and supporting files.",
    output:
      "Researchers return findings, uncertainties and receipts. The team’s synthesis gives the editor the material for a report.",
    next: "Editorial judgment or report",
  },
  editorial: {
    title: "Editorial judgment",
    role: "You · optional",
    icon: PencilLine,
    x: 16,
    y: 85,
    input: "The team’s findings and any review question.",
    output:
      "Your review setting determines whether the editor waits every time, only when asked, or continues independently. Your response tells the editor what to qualify or emphasize.",
    next: "Report",
  },
  report: {
    title: "Report",
    role: "Editor",
    icon: FileText,
    x: 50,
    y: 85,
    input:
      "The findings, supporting files, any editorial judgment and your optional writing sample.",
    output:
      "Inspect the resulting report and its supporting material. The saved study retains the decisions and requests behind it.",
    next: "Revisit material",
  },
  parked: {
    title: "Parked study",
    role: "You",
    icon: Pause,
    x: 84,
    y: 50,
    input: "A first reading you do not want to commission.",
    output:
      "The desk keeps the packet, the first reading and your decision. No researcher assignment is issued.",
    next: "Revisit material",
  },
  revisit: {
    title: "Revisit material",
    role: "You",
    icon: RotateCcw,
    x: 84,
    y: 85,
    input: "A previous study and its saved setup.",
    output:
      "Reopen the material, change the selection or context, and start a new first reading linked to the previous study.",
    next: "Source packet in a new study",
  },
} as const;
type Step = keyof typeof steps;
const cases = {
  breadth: {
    label: "Market breadth",
    sentence: "The index gain was concentrated in its largest constituents.",
    assignment:
      "Compare cap-weighted and equal-weight returns over the same week, then inspect the median constituent.",
    weakens:
      "An equally strong median and equal-weight return would weaken the concentration explanation.",
  },
  debt: {
    label: "Refinancing exposure",
    sentence: "Within the same sector, firms with near-term debt led the rally.",
    assignment:
      "Group companies by next debt maturity and compare returns within each sector over the same week.",
    weakens: "A gap that disappears within sectors would weaken the refinancing explanation.",
  },
} as const;

function Connectors() {
  return (
    <svg
      aria-hidden="true"
      className={styles.lines}
      viewBox="0 0 1000 400"
      preserveAspectRatio="none"
    >
      <defs>
        <marker
          id="method-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0 0 8 4 0 8z" fill="currentColor" />
        </marker>
      </defs>
      <g fill="none" stroke="currentColor" strokeWidth="1.25" markerEnd="url(#method-arrow)">
        <path d="M280 60H377" />
        <path d="M620 60H717" />
        <path d="M840 92V129H500V165" />
        <path d="M380 200H283" />
        <path d="M160 232V265H500V305" />
        <path d="M280 340H377" />
        <path d="M620 340H717" />
        <g strokeDasharray="4 4">
          <path d="M840 130V165" />
          <path d="M160 266V305" />
          <path d="M840 232V305" />
        </g>
      </g>
      <g className={styles.lineLabels}>
        <text x="615" y="121">
          Commission
        </text>
        <text x="851" y="151">
          Park
        </text>
        <text x="172" y="294">
          Review
        </text>
        <text x="322" y="257">
          Continue
        </text>
      </g>
    </svg>
  );
}

export function ResearchMethodology({
  titleRef,
  setupHref,
  onReturn,
}: {
  titleRef: Ref<HTMLHeadingElement>;
  setupHref?: string;
  onReturn?: MouseEventHandler<HTMLAnchorElement>;
}) {
  const [selected, setSelected] = useState<Step>("sentence");
  const [example, setExample] = useState<keyof typeof cases>("breadth");
  const step = steps[selected];
  const current = cases[example];
  return (
    <main className={styles.page}>
      <div className={styles.title}>
        <div>
          <h1 id="research-methodology-title" ref={titleRef} tabIndex={-1}>
            Methodology
          </h1>
          <p>How a week of sources becomes a working sentence, an assignment and a report.</p>
        </div>
        <a href={setupHref ?? "?view=research"} className="button" onClick={onReturn}>
          {setupHref ? "Return to study setup" : "Open research desk"}{" "}
          <ArrowRight size={15} aria-hidden />
        </a>
      </div>
      <section aria-labelledby="map-title" className={styles.sheet}>
        <header>
          <div>
            <h2 id="map-title">Study map</h2>
            <p>Select a step to inspect the handoff.</p>
          </div>
          <div className={styles.legend}>
            <span>
              <i />
              Your decision
            </span>
            <span>
              <b />
              Conditional path
            </span>
          </div>
        </header>
        <div className={styles.graph} role="group" aria-label="Research desk workflow">
          <Connectors />
          {(Object.keys(steps) as Step[]).map((key) => {
            const node = steps[key];
            const Icon = node.icon;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected === key}
                aria-controls="method-detail"
                data-human={node.role.startsWith("You") || undefined}
                style={{ "--x": `${node.x}%`, "--y": `${node.y}%` } as CSSProperties}
                onClick={() => setSelected(key)}
              >
                <small>
                  <Icon size={14} aria-hidden />
                  {node.role}
                </small>
                <strong>{node.title}</strong>
                <span className={styles.mobileNext}>
                  <ArrowRight size={12} aria-hidden />
                  {node.next}
                </span>
              </button>
            );
          })}
        </div>
        <div id="method-detail" className={styles.detail} aria-live="polite">
          <div>
            <small>{step.role}</small>
            <h3>{step.title}</h3>
          </div>
          <dl>
            <div>
              <dt>Comes in</dt>
              <dd>{step.input}</dd>
            </div>
            <div>
              <dt>What happens</dt>
              <dd>{step.output}</dd>
            </div>
            <div>
              <dt>Goes to</dt>
              <dd>{step.next}</dd>
            </div>
          </dl>
        </div>
      </section>
      <section className={styles.example} aria-labelledby="example-title">
        <div>
          <GitBranch size={20} aria-hidden />
          <h2 id="example-title">One packet, two possible assignments</h2>
          <p>
            The example uses an index chart, a note about the median stock and a conversation about
            debt maturities.
          </p>
        </div>
        <div>
          <div className={styles.switches} role="group" aria-label="Example judgment">
            {(Object.keys(cases) as (keyof typeof cases)[]).map((key) => (
              <button
                type="button"
                key={key}
                aria-pressed={key === example}
                onClick={() => setExample(key)}
              >
                {cases[key].label}
              </button>
            ))}
          </div>
          <dl aria-live="polite">
            <div>
              <dt>Your working sentence</dt>
              <dd>{current.sentence}</dd>
            </div>
            <div>
              <dt>Next assignment</dt>
              <dd>{current.assignment}</dd>
            </div>
            <div>
              <dt>What would weaken it</dt>
              <dd>{current.weakens}</dd>
            </div>
          </dl>
        </div>
      </section>
    </main>
  );
}
