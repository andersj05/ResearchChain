# GitHub configuration

- [Repository](https://github.com/andersj05/ResearchChain): public, with its original history preserved.
- [Issues](https://github.com/andersj05/ResearchChain/issues) and [PRs](https://github.com/andersj05/ResearchChain/pulls): the work queue and delivery record, managed through `gh`.
- [Foundation PR](https://github.com/andersj05/ResearchChain/pull/1): the initial implementation and validation record.
- [Milestones](https://github.com/andersj05/ResearchChain/milestones): M0 foundation, M1 durable workflows, M2 evidence/research, M3 editorial evaluation.

## Agent CLI workflow

GitHub Projects is retired from the workflow. No board updates, browser navigation,
or Projects permissions are required. Use `gh` for reads and writes, and `gh api`
when a dedicated subcommand is insufficient. Run commands from this checkout;
elsewhere pass `--repo andersj05/ResearchChain`.

1. Inspect local changes and the requested issue/PR. If no task is specified,
   query a small open-issue list; read the selected issue's acceptance criteria
   and dependencies. Reuse an existing issue/PR rather than creating duplicates.
2. Implement on the appropriate feature branch and run the checks in `AGENTS.md`.
   Keep existing labels and milestones useful, but do not invent status fields
   or a separate tracking system. A small fix does not need a new issue.
3. Open or update one PR into `dev` with the issue link, outcome, validation,
   and remaining limitations. Use `--body-file` for multiline text; keep temporary
   bodies under ignored `.local/`. Post only material updates.
4. Check CI after a push or before integration; inspect failed-job logs when needed.
   Use `gh pr checks <number> --watch --interval 30` only when waiting for CI is
   part of the task. Do not repeatedly fetch unchanged PRs or whole backlogs.
5. After an authorized merge into `dev`, close a fully satisfied issue through
   `gh issue close <number>`. Do not assume closing keywords in a PR targeting
   `dev` will close it: automatic closure depends on the default branch.
   Keep incomplete issues open and record remaining criteria. Promote to `main`
   separately under the branch rules below.

Use only the commands needed for the current task, substituting known numbers:

```text
git status --short
gh issue list --state open --label priority:next --limit 10 --json number,title
gh issue view <number> --json number,title,body,state
gh pr view <number> --json number,state,baseRefName,headRefName,body
gh pr create --base dev --title "Concise outcome" --body-file .local/pr-body.md
gh pr checks <number> --required
```

Fetch comments, reviews, or additional fields only when relevant. Follow the
Windows authentication instructions in `AGENTS.md`: verify failed GitHub operations
outside the sandbox before diagnosing credentials. Do not change authentication
or switch to a browser merely because sandbox networking fails.

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

The settings file disables the repository Projects feature on its next apply.
This does not delete or modify any existing account-level Project; it is no longer
part of agent work. Do not run the full settings reconciliation for routine tasks.

## Next work

Use [the current handoff](memory/current-state.md) for the next concrete task,
then verify the linked issue/PR through `gh`. Issues carry acceptance criteria,
dependencies, and existing area/priority labels and milestones.
