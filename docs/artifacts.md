# Artifact contracts

ADW 1.0 has two handwritten contracts a human ever reads (`adw.yaml` and `plan.md`) and two small machine records a human never authors (`approval.json` and `runs/<phase-id>.json`).

## Code branch

- `adw.yaml`: the committed `adw: 1` project contract — base branch, docs branch and worktree, execution mode/parallelism/isolation, components with their validation commands, optional provider capabilities, optional plain-language conventions.
- `.adw/local.yaml`: optional ignored machine-local values created during initialization or a contributor's digest-bound `adw:onboard` preview.
- `.adw/preferences.md`: ignored personal collaboration guidance; never shared policy, authorization, credentials, or an approval input.
- `.adw/cache/`: ignored local scratch space reserved for ADW tooling; never durable workflow evidence.
- `AGENTS.md` and `CLAUDE.md`: existing content plus one bounded routing block.
- `worktrees/`: ignored; holds the docs checkout and every execution group worktree.
- `.codex/config.toml`, `.codex/rules/adw.rules`, and `.claude/settings.json`: generated `managed-development` permission policy for both providers. These are written for every isolation mode, because the guardrails are useful without a container.
- `.devcontainer/`: optional. Project-owned containers are preserved untouched, and only `managed-devcontainer` mode generates one.
- Project `README.md`, `docs/`, ADRs, APIs, and runbooks remain authoritative and project-owned.

## Docs branch

- `architecture.md` and `components/*.md`: concise agent context linking to authoritative project docs.
- `changes/<change-id>/plan.md`: the one canonical plan. PART 1 is the human feature overview; PART 2 is the agent-executable implementation plan with phases, groups, anchors, directive tasks, and validation.
- `changes/<change-id>/approval.json`: version, change id, plan path, plan digest, plan commit, approver, timestamp, and status.
- `changes/<change-id>/approval-history/<plan-digest>.json`: immutable superseded approvals, named by the plan digest they were filed under.
- `changes/<change-id>/runs/<phase-id>.json`: the machine-written phase run record.
- `SYNC.yaml`: code branch, reviewed-through commit, and update time.

Removed in 1.0 and never regenerated: `spec.md`, `plan.yaml`, `integrations.yaml`, standalone `validation.json`, `external-events/` receipts, `adw/work-items/*.yaml` profiles, and the entire `plugin/schemas/` directory.

## Phase run record

```json
{
  "version": 1,
  "change_id": "tenant-throttling",
  "phase_id": "foundations",
  "plan_digest": "<sha256 of the approved plan bytes>",
  "base_branch": "main",
  "base_commit": "<40-hex>",
  "started_at": "<ISO timestamp>",
  "completed_at": null,
  "status": "running",
  "groups": {
    "contracts": {
      "branch": "adw/tenant-throttling/contracts",
      "worktree": "worktrees/tenant-throttling/contracts",
      "tasks": ["<interpreted directive>"],
      "affected_paths": ["src/contracts"],
      "tracker": null,
      "pull_request": null,
      "implementation_commit": null,
      "review": { "status": "pending", "high_findings": [] },
      "validation": { "status": "pending", "commands": [] },
      "status": "prepared"
    }
  }
}
```

Only the coordinator writes run records, and they are committed locally on the docs branch so a later session can resume. Whole-feature validation for an integration-PR delivery is stored in `runs/final.json`.

## Invariants

- Change ids, phase ids, group ids, and configured paths are validated before any filesystem access. Absolute paths, `..`, NULs, symlink escapes, and targets outside the project root are refused everywhere.
- Approval binds the exact bytes of one `plan.md` plus the docs commit containing them. Verification requires the current bytes to match `plan_digest`, `plan_commit` to be reachable on the docs branch with a byte-identical plan, status `active`, and matching change id and plan path.
- The plan is immutable after approval. Ticket ids, pull-request URLs, progress markers, and validation results are never written back into it.
- Superseded approval-history entries are immutable and retain their digest-derived filename.
- Group status advances only forward through `prepared → implementing → reviewing → validating → passed`; `failed` and `blocked` are reachable from anywhere and are terminal. Phase status moves only out of `running`.
- A group cannot be recorded `passed` until independent review and validation both passed.
- A validation cannot be recorded `passed` while any required command exited nonzero, was signaled, timed out, or was deferred. Only optional checks may be deferred, with an explicit reason.
- Captured command output is bounded to the last 4000 characters with secret-like values redacted.
- Branches and worktrees are unique per group within a phase, and parallel groups must have disjoint write paths.
- Run records never contain absolute local paths, credentials, unrestricted logs, or raw external content — only stable external ids, canonical URLs, and concise outcomes.
- Previous project, plan, and approval contract versions are unsupported and are never rewritten automatically.
