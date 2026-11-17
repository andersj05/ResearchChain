# Collecting a real evaluation baseline

The [evaluation workbench](evaluations.md) stores cases, outputs and judgments.
An implemented workbench is not evidence of research quality. This protocol turns
real captured inputs into reviewable comparisons for
[issue #7](https://github.com/andersj05/ResearchChain/issues/7).

## Freeze the case before generating outputs

Choose a substantive topic separate from development examples. Record the task,
track, partition, source selection, coverage period and actual capture dates.
Preserve downloaded originals and label text extraction, transcription and missing
originals explicitly. A public web extract is not a captured publisher PDF or HTML.
Keep transformations linked to their captured parent and verify their byte hashes.

For a retrospective exercise captured today, use today's cutoff and describe that
scope in the brief. Do not backdate capture to a release date. A passed date check
only establishes the app's recorded metadata conditions; it does not establish
historical availability, independence of sources or absence of model-training
contamination. Related statistical releases may share underlying observations.

Save the immutable dataset revision and its eligible generation packet. Pin its
input hash before inspecting generated outputs. Keep reference reports and
reviewer-only material outside generation inputs. Keep cases used for prompt
tuning out of subsequent held-out quality claims, even if their original database
record still says holdout. Collect fresh cases for that purpose.

Private source packages, briefs, prompts, outputs and receipts stay outside Git.
Use the application database and an owner-controlled local capture directory;
the public repository contains the procedure and aggregate validation only.

## First paired comparison

The initial collection uses the frozen-writing track: both outputs use exactly
the same brief and captured evidence. Reserve the workflow, model, prompt hashes,
limits and candidate-selection rule before starting the run.

For the first comparison, select the first completed hypothesis stage and the
final completed revision stage of one three-stage run. Keep the existing stage
prompts and the complete `research-text-1` rendering. Do not select whichever
attempt looks better. The challenge stage feeds the revision; it is not a third
independent observation.

This measures the change from an initial research note to its revision within
one trajectory. The outputs are correlated. It does not establish performance
against a human-authored baseline or the quality of a finished publication.
A later full-research study must separately evaluate additional evidence gathering.

The reserved run permits at most three included-plan requests, one at a time,
with 120 seconds per response and 420 active seconds overall. Its 36,000 reported-token
threshold gates subsequent requests; it cannot cap an in-flight response.
There is no paid API fallback. Preserve the final human-review checkpoint.
The evaluation workflow has no intermediate human approval, and must not imply
that a person supplied feedback.

If execution fails, stops at a limit or has an uncertain outcome, preserve that
result. Do not silently retry, replace a draft or tune the prompt against this
case. A runtime failure is not a missing result to discard from the study record.

## Review and interpret

Register both outputs from their completed recorded attempts, recheck input
eligibility, and create one randomized A/B comparison. The saved requests retain
all prior stages. Preserve the comparison assignment and complete texts.
An offline review copy must match that blind view exactly and omit candidate
identity and judge predictions.

The interface hides identity, but revision language may reveal which stage a
draft came from. A reviewer who knows the outputs or helped construct them is
also not independent. Record these limitations when interpreting a preference.

Collect factual, numerical and citation gates, reasons, writing dimensions and
edited spans from an actual reviewer. Leave unassessed gates unassessed. An agent
must not invent a human judgment or approve the paused run on the owner's behalf.
Keep predictions hidden from the reviewer; any judge prediction must be recorded
before the human label is revealed.

Report the case and pair counts, missing judgments, exclusions and failures.
One pair cannot establish reliable quality or calibration. The app's exploratory
calibration minimum remains 20 eligible labeled pairs across five distinct cases
per judge configuration. Those metrics measure agreement with saved preferences,
not factual correctness. Build that collection before tuning a judge or model.
