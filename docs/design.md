# Workbench design

Audited 2026-11-14. The owner requested a flat, modern Vercel-inspired interface,
with intuitive composition and selective color. This is a representative audit
of public Vercel properties, not a claim to inspect every page or private dashboard.

## Reference notes

| Reference                                                        | Observed structure                                                                                           | ResearchChain application                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [Vercel](https://vercel.com/)                                    | Compact shared navigation, aligned content, strong primary action, generous space around the main subject.   | Keep a stable shell and give the workflow the dominant area.                                             |
| [Geist colors](https://vercel.com/geist/colors)                  | Separate background, interaction, border, and text roles; neutral defaults with small semantic accents.      | Central CSS tokens; blue notes, amber reviews, green completion; text accompanies every status.          |
| [Geist typography](https://vercel.com/geist/typography)          | Label and copy styles are distinct; 14px is the common interface size, with smaller secondary labels.        | Readable controls and metadata; restrained headings; monospace only for identifiers.                     |
| [Geist buttons](https://vercel.com/geist/button)                 | Consistent sizes, primary/secondary hierarchy, labeled icon actions, explicit disabled and pending behavior. | Shared button classes over UI SDK; consistent Lucide icons.                                              |
| [Geist tables](https://vercel.com/geist/table)                   | Aligned semantic rows, quiet dividers, minimal cell decoration.                                              | Flat revision history and run lists, with readable timestamps.                                           |
| [Next.js](https://nextjs.org/)                                   | Compact breadcrumb-like brand navigation, neutral controls, a focused blue accent.                           | Workspace/workflow breadcrumbs; a single selection accent.                                               |
| [Turborepo](https://turborepo.dev/)                              | Neutral structure supports a concentrated colorful illustration and numerical emphasis.                      | Concentrate color in node identities and meaningful states, not panel backgrounds.                       |
| [v0](https://v0.app/)                                            | The main input and its related controls form one focal point.                                                | Research brief and execution action belong in the same focused run dialog.                               |
| [AI SDK](https://ai-sdk.dev/)                                    | Local tabs group related examples; adjoining panels share clear alignment.                                   | Local editor tools, contextual inspector, and consistent panel boundaries.                               |
| [Web interface guidelines](https://vercel.com/design/guidelines) | Keyboard operation, unobscured focus, understandable status, and resilient layouts.                          | Test modal focus/escape, keyboard canvas editing, narrow layouts, long content, and existing run safety. |

The websites were visually inspected in Chrome; the component and interface
guidelines were also read as text. Marketing hero scale and decorative effects
are not appropriate for the daily research workspace. The design below is our
adaptation of these patterns; it does not reproduce Vercel branding or assets.

## Composition and conventions

- Full-height desktop shell: workspace breadcrumb, local navigation/action bar,
  working surface, and a compact status line. Avoid repeated page introductions.
- Workflow editor: step library/outline, expansive canvas, selected-step inspector.
  Workflow settings are a disclosure. The outline provides a keyboard-accessible
  way to reach offscreen nodes. Panels collapse when more canvas room is needed.
  Default and reset zoom are 100% so node labels stay readable; Fit view is an
  explicit overview action and never changes stored node positions.
  Labeled Steps/Details controls disclose panels. Adding a step inserts it after
  the selection (before Finish) and focuses its name. Removing a middle step
  reconnects its neighbors; removing the first step advances the entry. Undo
  restores the previous draft. These conveniences target the single-chain model;
  server validation remains authoritative.
- Run setup: brief, revision context, and execution action together in a dialog.
  Failed validation keeps the brief available; success opens the saved run.
- Runs: compact history beside the selected run, readable research context,
  a distinctly marked review decision, and disclosed technical details.
- Revisions: a flat table of immutable saved versions. Loading is undoable;
  editor changes never mutate a pinned run.
- Tokens: white and near-white surfaces, neutral borders, 4/8/12/16/24/32px
  spacing, square corners throughout, 13–14px interface text, 12px metadata.
  No decorative logo/avatar blocks, icon tiles, canvas pattern, shadows, or fake
  draggable ports. Color belongs to step labels and states; icons support actions.
  Motion respects reduced-motion preferences. Save state remains visible at every width.
- Responsive: panels flow below the canvas on smaller screens; controls wrap;
  only wide tables and the canvas may require contained scrolling/panning.

## Scope

Keep UI SDK for behavior and accessibility. Keep graph-specific SDK code in
the canvas adapter. The redesign preserves the current deterministic node model,
server validation, revision pinning, recovery, and review idempotency. Advanced
connections and subgraphs remain [issue #4](https://github.com/andersj05/ResearchChain/issues/4).
No provider integration or deployment is part of this work.
