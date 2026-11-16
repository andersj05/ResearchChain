# Current state

Updated 2026-11-16. The owner authorized frequent commits and merging completed
steps into dev after passing checks. No main promotion or public deployment.

## First implementation pass: owner-built agents

Confirmed with the owner on 2026-11-16. Deliver the local environment in which the
owner designs, runs, inspects and iterates on their own agent. The owner determines
the research strategy, prompts, sources, checkpoints and quality judgments.
Agent-generated research templates and pilots are optional examples, not the product
specification or acceptance gates. Do not require pilot labels, a calibrated judge,
a finished agent, public hosting or publication to complete this environment pass.

Acceptance: the owner can start a blank workflow, configure model instructions and
human reviews, wire inputs, choose evidence/model/limits, save versions, run and inspect
outputs, incorporate feedback, and start a revised experiment without editing code.
Verify with synthetic providers; do not consume the owner's plan or submit human
judgments to demonstrate readiness. After delivery, the owner will build a simple
agent and supply usability feedback. Preserve that as the next step.

## Active owner feedback

The owner has reviewed the first builder handoff and requested canvas repair,
explicit agent switching, compact settings/navigation, adjustable sidebars,
owner-authored code steps, clearer models, a 1,000/day request limit, and better
data views. See [the delivery plan](../plans/0017-owner-workspace-feedback.md).
This extends the environment work; the owner still designs the agent and supplies
quality judgments. Each cohesive change needs its own PR merged into dev.

Canvas dragging and the alignment grid are merged in PR #39 (6949918).
CI 43957865925 passed 448 backend and 93 browser tests. Settings PR #40 and
adjustable panels PR #41 are merged after full CI. Named agents now have isolated
history, recoverable drafts and exact run ownership; focused backend/browser checks
passed, with full CI and schema-12 upgrade verification still pending. Model visibility
merged in PR #42. Named agents are in PR #43 and bounded JavaScript in PR #44.
Compact shell/navigation is implemented with renamed task labels and unchanged URL
keys; full CI and data-view improvements remain before delivery.
The live workspace allowance is now 1,000 per rolling 24 hours, policy revision 2,
changed on explicit owner authorization without inference. Private receipt:
.local/owner-1000-request-allowance.log. Initial policies for other workspaces remain 100.

Schema-12 rehearsal: a schema-11-compatible backup restored all 35 tables and 30
originals (612,016 bytes) into a separate database. Upgrading that copy preserved
all 34 existing data-table fingerprints; both legacy runs remain readable and
unassigned. Private receipts: .local/agents-before-upgrade/restore-receipt.json and
.local/agents-upgrade-rehearsal.json. The live database is still schema 11, stopped
pending final integration and upgrade. No model calls or human judgments were made.

## Checkout and verified delivery

The actual repository is C:/Users/jense/Desktop/ResearchChain. The empty
Documents/ChatGPT directory is not the checkout. Use explicit working directories.
The owner environment handoff is [PR #38](https://github.com/andersj05/ResearchChain/pull/38). PR #37's
optional evaluation protocol was merged into dev before this pass. Its pilot
judgments remain unsubmitted and are not blockers. See [the builder guide](../agent-builder.md)
for the scope, audit and owner walkthrough. Focused verification passed 29 backend tests and desktop/mobile authoring flows.
The latter builds a custom agent, passes actual test feedback through a checkpoint,
then restores inputs and starts a distinct revision without changing the first run.
Custom steps retain the original research prompt hashes for legacy recovery.
Full quality and browser gates are required before merge; PR #38 records final results.
The restore/upgrade rehearsal preserved all 34 prior data-table fingerprints and
30 originals (612,016 bytes). Private receipts are .local/builder-before-upgrade,
.local/builder-restore.log and .local/builder-upgrade-rehearsal.json.
No real model requests or human evaluation labels were submitted for this audit.

After integration the next step is the owner's simple-agent usability review, not
an assistant-generated agent or a request to label either old pilot. Use the builder
guide's capability boundaries when interpreting that feedback. Public hosting,
external tool integrations and research-quality studies are separate follow-ups.

[PR #35](https://github.com/andersj05/ResearchChain/pull/35) delivered the workspace
request allowance into dev as 4bbf68018d6342b58b96cdf95d3577ca2db69e59.
Final PR CI 43735728950 and dev CI 43736640641 passed all 445 backend and 88 browser
tests. Windows checks passed with 444 tests before the final cancellation regression;
that regression passed separately, and CI tested the complete final commit.
Desktop and mobile allowance screenshots were inspected.

Main .local/usage-delivery.json records the live runtime proof and service handle.
The schema-10 upgrade preserved all 32 existing data-table fingerprints and all
12 originals (129,817 bytes). Two worker consumers, an idle queue, protected usage
reads, eight available models and clear monitor conditions were verified without
inference. The default policy is 100 admissions per rolling 24 hours; it imported
three known historical research attempts. Current usage must be read again.

## Implemented capabilities

- [Research](../hypothesis-research.md): typed hypothesis/challenge/revision nodes,
  pinned sources and prompts, attempt journals, progress, budgets and cancellation.
- [Reports](../reports.md) and [evaluations](../evaluations.md): versioned editing,
  human feedback, separate references, blind comparisons and calibration summaries.
  Synthetic tests and unreviewed drafts are not human quality evidence.
- [Owner access](../owner-access.md) and [workers](../workers.md): one owner workspace,
  protected reads/mutations, durable commands, physical execution ownership and
  explicit recovery for held or uncertain work.
- [Operations](../operations.md), [retention](../retention.md) and
  [request allowance](../request-allowance.md): redacted status, confirmed cleanup
  and a shared request cap/pause control. Cleanup does not reset admission history.
- [Backups](../backups.md), [encrypted recovery packages](../encrypted-backups.md)
  and [monitoring](../monitoring.md): verified local recovery, portable encryption
  and explicit incident checks/delivery. No real external receiver or off-machine
  destination has been configured.

## Existing sign-in and optional pilot examples

The requested ChatGPT sign-in is complete. Saved plan usage and eight models were
verified without inference; see main .local/signin-restart-receipt.json.
Do not restart it without a new owner request or an actual authentication failure.
Credit permissions remain owner-controlled in ChatGPT and are not attested by the app.

The development pilot remains paused for human review. Its four-section report,
three sources and starter style guide are unreviewed. The run used 9,765 input and
4,135 output tokens. The published anchor was a development comparison, not a
separate holdout or an owner-submitted judgment.

Main .local/report-pilot.json identifies the private records. The current offline
review is .local/pilot-review-owner/index.html, copied from .local/pilot-report-review.zip
after verifying that its complete report view matches the database. An owner
feedback question is pending. Do not supply or record that judgment on the owner's behalf.

A first real frozen-writing case and randomized comparison are also ready for review.
Four public primary-source extracts and eight captured/derived records were frozen
before generation. Their date, reference-exclusion and exact-input checks passed.
The case uses the actual November 15 capture cutoff; it is not a historical forecast
test. One source is explicitly a web-text extract because direct download was blocked.

The reserved three-stage run completed with 29,544 input and 6,322 output tokens
in about 146 active seconds, using three included-plan requests. Its first and final
notes became the two recorded candidates, without output selection or retries.
The final run checkpoint and the A/B judgment remain open. There are no human labels
or judge predictions, and this correlated pair does not establish quality or calibration.
The offline copy preserves both complete blind texts and all four source byte hashes.

Main .local/evaluation-inflation-20261115/comparison-delivery.json records the exact
comparison and live review URL; review/index.html is the offline copy. The reservation,
source captures and generation packet remain private. A review question is pending.
Use [the study protocol](../evaluation-study.md) for collection and interpretation.

## Runtime and upgrade invariants

Keep ExecutionControl.lock shared with PostgresSaver.lock. The physical database
connection owns run/checkpoint fencing; never reconnect locked execution transparently.
Admission transactions require READ COMMITTED and commit before model work.
Failed, cancelled or uncertain requests retain their admission slot. Current policy
applies at each new request; it does not cancel work already admitted.
Recovery reuses confirmed results; uncertain model outcomes are never blindly retried.
Worker presence uses a separate connection from execution ownership.

Before stopping services, fence command admission and confirm the queue is idle.
Re-enumerate children of the verified old process tree after shutdown: on Windows,
the old Uvicorn reloader spawned a child during the PR #35 shutdown. Check process
identity/creation time before stopping a leftover; do not kill processes by name.
Confirm no old worker/API instance remains before migrating, then verify readiness.
Mixed versions are unsupported. Never rerun old schema-specific upgrade helpers
against the current database without checking their assumptions.

Use compatible code for a pre-upgrade backup and a separate database for restore
rehearsals. Research backups exclude provider credentials, owner sessions and monitor
profiles. An old archive cannot account for requests admitted after its snapshot.
Retain physical writer locks and cleanup reference checks; never purge private data
as a test. Browser tests use disposable e2e_ schemas and synthetic credentials.
Restore any displaced live services after testing.

## Later agent-quality and hosting criteria (not environment blockers)

- [#6](https://github.com/andersj05/ResearchChain/issues/6): actual owner assessment
  of the paused pilot/development comparison and provider-side spend controls.
  The request cap is local; the provider route cannot cap an in-flight response.
- [#7](https://github.com/andersj05/ResearchChain/issues/7): additional real separate
  holdouts, actual human assessment of the prepared comparison and judge calibration
  against independent human labels. Do not
  fabricate judgments, claim synthetic fixtures as quality evidence or optimize
  a judge before a reliable baseline exists.
- [#9](https://github.com/andersj05/ResearchChain/issues/9): a chosen off-machine
  recovery destination/key-handling procedure and copied restore, external receiver/
  watchdog, operational secret-rotation rehearsal, recovery objectives and measured
  hosting configuration. Local implementations alone do not complete these criteria.

Keep these issues open. Private uploads, notifications, paid services and deployment
need a concrete authorized destination/configuration. Use gh outside the Windows
sandbox; sandboxed auth errors do not justify re-authentication. Keep secrets,
private research, exports and transcripts out of Git. Write UTF-8 with LF.
