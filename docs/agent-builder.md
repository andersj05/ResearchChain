# Build and iterate on your agent

This is your local authoring environment. You choose the agent's purpose, prompts,
evidence, routing, checkpoints and standards. The bundled research template and
saved pilots are optional examples. Evaluating them is not required to start.

## First experiment

1. Select **New agent**, enter a name and create it. A blank agent starts with a
   Finish step; optionally copy the current workflow. The **Agent** selector shows
   what you are editing and switches between agents. Saved versions and runs belong
   to their agent; existing unassigned workflows remain available.
2. Select **Add model prompt**. Give the step a name and write your Instructions.
   **Custom instructions** follows your task rather than requiring hypothesis
   formation. The optional hypothesis, challenge and revision behaviors retain
   their structured research rules. A **Research note** only copies text; it does
   not call a model.
3. Add **Human review** and write the question you want to decide. Add another
   model prompt after it. Select the first model's text under **Context input**
   and the review's feedback under **Reviewer feedback**. A control connection
   determines execution order; data inputs determine what the model receives.
4. If needed, capture sources in **Sources**. URL-only records do not fetch pages.
   Set **Execution limits** and **Research limits** for this experiment.
5. **Validate workflow**, then **Save revision**. **Run workflow** opens the brief,
   model and source selection. Choose the available model, enter your task, and
   select the sources you want pinned to this run. **Start run** uses the connected
   ChatGPT plan and starts real inference; merely editing and validating does not.
6. In **Runs**, inspect outputs and **Saved request** / **Saved response**. At a
   review, write your feedback and approve to continue, or reject to stop. Feedback
   reaches only later steps explicitly connected to that review's feedback port.
7. Choose **Iterate from this run** to restore its workflow, brief, evidence,
   artifact references and account selection into the editor. Change instructions,
   topology, model or sources, then start a separate run. The original stays pinned
   to its own revision. Prior review feedback is not automatically copied into a
   new experiment; incorporate it in your prompt/brief if you want it reused.

Templates and loading a version are undoable workflow edits. Switching agents starts
that agent's own undo history. Named-agent drafts, brief, evidence selection and
account choice recover from this browser after switching or refreshing; **Save
revision** keeps a durable server version. Browser storage can be cleared or denied,
so use saved versions or **Export JSON** for work you need to keep. **Save draft** is
also available for unassigned workflows. Run inputs are separate from workflow undo.

Renaming the workflow and saving renames its agent. Two agents can share identical
workflow content while their runs remain separate. Older runs retain their original
agent name and exact workflow. **Iterate from this run** selects its agent, restores
its workflow and inputs, and leaves the original run unchanged. Undo can recover the
replaced draft. Unassigned mode shows workspace-wide history for legacy records.

If another tab saves first, a conflicting save keeps your draft and explains the
conflict. **Load latest** loads the current server version; Undo restores your draft
so you can combine your changes and save again. A local draft is never silently
accepted as the latest server version.

## Available controls and boundaries

| Capability              | Available now                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoring               | Blank workflows; custom model instructions; named steps; source and feedback bindings                                                                                           |
| Control flow            | Conditions, parallel branches/joins, bounded loops, nested subgraphs, human reviews                                                                                             |
| Model                   | One model per workflow, chosen from the connected ChatGPT account; no paid API fallback                                                                                         |
| Tools                   | Read pinned captured evidence; notes and graph controls; [bounded JavaScript steps](custom-code.md); [opt-in live web research](idea-research-example.md) on custom model steps |
| Results                 | Custom answers in the structured result's conclusion (up to 6,000 characters); optional hypotheses; saved requests, responses, usage and version manifests                      |
| Iteration               | Immutable revisions, original-run inspection, copied experiment inputs, manual feedback and separate new runs                                                                   |
| Optional editorial work | Reports, style guides, annotations, blind comparisons and judge calibration records                                                                                             |

The custom model step still uses a structured result envelope for inspectable, durable
outputs. It does not force hypotheses, alternatives or a research strategy. Output
format customization, per-step models and new tool integrations require further
implementation; they are not controls hidden elsewhere in the editor. No automatic
publication, trading or model training is performed.

## Environment acceptance audit (2026-11-16)

Existing foundations cover durable execution, typed graph editing, evidence
provenance, review feedback, cancellation, budgets, request allowances, report
editing and evaluation records. The audit found missing blank-start controls,
owner-defined model behavior and restoration of experiment inputs. This pass adds
those controls, a no-model demo, in-app guidance and unsaved-edit warnings.

Automated acceptance builds a two-step custom agent around a human checkpoint on
desktop and mobile, runs it against a synthetic provider, verifies feedback in the
saved request, reloads the run, changes its prompt, and starts another run with the
same brief/sources while verifying the original revision is unchanged. Backend
checks cover recovery, structured-result rules and unchanged legacy prompt hashes.
These checks establish environment behavior, not research quality.

The next acceptance step belongs to the owner: build a simple agent and report
where the UI or available capabilities get in the way. Helpful feedback includes
the intended action, expected behavior, observed behavior, and workflow/run/revision
identifiers. No pilot label, finished agent or calibrated judge is required for this
handoff. External hosting and operational deployment remain separate work.

## Custom logic

**Add custom code** runs your own JavaScript transformations with text/number inputs
and outputs. It is separate from model prompts and uses no model allowance. Read
[the code-step guide](custom-code.md) for examples, limits and saved-result inspection.

## Where the model is used

The canvas header shows the configured model, and each model step's inspector
names the same selection. Choose the model in Run workflow. All model prompt and
hypothesis research steps, including subgraphs, share that model. Notes, reviews
and routing do not call a model. The run setup identifies the ChatGPT included-plan
connection and explains this scope before starting.

Saved runs show their pinned selected model and the model identifiers actually
reported by the provider, with per-attempt details. Missing provider metadata says
Not reported; it is not inferred from the requested model. Editing the selection
does not change older runs. The local workspace allowance is 1,000 requests per
rolling day as explicitly authorized on 2026-11-16; Status shows current usage.

## Browsing your work

Use **Build** to edit and run the active agent. **Sources** holds the shared source
library and linked claims; **Runs** shows experiments for the selected agent;
**Reports** holds editorial drafts. **Evaluate**, **Versions** and **Status** keep
comparisons, saved workflow history and workspace health separate. Older bookmarks
continue to work. Owner access is in **Settings**; manage the ChatGPT connection in run setup.

Sources can be filtered by availability and searched by title, author or publisher.
Search applies to the loaded records; load more to include older sources. The linked
claims checkbox shows only loaded claims connected to the selected source. Filtering
the list keeps the open source visible, and corrections preserve earlier versions.

Runs shows the latest 20 for the active agent, with search, status filters and review
counts. Unassigned mode shows workspace-wide history. An open run remains inspectable
even when filters hide its row. Reports searches the latest 100 titles and change
notes, sorts by title or update time, and distinguishes research drafts from human
edits. These badges describe authorship, not quality approval.

Drag the divider in Sources or Runs to resize its list on desktop; focused dividers
also accept arrow keys. Widths are remembered for this browser and owner. Small
screens stack the list above the details. Resizing does not discard an open source
form. The builder's step and detail panels can also be resized or collapsed.
