# Discretionary macro research example

Choose **New agent → Discretionary macro research** to save an editable copy of the
[workflow](../examples/discretionary-macro.json). **Run workflow** opens an editable
[brief](../examples/discretionary-macro-brief.json) about a front-end rates repricing.
You can change the market, as-of time, horizon, and question, then attach dated charts,
positioning data, release tables, or other evidence. Workspaces use the existing
ChatGPT connection, Codex CLI, and local Python runner. The example enables optional
live search and sets an upper limit of 15 model calls across six model steps.

In Run setup, search **Evidence for this run** by saved date or source metadata.
Open **Selected sources** to confirm the exact versions and put the dated pricing
inputs and release evidence in the order you want to pin them.

| Stage              | What the run produces                                                                | Owner decision                                                      |
| ------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Frame              | A cross-asset tension, two mechanisms, and a test that distinguishes them            | Choose the question, event window, and horizon                      |
| Price and test     | A dated pricing baseline, quantitative evidence, and a challenge to the causal story | Weigh the thesis, dissent, and missing evidence                     |
| Scenarios and memo | A defended view, conditional scenarios, catalysts, and invalidation criteria         | Decide whether the view is ready or what a revised experiment needs |

The Python step can save a chart, observation table, script, and methods when the data
support a test. Use **Runs → Model activity** to locate a specific pass or inspect
the Python step for its files. The challenge step starts from the prior output and
asks for independent corroboration. The final memo receives the scenario analysis and
your recorded judgment. The sequence and checkpoint wording are an interpretation of
the owner's rough framework. Edit them in **Build**, save a new version, and start a
fresh run to try a different research process.

## Inspect a change before running it

1. Open **Model and tool plan** and select **Challenge the transmission story**.
   Check its model and search settings before deciding how much independent
   corroboration the step should collect.
2. Open **Review plan** to read each checkpoint question. Expand **Wiring** to see
   what prepares the decision and where its feedback goes. Select **Choose the
   question and horizon**. In **Review handoff**, follow
   the feedback link for **Run the discriminating test** to see where the mandate
   reaches that step. Its **Output bindings** show where the test feeds the challenge.
   Use **Return to step** after following a link to reopen the source step.
3. After editing a prompt or changing a binding, browse **Draft changes** to check
   what will differ from the saved revision. Use **Find changes** to locate the
   checkpoint, then **Compare with** to check the wording against an earlier
   version. Select **Open draft step** to inspect the edit.
   Choose **Use saved review question** to reuse the earlier checkpoint wording.
   Run **Validate workflow** to catch a broken connection and follow its link to
   the affected step when available.

## Inspect a run and carry judgment forward

**Runs → Decisions** shows open reviews and saved judgments. Expand **Steps wired to
this feedback** to inspect the downstream steps and their saved model requests.
In an open review, **Files for this review** shows saved files from the output
under review and its earlier context. Preview the chart or observations while
you write your judgment.
**Iterate with this feedback** copies the saved version and appends the selected
judgment to the next editable brief. Use **Combine feedback for next run** to
carry several recorded judgments into one brief, such as the mandate and your
later view on what the market is pricing. Edit the prior brief and preview the
combined text before opening the revised experiment in Build.

**Runs → Files** finds saved charts, CSVs, and methods files across the run. Open
the listed pass to inspect the calculation. Preview charts and supported text
files in the list or download the exact saved version.

When an attempt surfaces a useful web reference, open **Web sources** and use
**Save source link**. Review its title and URL before adding it to Sources.
The saved record is Link only and identifies the attempt that reported it.
