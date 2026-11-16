# ADR 0017: Owner-authored agents with stable identity

Date: 2026-11-16. Status: accepted.

## Context

The first implementation pass equips the owner to design and iterate on their own
agent. A generated research strategy or an evaluated pilot cannot substitute for
that environment. The owner also needs to know which agent they are editing and
keep separate experiment histories when agents share the same workflow content.

## Decision

Deliver blank-start authoring, custom model instructions, feedback wiring, versioned
runs and explicit iteration controls. Leave strategy, sources, prompts, checkpoint
judgments and research acceptance to the owner. Optional templates and studies are
examples; they do not gate the environment handoff.

Give each named agent a stable ID and an optimistic version counter. Preserve the
existing content-addressed workflow revisions as immutable documents; an agent's
ordered version history points to those documents and can intentionally revisit an
older document. Runs pin agent identity and its name when admitted. Never infer
ownership from a title or shared revision hash. Existing records remain unassigned.

Keep browser drafts and run inputs scoped to owner and agent. A competing save
must produce a recoverable conflict; loading the server head remains undoable.
Retry an unconfirmed run with its original admission identity and saved revision.

## Alternatives and consequences

Using titles as IDs would break renames. Treating identical content as one agent
would mix histories. Copying all historical documents for each agent would erase
the existing deduplication and complicate recovery. Separate agent identity and
version pointers preserve those contracts at the cost of three additive tables.

Browser drafts are convenience recovery, not a replacement for durable saved
versions or exports. Agent deletion, collaboration and per-agent access policies
are separate features; the present authorization boundary is one owner workspace.
See [the builder guide](../agent-builder.md) and PR #43 for implementation and checks.
