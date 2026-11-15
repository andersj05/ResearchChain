# Owner access

ResearchChain now requires an owner session before opening private research.
This sign-in protects the workbench. It is separate from the existing ChatGPT
plan connection and does not create an API key, change provider consent or start
model work.

## First sign-in and recovery

Start the local services with `pnpm dev`. In another terminal in the checkout:

```text
pnpm access:login --owner-name "Owner"
```

This local operator command opens a five-minute, single-use link in the default
browser. The browser exchanges it for an HttpOnly cookie and removes the link
fragment from the address. Treat the link as a credential; do not share it.
The command never prints it into terminal output.

Open **Set owner password** in the workbench header to choose a unique password
of 15–128 characters. Normal visits use that password. A password change signs
out other sessions and invalidates pending links. After five minutes without
fresh authentication, changing it also requires the current password; first
password setup after that window needs a new local sign-in link.

If the browser cannot open automatically, use a new private directory:

```text
pnpm access:login --write-link .local/owner-signin-new
```

Open the generated `sign-in.html` locally. It contains a short-lived credential;
keep the directory private and remove it when finished. Existing destinations
are rejected. A fresh login command replaces earlier pending links for that origin.

For recovery, run `pnpm access:login` again on the service's computer under its
OS account, then set a new password. There is no unauthenticated remote setup
or password-reset endpoint.

```text
pnpm access:status
pnpm access:revoke
```

Status prints aggregate configuration/session information only. Revoke signs out
all sessions and pending links while keeping the password. It does not cancel
research already admitted to execution or disconnect ChatGPT. The UI provides
**Sign out** for the current session and **Sign out all sessions** for the owner.

## Session and browser behavior

Sessions expire after 30 minutes without authenticated resource activity and
at most 12 hours after sign-in. Status polling does not extend the idle period.
A refresh or service restart preserves a valid session; signing out revokes it
on the server. Login failures share a persistent limit of ten attempts per minute.
The local recovery command can clear that lockout.

The workbench checks access on focus, every 30 seconds and after rejected requests.
Tabs share sign-in changes through a notification containing no credentials.
When access expires, the UI hides and disables the workspace while retaining its
open state. Signing back into the same owner/workspace restores that state.
A different owner/workspace mounts a fresh editor. Failed mutations are never
automatically replayed; pending report-save IDs survive reauthentication.

Saved workflow drafts and automatic report recovery records are scoped to owner
and workspace. Drafts from before owner sign-in require an explicit **Import my
draft saved before sign-in** or **Import my older report draft** action. The first
owner claiming legacy drafts reserves them in that browser profile; the original
records are preserved. Import only drafts you saved.

Browser storage and an open page are trusted local state, not encrypted storage.
Use a private OS/browser profile on a shared computer. Sign-out hides the editor
and revokes access; it does not erase downloaded files or browser drafts.
Workflow drafts still require **Save draft** to survive closing the page.
Report edits and pending save receipts retain their existing automatic recovery.

## Configuration and ownership

The default canonical browser origin is `http://127.0.0.1:3000`. Both services
remain bound to loopback. Configure a different exact origin with
`RESEARCHCHAIN_PUBLIC_ORIGIN` in the environment or `.env`; omit paths, trailing
slashes and default ports. Non-loopback origins require HTTPS. This configuration
option is not authorization to expose or deploy the application.

One configured Postgres host/port/database/schema is one owner workspace.
The API never accepts a database, schema, owner or workspace selector from an
HTTP request. All records and references use that configured repository scope,
including original-byte hashes, exports, evaluation records and run actions.
Existing immutable records need no data migration or changed content hashes.

The namespace hashes the connection target and schema, excluding database
credentials. Rotating the database password retains ownership. Restoring into a
different database/schema creates a separate workspace and requires enrollment.
Changing connection aliases or the browser origin can require signing in again.
This is a single-owner instance, not collaborator accounts or a shared
multi-tenant service.

Access state defaults to the OS application-data directory, separate from
research and provider data. `RESEARCHCHAIN_ACCESS_DIRECTORY` overrides its root;
each workspace gets its own subdirectory. Use a private path outside tracked
source. Inside this checkout, only ignored `.local`, `data` or `artifacts`
destinations are accepted.

Windows protects state with user-scoped DPAPI and an owner-only directory ACL.
Unix requires owner-only directory/file permissions. Passwords use Argon2id;
random session and link secrets are stored only as SHA-256 verifiers.
A locked, atomically replaced state file lets local API processes share expiry,
rate limits and revocation. Host-local storage is not a multi-host session service.

Research backups exclude access state and provider credentials. Restoring a
research archive cannot restore revoked sessions. Do not copy old access-state
files over live state: that would roll back revocation. A restored research
database should receive a new enrollment and an explicitly configured provider
connection if needed.

## API and operations

Only GET `/api/health`, GET `/api/access/status`, POST `/api/access/login` and
POST `/api/access/exchange` are public. Health reports readiness without database
details. Every other path requires a session, including documentation at
`http://127.0.0.1:3000/api/docs` and the OpenAPI document.

Browser mutations require the exact configured Origin and the session's
`X-ResearchChain-CSRF` header. Host validation and fetch metadata checks apply
before repositories or request parsing. Forwarded identity/host headers grant
no authority. Authentication bodies are limited to 4 KiB; resource requests to
20 MiB. API responses are private/no-store. Cookies are host-only, HttpOnly and
SameSite=Strict, with Secure and a `__Host-` prefix for HTTPS origins.

Operator commands for migrations, backups and provider connections remain
privileged local operations independent of browser sessions. Stop local services
before browser tests. Tests enroll synthetic owners in temporary access
directories and databases; they never reuse the real owner's session store.

The local owner gate does not complete [issue #9](https://github.com/andersj05/ResearchChain/issues/9).
Durable hosted workers, public-edge limits, retention, off-machine recovery,
secret operations and measured hosting costs remain. Do not expose a rollback
build that lacks the access gate; keep rollback rehearsal on loopback.
