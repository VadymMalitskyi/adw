---
name: amend
description: Revise an approved ADW plan.md after superseding and archiving its active approval, then stop for fresh approval. Use when scope, design, acceptance criteria, phase or group structure, affected paths, validation, or delivery intent must change after a plan was approved.
---

# ADW Amend

Invalidate the active approval first, preserve its evidence, then revise `plan.md` and stop for reapproval. Approval always describes exact plan bytes, so changed intent must never coexist with an approval that still claims to cover it.

## Resolve and preflight

1. Find the project root that contains `adw.yaml`, and require the configured docs worktree to be clean, attached to the configured docs branch, and fast-forward with its upstream.
2. Resolve the installed plugin root independently of the project working directory:
   - In Claude Code, use the expanded `${CLAUDE_PLUGIN_ROOT}` value.
   - In Codex, start from the absolute source location advertised for this loaded `SKILL.md` and remove `/skills/amend/SKILL.md`.
3. Use `templates/plan.md`, `lib/adw-helper.mjs`, `execution/contracts.md`, and `integrations/contracts.md` under that `<plugin-root>`. Bundled resources never resolve from the project directory or the current working directory. Stop if the root is missing, literal, unexpanded, or outside the installed plugin.
4. Validate the project contract with the helper's `load-project` command and use only its returned normalized `data`.
5. Require a change id matching `^[a-z0-9](?:[a-z0-9_-]|\.[a-z0-9_-]+)*$`, an existing `changes/<change-id>/plan.md`, and an active `changes/<change-id>/approval.json`.
6. Require the human to provide a specific, non-empty amendment reason and the requested change. Do not accept a generic value such as `amended`, and do not infer a reason from repository content.
7. Follow `<plugin-root>/integrations/contracts.md` for any provider read, and only for capabilities `adw.yaml` declares. Use read operations only during amendment; a tracker or code-host write still needs its own preview and fresh exact authorization.
8. Honor `execution.isolation` before any project read or lifecycle write. Accepting a weaker boundary needs explicit human confirmation for this amendment.

## Verify and invalidate first

1. Read `plan.md` as exact bytes and compute its digest with the helper's `digest` command.
2. Validate `approval.json` with the helper's `validate-approval` command and require `status: "active"`. Verify it with `verify-approval` against the current plan bytes, the recorded `plan_commit`, the change id, and the plan path.
3. Confirm directly from Git that the recorded `plan_commit` contains those exact plan bytes and is an ancestor of the current docs-branch head. Stop on any mismatch and report it; do not rewrite questionable evidence.
4. Invoke the helper's `supersede-approval` command with the active record, the human-provided reason, and the current UTC ISO 8601 timestamp. It returns the superseded record — carrying every original field plus `status: "superseded"`, `superseded_at`, and `superseded_reason` — and the history path `approval-history/<plan-digest>.json`.
5. Write the returned record byte-for-byte to both `changes/<change-id>/approval-history/<plan-digest>.json` and `changes/<change-id>/approval.json`. Refuse to replace a non-identical existing history file.
6. Commit only this lifecycle evidence on the docs branch, before editing `plan.md`.

This ordering ensures an interruption cannot leave changed intent paired with an active approval. Never delete or rename away approval evidence, and never rely only on Git history to preserve it.

Run records under `changes/<change-id>/runs/` are historical evidence of what already ran. Amendment never edits, deletes, or rewrites them, even when the amended plan invalidates the work they describe.

## Amend the plan

1. Explore relevant code, tests, manifests, and authoritative documentation read-only to ground the requested revision.
2. Edit only `changes/<change-id>/plan.md` in the docs worktree, keeping the original change id and the mandatory PART 1 and PART 2 headings in order. Consult `<plugin-root>/templates/plan.md` for the canonical structure when a new section is needed.
3. Reconcile both parts. A change to PART 1's summary, design, decisions, risks, or acceptance criteria must be reflected in PART 2's glance table, groups, directives, and validation, and the reverse.
4. Keep phase and group ids stable wherever the work itself is unchanged, because branches, worktrees, and run records are keyed by them. When a group genuinely no longer exists, remove it and say so in the report rather than reusing its id for different work.
5. Re-verify every `file -> symbol` anchor, every affected path against the declared components, the dependency ordering between phases, disjoint write paths among groups that share a phase, and every validation command against its observable source.
6. Summarize the amendment's rationale in `Key Decisions & Trade-offs` so future readers need no chat history. The literal amendment reason stays in the superseded approval evidence.
7. Run a fresh `adw:review-plan` pass over the amended bytes and apply its objective findings; record judgment calls as open decisions. A `needs-rework` verdict means the amendment is not ready for approval.
8. Review the diff and commit only the amended `plan.md` on the docs branch. Leave `approval.json` superseded. Do not compute, request, or create a replacement approval.
9. Report the amendment reason, the superseded plan digest, the history path, the lifecycle commit, the plan commit, the material changes, the review verdict, and the exact validation commands. Stop and require a fresh `adw:approve` interaction.

Any change to the plan bytes requires fresh approval. Execution stays blocked until a human approves the amended plan.

Do not push unless the human separately authorizes the configured docs delivery operation.

## Boundaries

Mutate only this change's `plan.md`, its approval lifecycle files, and their docs-branch commits. Never modify project code, code-coupled documentation, project configuration, run records, tickets, pull requests, or external systems. Never create or switch a branch, never create a worktree, never implement a task, never run implementation validation, never approve the amended plan, and never push, merge, release, or deploy.
