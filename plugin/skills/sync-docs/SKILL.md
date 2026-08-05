---
name: sync-docs
description: Audit code changes since the docs-branch SYNC.yaml marker and report documentation-context drift without writing by default. Use when reconciling architecture.md or component maps, preparing an explicitly authorized docs-branch fix, or directly pushing an approved synchronization without force.
---

# Synchronize Documentation Context

Treat synchronization as a maintenance audit. Preserve repository-owned documentation and historical change records.

1. Resolve the installed plugin root from this loaded skill:
   - In Claude Code, expand `${CLAUDE_PLUGIN_ROOT}` and use `${CLAUDE_PLUGIN_ROOT}/skills/sync-docs/SKILL.md` as this skill's absolute locator.
   - In Codex, use the absolute `SKILL.md` source locator advertised when this skill loaded.
   - Remove `/skills/sync-docs/SKILL.md` from that locator. Never derive plugin resources from the current working directory.
2. Resolve the project root with `git rev-parse --show-toplevel` and run `node <plugin-root>/skills/sync-docs/scripts/sync-docs.mjs report --project-root <project-root>`.
3. Report changed code paths between `SYNC.yaml.reviewed_through` and the current configured code branch. Compare manifests, build files, CI, component paths, code-branch `README.md`/`docs/`, and accepted change records when explaining possible drift.
4. Keep the default report read-only. Do not fetch, edit, commit, or push. Stop if either checkout is dirty, the marker commit is missing or divergent, the configured branches do not match, or the local docs branch is behind/diverged from its known remote-tracking ref.
5. When context needs repair, draft an exact JSON proposal containing `files`, where each item has `path`, complete `content`, and the exact current `expected_content` (or `null` for a new file). Permit only `architecture.md` and `components/<name>.md`. Keep context concise and link to authoritative code-branch docs instead of copying them.
6. Show the complete proposed diff and ask whether to apply it. For an authorized local-only repair, run:
   `node <plugin-root>/skills/sync-docs/scripts/sync-docs.mjs fix --authorized --proposal <proposal.json> --project-root <project-root>`.
7. For configured direct-push delivery, ask separately for explicit authorization to commit and push the exact reviewed proposal. From the clean state used to produce the proposal, run the fix command once with `--push-authorized` included. Do not first apply a local-only repair. The script uses a normal push and never passes a force option.
8. Report the new marker, docs commit, and push result. Never edit or delete code-branch `README.md`, `docs/`, docs-branch `README.md`, `changes/`, specifications, plans, approvals, or validation evidence.

If an authorized local fix is interrupted before commit, inspect the docs-worktree diff, retain it for review or restore only the listed context files and `SYNC.yaml`, then rerun the report. If the commit succeeds but push fails, preserve the local commit, fetch the docs branch, reconcile without rewriting history, and retry a normal push only after renewed authorization.
