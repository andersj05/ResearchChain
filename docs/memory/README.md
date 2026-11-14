# Agent memory

This is explicit, version-controlled project memory. `AGENTS.md` directs an agent
to the two small entry files; it does not magically load every linked document.

| Record | Contents | Update when |
| --- | --- | --- |
| `project-context.md` | Stable user goals, constraints, source references | The user changes a requirement |
| `current-state.md` | Verified capabilities, limitations, checks, next task | A meaningful milestone finishes |
| `../decisions/` | Context, decision, alternatives, consequences | A consequential choice is accepted |
| GitHub issues / Project | Work status and acceptance criteria | Work starts, changes scope, or finishes |

Avoid duplicate task boards, session diaries, and unbounded append-only notes.
Replace stale current-state facts, link to PRs and issues, and identify unverified
assumptions. Never save credentials, raw private reports, customer information,
or reasoning transcripts here. Local scratch work belongs in ignored `.local/`.

At handoff, record what works, checks actually run, known limitations, and the
next concrete step. For conflicting records, inspect the implementation and
GitHub; update the obsolete note. Architectural reversals get a superseding ADR.

Research-agent memory is a separate future subsystem: evidence, hypotheses,
run state, and editorial feedback belong in application storage with provenance.
They must not silently become coding-agent instructions or training data.
