# Chart signal research

Choose **New agent → Chart signal research** to create an editable copy of the
[workflow](../examples/chart-signal.json). Open **Run workflow**, replace the
sample brief with the relationship you see and the horizon you care about, then
choose **Upload a chart**. Select the PNG, JPEG or WebP original, record your
access rights and choose **Save and attach**. You can select additional saved
sources, including release notes and CSVs, in the same dialog.

| Step                                | What to inspect                                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read the chart                      | The series, units, dates, apparent lag, proposed mechanism and competing explanation.                                                                                                                   |
| Find the series                     | A Codex analyst searches for original observations, release calendars and revisions. Check the dated source links.                                                                                      |
| Approve the forecast design         | Freeze X, the future outcome, horizon, cutoff, benchmark, loss and planned sensitivity check. Identify every period you saw when developing the idea.                                                   |
| Build the observation table         | A second analyst assembles the point-in-time data in Python. It can search for missing observations. Inspect the exclusions, source notes and saved CSV.                                                |
| Score the holdout                   | A third analyst uses the connected files to fit on eligible training rows and compare forecasts on the same later dates. Inspect the script, per-origin predictions and metrics under **Runs → Files**. |
| Look for a competing explanation    | A fourth analyst searches for evidence that challenges the result, including a common driver, timing error or regime change.                                                                            |
| Weigh the result and write the memo | Record your judgment. The final step writes a memo with the evidence, benchmark comparison, dissent and next prospective test.                                                                          |

The default scorer fits a one-predictor linear regression with an intercept
and compares it with the training-period mean. Both forecasts are fixed before
the holdout. A training outcome must have been released strictly before the
cutoff. The test includes forecast origins at or after the cutoff. A row whose
outcome crosses the split is excluded from training. Inspect both RMSEs in
target units. Out-of-sample R² is relative to the benchmark and is undefined
when the benchmark error is zero.

A visual pattern can motivate the study. A numeric test needs sourced
observations, their availability at each forecast origin, and actual outcomes.
When those are missing, the example asks the analysts to return the specific
data gap. The scorer checks the supplied timestamps. Establishing that the
timestamps and vintage match the original release requires source review.
An interval you already saw on the chart can support a retrospective comparison.
New observations provide a prospective test.

The source-discovery and challenge steps each require a completed web search.
Search queries can include information from the brief and selected evidence.
The example uses the existing ChatGPT plan connection, installed Codex CLI and
local analyst Docker image. It allows up to 18 model calls and 60 active minutes
across a run. Review pauses are excluded. Edit the prompts, tools, model, limits
and checkpoints in Build. Use **Iterate from this run** to test a revised design.
