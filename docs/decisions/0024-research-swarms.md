# Research swarms and expert consultations

The Research desk can start a study with several lead researchers. The owner
chooses the models, the number of mandates, the maximum assignments per lead,
the maximum concurrent agents and the lead turn limit. A coordinator using
the lead model assigns distinct mandates from the brief. Swarms use their own
versioned prompts and tools. Existing team plans retain their original format.

## Delegation and budgets

A lead can call `research.delegate`, `research.ask_expert` or `research.finish`.
Delegation creates numbered assignments under that lead. Each has an isolated
analyst conversation and Python workspace. A lead receives its workers' saved
findings and can delegate a follow-up within its remaining capacity. The final
permitted turn synthesizes the mandate. Stable attempt paths identify the
coordinator, lead turns, workers and worker continuations across recovery.

Leads and researchers share the study's concurrency, request and active-time
budgets. A lead waiting for its workers holds no model slot. Each provider
request goes through the workspace allowance check. The scheduler reuses a
completed receipt on replay and preserves the existing stop for a provider
request whose outcome is uncertain.

## Human decisions

A lead consultation records its tentative thesis, the decision it needs,
possible approaches and references to its completed researcher work. Options
are suggestions. The owner can supply a different judgment in their own words.
Independent leads can continue. When the swarm needs a human answer to make
further progress, a durable checkpoint releases the worker and stops the
active-time clock.

Each consultation has a public identity derived from the run and the lead's
saved tool-call path. This allows several questions to be answered in any
order using the existing owner-authenticated review command. The answer returns
to the lead that asked, travels with its follow-up assignments and reaches
the editor as attributed human judgment. Exact retries reuse the admitted
command. A study-wide direction and an editorial review retain their own scope.

## Handoff

The editor receives the mandates, lead decisions and a bounded index of
confirmed worker findings. File aliases include the lead and worker identity.
Full results and files remain inspectable in their producing workspace. The
owner's writing sample continues to reach the editor only.

[Delivery issue](https://github.com/andersj05/ResearchChain/issues/134)
