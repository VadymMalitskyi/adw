---
name: execute
description: Execute an explicitly approved ADW change on one feature branch, in sequential plan order, with approval preflight, tests, review, code-coupled documentation, helper-recorded validation evidence, and an optional authorized draft GitHub pull request. Use when the user asks to implement or execute an approved ADW plan.
---

# Execute an approved change

Treat execution as one agent working sequentially on one feature branch. Never create per-task worktrees, parallel implementation branches, integration branches, tickets, or multiple pull requests.

## Resolve resources and inputs

1. Resolve the installed plugin root from this loaded skill, never from the project working directory:
   - In Claude Code, use the expanded `${CLAUDE_PLUGIN_ROOT}` value.
   - In Codex, remove `/skills/execute/SKILL.md` from the absolute source location advertised for this skill.
2. Use `<plugin-root>/lib/adw-helper.mjs`. Fail if the resolved helper or schemas are outside that same installed plugin root. Never write into the plugin installation.
3. Resolve the project root with Git. Read root-level `adw.yaml` and locate its configured docs worktree, branch, default code branch, and validation commands. Read the installed plugin version from the provider manifest in the resolved plugin root. Select the requested change under `changes/<change-id>/`.

## Run preflight before editing

Stop without changing code if any gate fails.

1. **Repository state:** Reject an in-progress merge, rebase, cherry-pick, or bisect; a dirty code worktree; a missing or dirty docs worktree; detached HEAD; nested execution worktree; or unexpected submodules. Do not stash, discard, or overwrite existing work.
2. **Base and branch:** Require the configured default branch to exist and be checked out for a new execution. Require an explicit fast-forward update decision if it is behind its upstream. Create or resume exactly one `adw/<change-id>` feature branch from that base. On resume, require the branch to descend from the recorded base and inspect all existing commits and changes before continuing. Never rebase or reset implicitly.
3. **Artifacts:** Parse `adw.yaml` without normalizing or rewriting it and validate the project object with the helper. Read `spec.md`, `plan.yaml`, and `approval.json` from the docs worktree as exact raw bytes. Validate the plan and approval with the helper. Require an active approval and plugin compatibility.
4. **Approval commit:** Require `approval.docs_commit` to name an existing 40-hex commit on the docs branch that contains byte-identical `spec.md` and `plan.yaml` at the same change-local paths. It is the pre-approval artifact commit, not the approval commit or current docs `HEAD`. Require the current docs history to descend from it.
5. **Approval digest:** Invoke the helper's `verify-approval` command with the current exact raw spec and plan bytes, the parsed approval, and `docs_commit` equal to `approval.docs_commit`. Continue only on exit code 0 and `verified: true`. Any byte change, missing approval, superseded approval, schema error, commit mismatch, or helper failure requires reapproval; do not reproduce the digest in prose.
6. **Paths:** Require every task path, validation `cwd`, and declared documentation file to be explicit and project-relative. Reject absolute paths, `..`, NULs, symlink escapes, paths outside the project root, plugin files, `.git`, `.adw`, `worktrees/`, and the docs checkout. Confirm the planned anchors still identify the intended live code. Stop for `adw:amend` when an anchor or affected area has drifted materially.
7. **Commands:** Reconcile every plan command with `adw.yaml` and its observable source, such as a manifest, task runner, CI workflow, or existing project documentation. Show the exact commands and working directories before running them. Reject commands that are interpolated from untrusted text or that can deploy, release, publish, merge, force-push, mutate remotes, elevate privileges, delete broadly, expose secrets, or write outside the project. Missing required commands are blockers, never implicit deferrals.
8. **Scope:** Summarize the approved outcome, exclusions, sequential tasks, affected paths, restrictions, acceptance criteria, and documentation declaration. If repository reality requires different behavior, design, public contract, architecture, component ownership, dependencies, or affected paths, stop and route the discovery through `adw:amend`.

## Implement sequentially

For each plan task in numeric order:

1. Read its anchors, affected code, restrictions, and existing tests.
2. Implement only that task on `adw/<change-id>`. Do not delegate implementation to another agent.
3. Add or update focused tests that prove the task's acceptance behavior. A task is not complete merely because existing tests pass.
4. Run the task's exact required validation commands in the declared project-relative directories. Preserve every nonzero exit, signal, timeout, and output summary. Stop task progression on a required failure and do not weaken, remove, skip, or relabel a required check.
5. Inspect the task diff for unexpected paths and scope. A scope-changing discovery stops execution for amendment; do not reinterpret the plan locally.

Do not merge, deploy, release, publish packages, modify external tickets, or force-push at any point.

## Review the whole change

After all tasks pass, review the complete feature-branch diff against the exact base, not only the last task. Check correctness, security, data and API compatibility, error paths, tests, accidental generated files, secrets, scope, and compliance with the approved spec and plan. Fix in-scope defects and rerun every affected task check. Route behavior or design changes through `adw:amend`.

Update every code-coupled documentation file declared by `plan.yaml` on the feature branch. If the plan says `none` but implementation changes public behavior, operations, configuration, an API, or architecture—or if declared documentation paths are insufficient—stop for amendment. Keep ADW context and change evidence in the docs worktree, never on the feature branch.

## Commit and record validation

1. Confirm the final feature diff contains only approved code, tests, and code-coupled docs. Create intentional local commits on the single feature branch. Do not add AI attribution.
2. With the resulting 40-hex code commit, run every unique required task command and configured project command through the helper's `run-validation` command. Pass exact commands, project-relative `cwd` values, timeouts, `required` flags, change id, plugin version, code commit, the current docs commit, and an ISO timestamp.
3. Capture the helper JSON even when it exits with `VALIDATION_FAILED`. Write its returned evidence, unchanged, to `changes/<change-id>/validation.json` in the docs worktree, validate that artifact with the helper, and commit it on the docs branch. The evidence's `docs_commit` is the docs `HEAD` immediately before writing that evidence. Never hand-author a passing status.
4. A required nonzero exit, signal, timeout, or required deferral keeps status `failed`. Commit the truthful failure evidence, report the failure, and do not present the change or pull request as successful. Optional checks may be deferred only with a specific recorded reason. Required checks may not be deferred.
5. After writing evidence, require both worktrees to be clean and confirm the evidence's code commit equals feature `HEAD`. Do not push either branch without authorization applicable to that remote operation.

## Optionally prepare one draft pull request

Create or update one draft GitHub pull request only when the user explicitly authorizes that external action and validation status is `passed`.

1. Verify GitHub authentication, the intended remote, feature branch, and base. Push normally; never force-push.
2. Reuse an existing pull request for the exact head branch instead of creating a duplicate. Otherwise create one draft PR targeting the configured base.
3. Include the approved outcome, scoped diff, code-coupled docs, exact validation summary, and docs-branch evidence commit. Keep it draft; never mark it ready, approve it, merge it, release it, or deploy it.

If draft-PR authorization is absent, stop after local commits and evidence and report the exact push/PR actions still awaiting authorization.

## Report

Report the change id, approval commit and digest verification, base and feature branches, completed tasks, whole-diff review findings, code-coupled docs, code commit, docs evidence commit, every check and its actual result, and draft PR URL or authorization-needed state. Never describe failed or incomplete validation as successful.
