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
at `http://127.0.0.1:8000/docs`. Both services bind to loopback. `Ctrl+C` stops both.
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
the database before upgrades; volumes and checkpoints are not backups.

## Iteration

```text
git switch dev
git pull --ff-only
git switch -c feat/your-feature
pnpm dev
```

| Command                         | Purpose                                                  |
| ------------------------------- | -------------------------------------------------------- |
| `pnpm dev:web` / `pnpm dev:api` | Run a single service                                     |
| `pnpm db:up` / `pnpm db:down`   | Start/stop local Postgres; preserve its named volume     |
| `pnpm db:migrate`               | Apply application and LangGraph database migrations      |
| `pnpm test`                     | Backend validation and real checkpoint/resume tests      |
| `pnpm typecheck`                | TypeScript and strict Python type checks                 |
| `pnpm lint`                     | ESLint and Ruff checks                                   |
| `pnpm format`                   | Format supported source and docs                         |
| `pnpm contracts:generate`       | Regenerate OpenAPI and TypeScript API types              |
| `pnpm contracts:check`          | Regenerate and detect tracked contract drift             |
| `pnpm check`                    | Formatting, lint, types, backend tests, production build |
| `pnpm test:e2e`                 | Browser tests in a temporary Postgres schema             |

Install the test browser once with
`pnpm --filter @researchchain/web exec playwright install chromium`.
On Linux CI the install command also uses `--with-deps`.

Backend tests fail if Postgres is unavailable; they do not silently skip durability
checks. Browser tests own their API/web processes and fail if ports 8000/3000 are
already occupied. Stop `pnpm dev` first. Run browser tests from the repository root
so `scripts/browser-tests.py` can migrate and clean up an isolated `e2e_*` schema.
Focus a browser test with `pnpm test:e2e --grep "narrow screen"`. Screenshots and
failure traces stay under ignored `apps/web/test-results/`; CI uploads them for
seven days. Backend tests also create and remove isolated `test_*` schemas.

The Python models in `apps/api/src/researchchain/models.py` own the API boundary.
Regenerate contracts after changing them, review the generated diff, and commit
it. The backend validates semantics; generated TypeScript alone does not validate
untrusted JSON. The compiler only executes registered node kinds.

## Workbench behavior

Edit a node in the inspector; use its Next node field to connect or disconnect it.
Drag nodes or focus one and use Alt+arrows. Pan the background or scroll; use
Ctrl/Command+scroll to zoom. Save a draft in this browser or export JSON. Loading
a saved draft validates it through the local API before rendering it. Undo keeps
the last 50 edits for this page session.

Save a revision to Postgres; identical validated documents share a revision. Run
automatically saves and pins the current revision plus the brief. Revisions are
immutable, and loading an older revision is undoable. Revision numbers are database
sequence values, so concurrent saves can leave gaps.

The Runs view lists recent runs and their original briefs, revisions, completed
steps, and review questions. Run links survive browser refresh and API restart.
Approve/reject is tied to a specific checkpoint and interrupt. Repeating a decision
returns its saved receipt; a conflicting decision returns HTTP 409. The browser
then reads current state so an old response cannot restore obsolete controls.

If the process stops during execution, open the run and select **Recover run**.
Recovery continues the recorded command from the last durable progress and stops
at the next unanswered human review. Reading a run never executes it. Paused runs
can be approved normally after restart; they do not require a recovery action.

The UI shows the latest 20 runs and 50 revisions. The API accepts bounded `limit`
parameters and direct UUID lookups; there is no automatic data deletion. A run
also pins a compiler version. Incompatible executors refuse recovery instead of
silently interpreting old checkpoints through changed code.

To manually verify restart: run the sample until it pauses, restart `pnpm dev:api`,
refresh the run's URL, and approve. Editing/saving a newer workflow before the
restart must not change that run. `apps/api/tests/test_restart.py` automates this
with hard process kills. This is not yet a complete research/report system.

## Tooling notes

- Lockfiles are committed; CI uses `--frozen-lockfile` and `--locked`.
- ESLint 9 is pinned because the current Next.js plugin dependencies declare
  ESLint 9 support. Upgrade the compatible set together; do not hide peer warnings.
- UI SDK is beta and its installed docs are the reference for its exact API.
- Next.js regenerates `next-env.d.ts`; it is ignored. `pnpm typecheck` runs
  `next typegen` first so a fresh checkout has its required generated types.
- Ignore local data in `data/`, `artifacts/`, and `.local/`; no secrets in Git.
- Windows Codex sandboxing can restrict pnpm symlinks and uv caches. A narrow
  outside-sandbox command may be needed. It is not evidence of a broken install.
- GitHub authentication follows the repository `AGENTS.md` instructions.

## Production prerequisites

Before remote hosting, implement authentication/authorization, job isolation,
request limits, database backups/retention, and artifact permissions.
Then configure provider credentials, spend budgets, tool access, and tracing with
explicit data-retention choices. The local service is not a production deployment.

Use a direct Postgres connection for this runtime: session advisory locks and the
checkpointer deliberately share a physical connection. Transaction-mode poolers
are incompatible with that locking contract. Long-running jobs, external side
effects, automatic recovery workers, and connection pooling need a separate design;
see [ADR 0002](decisions/0002-durable-runs.md).
