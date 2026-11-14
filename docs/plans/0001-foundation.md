# Foundation implementation plan

Date: 2026-11-13.

1. Preserve the existing repository and establish `dev` and `feat/project-foundation`.
2. Commit product context, architecture decisions, and lightweight agent memory.
3. Build a Next.js/UI SDK editor and a FastAPI/LangGraph execution slice with no
   model credentials required. Commit the working app and locked dependencies.
4. Add generated contracts, meaningful validation/runtime/browser tests, and CI.
5. Publish the branches, configure PR and status-check protection, and create a
   milestone-based issue backlog and GitHub Project when account access permits.
6. Verify CI, record precise remaining scope, and promote the verified foundation
   through `dev` to `main`. Keep the branch history intact.

Acceptance: a fresh checkout has documented setup; the visual graph can be edited,
saved locally and exported; the backend rejects invalid graphs; a run pauses for
human review and resumes; contracts are checked for drift; CI enforces the branch
route; memory gives a new agent a short, accurate starting point.

Out of scope: live investment analysis, provider selection, paid APIs, authentication,
production persistence, deployment, publishing reports, and a complete advanced
graph editor. Those become explicit follow-on issues with acceptance criteria.
