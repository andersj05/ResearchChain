# Development

## Prerequisites and setup

Use Node.js 24 (the verified patch is in `.node-version`), pnpm 11.24.0, and
[uv](https://docs.astral.sh/uv/getting-started/installation/) 0.12.5 or later.
uv selects Python 3.12 from `.python-version` and can install it if missing.

```text
npm install --global pnpm@11.24.0
pnpm bootstrap
pnpm db:up
pnpm db:migrate
pnpm dev
```

Open `http://127.0.0.1:3000`. The API is on port 8000, with interactive documentation
at `http://127.0.0.1:3000/api/docs` after sign-in. Both services bind to loopback.
In another terminal, run `pnpm access:login` for first enrollment or recovery, then
set an owner password in **Settings**. See [owner access](owner-access.md).
`Ctrl+C` stops the web app, API and worker.
Commands work in PowerShell and on Linux/macOS. Docker Desktop (or Docker Engine
with Compose) must be running for the local Postgres database. No model API key
or hosted service is needed. Postgres listens only on `127.0.0.1:5433` and uses a
named volume that survives container recreation. `pnpm db:down` preserves it.

The API defaults to the local database described in `.env.example`. To use another
Postgres instance, copy that file to `.env` and change `DATABASE_URL`. Variables
already in the environment take precedence. `DATABASE_SCHEMA` defaults to
`public`. Tests use `TEST_DATABASE_URL` and create their own temporary schema;
they never clear the application's schema. Do not use a production database for
development or tests. The Compose credentials are only local development defaults.

Run `pnpm db:migrate` after pulling database changes. Application migrations are
ordered SQL files with checksums; applied files must never be edited. The same
command applies LangGraph's checkpoint migrations under a database lock. Back up
the database before upgrades; volumes and checkpoints are not backups. Use the
[backup, verified restore and migration recovery procedure](backups.md).

## Desktop delivery

Workspace-enabled research nodes use the installed Codex CLI and a local Python
runner image. Build the image from this checkout when installing or updating
the runner. The build downloads the pinned Python environment. Running a
research script uses the local image with networking disabled.

```text
docker build -t researchchain/analyst-python:1 docker/analyst-python
```

The owner's Windows app runs from `C:/Users/jense/Desktop/ResearchChain` and
tracks `origin/dev`. Complete these steps on the owner's machine after merging
an implementation, even when development and tests ran in a different checkout.

1. In the Desktop clone, run `git status --short --branch` and `git fetch origin dev`.
   Record the installed and target commits. Compare them for dependency,
   migration and runtime changes. Preserve local edits, commits, the ignored
   environment and owner data. If changes conflict with the update, report the
   conflict with both revisions.
2. Before restarting services, use `pnpm operations` to check the worker and
   active requests. Let active work reach a safe pause. For a schema change,
   follow [Upgrade and rollback](backups.md#upgrade-and-rollback) using the old
   code for backup and restore verification, then rehearse the new migration.
3. In the Desktop clone, switch to `dev` and run `git merge --ff-only origin/dev`.
   Rebuild the Python image when files under `docker/analyst-python` change.
   Sync changed dependencies with `pnpm install --frozen-lockfile` or
   `uv sync --project apps/api --locked` as applicable. Apply rehearsed schema
   changes with `pnpm db:migrate`. Restart the affected services from this clone.
   The standard `pnpm dev` launcher runs the web app, API and worker together.
4. Verify the Desktop `HEAD` matches the fetched `origin/dev`. Open the workbench
   at `http://127.0.0.1:3000`, check `/api/health` through the web app, and
   confirm a connected worker with `pnpm operations`. Check an observable part
   of the delivered change without starting a research run. Include the deployed
   commit and verification result in the handoff.

## Optional ChatGPT plan connection

Use **Run workflow → ChatGPT plan usage → Connect ChatGPT** in a research
workflow, or `pnpm provider:login`, to connect an eligible ChatGPT plan, then
`pnpm provider:models` and `pnpm provider:verify --model <slug>` to verify a small
response. See [the connection guide](chatgpt-plan.md) for account management,
protected credential storage, usage controls, and current limits. This setup supports the [live research template](hypothesis-research.md). The deterministic
example remains available without a provider connection.

## Iteration

```text
git switch dev
git pull --ff-only
git switch -c feat/your-feature
pnpm dev
```

| Command                                              | Purpose                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm dev:web` / `pnpm dev:api`                      | Run a single service                                            |
| `pnpm db:up` / `pnpm db:down`                        | Start/stop local Postgres; preserve its named volume            |
| `pnpm db:backup` / `pnpm db:restore`                 | Create a private snapshot / verify a new recovery database      |
| `pnpm db:keygen` / `pnpm db:seal` / `pnpm db:unseal` | Prepare portable encrypted recovery copies                      |
| `pnpm access:login` / `pnpm access:revoke`           | Open a private owner link / revoke browser sessions             |
| `pnpm monitor check` / `pnpm monitor --help`         | Read current operational conditions / configure explicit alerts |
| `pnpm usage status` / `pnpm usage --help`            | Read/change the shared request allowance and pause control      |
| `pnpm db:migrate`                                    | Apply application and LangGraph database migrations             |
| `pnpm test`                                          | Backend validation and real checkpoint/resume tests             |
| `pnpm typecheck`                                     | TypeScript and strict Python type checks                        |
| `pnpm lint`                                          | ESLint and Ruff checks                                          |
| `pnpm format`                                        | Format supported source and docs                                |
| `pnpm contracts:generate`                            | Regenerate OpenAPI and TypeScript API types                     |
| `pnpm contracts:check`                               | Regenerate and detect tracked contract drift                    |
| `pnpm check`                                         | Formatting, lint, types, backend tests, production build        |
| `pnpm test:e2e`                                      | Browser tests in a temporary Postgres schema                    |

Install the test browser once with
`pnpm --filter @researchchain/web exec playwright install chromium`.
On Linux CI the install command also uses `--with-deps`.

Backend tests fail if Postgres is unavailable; they do not silently skip durability
checks. Backup tests require matching PostgreSQL clients or the local container
and create/drop only their own randomly named `test_restore_*` databases. CI
selects its Postgres service container explicitly. Browser tests own their API/web processes and fail if ports 8000/3000 are
already occupied. Stop `pnpm dev` first. Run browser tests from the repository root
so `scripts/browser-tests.py` can migrate and clean up an isolated `e2e_*` schema
and temporary synthetic owner credentials. API fixtures authenticate normally;
there is no test bypass. The access project runs after feature tests because
password/revocation cases intentionally invalidate its synthetic sessions.
Focus it with `pnpm test:e2e --project=access --no-deps --workers=1`.
The worker project follows access tests and uses temporary database slot locks to
exercise queued UI behavior without affecting other tests. Focus it with
`pnpm test:e2e --project=workers --no-deps --workers=1`. The runner starts a separate
synthetic-provider worker and stops it before dropping the test schema.
Focus a browser test with `pnpm test:e2e --grep "narrow screen"`. Screenshots and
failure traces stay under ignored `apps/web/test-results/`; CI uploads them for
seven days. Backend tests also create and remove isolated `test_*` schemas.

The Python models in `apps/api/src/researchchain/models.py` own the API boundary.
Regenerate contracts after changing them, review the generated diff, and commit
it. The backend validates semantics; generated TypeScript alone does not validate
untrusted JSON. The compiler only executes registered node kinds.

## Owner authoring handoff

See [Build and iterate on your agent](agent-builder.md) for the first experiment,
the environment audit, available controls and current boundaries. First-pass
acceptance concerns owner control, not pilot quality or production hosting.

## Workbench behavior

The full-height desktop workbench uses a step library and outline on the left,
a canvas in the center, and a selected-step inspector on the right. Collapse
either panel from the canvas header. The outline selects and reveals offscreen
nodes. **Find a step** searches names, instructions, and assigned models in the
draft and its referenced subgraphs. Select a match to focus its step editor.
Enter opens the first match and Escape clears the search.
Zoom controls and Fit view change only the viewport; Reset view restores
100% zoom. Workflow settings expand beneath the outline. On smaller screens,
the library and inspector move below the canvas.

**Run workflow** opens a focused setup dialog. Edit the research brief, then
choose **Start run**. Escape or Cancel preserves the brief and returns focus;
validation failures remain visible in the dialog. Visual conventions and the
Vercel reference audit are recorded in [design.md](design.md).

Add a step after the selection, or before a selected Finish; its connections are
created automatically and its name is focused for editing. Removing a middle step
reconnects its neighbors, and removing the first advances the workflow entry.
These operations are undoable and still require server validation before saving.

Edit a step in the inspector; use its Next step field to connect or disconnect it.
Drag nodes or focus one and use Alt+arrows. Pan the background or scroll; use
Ctrl/Command+scroll to zoom. Save a draft in this browser or export JSON. Loading
a saved draft validates it through the local API before rendering it. Undo keeps
the last 80 edits for this page session.

Save a revision to Postgres; identical validated documents share a revision. Run
automatically saves and pins the current revision plus the brief. Revisions are
immutable, and loading an older revision is undoable. Revision numbers are database
sequence values, so concurrent saves can leave gaps.

The Runs view lists recent runs and their original briefs, revisions, completed
steps, and review questions. Run links survive browser refresh and API restart.

In **Run workflow → Step models**, assign a model to any research step in the
draft, including a step in a referenced subgraph. **Use workflow default for all
steps** clears the displayed overrides in one undoable edit. Starting the run
saves the draft if needed and pins the saved model assignments to that run.
**Run limits** shows the active-time and model-attempt budgets before start.
Expand it to edit execution, response, and evidence limits in the same draft.

**Model activity** can sort attempts by elapsed time or total reported tokens.
Rows with missing measurements follow measured rows, and the sort preference is
stored in the owner's browser.

Use **Copy attempt link** in **Attempt details** to reopen the specific saved
pass, including an earlier pass of the same step.

Unsent feedback stays in the current browser tab when you switch runs or refresh.
Drafts clear when the app observes a resolved checkpoint or a terminal run.

Approve/reject is tied to a specific checkpoint and interrupt. Repeating a decision
returns its saved receipt; a conflicting decision returns HTTP 409. The browser
then reads current state so an old response cannot restore obsolete controls.

Run actions return HTTP 202 receipts and a separate worker executes accepted
commands. The UI follows queued/running progress across refresh. Worker takeover
continues confirmed work after a hard process failure; uncertain model requests
are never resent. Handled errors and restored jobs require **Recover run** after
review. Reading a run never executes it. Paused human reviews remain paused.
See [worker operation and limits](workers.md).

The UI shows the latest 20 runs and 50 revisions. The API accepts bounded `limit`
parameters and direct UUID lookups; there is no automatic data deletion. A run
also pins a compiler version. Incompatible executors refuse recovery instead of
silently interpreting old checkpoints through changed code.

In **Runs → Run context → Compare a saved run**, select another run for the same
agent to inspect its pinned revision, models, usage, sources, brief, feedback and
latest recorded model output alongside the open run. The comparison reads a saved
snapshot when you select it. Open its own run view to follow active work.
**Setup changes** shows before and after values for changed prompts, tools, inputs,
routing, limits and judgments. It follows the referenced subgraph versions and
compares pinned source identities and order.

**Output file changes** pairs the latest saved file at each step and filename.
Open each side to preview or download the saved versions. File contents are
matched by their stored artifact hashes.
CSV previews use the first row as column headers and keep the cell text as saved.
Use **Show raw CSV** for the full text when the table preview shows only the first
50 data rows or 20 columns.

Open **Search saved runs** in Runs for the full archive, or **Search comparison
runs** in the comparison picker for the current agent's archive. Search by brief,
agent, workflow, or run ID and filter by saved status. The recent run list still
provides a quick view of the latest 20 runs.

Selecting a comparison run puts both run IDs in the address bar. Use **Copy
comparison link** to bookmark the pair, including a baseline from the archive.

Open **Review inbox** in Runs to see unanswered checkpoint questions across agents,
including runs outside Recent runs. It lists the oldest runs first, 20 per page, and
refreshes while open. Opening a question checks the current checkpoint and takes
you to its evidence and decision controls. An expired entry refreshes the inbox.

In **Runs → Decisions**, expand **Steps wired to this feedback** on a recorded
judgment to inspect steps with a direct input binding. A model step links to the
latest saved request for that exact step and iteration when one exists.

To manually verify restart: run the sample until it pauses, restart `pnpm dev:api`,
refresh the run's URL, and approve. Editing/saving a newer workflow before the
restart must not change that run. `apps/api/tests/test_restart.py` automates this
with hard process kills; test_worker_process.py also keeps independent worker
ownership across API restarts.

## Tooling notes

- Lockfiles are committed; CI uses `--frozen-lockfile` and `--locked`.
- ESLint 10 is compatible with the installed Next.js lint configuration. TypeScript
  stays pinned to 5.9.3 because typescript-eslint 8.72.2 explicitly rejects TypeScript 7. Dependabot ignores the 7.x line until the compatible lint toolchain is upgraded;
  do not suppress compatibility checks to merge an update.
- UI SDK is beta and its installed docs are the reference for its exact API.
- Next.js regenerates `next-env.d.ts`; it is ignored. `pnpm typecheck` runs
  `next typegen` first so a fresh checkout has its required generated types.
- Ignore local data in `data/`, `artifacts/`, and `.local/`; no secrets in Git.
- Windows Codex sandboxing can restrict pnpm symlinks and uv caches. A narrow
  outside-sandbox command may be needed. It is not evidence of a broken install.
- GitHub authentication follows the repository `AGENTS.md` instructions.

## Production prerequisites

Owner access, bounded local workers, explicit retention, request allowances,
verified backups and monitoring tools are implemented. Before remote hosting,
exercise operational secret management, an off-machine copy/restore and external
alert/watchdog setup, then prepare hosting configuration from workload measurements.
See [operations](operations.md) for the current controls. Preserve explicit provider
consent and the documented in-flight spend limitations. The local service is not
a production deployment.

Use a direct Postgres connection for this runtime: session advisory locks and the
checkpointer deliberately share a physical connection. Transaction-mode poolers
are incompatible with that locking contract. Worker ownership and recovery follow
[ADR 0011](decisions/0011-durable-workers.md). New external tools require their own
effect journal before automatic recovery can safely include them.

Retention and request-allowance browser tests follow the core workflow suites,
in that order, so synthetic cleanup cannot remove active fixtures. Focus retention with
`pnpm test:e2e --project=retention --no-deps --workers=1`. All deletion uses the
runner's disposable e2e_ workspace; never select the private database for tests.
