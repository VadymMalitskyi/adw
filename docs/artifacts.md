# Artifact contracts

## Code branch

- `adw.yaml`: committed shared configuration and workflow schema, including any runtime versions explicitly chosen during initialization.
- `adw/work-items/*.yaml`: optional committed project-owned tracker payload profiles referenced by schema-5 workflow policy.
- `.codex/config.toml`, `.codex/rules/adw.rules`, and `.claude/settings.json`: Codex and Claude Code adapters for schema-5 `managed-development` permissions.
- `.adw/local.yaml`: optional ignored machine-local values created during project initialization or through a contributor's digest-bound `adw:onboard` preview.
- `.adw/preferences.md`: ignored personal collaboration guidance; never shared project policy, authorization, credentials, or an approval input.
- `.adw/cache/`: ignored local scratch space reserved for ADW tooling; never durable workflow evidence.
- `AGENTS.md` and `CLAUDE.md`: existing content plus one bounded routing block.
- `worktrees/docs`: ignored checkout of the configured docs branch.
- Project `README.md`, `docs/`, ADRs, APIs, and runbooks remain authoritative and project-owned.

## Docs branch

- `architecture.md` and `components/*.md`: concise agent context linking to authoritative project docs.
- `changes/<change-id>/spec.md`: outcome, behavior, scope, exclusions, decisions, risks, acceptance criteria, and documentation impact.
- `changes/<change-id>/plan.yaml`: ordered tasks, anchors, restrictions, exact validation commands, and for schema 2 the digest-bound effective component, validation, and tracker policy snapshot.
- `changes/<change-id>/integrations.yaml`: optional durable external bindings and requirement digests; never credentials.
- `changes/<change-id>/approval.json`: approver, time, approval-bundle digests, schema/plugin versions, and approved docs commit.
- `changes/<change-id>/approval-history/<digest>.json`: immutable superseded approvals, named by their recorded digest.
- `changes/<change-id>/validation.json`: bound code/docs revisions and exact command evidence. A planned change also has spec, plan, and active approval artifacts; a quick change intentionally records validation without those planning artifacts.
- `changes/<change-id>/external-events/*.json`: normalized, redacted receipts for attempted external mutations and verified results.
- `SYNC.yaml`: code branch, reviewed-through commit, and update time.

## Invariants

- Change IDs and configured paths are validated before filesystem access.
- The approval bundle always covers the exact bytes of `spec.md` and `plan.yaml` and, when present, all of `integrations.yaml` in a deterministic order. The binding's requirements digest separately detects provider-side requirement drift.
- Previous project, plan, and approval schema versions are unsupported and are never rewritten automatically.
- Superseded approval-history entries are immutable, validate as superseded approvals, and retain their digest-derived filename.
- A standalone valid quick-change validation record is `validated` when it passed and `validation-failed` when it failed; it does not require a planning approval.
- Failed required commands and required deferrals remain failed. Only optional checks may be deferred, with an explicit reason and authorization.
- Captured output is bounded and secrets must be redacted.
- A compatible plugin version change does not modify project artifacts.
- External bindings contain stable provider identity, external ID, URL, requirement fields, and requirement digest. Operational fields such as assignee or current check status do not invalidate approval unless configured as requirements.
- Every external mutation has explicit authorization, an idempotency identity, post-write readback, and a receipt. Receipts store digests and concise summaries rather than full logs or sensitive page contents.
