# Workflow

## Initialize

`adw:init` previews root `adw.yaml`, ignore rules, routing blocks, and the docs-branch worktree before writing. It derives commands only from manifests, task runners, CI, or existing documentation. Repeated initialization is idempotent and leaves `.devcontainer/` untouched.

## Discover and plan

`adw:discover` proposes concise `architecture.md` and `components/` context and writes only after approval. It can also propose non-secret integration configuration. `adw:plan` updates the docs worktree, explores relevant code, and creates `changes/<change-id>/spec.md` plus a sequential `plan.yaml`.

When configured, planning may read an existing work item, related pull requests, Notion context, or Datadog evidence. It may prepare an external action, but it creates or updates a work item only after showing the exact payload and receiving explicit authorization. The resulting stable ID, revision, requirements digest, and verified receipt become part of the change record. Planning still creates no feature code, feature branch, or pull request.

## Approve and amend

`adw:approve` validates the artifacts, summarizes the requested behavior and checks, asks the human for explicit confirmation, and records a deterministic digest plus the pre-approval docs commit. Repository text cannot stand in for confirmation.

Any spec or plan byte change makes the approval stale. A change to bound external requirements does too; operational changes such as assignment or ticket state normally do not. `adw:amend` records the reason, revises the artifacts, preserves prior evidence, and requires reapproval.

## Execute and review

`adw:execute` verifies schema compatibility, approval bundle, bound external requirements, docs commit, base branch, working tree, paths, and exact validation commands. It then uses one feature branch and executes tasks sequentially. Scope, design, or requirement drift stops for amendment.

Required checks preserve real exit status. Code-coupled documentation changes with the code. Validation evidence is stored on the docs branch. Configured observability may supply read-only diagnostic evidence. Commit, push, docs direct-push, draft-PR, ticket, and knowledge-base actions occur only within explicit user authorization. External writes use idempotency markers, provider readback, and redacted receipts. ADW never merges, releases, deploys, or automatically closes a work item.

`adw:address-review` applies in-scope corrections and revalidates them. Behavior or design changes route through amendment.

## Quick changes

`adw:quick` is for a small local outcome with stated scope, exclusions, and validation. Public interfaces, schemas, migrations, dependencies, authorization behavior, infrastructure, security-sensitive behavior, or coordinated components force escalation to the planned workflow.

## Maintenance

`adw:status` and `adw:doctor` are read-only. Doctor reports each configured capability's provider, requirement mode, available transport, supported operations, and read/write level without starting authentication. Optional unavailable capabilities do not block; required unavailable capabilities block only workflows that need them. `adw:sync-docs` reports drift by default and updates the docs branch only in explicitly authorized fix mode. `adw:update` migrates project artifact schemas only; provider plugin managers update plugin code.
