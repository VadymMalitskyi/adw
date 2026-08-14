---
name: quick
description: Implement a genuinely small, low-risk ADW change on exactly one branch with focused tests, whole-diff review, truthful validation recorded in a run record, and an optional separately authorized draft pull request. Use when the user explicitly requests quick mode for a narrow local correction that needs no plan and no approval.
---

# Execute a quick change

Use quick mode only for a narrow, already-understood local correction. It removes the plan and the approval step; it removes none of the branch, path, review, testing, validation, evidence, documentation, or delivery safety.

## Resolve and bound the change

Resolve the installed plugin root from this loaded skill: use the expanded `${CLAUDE_PLUGIN_ROOT}` in Claude Code, or in Codex remove `/skills/quick/SKILL.md` from the absolute loaded source location advertised for this skill. Invoke `<plugin-root>/lib/adw-helper.mjs`, read `<plugin-root>/execution/contracts.md` and `<plugin-root>/integrations/contracts.md`, and read the plugin version from the provider manifest there. Never resolve a resource from the project or current working directory, and never write into the installed plugin. Project conventions may shape names and draft-pull-request formatting; they never weaken quick-mode safety, validation, fresh external authorization, or the no-merge rule.

Load `adw.yaml` with the helper's `load-project` command and use only its parsed `data`. Enforce `execution.isolation` through the execution contract before any project command or edit. Report the configured and active boundary; a weaker active boundary requires explicit confirmation for this quick change.

Determine which components own the change by matching each explicit project-relative path against `components[].path`, choosing the longest matching component path. Run the de-duplicated union of every matching component's `validate` entries plus any root component that owns `.`, using the helper's `resolve-validation` command. Never omit a required component command and never invent one. A path that no component owns, or that would pull in a second component, escalates to `adw:plan`.

Resolve only configured `work_tracker`, `code_host`, `observability`, and `knowledge` capabilities, keeping providers separate from `native|mcp|cli|api` transports, and honor `required: true|false` and absence. Scoped external reads may help bound or diagnose the correction. When no provider is configured, keep the lightweight local workflow unchanged and probe nothing.

Before editing, write a compact change contract in the interaction: outcome, rationale, explicit project-relative paths, exclusions, acceptance behavior, exact sourced validation commands, and documentation impact. Use a stable quick change id such as `quick-<date>-<slug>`.

Escalate to `adw:plan` immediately if the requested or discovered work involves any of the following:

- a public API or persisted schema change;
- a migration or data backfill;
- adding, removing, or upgrading a dependency;
- authentication, authorization, secrets, privacy, or other security behavior;
- infrastructure, deployment, release, CI/CD, or operational topology;
- more than one component or repository;
- work that depends on other work, or that other work must wait for;
- a design change, a new capability, or a decision a reviewer would want recorded;
- uncertain behavior, ordered multi-step work, or scope that grows beyond the compact contract.

Do not start the larger work, split it into disguised quick changes, or silently expand the contract.

## Run preflight

Require a Git project with a clean checkout, no operation in progress, an existing configured base branch, and no detached HEAD. Never stash or discard user work. Create or safely resume exactly one `adw/<quick-change-id>` branch from the configured base; inspect its existing commits before resuming and never reset or rebase implicitly. Quick mode uses that one branch and the ordinary project checkout: it never prepares an extra isolated checkout and never splits work across more than one branch.

Reject absolute paths, `..`, NULs, symlink escapes, plugin paths, Git internals, `.adw`, `worktrees/`, the docs checkout, and anything outside the project root. Require every command and working directory to come from `adw.yaml` or another observable project source. Show the exact commands before running them. Reject destructive, privileged, secret-exposing, remote-mutating, deploy, release, publish, merge, and force-push commands.

## Implement, test, and review

1. Implement only the compact contract on that one branch.
2. Add or update focused tests that prove the changed behavior, then run them.
3. Update affected authoritative code-coupled documentation on the same branch. Escalate if documentation reveals public, API, operational, cross-component, or architectural scope.
4. Review the whole diff against the exact base for correctness, security, regressions, scope, unintended files, secrets, documentation, and test quality. Fix in-scope defects and rerun affected checks. Escalate behavior or design discoveries.
5. Create intentional local commits only after the focused tests and the whole-diff review pass. Never merge, deploy, release, publish, or force-push.

## Validate and preserve evidence

Run the resolved component commands plus the focused quick checks through the helper's `run-validation` command using exact project-relative working directories, timeouts, and required flags, with an ISO timestamp.

Capture helper output even when it exits with `VALIDATION_FAILED`. Store the evidence in a run record rather than a standalone artifact:

1. Compute the digest of the exact compact change contract text with the helper's `digest` command.
2. Build the record with `create-run-record` using the quick change id, phase id `quick`, that digest as `plan_digest`, the configured base branch, the exact 40-hex base commit, an ISO timestamp, and one group `quick` whose branch is `adw/<quick-change-id>`, whose worktree is `.`, whose tasks are the contract's directives, and whose affected paths are the contract's paths.
3. Move the group forward with `update-run-record` as work proceeds, attach the helper's returned validation evidence unchanged, and set the whole-diff review outcome.
4. Write the record to `changes/<quick-change-id>/runs/quick.json` in the docs checkout and commit it locally on the docs branch. There is no separate validation artifact.

A required failure, signal, timeout, or deferral remains `failed`; never skip, relabel, hand-edit, or silently defer it. The helper refuses a passed record that contradicts its own evidence. A failure prevents successful completion and any draft pull request. An optional deferral needs a specific recorded reason.

Create or update one draft pull request only after passed evidence, an explicit delivery request, and explicit user authorization for the exact push and pull-request payload. Use the configured `code_host`; when no provider is configured, `integrations/contracts.md` permits inferring one from a single unambiguous existing Git remote for this explicit request. Stop after local commits when the host is ambiguous or unsupported. Follow that contract for the preview, fresh authorization, idempotency marker, reuse of the exact head branch's existing pull request, and readback, and record the resulting id, URL, and outcome in the run record. Never mark ready, approve, merge, release, deploy, or force-push.

Report the compact contract, branch, files, tests, review findings, code-coupled documentation, code and run-record commits, the actual result of every check, and the pull-request or authorization-needed state.
