# Bounded hypothesis research

Next implementation after the verified ChatGPT-plan connection, tracked in
[issue #6](https://github.com/andersj05/ResearchChain/issues/6).

## First usable flow

Use the connected account to propose hypotheses, alternative explanations,
falsifiers, unresolved questions, and evidence requests. Pause for human review,
challenge the proposal against pinned evidence, then produce a revised conclusion
with citations and uncertainty. Start with a small, explicit research brief and
compare its result with a separately supplied human baseline. Do not label an
agent-written reference as a human baseline.

## Implementation boundaries

- Preserve existing workflow documents, pinned compiler versions, checkpoints,
  and retry receipts. Add a versioned research configuration through the Python
  models and regenerate browser contracts.
- Expose safe connection/model status and research configuration in the workbench.
  Tokens stay in the server-side provider store. Keep the plan-use indicator and
  usage-settings link near model selection.
- Persist a model-attempt journal before external calls, then save validated
  outputs and returned usage. Replays reuse completed records. A request with an
  uncertain outcome must not be silently sent again after process recovery.
- Pin provider/account registration, requested and returned model IDs, versioned
  prompts, tool settings, workflow revision, and evidence/data snapshots. Exclude
  all credentials from runs and manifests.
- Add model/tool-call budgets and visible progress to existing elapsed-time,
  iteration, node-execution, and cancellation controls. Close live streams when
  cancelled or limited, and retain partial/unknown outcomes accurately. The plan
  route has no hard max-output-token parameter: do not invent a dollar cost or
  claim a transport timeout guarantees a token-spend cap. Respect app usage limits
  and the owner's choice to use included allowance without paid fallback.
- Treat originals and source text as untrusted evidence. Keep chart interpretation,
  numeric data, derived estimates, claims, and human judgments distinct. Require
  citations to captured versions and represent missing/disconfirming evidence.
  Do not treat model-invented URLs as independent sources.
- Verify failure/recovery/cancellation and budget behavior with controlled provider
  fixtures, then one small live task. Keep the human baseline out of generation
  inputs. No automatic publication or trading.

## Checks and delivery

Commit coherent steps frequently. Run focused tests while developing, then
`pnpm check`, generated-contract drift checks, and browser tests for changed
interactions. Merge completed steps into dev after CI; keep issue #6 open until
all acceptance criteria, including the human comparison, are satisfied.
