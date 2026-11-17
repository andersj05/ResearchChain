# ADR 0005: Local ChatGPT plan connection

Status: accepted, 2026-11-14.

## Context

The owner chose their included ChatGPT Pro allowance for the first live provider
milestone. Current OpenAI documentation supports direct plan usage for locally
hosted/open-source applications through dynamic Sign in with ChatGPT registration.
This is separate from copying a Codex login or configuring a separately billed
API key.

## Decision

Implement a local setup command and a server-side provider module, separate from
the graph runtime and its public API contract. Use the documented loopback
Authorization Code/PKCE flow. Verify signed ID tokens and plan-use scopes, keep
registrations separate by issued client ID and verified subject, and persist a
stable opaque host ID. Credentials use Windows current-user DPAPI or owner-only
Unix storage outside the checkout, atomic replacement, and process-shared locking.
Do not automatically change billing paths.

Use the public account-specific model catalog and Responses endpoint with
`store=false`, `stream=true`, and explicit input history. A completed terminal
event proves connectivity; a model listing or partial output does not. Treat
provider errors, incomplete responses, and disconnected streams as failures.
Do not use unsupported preview fields or borrow another application's tokens.

## Consequences

Human sign-in and consent are still necessary. Revocation can be delayed by network
failures, so local sign-out reports when remote revocation is unconfirmed. The
browser callback is short lived, same-computer only, and is not the web app's own
login. Platform credentials stay outside Postgres run/checkpoint manifests.

Subscription usage does not have an API-price-derived dollar cost. The preview's
unsupported `max_output_tokens` means a transport deadline/output bound cannot be
represented as a hard token/spend cap. Full research execution must record its
actual provider/model/prompts/evidence configuration and enforce its own budgets,
while OpenAI's app limits govern included plan usage and optional credits.

See the [connection guide](../chatgpt-plan.md) for commands and authoritative sources.
