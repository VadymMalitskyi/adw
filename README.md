# ADW

ADW is a private, dual-provider plugin that gives Codex and Claude Code the same Git-native development workflow:

```text
install -> init-greenfield | init-brownfield
        -> onboard -> status
                   -> plan -> approve -> execute -> draft PRs
                   -> quick for a genuinely small change
```

One opinionated workflow, portable across repositories, languages, build systems, code hosts, and work trackers. Portability comes from a small project configuration and provider adapters — not from a family of author-facing schemas.

You do not need to learn JSON Schema, policy digests, profile digests, approval manifests, payload profiles, or receipt schemas to use ADW. There are exactly two things a contributor authors: a plan, and a yes.

## The five concepts

1. The **docs branch** stores durable ADW context and plans, checked out at `worktrees/docs`.
2. Substantial changes use **plan → approve → execute**; small ones use **quick**.
3. **Phases run in order; groups inside a phase run in parallel**, each in its own branch and worktree.
4. **External writes always get a separate preview and authorization** — approving a plan authorizes local implementation, nothing else.
5. **ADW never merges, releases, or deploys.**

## One plan per change

A substantial change still has exactly one artifact: `changes/<change-id>/plan.md`. New projects also keep a complete, editable standard template at `adw/plan-templates/standard.md`. A project may rename headings, add required sections, remove unneeded presentation sections, or register additional complete templates. Four invisible markers preserve the semantic core ADW needs:

```markdown
<!-- ADW:PLAN 1 -->
<!-- ADW:REQUIRED-SECTIONS feature-overview acceptance-criteria implementation-plan whole-feature-validation -->
<!-- ADW:SECTION feature-overview -->
# Feature overview                <- headings and project sections are editable

<!-- ADW:SECTION acceptance-criteria -->
## Acceptance criteria

<!-- ADW:SECTION implementation-plan -->
# Implementation plan             <- phases, groups, paths, directives, commands

<!-- ADW:SECTION whole-feature-validation -->
## Whole-feature validation
```

To make a project-specific section mandatory, add it to the durable manifest and give it its own stable marker in the project template:

```markdown
<!-- ADW:REQUIRED-SECTIONS feature-overview security-review acceptance-criteria implementation-plan whole-feature-validation -->
<!-- ADW:SECTION security-review -->
## Security and privacy

Describe sensitive data, trust boundaries, threats, and mitigations.
```

The manifest must exactly match the template's ordered section markers. During creation, the planner also validates the rendered plan against the section list returned when it resolved the selected template; amendment validates against the pre-edit plan's list. The retained manifest then gives later read-only steps the durable contract without consulting a newer template revision. Adding or removing the manifest entry and marker in the committed template changes the requirement for future plans; it never re-renders an existing plan.

Anchors are grep-able `file -> symbol` references, never line numbers. The plan is immutable after approval: ticket ids, pull-request URLs, progress, and validation results live in machine-written run records, never in the plan. Changing the design means `adw:amend`, new plan bytes, and fresh approval.

Before a human ever sees it, the plan is red-teamed cold by `adw:review-plan` — a fresh agent that gets the plan and the repository but not the planning conversation. It checks every anchor against live code, phase dependency order, path overlap between parallel groups, whether validation commands are real, and whether each acceptance criterion maps to executable work.

## Approval and execution

Approval binds the exact plan bytes and the docs commit that contained them:

```json
{ "version": 1, "change_id": "tenant-throttling", "plan_path": "changes/tenant-throttling/plan.md",
  "plan_digest": "<sha256 of the exact plan bytes>", "plan_commit": "<40-hex docs commit>",
  "approved_by": "Ada Lovelace", "approved_at": "2026-08-13T12:00:00Z", "status": "active" }
```

Edit one byte of an approved plan and execution stops until you reapprove. You are never asked to read or copy a digest.

`adw:execute phase=<phase-id>` verifies the approval and its dependency phases, shows a bounded preview, writes a run record, prepares deterministic branches and worktrees, and then runs every group the phase declares concurrently through the active provider's native subagents. Each group runs implementation → independent review → fix every in-scope high-severity finding → truthful validation → coordinator scope check. Workers never commit, push, or touch external systems; the coordinator owns Git and every external action.

Interrupt it and start a new session: status and resume are reconstructed from Git branches, worktree markers, the approval, and the run records. No chat history required.

Two delivery strategies, neither of which merges anything: one draft pull request per group (default, with later phases waiting for humans to merge dependencies), or one draft integration pull request built from validated group branches.

## Project configuration

`adw.yaml` is small enough to read without documentation:

```yaml
adw: 1

git:
  base_branch: main

docs:
  branch: docs
  worktree: worktrees/docs

planning:
  default_template: standard
  templates:
    standard: adw/plan-templates/standard.md
    migration: adw/plan-templates/migration.md

execution:
  mode: orchestrated          # orchestrated | sequential
  isolation: provider-sandbox # provider-sandbox | project-devcontainer | managed-devcontainer

components:
  api:
    path: src/api
    validate:
      - dotnet test tests/Api.Tests
  web:
    path: apps/web
    validate:
      - npm test
      - npm run build

providers:                    # optional; omit what the project does not use
  code_host:
    provider: github
```

An explicit choice such as `adw:plan template=migration` wins over the ignored per-user `planning.preferred_template` in `.adw/local.yaml`, which wins over the project default. A user can select only a template declared by the project. Projects initialized before this feature remain valid and use the bundled standard template until they opt in.

A project with no providers and no devcontainer keeps the lightweight path: `provider-sandbox` isolation is the default, and nothing probes an external system.

## Security is proportional

Provider sandboxing is the lightweight default. An existing project devcontainer is preserved as-is. The hardened managed devcontainer — pinned agents, non-root user, fail-closed egress proxy, project-scoped credential volumes, generated permission policy — remains available and fully tested, but it is an explicit opt-in, not a prerequisite for adopting ADW. Ordinary contributors only ever see which isolation mode is configured and whether `adw:doctor` passes.

## Requirements

- Node.js 20 or newer for the bundled internal helper.
- Git 2.42 or newer (both initialization workflows use orphan worktree creation introduced in Git 2.42).
- A current Codex or Claude Code plugin manager.
- Docker plus a Dev Containers client **only** if you opt into the managed devcontainer.
- Provider tooling only when an integration or external delivery is requested. Credentials stay in the provider, MCP client, CLI, or external credential store.

## Private development installation

From the repository root, register the local marketplace and install `adw` in each provider:

```bash
codex plugin marketplace add /absolute/path/to/adw
codex plugin add adw@adw-local

claude plugin marketplace add /absolute/path/to/adw
claude plugin install adw@adw-local --scope user
```

Then start a new provider session in the target directory. Invoke `adw:init-greenfield` for a genuinely empty project or `adw:init-brownfield` for an established Git repository. Review the preview and approve explicitly before ADW writes anything. Greenfield initialization creates the first main commit; brownfield initialization leaves the generated main-branch files for the maintainer to commit. Make the docs branch available through the project's approved delivery path. Later contributors clone the initialized project, install ADW, and run `adw:onboard`; they never rerun either initializer. See [private installation](docs/private-installation.md) for tagged repositories, organization distribution, update, and rollback.

## Skills

- Foundation: `adw:init-greenfield`, `adw:init-brownfield`, `adw:onboard`, `adw:doctor`, `adw:status`, `adw:discover`
- Change loop: `adw:plan`, `adw:review-plan`, `adw:approve`, `adw:amend`, `adw:execute`
- Delivery: `adw:quick`, `adw:address-review`
- Operations and maintenance: `adw:investigate`, `adw:sync-docs`, `adw:update`

Workflows depend on capabilities — `work_tracker`, `code_host`, `observability`, `knowledge` — never on provider tool names. Provider references translate four operations (`read`, `create`, `update`, `link`) to a native, MCP, CLI, or API transport. See [integration architecture](docs/integrations.md).

## Development

```bash
npm test
npm run check:helper
npm run test:security
claude plugin validate --strict plugin
claude plugin validate --strict .claude-plugin/marketplace.json
```

ADW never merges, marks a pull request ready, releases, deploys, force-pushes, or performs an external write without explicit fresh authorization. Every authorized external mutation is idempotent where the provider permits it, read back for verification, and recorded as a stable id and concise outcome in the run record.
