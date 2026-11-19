# EquityCats cross-asset research

Choose **New agent → EquityCats cross-asset research** to save an editable copy of
the [workflow](../examples/equitycats-research.json). The example applies the essay’s
division of work to a cross-asset question. Researchers collect and challenge the
evidence, an auditor flags gaps, and the owner decides which view to defend.
[Interfaces, Brains, and Computers](https://equitycats.substack.com/p/interfaces-brains-and-computers)

Open **Run workflow** to fill in the [brief](../examples/equitycats-research-brief.json).
Set an information cutoff, event window and horizon. Name the instruments, the
market tension and the observation that would distinguish the two explanations.
Attach the original chart, time series, or release when available. The example
uses the existing ChatGPT plan connection, the Codex analyst and optional live
search. It allows up to 14 model requests across all passes.

In **Build**, expand **Test the view against the evidence** in **Workflow outline**
to see its pinned body and three-pass limit. Open its stop condition to see which
step determines readiness. Expand **Present the case or test again** in the
body to see the owner review and memo on one path and the retry note on the other.
Open **Choose this pass’s test** to see the input from the previous iteration's
readiness check.

| Pass | Research test                                                                             |
| ---- | ----------------------------------------------------------------------------------------- |
| 1    | Reconcile the apparently conflicting moves with information and expectations at cutoff.   |
| 2    | Follow up the first audit's gap with a matched window, instrument or benchmark.           |
| 3    | Test the remaining decisive gap against original observations and a plausible confounder. |

Each pass reconstructs what was priced, challenges the leading explanation, and
audits the strongest evidence. The readiness check requires an explicit verdict,
no blocking gaps, and a substantive captured citation or provider-recorded web
citation. This is a handoff check. Read the saved audit and its source receipts
to judge whether the evidence supports the claim.

When a case is ready, **Decide which view to defend** asks for your view and what
would change it. Approving feeds the exact feedback into the memo. Rejecting
saves the decision and ends that run. If all three passes find a blocking gap,
the run reaches the loop limit with its audits and search receipts saved. Use the
last audit’s named evidence gap to decide what to add for the next experiment.

In **Runs → Outputs**, search for **Audit the case and the evidence**. When the
run saves more than one audit, use **Compare iterations** to inspect citations
and saved inputs from both. Open **Check readiness for owner review** in each
iteration to see what the agent carried forward. Open **Saved request** on the
next **Reconstruct the priced baseline** step to verify the actual context.
The chosen iteration contains the proposal, decision and memo. **Iterate from
this step** opens the pinned body in Build with the original brief and sources
available.

The workflow holds the pinned brief and cutoff fixed. Each follow-up receives
the previous audit's provisional view, strongest objection and highest-priority
gaps as leads to verify. The challenger independently checks what the new
observation changes. Within each numbered iteration, the baseline analyst can
also pursue one follow-up with its prior result and tool records. Edit a prompt,
the readiness check, or the pinned loop definition in **Build → Plan** and save
a version to try a different test.
