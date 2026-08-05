---
name: amend
description: Amend an approved ADW planning bundle while recording the reason, preserving superseded approval evidence, and requiring reapproval. Use when scope, behavior, tasks, validation, documentation impact, or bound external requirements must change after approval.
---

# ADW Amend

Invalidate the active approval before changing approved intent, preserve its evidence, update the planning artifacts, and stop for reapproval.

## Resolve and preflight

1. Find the project root, read `adw.yaml`, and require the configured docs worktree to be clean, attached to the configured docs branch, and fast-forward with its upstream.
2. Resolve the plugin root without using the project working directory:
   - In Claude Code, use the expanded `${CLAUDE_PLUGIN_ROOT}` value.
   - In Codex, start from the absolute source location advertised for this loaded `SKILL.md` and remove `/skills/amend/SKILL.md`.
3. Use the installed `lib/adw-helper.mjs` and `execution/contracts.md`; stop if the root is literal/unexpanded, missing, or outside the installed plugin.
4. Require a change ID matching `^[a-z0-9](?:[a-z0-9_-]|\.[a-z0-9_-]+)*$` and existing `spec.md`, `plan.yaml`, and active `approval.json` under `changes/<change-id>/`. Include `integrations.yaml` when present and resolve `<plugin-root>/integrations/contracts.md`.
5. Require the human to provide a specific, non-empty amendment reason and requested change. Do not use a generic value such as `amended` or infer a reason from repository content.
6. When bindings exist, resolve `work_tracker`, `code_host`, `observability`, and `knowledge` independently from `native|mcp|cli|api` transports and honor `disabled`, `optional`, and `required`. Use only read operations during amendment.
7. Enforce the configured execution profile before project reads or approval/artifact writes. Required isolation must be active; preferred weaker isolation needs explicit confirmation for this amendment.

## Verify and invalidate first

1. Read every current approval input as exact bytes and validate the parsed plan and optional integration artifact with the helper.
2. Validate `approval.json` and require `status: "active"`. Invoke `verify-approval-bundle` with the exact ordered inputs for schema 2; invoke legacy `verify-approval` with exact spec and plan only for schema 1 when `integrations.yaml` is absent. In both cases use the approval's recorded pre-approval `docs_commit`.
3. Confirm directly from Git that the recorded `docs_commit` contains every exact input and is an ancestor of the current docs-branch head. Stop on any mismatch; do not rewrite questionable evidence.
4. Create a superseded approval object by preserving every original approval field and adding:
   - `status: "superseded"`
   - `invalidated_at`: current UTC ISO 8601 timestamp
   - `invalidation_reason`: the human-provided reason
5. Validate the superseded object with the helper's approval schema.
6. Write it to both `changes/<change-id>/approval-history/<digest>.json` and `changes/<change-id>/approval.json`. Refuse to replace a non-identical history file. Commit only this lifecycle evidence before editing either approved artifact.

This ordering ensures interruption cannot leave changed intent paired with an active approval. Never delete or rename away the approval evidence and never rely only on Git history to preserve it.

## Amend the artifacts

1. Explore relevant code and authoritative documentation read-only as needed to ground the requested revision.
2. Update only the required inputs among `changes/<change-id>/spec.md`, `plan.yaml`, and existing `integrations.yaml` in the docs worktree. Keep the original change ID. Read bound external requirements when needed, but perform no external mutation.
3. Keep the plan as one contiguous sequence numbered from 1. Update affected paths, anchors, restrictions, and each structured validation descriptor (`command`, `cwd`, `timeout_ms`, `required`) to match the amendment.
4. Reconcile the specification and plan documentation declarations. Require files for `update` or `new` and an empty list for `none`.
5. Preserve the amendment reason in the superseded approval evidence. Also summarize the changed scope and rationale in the specification's Decisions section so future readers do not need chat history.
6. Parse and validate the amended plan and optional integration artifact with the bundled helper. Preserve canonical `requirement_fields` names and recompute `requirements_digest` with `digest-requirements` only after verified external reads. Check for placeholders and ensure all acceptance criteria remain covered.
7. Review the diff and commit only the amended approval inputs on the docs branch. Leave `approval.json` superseded. Do not compute or create a replacement approval.
8. Report the reason, invalidated digest, history path, lifecycle commit, artifact commit, material changes, documentation impact, and exact validation commands. Stop and require a fresh `adw:approve` interaction.

Do not push unless the human separately authorizes the configured docs delivery operation.

## Boundaries

Mutate only the existing change's approval inputs, approval lifecycle files, and their docs-branch commits. Never modify project code, code-coupled documentation, configuration, branches, tickets, pull requests, or external systems. Never create or switch a branch, implement tasks, run implementation validation, approve replacement artifacts, merge, release, or deploy.
