# ADR 0010: one owner per configured workspace

Status: accepted for the local workbench; hosted operations remain in issue #9.

## Decision

Give each configured database target/schema an owner namespace, separate from
provider identity and research records. Every repository remains bound to that
namespace at app construction; requests cannot select another database or schema.
An outer deny-by-default API boundary protects listings, IDs, source hashes,
exports and execution before parsing business inputs.

Use local operator enrollment/recovery, an Argon2id password and bounded opaque
sessions. A five-minute single-use link is exchanged through a fragment that the
browser removes before requests. Only hashes of link/session secrets are saved.
The host-only cookie is HttpOnly and SameSite=Strict; HTTPS adds Secure and the
__Host prefix. Mutations require a session-bound CSRF value and exact Origin.
Do not trust forwarded headers as identity.

Keep credentials, session verifiers, CSRF values, lockout state and ownership in
private host storage, protected with DPAPI on Windows and restrictive Unix modes.
Serialize changes under a process-shared file lock and publish with atomic,
durable replacement. Research backups omit this store, so restoring research
cannot roll back sign-out. Provider credentials remain independently protected.

The client does not mount private content before authentication. It can retain a
hidden, inert editor through expiry for the same owner/workspace, but replaces
the editor for another identity. Scope browser recovery to that identity and
require explicit import for older unscoped drafts. Never replay a rejected
mutation automatically.

## Consequences

This preserves existing records, hashes, pinned workflows and review decisions
without an authorization data migration. One owner controls all records in the
configured workspace. It does not add collaborator roles, per-project ACLs,
federated identity, multi-host sessions or public deployment.

The service OS account can enroll or recover the owner and is privileged.
Browser profiles and downloaded exports remain trusted local state. An admitted
long-running operation may finish after sign-out; cancellation remains explicit.
Restoring stale credential files could revive old sessions and is not an approved
research-recovery procedure. Operator recovery creates fresh access instead.

A deployment with collaborators or multiple API hosts must replace the identity/
session layer and define shared ownership before rollout; it cannot infer users
from the owner's ChatGPT provider connection. See [the operator guide](../owner-access.md).

Mechanisms follow the primary guidance for
[Argon2 password verification](https://argon2-cffi.readthedocs.io/en/stable/howto.html),
[server-enforced sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
and [stateful CSRF tokens and origin checks](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
