# 0019 — Opt-in web research and an owner-editable example

Date: 2026-11-16. Status: accepted for the explicitly requested example.

## Context

The owner asked for a simple chart-and-thesis research agent with modeling and
confirmed live web research. This extends the environment's capabilities without
changing the owner-built scope or replacing LangGraph and the existing ChatGPT
included-plan connection.

## Decision

Custom model steps may opt into the official Responses `web_search` tool. Existing
steps default off, and canonical workflow documents omit that default so saved
revision hashes remain stable. A run pins the web instructions and request options
alongside the existing prompt hashes; old research schemas and hashes are unchanged.

The transport combines streamed output-item completion records with final response
metadata. Only provider-reported actions and citation/source records become web
provenance; model-written URLs do not. The server adds this metadata to a stored
result subtype, excluded from the model's output schema, and saves it with the raw
model text in the response artifact. Existing JSON storage suffices; no migration.
Downstream steps can receive the references through their context connection.

A web-enabled attempt requires a completed web action. Unsupported tools, absent
actions and uncertain responses fail visibly without retries or billing fallback.
Request admission, timeout, stream/output size, and token thresholds remain enforced.
The SIWC route does not support `max_tool_calls`; do not represent the evidence-read
budget as a cap on provider-managed web actions. References are not full page copies.

The optional example uses three model calls, two human checkpoints, and a bounded
JavaScript transform. Numeric observations are supplied directly in the brief,
never silently transcribed from chart pixels or model prose. OLS, sample correlation
and explicit scenarios are reproducible and labeled as descriptive. Missing data
produces a data request. Research quality and model suitability remain owner judgments.

## Consequences

No API key or separate search service is required. Model/account policies can still
reject the tool. The current 120-second request timeout limits research depth; the
owner can split work into additional steps. Archived originals, automatic verified
data ingestion, larger analytical libraries and calibrated judgments are separate
future work. The example stays editable and never changes existing saved agents.

See [usage and limits](../idea-research-example.md) and the official
[SIWC preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
