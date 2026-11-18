# Python workspaces for Codex research nodes

The owner wants an analyst to decide which data to gather, write analysis code,
inspect a chart, and revise a report within a graph step. The workflow pins an
opt-in workspace on a custom analyst node. Its Codex session can request Python
and continue with the execution receipt. Hosted search and SEC lookup keep their
own per-step controls. The structured conclusion can point to a full Markdown report.

Each Python action runs in a disposable local Docker container with a read-only
root, a memory budget and a 90-second script deadline. The script runs as an
unprivileged user. Inputs travel over standard input and include the selected
evidence files and confirmed workspace outputs. There are no host mounts.
Network access is disabled. The pinned runner includes NumPy and Matplotlib.
The worker keeps the account connection and admits each model pass.

The worker records the requested action and script before execution. It commits
the completed receipt and exported blobs together. A restarted worker reuses a
confirmed receipt. An uncertain action stops the run for inspection. Owners
can see each version of a file in its action and the latest files in the final
summary. The next pass can inspect the first saved chart from the previous
action when it fits the input budget. A downstream workspace can reopen files
from a connected research result after the worker verifies it against that run.
