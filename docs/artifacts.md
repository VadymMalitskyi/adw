# Artifact contracts

## Code branch

- `adw.yaml`: committed shared configuration and workflow schema.
- `.adw/local.yaml`: optional ignored machine-local values.
- `AGENTS.md` and `CLAUDE.md`: existing content plus one bounded routing block.
- `worktrees/docs`: ignored checkout of the configured docs branch.
- Project `README.md`, `docs/`, ADRs, APIs, and runbooks remain authoritative and project-owned.

## Docs branch

- `architecture.md` and `components/*.md`: concise agent context linking to authoritative project docs.
- `changes/<change-id>/spec.md`: outcome, behavior, scope, exclusions, decisions, risks, acceptance criteria, and documentation impact.
- `changes/<change-id>/plan.yaml`: ordered tasks, anchors, restrictions, and exact validation commands.
- `changes/<change-id>/approval.json`: approver, time, artifact digest, schema/plugin versions, and approved docs commit.
- `changes/<change-id>/validation.json`: bound code/docs revisions and exact command evidence.
- `SYNC.yaml`: code branch, reviewed-through commit, and update time.

## Invariants

- Change IDs and configured paths are validated before filesystem access.
- The approval digest covers the exact bytes of `spec.md` and `plan.yaml` in a deterministic order.
- Historical approvals and validation are not rewritten by migrations.
- Failed required commands remain failed; deferral requires an explicit reason and authorization.
- Captured output is bounded and secrets must be redacted.
- A compatible plugin version change does not modify project artifacts.
