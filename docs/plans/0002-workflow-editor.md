# Visual workflow authoring (issue #4)

Completed in [PR #21](https://github.com/andersj05/ResearchChain/pull/21), merged
into dev at `1f05f58`. All required checks passed; issue #4 is closed.
The runtime prerequisite was PR #20.
The owner has authorized frequent coherent commits and merging each completed
stage into dev after local checks and CI.

## Implementation sequence

1. Add graph-scoped editing helpers and reversible templates for conditions,
   parallel branches/joins, loops, and subgraphs. Upgrade a chain document to 0.2
   when an advanced operation needs it. Keep ordinary chain insertion/removal
   convenient. Maintain typed control edges and data-input bindings separately.
2. Add typed port wiring/reconnection in the UI SDK canvas adapter. Use the
   installed `createConnect` behavior for pointer and keyboard interactions;
   preserve move, pan, zoom, focus reveal, and fit controls. Reject incompatible
   port types immediately; show server diagnostics for incomplete graph edits.
3. Add condition, fork/join, loop/reference, data-binding, and budget settings.
   Drill into pinned definitions through breadcrumbs. Offer inline group previews
   with expand/collapse while keeping the current graph editable. Edits to a
   shared definition affect its draft references; saved run bundles stay pinned.
4. Use `createUndoStack` for redo, grouped field edits, and complete drag actions.
   Add validated JSON import and retain export. Loading/importing a document is
   undoable. Selection/navigation should not create history entries.
5. Finish accessible labels/focus and small-screen layouts; align the run actions
   and keep pending reviews easy to reach. Verify browser round trips, pointer
   and keyboard reconnection, nested edits, undo/redo, validation, and pinned runs.
   Measure representative 128-node interaction performance and record actual
   results rather than imposing an arbitrary benchmark score.

## Installed SDK references already inspected

- `apps/web/node_modules/@ui-sdk/react/docs/llms.txt`
- `docs/core.md` beside it: Connections (`createConnect`, draft from/to/x/y/keyboard,
  pointerdown, start, keydown, canConnect, label, viewport.toCanvas), Undo
  (`createUndoStack`, record group, groupDelay, seal, undo, redo, reset).
- `docs/rendering.md`: `createParts`, custom parts, live attributes.
- `apps/web/node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`

Keep SDK-specific behavior in the canvas adapter. Preserve square corners,
neutral surfaces, thin borders, restrained status colors, and explicit labels.
Full editor authoring is not complete until the issue's browser/performance and
round-trip criteria are demonstrated. Run `pnpm check`, `pnpm contracts:check`
when the API changes, and `pnpm test:e2e`; inspect screenshots, then merge via PR.
