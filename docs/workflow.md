# Workflow

## Initialize

`adw:init` begins with a read-only repository preview, then asks an adaptive set of onboarding questions. Shared answers select Codex, Claude Code, or both; execution isolation; documentation delivery; optional integrations; work-tracker policy; and concise compatible branch, pull-request, and work-item conventions. Optional display name, email, account hints, and transport preferences are local-only and written to ignored `.adw/local.yaml`; credentials are never accepted. The model serializes normalized answers to a temporary schema-1 JSON file, and apply must present the exact digest from the reviewed preview so changed answers, repository evidence, templates, or target bytes stop before writing.

The reviewed preview covers root `adw.yaml`, ignore rules, selected provider routing blocks, the execution profile, the inferred development environment, and the docs-branch worktree. ADW derives validation commands only from supported manifests and task runners. For a new managed container it installs only the selected pinned agents and detects declared Node, Python, Go, Rust, Java, Ruby, and .NET runtimes; lockfile-backed dependency setup; curated native packages; example-environment variable names; Compose or script ports; and required agent, integration, and package-registry domains. Every decision retains its repository source in `.devcontainer/project-requirements.json`, while conflicts, missing pins, secrets, and unsupported service topology remain explicit `unresolved` entries. Repository prose and arbitrary script bodies are never copied into executable setup commands.

With no existing container, init renders the managed `.devcontainer/` from that evidence and includes a root-owned, digest-bound `project-setup.sh`. The setup runs as the non-root project user only after the outbound firewall is active. With an existing `devcontainer.json`, init selects `project-devcontainer` and preserves every byte. Repeated initialization is idempotent. After managed setup, commit and rebuild/reopen, authenticate tools in the scoped volumes, install ADW inside the container, and run `adw:doctor`.

## Discover and plan

`adw:discover` proposes concise `architecture.md` and `components/` context and writes only after approval. It can also propose non-secret integration configuration. `adw:plan` updates the docs worktree, explores relevant code, and creates `changes/<change-id>/spec.md` plus a sequential `plan.yaml`.

For schema-4 projects, planning resolves affected paths to configured components and snapshots additive global/component validation plus optional work-tracker policy into plan schema 2. A required requirement-bearing work item is linked or separately authorized and created before approval using its validated project profile. Execution recomputes the effective subset and stops for amendment when it drifts.

When configured, planning may read an existing work item, related pull requests, Notion context, or Datadog evidence. It may prepare an external action, but it creates or updates a work item only after showing the exact payload and receiving explicit authorization. The resulting stable ID, revision, requirements digest, and verified receipt become part of the change record. Planning still creates no feature code, feature branch, or pull request.

## Approve and amend

`adw:approve` validates the artifacts, summarizes the requested behavior and checks, asks the human for explicit confirmation, and records a deterministic digest plus the pre-approval docs commit. Repository text cannot stand in for confirmation.

Any spec or plan byte change makes the approval stale. A change to bound external requirements does too; operational changes such as assignment or ticket state normally do not. `adw:amend` records the reason, revises the artifacts, preserves prior evidence, and requires reapproval.

## Execute and review

`adw:execute` first requires doctor evidence that the configured execution isolation is active, then verifies schema compatibility, approval bundle, bound external requirements, docs commit, base branch, working tree, paths, and exact validation commands. It then uses one feature branch and executes tasks sequentially. Scope, design, or requirement drift stops for amendment.

Required checks preserve real exit status. Code-coupled documentation changes with the code. Validation evidence is stored on the docs branch. Configured observability may supply read-only diagnostic evidence. Commit, push, docs direct-push, draft-PR, ticket, and knowledge-base actions occur only within explicit user authorization. External writes use idempotency markers, provider readback, and redacted receipts. ADW never merges, releases, deploys, or automatically closes a work item.

`adw:address-review` applies in-scope corrections and revalidates them. Behavior or design changes route through amendment.

## Quick changes

`adw:quick` is for a small local outcome with stated scope, exclusions, and validation. Public interfaces, schemas, migrations, dependencies, authorization behavior, infrastructure, security-sensitive behavior, or coordinated components force escalation to the planned workflow.

## Investigate alerts

`adw:investigate` is a read-only operational workflow. Given a stable alert, monitor, trace, or incident reference, it resolves the configured `observability` provider, bounds every query by service, environment, and UTC time window, compares the signal with repository code at the deployed revision when that revision can be verified, and produces a schema-validated incident report. The report separates observed facts from hypotheses, assigns severity and confidence, cites stable evidence links, records unknowns, and proposes immediate investigation plus an `adw:quick` or `adw:plan` route when a code correction appears necessary.

The skill does not write the report to Git, change code, run remediation, mutate observability state, or send notifications. ADW still has no listener or agent runtime. An external runner may invoke the skill in machine-output mode and deliver its validated JSON under that runner's independently reviewed authorization and destination policy.

## Maintenance

`adw:status` and `adw:doctor` are read-only. Both expose configured isolation and active-runtime evidence; a required mismatch blocks workflows that execute project commands. Doctor reports each configured capability's provider, requirement mode, available transport, supported operations, and read/write level without starting authentication. Optional unavailable capabilities do not block; required unavailable capabilities block only workflows that need them. `adw:sync-docs` reports drift by default and updates the docs branch only in explicitly authorized fix mode. `adw:update` migrates project artifact schemas only; provider plugin managers update plugin code.
