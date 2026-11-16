# Visual workflow authoring

The editor supports the [structured workflow contract](structured-workflows.md)
through the UI SDK adapter. Workflow JSON contains graph semantics and positions;
selection, breadcrumbs, expanded previews, viewport, and history stay in the UI.

Start from **New workflow** and follow [Build your agent](agent-builder.md). **Add
model prompt** uses your custom instructions; **Use research template** is optional.
**Iterate from this run** in Runs restores that experiment's workflow and run inputs.

## Editing

- Add notes, reviews, conditions, parallel branches, bounded loops, or subgraphs
  from Steps. Conditions and parallel templates include separate branches and a
  paired join. Inserting after a split inserts after its join. Advanced operations
  upgrade a legacy chain to schema 0.2 without changing saved revisions.
- Drag a port to a compatible port. Dragging an existing output to another input
  reconnects it. Control, text, and numeric ports remain distinct. Focus a port,
  press Enter, use arrows to choose a compatible destination, and press Enter to
  connect; Escape cancels. Inspector controls offer the same explicit connections.
- Edit predicates, branch names, joins, data inputs, pinned subgraph versions,
  loop bounds/stop rules, and whole-run execution limits in Details and Settings.
  An incomplete draft is editable; Validate and Save show server diagnostics.
  Every saved revision and run must satisfy the complete graph contract.
- Open a subgraph or its expanded preview to edit its definition. Breadcrumbs
  return to parents. References to the same version share the draft definition;
  New version makes a separate copy. Remove unused definitions removes versions
  unreachable from the root, including their unused descendants. Existing saved
  revisions and runs keep their original bundles.
- Undo/redo stores up to 80 edits. Typing within one field groups edits separated
  by less than 800 ms; blur ends the group. One completed drag is one edit;
  consecutive keyboard nudges group too. Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z
  redoes. Navigation and viewport changes do not create edits.
- Import JSON validates files up to 10 MB before replacing the draft. Failed
  imports keep it intact. Import, loading a revision, and loading a browser draft
  are undoable. Export includes the complete document and nested definitions.

Removing a valid split removes its branches and join together. For a miswired
region that reaches unrelated steps or Finish, only the selected split is removed;
the remaining incomplete graph needs reconnection or Undo. The inspector protects
Finish and owned joins from accidental removal.

## Interaction measurements

Measured on 2026-11-14 in local Windows Chromium 159 at 1440 × 1040, using an
optimized Next.js production build and one Playwright worker. The fixture has
128 nodes (notes, reviews, one Finish), 127 control edges, and 101 data bindings.
The test verifies fit-to-view, movement, undo, and redo as well as recording times.

| Action         |  Median |     p95 |
| -------------- | ------: | ------: |
| Keyboard nudge | 35.1 ms | 46.5 ms |
| Pan            | 16.7 ms | 18.2 ms |
| Zoom           | 20.9 ms | 27.2 ms |

Each action has 30 samples after five warm-up iterations. Measurements run
synthetic DOM events through the real SDK handlers and stop at the next animation
frame callback. They include frame scheduling and are not end-to-end physical
input-to-display latency. Results describe this machine/build, not a universal
performance guarantee. [Raw samples](measurements/workflow-editor-2026-11-14.json)
include the browser and viewport metadata.

An initial development measurement exposed broad React rendering on movement
(nudge median 112 ms, p95 288 ms). Moving positions to SDK live state and keeping
unchanged cards and edges mounted reduced the development observation to 82 ms
median; the production result above is reported separately. Port drafts, dragging,
panning, zooming, and line previews use live attributes. The remaining full-document
commit cost does not require a renderer replacement for this milestone; retain the
custom adapter and remeasure if graph limits or editor features grow.

Reproduce after `pnpm build` by setting `CI=1` for the command and running
`pnpm test:e2e workflow-performance.spec.ts --workers=1`. CI also runs the test as
part of its full browser suite and uploads metrics/screenshots with the results.
Timing values are observations, not machine-dependent pass/fail thresholds.
