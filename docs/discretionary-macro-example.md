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

**Runs → Decisions** shows open reviews and saved judgments. Expand **Steps wired to
this feedback** to inspect the downstream steps and their saved model requests.
In an open review, **Files for this review** shows saved files from the output
under review and its earlier context. Preview the chart or observations while
you write your judgment.
**Iterate with this feedback** copies the saved version and appends the selected
judgment to the next editable brief.

**Runs → Files** finds saved charts, CSVs, and methods files across the run. Open
the listed pass to inspect the calculation. Preview charts and supported text
files in the list or download the exact saved version.
