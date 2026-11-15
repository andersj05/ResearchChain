# Workbench authentication and authorization

Follow-on to the verified backup/restore slice of
[issue #9](https://github.com/andersj05/ResearchChain/issues/9).
Start from dev merge 5c13438 on feat/workbench-auth.

## Initial scope

Assume one owner for the first hosted version unless the owner requests separate
collaborator accounts. Provider sign-in is a separate boundary: the
existing ChatGPT Pro connection does not itself authenticate workbench users.
Do not share that provider account implicitly or introduce paid API usage.

Implement a concrete owner-access workflow with protected bootstrap/recovery,
bounded sessions, sign-out and explicit authorization for every existing API
surface. Keep setup secrets and session credentials out of logs, URLs exposed in
chat, source control and research records. Choose the credential/session mechanism
after inspecting the existing app and deployment constraints; do not turn this
plan into an unreviewed identity-provider deployment.

## Required behavior

- Establish an authenticated owner before exposing private workbench state.
  Give initial enrollment and recovery clear local operator procedures.
- Keep provider credentials independent. Restoring research data must not
  resurrect revoked sessions or copy a provider connection to another person.
- Define project/workspace ownership and a reusable authorization boundary.
  Existing local data must migrate into the owner's workspace without changing
  pinned workflows, original bytes, immutable content hashes or review decisions.
- Protect every listing, UUID lookup, mutation, run action, provider status,
  export and content-addressed original. Validate that referenced records belong
  to the same authorized workspace. Knowing an ID or original hash is not access.
- Keep unauthenticated health responses minimal. Address API documentation,
  HTTP origins/hosts, cookie flags, expiry, revocation and CSRF for browser actions.
- Add the sign-in/setup/session-expiry/sign-out UI using the installed UI SDK and
  repository design rules. Preserve owner drafts and idempotent request recovery
  across reauthentication without exposing another identity's cached data.
- Keep maintenance CLI operations separate from app sessions. Back up and rehearse
  authorization migrations before applying them to the private owner database.
- Keep services on loopback. A completed auth slice does not authorize public
  deployment or satisfy the remaining worker, retention and hosting requirements.

## Verification and delivery

Use isolated synthetic users/workspaces and databases. Test anonymous denial,
expired/revoked sessions, known-ID and original-hash access, cross-workspace
references, protected exports and all execution actions. Preserve the existing
model-journal no-resend guarantees. Never fabricate owner review or model usage.

Run focused checks while implementing, pnpm check before delivery and production
browser tests for the changed interactions. Preserve frequent coherent commits,
open the feature PR into dev, merge after CI, and leave issue #9 open until its
remaining acceptance criteria are complete.
