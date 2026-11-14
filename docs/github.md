# GitHub configuration

- [Repository](https://github.com/andersj05/ResearchChain): public, with its original history preserved.
- [Project](https://github.com/users/andersj05/projects/1): private; the delivery board imports new open repository issues automatically.
- [Foundation PR](https://github.com/andersj05/ResearchChain/pull/1): the initial implementation and validation record.
- [Milestones](https://github.com/andersj05/ResearchChain/milestones): M0 foundation, M1 durable workflows, M2 evidence/research, M3 editorial evaluation.

## Branch and merge rules

`feat/<feature-name>` starts from `dev` and opens a PR into `dev`. Integration
branches require PRs, resolved review conversations, and the GitHub Actions `ci`
check. Force pushes and deletion are blocked, with no configured bypass actors.
The CI branch gate rejects feature PRs directly into `main`.

Feature PRs can use merge or squash. A `dev` → `main` promotion must use a merge
commit. Automatic deletion is off so a promotion cannot delete `dev`; delete
finished feature branches deliberately if desired. Rebase merges are disabled.

`dev` requires feature branches to be up to date. `main` accepts a passing merge
result from `dev` without requiring `dev` to contain the previous promotion's
merge commit. This avoids a recurring synchronization PR while retaining ancestry.
All changes to `main` still pass through `dev` and the PR branch gate.

Independent review is recommended but not required while there is one maintainer;
GitHub does not allow an author to approve their own PR. CODEOWNERS records the
owner. Increase required approvals when a second maintainer is available.

## Reproducible settings

`.github/repository-settings.json` and `scripts/configure-github.mjs` define the
repository settings, labels, milestones, and rulesets. Inspect the proposed changes:

```text
node scripts/configure-github.mjs
```

An authorized administrator can apply them with `--apply`. The script reconciles
only its named rulesets and labels; it does not change visibility, reset branches,
delete unrelated settings, or store tokens. Secret scanning, push protection,
and vulnerability alerts are enabled. Dependabot opens reviewed update PRs into
`dev`; security updates against the default branch may require manual routing.

Project access is separate from repository access. The current CLI token has
repository access but lacks Projects scope. The board was configured in the
owner's signed-in browser; no credential or scope change was needed. The GitHub
connector currently permits reads but returns 403 for issue/PR creation; use the
authenticated CLI for those writes. Follow the Windows authentication notes in
`AGENTS.md` before diagnosing an access failure.

## Next work

Start with [durable revisions and checkpoints (#2)](https://github.com/andersj05/ResearchChain/issues/2).
Then coordinate [advanced graph semantics (#3)](https://github.com/andersj05/ResearchChain/issues/3)
with [editor capabilities (#4)](https://github.com/andersj05/ResearchChain/issues/4).
Issues #5–#9 cover provenance, the research loop, evaluations, report editing, and
hosting. Each has a milestone, area/priority labels, and acceptance criteria.
