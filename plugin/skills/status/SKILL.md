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
2. Resolve the project root with `git rev-parse --show-toplevel`.
3. Run `node <plugin-root>/skills/status/scripts/snapshot.mjs --project-root <project-root>`.
4. Summarize the code branch, commit, dirty paths, docs worktree, docs commit, and docs dirty paths.
5. For every `changes/<change-id>/` directory, report artifact presence and the reconstructed state:
   - `planned` when intent exists without a valid active approval;
   - `approved` only when approval schema and digest match the exact current spec and plan bytes;
   - `validation-failed` when required evidence failed;
   - `validated` only when validation evidence is valid and passed.
6. If a GitHub integration and authenticated read-only command are already available, query open draft pull requests for the current repository and join them by head branch. Otherwise preserve `not-queried`; do not authenticate or write configuration.
7. Call out stale approvals, invalid JSON/schema evidence, missing worktrees, dirty checkouts, failed validation, and ambiguous multiple active changes. Recommend the next ADW skill without taking that action.

Resolve the bundled helper from the installed plugin root. Treat filesystem artifacts and Git as authoritative over prior conversation history.
