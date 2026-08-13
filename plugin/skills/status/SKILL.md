---
name: status
description: Reconstruct ADW workflow state from Git-native project and docs-branch artifacts without modifying anything. Use when reviewing branches, active changes, approval validity, validation evidence, docs checkout state, or draft pull requests in a new session.
---

# Reconstruct ADW Status

Keep the entire workflow read-only. Do not fetch, pull, checkout, repair, create caches, or update pull requests.

1. Resolve the installed plugin root from this loaded skill:
   - In Claude Code, expand `${CLAUDE_PLUGIN_ROOT}` and use `${CLAUDE_PLUGIN_ROOT}/skills/status/SKILL.md` as this skill's absolute locator.
   - In Codex, use the absolute `SKILL.md` source locator advertised when this skill loaded.
   - Remove `/skills/status/SKILL.md` from that locator. Never derive plugin resources from the current working directory.
   - Resolve `execution/contracts.md`, `integrations/contracts.md`, and selected provider references from that same root.
2. Resolve the project root with `git rev-parse --show-toplevel`.
3. Resolve configured `work_tracker`, `code_host`, `observability`, and `knowledge` independently from `native|mcp|cli|api` transports. Honor `disabled`, `optional`, and `required`; when integrations are omitted, do not probe external systems during ordinary status.
4. Run `node <plugin-root>/skills/status/scripts/snapshot.mjs --project-root <project-root>`.
5. Summarize configured and active execution isolation, doctor evidence, code branch, commit, dirty paths, docs worktree, docs commit, and docs dirty paths. Status may diagnose a required inactive environment but must not execute project code or mutate anything.
6. For every `changes/<change-id>/` directory, report artifact presence and the reconstructed state:
   - classify it as workflow `planned` when planning or approval artifacts exist, `quick` when standalone validation evidence exists without a planning bundle, or `unknown` otherwise;
   - `draft` when the directory has no recognized intent or evidence, and `invalid` when present validation evidence is invalid;
   - `planned` when intent exists without a valid active approval;
   - `approved` only when schema-2 approval matches the exact current `spec.md`, `plan.yaml`, and optional `integrations.yaml` bytes;
   - `validation-failed` when required evidence failed;
   - `validated` only when validation evidence is valid and passed, plus an active exact-byte approval for a planned workflow; quick workflows require no approval.
   Also summarize affected components, effective required validation, tracker policy, and whether current project-policy and profile digests still resolve to the approved snapshot. Report drift without modifying artifacts.
7. Validate every non-symlink JSON file under `approval-history/` as a superseded approval whose filename matches its digest. Report valid and invalid lifecycle evidence independently from the current approval. Validate each `integrations.yaml` as artifact `integration` and each file under `external-events/` as artifact `external-action`. Summarize bindings, latest verified external actions, failed or uncertain receipts, and pending authorized-state reconciliation without exposing external content or secrets.
8. For configured, non-disabled capabilities with an already authenticated read-only transport, read current requirement-bearing fields and relevant open draft pull-request state. Join objects by provider, external id, URL, or exact head branch. Report requirement drift separately from operational drift such as state or assignee. Required unavailability is a blocker; optional unavailability remains `not-queried`. Do not authenticate or write configuration.
9. Call out stale approvals, invalid approval-history entries, requirement-bearing external drift, invalid artifacts, missing worktrees, dirty checkouts, failed validation, failed receipts, and ambiguous multiple active changes. Recommend the next ADW skill without taking that action.

Resolve the bundled helper from the installed plugin root. Treat filesystem artifacts and Git as authoritative over prior conversation history.
