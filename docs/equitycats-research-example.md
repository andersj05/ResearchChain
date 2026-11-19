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

| Pass | Research test                                                                               |
| ---- | ------------------------------------------------------------------------------------------- |
| 1    | Reconcile the apparently conflicting moves with information and expectations at cutoff.     |
| 2    | Use a matched window, instrument or benchmark that gives the rival explanation a fair test. |
| 3    | Seek the decisive original observation and test sensitivity to a confounder.                |

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

In **Runs → Outputs**, search by step or iteration. Compare the **Audit the case
and the evidence** outputs and the saved **Check readiness for owner review**
results to see why the agent retried or asked for judgment.
Open the audit’s web sources or saved request for its source record. The chosen
iteration contains the proposal, decision and memo. **Iterate from this step**
opens the pinned body in Build with the original brief and sources available.

The numbered workflow passes are independent tests against the same pinned
brief and evidence. Within a pass, connections carry the latest finding from
one researcher to the next. The baseline analyst can also pursue one follow-up
with its prior result and tool records. Edit a prompt, the readiness check,
or the pinned loop definition in Build and save a version to try a different plan.
