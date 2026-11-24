import Image from "next/image";
import { useRef, useState } from "react";
import type { components } from "@researchchain/contracts";
import { contentUrl, evidenceUrl } from "@/lib/evidence";
import { readReviewDrafts } from "@/lib/run-review-drafts";
import type { SessionWorkspace } from "@/lib/swarm-workspaces";
import { useSourceDetails } from "@/lib/use-evidence-library";
import type { RunSnapshot } from "@/lib/workflow";
import { PassLink, rememberAnswer } from "./session-consultations";
import styles from "./session-discovery.module.css";

type Reading = components["schemas"]["DiscoveryReading"];
type Review = NonNullable<RunSnapshot["review"]>;
type Decision = components["schemas"]["ReviewResponse"];
type SelectPass = (workspace: string, pass: string) => void;

const basisLabel = {
  source_text: "Source text",
  numeric_source: "Numeric source",
  image_interpretation: "Chart interpretation",
  document_interpretation: "Document interpretation",
  ocr_interpretation: "OCR interpretation",
  estimate: "Estimate",
  metadata_only: "Source metadata",
};

function SourceNotes({
  run,
  reading,
  sources,
}: {
  run: RunSnapshot;
  reading: Reading;
  sources: ReturnType<typeof useSourceDetails>;
}) {
  const cited = [...new Set(reading.citations.map((c) => c.evidence_id))];
  return (
    <aside className={styles.sources} aria-label="Evidence behind the reading">
      <h3>Evidence behind the reading</h3>
      {cited.length === 0 && <p>The lead cited no source passages.</p>}
      {cited.map((id) => {
        const item = sources.items.get(id);
        const saved = run.research_manifest?.evidence.find((s) => s.evidence_id === id);
        const citations = reading.citations.filter((c) => c.evidence_id === id);
        const name = item?.title ?? `Source ${id.slice(0, 8)}`;
        const chart = saved?.representation === "chart_screenshot" && saved.original;
        return (
          <article key={id} id={`reading-source-${id}`}>
            <h4>
              <a href={evidenceUrl(id)} target="_blank" rel="noopener">
                {name}
              </a>
            </h4>
            <p className={styles.byline}>
              {[
                item?.kind === "discussion" ? "Conversation" : null,
                item?.author || saved?.publisher,
                saved?.as_of_date,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {chart && (
              <a href={evidenceUrl(id)} target="_blank" rel="noopener">
                <Image
                  className={styles.chart}
                  src={contentUrl(chart)}
                  alt={name}
                  width={420}
                  height={220}
                  unoptimized
                />
              </a>
            )}
            {citations.map((citation, i) => (
              <div className={styles.excerpt} key={i}>
                {citation.quote && <blockquote>{citation.quote}</blockquote>}
                <small>
                  {basisLabel[citation.basis]}
                  {citation.locator && citation.locator !== name && ` · ${citation.locator}`}
                </small>
                <p>{citation.rationale}</p>
              </div>
            ))}
          </article>
        );
      })}
      {!!sources.unresolved.length && (
        <button className="text-link" onClick={sources.retry}>
          Retry source details
        </button>
      )}
    </aside>
  );
}

function FirstReading({
  run,
  reading,
  sources,
  choose,
}: {
  run: RunSnapshot;
  reading: Reading;
  sources: ReturnType<typeof useSourceDetails>;
  choose?: (sentence: string) => void;
}) {
  return (
    <div className={styles.spread}>
      <div className={styles.reading}>
        <p className={styles.observation}>{reading.observation}</p>
        {reading.proposals.map((p, i) => (
          <article className={styles.proposal} key={i}>
            <h3>{p.sentence}</h3>
            <dl>
              <dt>Another explanation</dt>
              <dd>{p.alternative}</dd>
              <dt>First check</dt>
              <dd>{p.first_check}</dd>
              <dt>What would weaken it</dt>
              <dd>{p.weaken_if}</dd>
            </dl>
            <div className={styles.references}>
              {p.evidence_ids.map((id) => (
                <a key={id} href={`#reading-source-${id}`}>
                  {sources.items.get(id)?.title ?? `Source ${id.slice(0, 8)}`}
                </a>
              ))}
            </div>
            {choose && (
              <button type="button" className="button small" onClick={() => choose(p.sentence)}>
                Use this sentence
              </button>
            )}
          </article>
        ))}
        {!reading.proposals.length && (
          <p>The lead has an open question. You can write a sentence or park this packet.</p>
        )}
      </div>
      <SourceNotes run={run} reading={reading} sources={sources} />
    </div>
  );
}

function ChooseSentence({
  run,
  reading,
  review,
  draftKey,
  disabled,
  respond,
  sources,
}: {
  run: RunSnapshot;
  reading: Reading;
  review: Review;
  draftKey: string;
  disabled: boolean;
  respond: (decision: Decision["decision"], sentence: string) => void;
  sources: ReturnType<typeof useSourceDetails>;
}) {
  const [sentence, setSentence] = useState(
    () => readReviewDrafts(draftKey)[review.interrupt_id] ?? "",
  );
  const input = useRef<HTMLTextAreaElement>(null);
  function edit(value: string) {
    setSentence(value);
    rememberAnswer(draftKey, review.interrupt_id, value);
  }
  return (
    <>
      <h2>The lead’s first reading</h2>
      <FirstReading
        run={run}
        reading={reading}
        sources={sources}
        choose={
          disabled
            ? undefined
            : (value) => {
                edit(value);
                input.current?.focus();
              }
        }
      />
      <form
        className={styles.decision}
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled && sentence.trim()) respond("approve", sentence);
        }}
      >
        <h3>{reading.question}</h3>
        <label htmlFor="working-sentence">Your working sentence</label>
        <textarea
          id="working-sentence"
          ref={input}
          rows={3}
          maxLength={6000}
          value={sentence}
          disabled={disabled}
          placeholder="What should the researchers try to establish?"
          onChange={(e) => edit(e.target.value)}
        />
        <div className={styles.actions}>
          <button className="button primary" disabled={disabled || !sentence.trim()} type="submit">
            Assign research
          </button>
          <button
            className="button"
            disabled={disabled}
            type="button"
            onClick={() => respond("reject", sentence)}
          >
            Park this study
          </button>
        </div>
      </form>
    </>
  );
}

function IssuedAssignment({
  runId,
  lane,
  onSelect,
}: {
  runId: string;
  lane: SessionWorkspace;
  onSelect: SelectPass;
}) {
  const receipt = lane.attempts.find((pass) => pass.input_artifact_id);
  return (
    <li>
      <h4>{lane.title}</h4>
      <p>{lane.objective}</p>
      {receipt && (
        <PassLink runId={runId} lane={lane} pass={receipt.id} onSelect={onSelect}>
          Inspect researcher request
        </PassLink>
      )}
    </li>
  );
}

export function SessionDiscovery({
  run,
  review,
  decision,
  team,
  draftKey,
  disabled,
  respond,
  onSelect,
}: {
  run: RunSnapshot;
  review?: Review;
  decision?: Decision | null;
  team: SessionWorkspace[];
  draftKey: string;
  disabled: boolean;
  respond: (decision: Decision["decision"], sentence: string) => void;
  onSelect: SelectPass;
}) {
  const sources = useSourceDetails(run.evidence_ids ?? []);
  const reading = run.model_attempts?.find(
    (pass) => pass.path === "root/discovery" && pass.status === "completed",
  )?.result?.discovery;
  const active = run.execution_pending || ["queued", "running", "paused"].includes(run.status);
  const parked = decision?.decision === "reject";
  return (
    <section
      className={styles.sheet}
      id="source-led-investigation"
      aria-label="Source-led investigation"
    >
      {reading && review && !decision ? (
        <ChooseSentence
          key={review.interrupt_id}
          run={run}
          reading={reading}
          sources={sources}
          review={review}
          draftKey={draftKey}
          disabled={disabled}
          respond={respond}
        />
      ) : (
        <>
          <h2>
            {decision
              ? parked
                ? "Study parked"
                : "Your working sentence"
              : "The lead’s first reading"}
          </h2>
          {decision?.feedback && <p className={styles.sentence}>{decision.feedback}</p>}
          {parked && (
            <p>This packet can be revisited in a new study. Research ended before delegation.</p>
          )}
          {decision && !parked && (
            <section className={styles.issued} aria-label="Issued assignments">
              <h3>Issued assignments</h3>
              {team.length === 0 ? (
                <p role="status">
                  {active
                    ? "Waiting for the lead’s assignments."
                    : "No researcher assignments were issued."}
                </p>
              ) : (
                <>
                  <ol>
                    {team.slice(0, 3).map((lane) => (
                      <IssuedAssignment
                        key={lane.key}
                        runId={run.id}
                        lane={lane}
                        onSelect={onSelect}
                      />
                    ))}
                  </ol>
                  {team.length > 3 && (
                    <details>
                      <summary>{team.length - 3} more assignments</summary>
                      <ol start={4}>
                        {team.slice(3).map((lane) => (
                          <IssuedAssignment
                            key={lane.key}
                            runId={run.id}
                            lane={lane}
                            onSelect={onSelect}
                          />
                        ))}
                      </ol>
                    </details>
                  )}
                </>
              )}
            </section>
          )}
          {reading ? (
            <details className={styles.history}>
              <summary>Read the original lead proposal</summary>
              <FirstReading run={run} reading={reading} sources={sources} />
              <p>{reading.question}</p>
            </details>
          ) : (
            <p role="status">
              {active
                ? "The lead is reading your pinned material."
                : "The lead’s first reading was not completed."}
            </p>
          )}
        </>
      )}
    </section>
  );
}
