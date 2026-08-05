---
name: quick
description: Implement a genuinely small, low-risk ADW change on one feature branch with focused tests, whole-diff review, code-coupled documentation, and helper-recorded validation. Use when the user explicitly requests quick mode for a narrow local correction that does not need a plan or approval.
---

# Execute a quick change

Use quick mode only for a narrow, already-understood local correction. It removes the spec, plan, and approval ceremony; it does not reduce branch, path, review, testing, validation, evidence, documentation, or delivery safety.

## Resolve and bound the change

Resolve the plugin root from this loaded skill: use expanded `${CLAUDE_PLUGIN_ROOT}` in Claude Code, or derive it in Codex from the absolute loaded path ending in `/skills/quick/SKILL.md`. Invoke `<plugin-root>/lib/adw-helper.mjs` and read the plugin version from the provider manifest there; never resolve resources from the project current working directory or write into the installed plugin.

Before editing, write a compact change contract in the interaction: outcome, rationale, explicit project-relative paths, exclusions, acceptance behavior, exact sourced validation commands, and documentation impact. Use a stable quick change id such as `quick-<date>-<slug>`.

Escalate to `adw:plan` immediately if the requested or discovered work involves any of the following:

- a public API or persisted schema change;
- a migration or data backfill;
- adding, removing, or upgrading a dependency;
- authentication, authorization, secrets, privacy, or other security behavior;
- infrastructure, deployment, release, CI/CD, or operational topology;
- more than one component or repository;
- a new capability rather than a local correction;
- uncertain behavior or design, ordered multi-step work, or scope that grows beyond the compact contract.

Do not start the larger work, split it into disguised quick changes, or silently expand the contract.

## Run preflight

Require a Git project with a clean worktree, no operation in progress, an existing configured base branch, and no detached HEAD. Do not stash or discard user work. Create or safely resume exactly one `adw/<quick-change-id>` branch from the configured base; inspect existing branch commits before resuming and never reset or rebase implicitly.

Reject absolute paths, traversal, symlink escapes, plugin paths, Git internals, `.adw`, `worktrees/`, the docs checkout, and paths outside the project root. Require every command and `cwd` to come from an observable project source. Show exact commands before execution. Reject destructive, privileged, secret-exposing, remote-mutating, deploy, release, publish, merge, and force-push commands.

## Implement, test, and review

1. Implement only the compact contract on the one feature branch.
2. Add or update focused tests that prove the changed behavior, then run them.
3. Update affected authoritative code-coupled documentation on the same branch. Escalate if documentation reveals public, API, operational, cross-component, or architectural scope.
4. Review the whole diff against the exact base for correctness, security, regressions, scope, unintended files, secrets, documentation, and test quality. Fix in-scope defects and rerun affected checks. Escalate behavior or design discoveries.
5. Create intentional local commits only after the focused tests and whole-diff review pass. Never merge, deploy, release, publish, or force-push.

## Validate and preserve evidence

Run every configured required project command through the helper's `run-validation` command using exact project-relative working directories, timeouts, and required flags. Provide the quick change id, plugin version, 40-hex code commit, current docs commit, and timestamp.

Capture helper output even when it exits with `VALIDATION_FAILED`. Store the returned artifact unchanged at `changes/<quick-change-id>/validation.json` in the docs worktree, validate it with the helper, and commit the evidence locally on the docs branch. The artifact's `docs_commit` is docs `HEAD` immediately before the evidence write.

A required failure, signal, timeout, or deferral remains `failed`; never skip, relabel, hand-edit, or silently defer it. A failure prevents successful completion and draft-PR creation. Optional deferrals require a specific recorded reason.

Create or update one draft GitHub PR only after passed evidence and explicit user authorization for that external action. Push normally, reuse the exact branch's existing PR, and never mark ready, approve, merge, release, deploy, or force-push. Without authorization, report the local branch and commits as ready for the user's next decision.

Report the compact contract, branch, files, tests, review findings, code-coupled docs, code and evidence commits, actual validation results, and PR or authorization-needed state.
