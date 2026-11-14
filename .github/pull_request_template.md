## Change

Describe the problem and resulting behavior. Link the issue.

## Validation

List checks actually run and any remaining limitations. Include a screenshot for
meaningful UI changes and evaluation evidence for research behavior changes.

## Review

- Correct branch route: `feat/*` → `dev`, or `dev` → `main`.
- Updated contracts, relevant docs, and agent handoff if behavior changed.
- No secrets, private research, or reference-output leakage in fixtures.
- Dev-to-main promotion uses a merge commit, never squash.
