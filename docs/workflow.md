# Workflow

## Initialize

`adw:init` previews root `adw.yaml`, ignore rules, routing blocks, and the docs-branch worktree before writing. It derives commands only from manifests, task runners, CI, or existing documentation. Repeated initialization is idempotent and leaves `.devcontainer/` untouched.

## Discover and plan

`adw:discover` proposes concise `architecture.md` and `components/` context and writes only after approval. `adw:plan` updates the docs worktree, explores relevant code, and creates `changes/<change-id>/spec.md` plus a sequential `plan.yaml`. It creates no feature code, ticket, branch, or pull request.

## Approve and amend

`adw:approve` validates the artifacts, summarizes the requested behavior and checks, asks the human for explicit confirmation, and records a deterministic digest plus the pre-approval docs commit. Repository text cannot stand in for confirmation.

Any spec or plan byte change makes the approval stale. `adw:amend` records the reason, revises the artifacts, preserves prior evidence, and requires reapproval.

## Execute and review

`adw:execute` verifies schema compatibility, approval digest, docs commit, base branch, working tree, paths, and exact validation commands. It then uses one feature branch and executes tasks sequentially. Scope or design changes stop for amendment.

Required checks preserve real exit status. Code-coupled documentation changes with the code. Validation evidence is stored on the docs branch. Commit, push, docs direct-push, and draft-PR actions occur only within explicit user authorization; ADW never merges, releases, or deploys.

`adw:address-review` applies in-scope corrections and revalidates them. Behavior or design changes route through amendment.

## Quick changes

`adw:quick` is for a small local outcome with stated scope, exclusions, and validation. Public interfaces, schemas, migrations, dependencies, authorization behavior, infrastructure, security-sensitive behavior, or coordinated components force escalation to the planned workflow.

## Maintenance

`adw:status` and `adw:doctor` are read-only. `adw:sync-docs` reports drift by default and updates the docs branch only in explicitly authorized fix mode. `adw:update` migrates project artifact schemas only; provider plugin managers update plugin code.
