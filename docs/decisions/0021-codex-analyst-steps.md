# Per-step Codex research sessions

The owner wants selected research steps to investigate their own leads and use
a detailed methodology within a larger workflow. A custom research node can pin
an analyst skill, a maximum pass count, a model and its research tools. LangGraph
continues to own the surrounding graph and human checkpoints.

The worker starts an ephemeral local Codex app-server for the node. A
session-specific loopback provider connects its Responses requests to the pinned
ChatGPT plan account. The worker admits each inference against the run and
workspace limits, supplies the pinned evidence, and exposes only the step's
research tools. Codex receives the model's response items and dispatches its
follow-up tool call. The next pass can use the tool receipt in the conversation.
The worker stores pass inputs, outputs, model identifiers and observed sources.
[OpenAI app-server integration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) ·
[supported plan capabilities](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

A pass has a stable identity under the workflow step path. Recovery can replay
confirmed responses and tool receipts without sending a duplicate inference.
An uncertain attempt stops execution for owner inspection. Each run records its
own limits. A fixed token budget gates the next request using reported usage.
**As needed** allows continued token use under the request, time and payload limits.
