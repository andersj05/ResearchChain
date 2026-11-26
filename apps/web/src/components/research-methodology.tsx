"use client";

import { useRef, useState, type CSSProperties, type MouseEventHandler, type Ref } from "react";
import {
  ArrowRight,
  BookOpen,
  ClipboardList,
  Files,
  FileText,
  GitBranch,
  Layers,
  MessagesSquare,
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
    y: 12,
    input:
      "A week of events, changes in the data, and opinions from people who see the market differently.",
    output:
      "Choose what surprised you against your prior expectations. Pin the dated release or chart alongside the attributed conversation. A desk comment can suggest a test even when it cannot establish what happened.",
    next: "Lead’s first reading",
  },
  reading: {
    title: "Lead’s first reading",
    role: "Lead",
    icon: BookOpen,
    x: 50,
    y: 12,
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
    y: 12,
    input: "The first reading, the cited material and your own sense of what deserves a test.",
    output:
      "Put your hunch into one sentence. Name the surprising move, who it affects, the horizon and why you think it happened. Editing the wording can change the comparison the team should run. Assign research records your exact wording. You can also park the idea.",
    next: "Research assignments or parked study",
  },
  assignments: {
    title: "Research assignments",
    role: "Lead + researchers",
    icon: ClipboardList,
    x: 50,
    y: 42,
    input:
      "Your recorded sentence, the first reading, its rival explanations and the source packet.",
    output:
      "The director gives leads distinct mandates. Each lead can send researchers down parallel paths. Test the mechanism against a rival explanation, check what prices already imply, and keep the data, calculations and charts with the assignment.",
    next: "Findings",
  },
  findings: {
    title: "Findings",
    role: "Research team",
    icon: Layers,
    x: 16,
    y: 42,
    input: "The assignment, evidence, research passes and supporting files.",
    output:
      "Leads read the researchers’ receipts together. Match dates, units and comparison groups. Identify which observation distinguishes the rival explanations, what surprised the team, and what the packet still cannot establish.",
    next: "Expert check-in or synthesis",
  },
  consultation: {
    title: "Expert check-in",
    role: "You + lead",
    icon: MessagesSquare,
    x: 50,
    y: 66,
    input: "A lead’s provisional thesis, its alternatives and any completed researcher work.",
    output:
      "Each lead checks in by default, after its first findings or earlier if the test itself needs your judgment. Read the supporting passes. Give the interpretation or counterexample that matters to you. The lead receives your exact answer and can commission a different test. Subsequent researchers and the editor can see whose judgment shaped the work.",
    next: "Follow-up assignment or synthesis",
  },
  editorial: {
    title: "Editorial judgment",
    role: "You",
    icon: PencilLine,
    x: 16,
    y: 89,
    input: "The team’s findings and any review question.",
    output:
      "Before writing, decide which view you can defend. What changed from your first hunch? Which counterexample still matters? The default review setting waits for you. Ask the editor to emphasize a finding, qualify its limits, or end the study here.",
    next: "Report",
  },
  report: {
    title: "Report",
    role: "Editor",
    icon: FileText,
    x: 50,
    y: 89,
    input:
      "The findings, supporting files, any editorial judgment and your optional writing sample.",
    output:
      "Read the bottom line against the original question. A trade takeaway should say what you expect, why, over what horizon and what would change your mind. Follow a figure to its saved evidence and distinguish observations from estimates and expert judgment.",
    next: "Revisit material",
  },
  parked: {
    title: "Parked study",
    role: "You",
    icon: Pause,
    x: 84,
    y: 42,
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
    y: 89,
    input: "A previous study and its saved setup.",
    output:
      "Reopen the material, change the selection or context, and start a new first reading linked to the previous study.",
    next: "Source packet in a new study",
  },
} as const;
type Step = keyof typeof steps;
const handoffs: Record<Step, Step[]> = {
  sources: ["reading"],
  reading: ["sentence"],
  sentence: ["assignments", "parked"],
  assignments: ["findings"],
  findings: ["consultation", "editorial", "report"],
  consultation: ["assignments", "editorial", "report"],
  editorial: ["report"],
  report: ["revisit"],
  parked: ["revisit"],
  revisit: ["sources"],
};
const cases = {
  breadth: {
    label: "Market breadth",
    sentence: "The index gain was concentrated in its largest constituents.",
    assignment:
      "Compare cap-weighted and equal-weight returns over the same week, then inspect the median constituent.",
    weakens:
      "An equally strong median and equal-weight return would weaken the concentration explanation.",
    question: "Could the apparent breadth gap come from sector weights?",
    answer:
      "I care about participation within sectors. Compare peers before treating this as an index-wide signal.",
    followUp:
      "Rebuild the comparison within each sector and check whether a few large constituents still explain the gap.",
  },
  debt: {
    label: "Refinancing exposure",
    sentence: "Within the same sector, firms with near-term debt led the rally.",
    assignment:
      "Group companies by next debt maturity and compare returns within each sector over the same week.",
    weakens: "A gap that disappears within sectors would weaken the refinancing explanation.",
    question:
      "Should the team use the next debt maturity or the date when funding costs actually reset?",
    answer: "Use the reset date. A near-term maturity can already be funded.",
    followUp:
      "Separate pre-funded maturities from firms still exposed to refinancing. Compare the groups over the same release window.",
  },
} as const;

function Connectors({ selected }: { selected: Step }) {
  const paths: [Step, Step, string, boolean?][] = [
    ["sources", "reading", "M280 60H377"],
    ["reading", "sentence", "M620 60H717"],
    ["sentence", "assignments", "M840 92V136H500V177"],
    ["sentence", "parked", "M840 136V177", true],
    ["assignments", "findings", "M380 210H283"],
    ["findings", "consultation", "M160 242V330H377"],
    ["consultation", "assignments", "M500 298V243"],
    ["consultation", "editorial", "M500 362V385H160V412"],
    ["findings", "editorial", "M160 330V412", true],
    ["findings", "report", "M280 226H326V369H464V412", true],
    ["consultation", "report", "M500 385V412", true],
    ["editorial", "report", "M280 445H377"],
    ["report", "revisit", "M620 445H717"],
    ["parked", "revisit", "M840 242V412", true],
  ];
  return (
    <svg
      aria-hidden="true"
      className={styles.lines}
      viewBox="0 0 1000 500"
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
      <g fill="none" stroke="currentColor" markerEnd="url(#method-arrow)">
        {paths.map(([from, to, d, optional]) => (
          <path
            key={from + to}
            d={d}
            data-active={from === selected || undefined}
            strokeDasharray={optional ? "4 4" : undefined}
          />
        ))}
      </g>
      <g className={styles.lineLabels}>
        <text x="615" y="128">
          Commission
        </text>
        <text x="851" y="160">
          Park
        </text>
        <text x="177" y="322">
          Weigh the evidence
        </text>
        <text x="513" y="277">
          Follow-up test
        </text>
        <text x="215" y="378">
          Send findings
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
  const detailTitle = useRef<HTMLHeadingElement>(null);
  function selectStep(key: Step, follow = false) {
    setSelected(key);
    if (follow || window.matchMedia("(max-width: 710px)").matches) {
      requestAnimationFrame(() => detailTitle.current?.focus());
    }
  }
  return (
    <main className={styles.page}>
      <div className={styles.title}>
        <div>
          <h1 id="research-methodology-title" ref={titleRef} tabIndex={-1}>
            Methodology
          </h1>
          <p>
            Start with what caught your attention this week. Use a working sentence to decide what
            to test, then revise the view as evidence comes in.
          </p>
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
            <p>Select a step to see what it receives and which decision changes the work.</p>
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
          <Connectors selected={selected} />
          {(Object.keys(steps) as Step[]).map((key) => {
            const node = steps[key];
            const Icon = node.icon;
            return (
              <button
                key={key}
                id={`method-step-${key}`}
                type="button"
                aria-pressed={selected === key}
                aria-controls="method-detail"
                data-human={node.role.startsWith("You") || undefined}
                data-next={handoffs[selected].includes(key) || undefined}
                style={{ "--x": `${node.x}%`, "--y": `${node.y}%` } as CSSProperties}
                onClick={() => selectStep(key)}
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
            <h3 ref={detailTitle} tabIndex={-1}>
              {step.title}
            </h3>
            <a className={styles.backToMap} href={`#method-step-${selected}`}>
              Back to study map
            </a>
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
              <dt>Follow the handoff</dt>
              <dd className={styles.handoffs}>
                {handoffs[selected].map((key) => (
                  <button type="button" key={key} onClick={() => selectStep(key, true)}>
                    {steps[key].title} <ArrowRight size={12} aria-hidden />
                  </button>
                ))}
              </dd>
            </div>
          </dl>
        </div>
      </section>
      <section className={styles.example} aria-labelledby="example-title">
        <div>
          <GitBranch size={20} aria-hidden />
          <h2 id="example-title">One packet, two possible assignments</h2>
          <p>
            In this illustrative packet, an index rose, the median stock was flat, and a desk
            conversation raised a question about debt maturities. See how two readings produce
            different work.
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
            <div>
              <dt>The lead asks</dt>
              <dd>{current.question}</dd>
            </div>
            <div>
              <dt>Your judgment</dt>
              <dd>{current.answer}</dd>
            </div>
            <div>
              <dt>Revised assignment</dt>
              <dd>{current.followUp}</dd>
            </div>
          </dl>
        </div>
      </section>
    </main>
  );
}
