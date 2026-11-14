# Development

## Prerequisites and setup

Use Node.js 24 (the verified patch is in `.node-version`), pnpm 11.24.0, and
[uv](https://docs.astral.sh/uv/getting-started/installation/) 0.12.5 or later.
uv selects Python 3.12 from `.python-version` and can install it if missing.

```text
npm install --global pnpm@11.24.0
pnpm setup
pnpm dev
```

Open `http://127.0.0.1:3000`. The API is on port 8000, with interactive documentation
at `http://127.0.0.1:8000/docs`. Both services bind to loopback. `Ctrl+C` stops both.
Commands work in PowerShell and on Linux/macOS. No API key, Docker, database,
`.env` file, or hosted service is needed for this development slice.

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
| `pnpm test`                     | Backend validation and real checkpoint/resume tests      |
| `pnpm typecheck`                | TypeScript and strict Python type checks                 |
| `pnpm lint`                     | ESLint and Ruff checks                                   |
| `pnpm format`                   | Format supported source and docs                         |
| `pnpm contracts:generate`       | Regenerate OpenAPI and TypeScript API types              |
| `pnpm contracts:check`          | Regenerate and detect tracked contract drift             |
| `pnpm check`                    | Formatting, lint, types, backend tests, production build |
| `pnpm test:e2e`                 | Browser tests; starts local services if absent           |

Install the test browser once with
`pnpm --filter @researchchain/web exec playwright install chromium`.
On Linux CI the install command also uses `--with-deps`.

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

Run the default workflow and approve or reject at the real LangGraph review pause.
Editor changes do not mutate the running workflow. Runs are intentionally limited
to 100 in process memory; restart clears them. Browser drafts survive a restart,
but are not durable team storage. This is not yet a complete research/report system.

## Tooling notes

- Lockfiles are committed; CI uses `--frozen-lockfile` and `--locked`.
- ESLint 9 is pinned because the current Next.js plugin dependencies declare
  ESLint 9 support. Upgrade the compatible set together; do not hide peer warnings.
- UI SDK is beta and its installed docs are the reference for its exact API.
- Ignore local data in `data/`, `artifacts/`, and `.local/`; no secrets in Git.
- Windows Codex sandboxing can restrict pnpm symlinks and uv caches. A narrow
  outside-sandbox command may be needed. It is not evidence of a broken install.
- GitHub authentication follows the repository `AGENTS.md` instructions.

## Production prerequisites

Before remote hosting, implement authentication/authorization, durable workflow
revisions and checkpoints, job isolation, request limits, and artifact permissions.
Then configure provider credentials, spend budgets, tool access, and tracing with
explicit data-retention choices. The local service is not a production deployment.
