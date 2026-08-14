---
name: status
description: Reconstruct ADW workflow state from Git and the durable docs-branch artifacts without modifying anything. Use when reviewing branches, active changes, plan approval validity, phase run records, group worktrees, validation evidence, or draft pull requests in a new session.
---

# Reconstruct ADW status

Keep the entire workflow read-only. Do not fetch, pull, checkout, repair, create caches, run project commands, or update pull requests.

1. Resolve the installed plugin root from this loaded skill:
   - In Claude Code, expand `${CLAUDE_PLUGIN_ROOT}` and use `${CLAUDE_PLUGIN_ROOT}/skills/status/SKILL.md` as this skill's absolute locator.
   - In Codex, use the absolute `SKILL.md` source locator advertised when this skill loaded.
   - Remove `/skills/status/SKILL.md` from that locator to obtain `<plugin-root>`. Never derive a plugin resource from the project or current working directory.
   - Resolve `execution/contracts.md`, `integrations/contracts.md`, and any selected provider reference from that same root.
2. Resolve the project root with `git rev-parse --show-toplevel`.
3. Resolve configured `work_tracker`, `code_host`, `observability`, and `knowledge` capabilities independently from `native|mcp|cli|api` transports. Honor `required: true|false` and absence. When no provider is configured, probe no external system during ordinary status.
4. Run `node <plugin-root>/skills/status/scripts/snapshot.mjs --project-root <project-root>`. It loads `adw.yaml` through the bundled helper, verifies approvals against exact bytes and Git, and validates run records. Treat its JSON as authoritative over prior conversation.
5. Summarize the configured execution mode, maximum concurrency, and isolation, plus whether that isolation is actually active. `provider-sandbox` is the lightweight default and the weaker boundary; say so plainly. Status may diagnose an inactive required environment but must never execute project code or mutate anything.
6. For every `changes/<change-id>/` directory, report the reconstructed state:
   - whether `plan.md` is present and its exact byte digest;
   - approval state, which is `active` only when `approval.json` verifies against the exact current plan bytes, its `plan_commit` is reachable from the docs branch, that commit holds byte-identical plan bytes, its status is `active`, and its change id and plan path match; report `stale`, `superseded`, `invalid`, or `missing` with the precise reason otherwise;
   - each superseded record under `approval-history/`, valid only when it is a non-symlink JSON file named for its own bound plan digest;
   - each `runs/<phase-id>.json` record: phase status, start and completion, whether its plan digest still matches the current plan, and per group the branch, whether that branch exists, the worktree and whether it is attached, the recorded tracker item, draft pull request, implementation commit, review outcome with any unresolved high-severity findings, validation status with each command's actual result, and the group status;
   - the blocking reasons, such as a stale approval, an unverifiable approval commit, an invalid run record, a failed required check, an unresolved high-severity finding, a missing branch or worktree, a dirty checkout, or several changes competing for the same branch.
7. Recommend exactly one next ADW skill per change and never take that action: `adw:plan` for a change with no plan, `adw:approve` for an unapproved plan, `adw:amend` for a stale or superseded approval, `adw:execute` for an approved plan whose phases are unfinished, `adw:address-review` for an open draft pull request awaiting feedback, and none when every phase has passed.
8. For a configured capability with an already authenticated read-only transport, read the open draft pull request state relevant to the recorded branches, joining objects by provider, external id, URL, or exact head branch. A required unavailable capability is a blocker; an optional one stays `not-queried`. Never authenticate, write configuration, or expose external content or secrets.
9. Derive everything from durable artifacts and Git, never from chat history. Ignore symlinked, hostile, or unparsable entries rather than following them, and report that they were skipped.
