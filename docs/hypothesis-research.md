# Hypothesis research

Use **Use research template** in the Workflow tab, then **Run workflow**. Choose a
model offered by the connected ChatGPT account, supply a brief, and select evidence.
Model selection is saved in the workflow revision. The run separately pins the
selected account. Connection setup is in [ChatGPT plan usage](chatgpt-plan.md).

The default research template forms hypotheses, pauses for feedback, challenges
them, revises the conclusions, and pauses again. Review each hypothesis's alternative
explanations, falsifiers, citations, unanswered questions and evidence requests.
Your review feedback is saved with that checkpoint and passed only to steps wired
to its feedback output. Reject stops the run. Editor changes apply to future runs.

## Sources and results

Each call reads the run's pinned evidence versions. Text and CSV/TSV content are
sent as captured; supported images and PDFs are attached within the input budget.
Missing, paywalled, link-only and unsupported originals remain metadata references.
Links do not fetch websites. Add independent sources in the evidence desk before
starting a new run when the current evidence is insufficient.

The server checks result structure, stable hypothesis IDs, cited evidence IDs,
representation labels, and exact text quotations. A supported/contradicted/mixed
assessment needs matching substantive citation relationships. These checks do not
verify the truth of a claim or that a quotation entails it. Image/PDF interpretation,
OCR and digitized estimates remain distinguishable from numeric sources. Model
output and source content render as text, not executable markup.

Run details show per-stage progress, usage, validated results and saved request/
response downloads. The research manifest export includes prompts' versions and
hashes, model IDs, limits, workflow revision, account registration and evidence
snapshots. It contains no credentials. Keep exports private when they include
research notes or account details.

## Execution limits

Research limits cover model attempts, evidence reads, request bytes, response
characters, per-response seconds and reported tokens. Existing workflow limits
cover active time, step count, loops and parallelism. Paused human-review time is
excluded. Model attempts within a run are serialized even inside parallel branches,
so returned usage is charged before another request is admitted.

The [workspace request allowance](request-allowance.md) also limits admissions across
runs, workers and accounts. Operations can pause new requests or change its rolling
24-hour allowance. Cleanup does not replenish it. Runs stopped by the guard need
an explicit new start when capacity is available.

The reported-token threshold stops the **next** request. It is not a hard cap on
an in-flight response: the current plan route does not support `max_output_tokens`.
A timeout, output limit or cancellation closes the local stream but cannot guarantee
that remote work has stopped. Incomplete usage remains visibly unknown. See
[OpenAI's preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

This integration uses the authorized ChatGPT plan and has no paid API fallback.
Keep credit use disabled and configure app usage controls in
[ChatGPT usage settings](https://chatgpt.com/settings/usage). ResearchChain does not
read or attest to those provider-side credit settings, and does not invent a dollar
price for included plan usage.

Each model attempt is recorded before sending. Recovery reuses completed saved
results. An interrupted request whose outcome is uncertain is not automatically
sent again; inspect the saved progress and start a new run deliberately. Cancellation
and live progress reads work while the original execution request is pending.

## Development validation

A three-stage `gpt-6.1-sol` pilot completed through the connected plan on 2026-11-14
and was left paused for the owner's final review. All three outputs passed schema,
source, quotation and stable-ID checks. The pilot recorded 9,765 input and 4,135
output tokens in approximately 108 active seconds. Its 12,000-token admission
threshold was crossed by the final response, illustrating the in-flight limitation.

The small task examined conditions connecting correlation, portfolio risk and
exposure reduction. Inputs were short, independently published SEC and NIST
educational excerpts and a clearly labeled, reproducible synthetic variance check.
The owner's EquityCats anchor article was kept out of the inputs and used afterward
as a human-authored development baseline. This is not a blind evaluation.

The comparison found agreement on the conditional covariance mechanism. The run
kept manager behavior untested, requested positioning/constraint/flow evidence, and
did not claim the synthetic example verified a market regime. It also flagged that
different publishers are not independent empirical confirmation of the same claim.
This is a useful source-discipline check, not evidence of forecasting quality or a
full reproduction of the reference report. The private run and comparison notes
stay in local storage, outside Git. Broader quality evaluation is tracked in
[issue #7](https://github.com/andersj05/ResearchChain/issues/7).
