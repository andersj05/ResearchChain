# Contributing

Start with [development setup](docs/development.md) and a focused issue. Create
`feat/<feature-name>` from current `dev`; use that prefix for fixes and maintenance
too. Open PRs into `dev`. Keep one outcome per PR and explain its validation.

Use descriptive commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:` are useful).
Prefer coherent commits over noisy checkpoints. Feature PRs may be squashed;
promote `dev` to `main` with a merge commit so future promotions retain ancestry.
Continue features from `dev` after a promotion. No force-push or squash is needed
to align the branches; merge commits preserve their shared history.

Required CI runs formatting, lint, type checks, backend tests, generated-contract
drift, a production build, and browser tests. The stable required check is `ci`.
No path filters skip it. A single maintainer can merge their passing PR without
an impossible self-approval; enable independent review requirements when another
maintainer joins. CODEOWNERS records ownership without requiring self-review.

Dependabot is the sole naming exception: its `dependabot/*` PRs target `dev` and
are still subject to CI. Review dependency upgrades; do not enable blanket auto-merge.

Do not change public visibility, add a license, or publish a hosted app as part of
routine development. Keep private source materials outside this public repository.
