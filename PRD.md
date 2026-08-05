# Agentic Development Workflow (ADW)

## Product Requirements Document

**Status:** Approved for private MVP implementation
**Audience:** Product owner and implementers
**Last updated:** 2026-08-05

## 1. What ADW is

ADW is one private, versioned plugin repository for Codex and Claude Code. The plugin is installed through each provider's plugin manager and exposes one shared workflow skill tree.

It teaches either agent the same development workflow:

```text
understand the repository
    -> write a specification
    -> obtain explicit human approval
    -> implement the approved change
    -> run real project checks
    -> prepare a draft pull request
```

ADW stores project configuration on the code branch and stores concise project context, specifications, approvals, and validation evidence on a separate `docs` branch so work can survive chat sessions and move between agents.

The user interacts with ADW through namespaced skills such as `adw:plan`, `adw:approve`, and `adw:execute`.

There is no `adw` CLI, daemon, server, scheduler, or custom agent runtime.

## 2. Why ADW exists

Codex and Claude Code are capable of exploring, editing, testing, and reviewing code. ADW does not replace those capabilities. It gives them a shared operating contract.

Without that contract:

- Repository setup and instructions are recreated for every project.
- Important requirements remain only in chat history.
- An agent can begin implementation before the intended behavior is clear.
- Different agents follow different planning and validation conventions.
- A later session cannot reliably tell what was approved or tested.
- Agents may describe validation as successful without preserving the actual commands and results.

ADW makes the workflow durable, reviewable, and consistent while leaving coding and reasoning to the active agent.

## 3. Product goal

A developer can privately install ADW for Codex and Claude Code, initialize a Git repository with only project-specific artifacts, and take a meaningful change from idea to validated draft pull request without learning or installing another command-line tool.

The first release is successful when this workflow is useful on real projects and feels lighter than repeatedly prompting the agent by hand.

## 4. How the user experiences ADW

### 4.1 Initial setup

The developer installs the private ADW plugin using the normal plugin mechanism of Codex or Claude Code, opens a target repository, and asks the agent to use `adw:init`.

`adw:init`:

1. Inspects the repository, existing instructions, CI files, manifests, documentation, and any existing devcontainer.
2. Identifies components and supported build, lint, test, and formatting commands.
3. Shows the proposed ADW files and changes.
4. Creates root-level `adw.yaml`, ignores `.adw/` and `/worktrees/`, and creates or attaches the `docs` branch at `worktrees/docs`.
5. Adds only small bounded ADW routing blocks to existing `AGENTS.md` and `CLAUDE.md` files.
6. Creates concise project context on the docs branch and optional ignored machine-local configuration.
7. Leaves every devcontainer unchanged unless the user separately requests a devcontainer change.
8. Reports what is ready, unresolved, or requires manual authentication.

After initialization, the repository contains only project-specific ADW artifacts. Skills, schemas, templates, and helper programs remain in the installed plugin and are never copied into the target project.

### 4.2 Planned feature

The normal interaction is conversational:

```text
User: Use adw:plan to plan OAuth login.
Agent: Explores the repository, asks material questions, and writes the spec and plan.

User: Use adw:approve for oauth-login.
Agent: Shows the final scope and validation plan, asks for confirmation, and records approval.

User: Use adw:execute for oauth-login.
Agent: Checks approval, implements the plan, runs the configured checks, and prepares a draft PR.
```

The user does not run an ADW shell command at any point.

### 4.3 Small change

For a local, low-risk change, the developer invokes `adw:quick`.

Quick mode requires:

- One-sentence intended outcome.
- Expected code area.
- Validation to run.
- Explicit exclusions.

Quick mode must stop and route to `adw:plan` if the change introduces a public API change, schema or migration, new dependency, authentication or authorization behavior, infrastructure design, or coordinated changes across components.

### 4.4 Interrupted work

A new Codex or Claude Code session can use `adw:status` to reconstruct the current state from repository artifacts, Git, validation evidence, and any existing draft PR. It must not depend on the previous chat transcript.

## 5. Product architecture

ADW has four parts.

### 5.1 Skills are the user interface

Skills contain the workflow instructions for Codex and Claude Code. They tell the active agent:

- What repository context to inspect.
- Which decisions require the user.
- Which files to create or update.
- When implementation must stop.
- What evidence is required before claiming completion.
- Which external side effects need explicit authorization.

The two provider manifests expose the same physical skill tree, behavior, and artifact formats. Provider-specific files contain packaging only; the workflow has one canonical source.

### 5.2 Repository artifacts are the state

ADW has no workflow database. Durable state lives in ordinary files and Git across the code and docs branches:

```text
code branch:
  adw.yaml
  .adw/local.yaml        # ignored
  worktrees/docs/        # ignored docs-branch checkout

docs branch:
  architecture.md
  components/
  changes/<change-id>/
    spec.md
    plan.yaml
    approval.json
    validation.json
  SYNC.yaml
```

The initialized repository contains thin routing blocks but no provider skill files, schemas, templates, or helpers.

### 5.3 Internal helpers perform fragile mechanics

Skills may call small plugin-bundled helper programs for operations that should not be improvised by a language model, including:

- Schema validation.
- Computing and comparing approval digests.
- Running configured validation commands and recording exit codes.
- Checking workflow-schema compatibility.
- Applying an artifact migration without leaving a partial result.

These helpers are implementation details used by the skills. They do not form a public CLI, have no user-facing command vocabulary, and must not become an orchestration platform.

Where a standard project or operating-system tool is sufficient, the skill uses that tool instead of adding an ADW helper.

### 5.4 The active agent performs the work

Codex or Claude Code remains responsible for:

- Understanding the repository.
- Drafting the specification and plan.
- Editing code and tests.
- Reviewing the diff.
- Running tools through its normal execution environment.
- Reporting findings, deviations, and unresolved questions.

ADW never launches or supervises an agent process.

## 6. Core workflow contract

### 6.1 Plan

For a meaningful change, `adw:plan` must:

1. Explore the relevant code and existing conventions.
2. Identify the real project commands that can validate the change.
3. Ask only questions that cannot be answered from the repository.
4. Write a human-readable specification.
5. Write a sequential execution plan.
6. Present assumptions, risks, exclusions, and open decisions.

Planning must not modify production code, create a feature branch, or open a pull request.

### 6.2 Approve

`adw:approve` must:

1. Validate the specification and plan.
2. Show the outcome, scope, exclusions, and validation plan.
3. Ask the human for explicit confirmation.
4. Record the approver, time, schema version, and digest of the approved files.

Any material change to the specification or plan invalidates the approval.

Approval is a tamper-evident personal workflow, not an enterprise authorization system.

### 6.3 Execute

`adw:execute` must:

1. Confirm that the specification and plan exist.
2. Confirm that approval still matches their current contents.
3. Check that the base branch, working tree, referenced paths, and validation commands are usable.
4. Create or reuse one feature branch.
5. Implement tasks in plan order.
6. Add or update tests with the behavior.
7. Review the complete diff against the specification.
8. Run the configured validation commands.
9. Record each command, exit code, duration, and any explicitly deferred check.
10. Commit and prepare a draft pull request when authorized.

The agent must not claim successful completion when a required check failed.

The agent must stop for renewed approval if implementation requires a change to behavior, public interfaces, data shape, dependencies, architecture, or agreed scope.

### 6.4 Amend

`adw:amend` records why an approved change must be revised, updates the specification and plan, and invalidates the previous approval. Affected implementation cannot continue until the new contents are approved.

### 6.5 Review feedback

`adw:address-review` classifies feedback as one of:

- An in-scope correction that can be implemented and revalidated.
- A clarification that needs a response but no code change.
- A design or scope change that requires `adw:amend` and new approval.

## 7. Skill surface

### Required MVP skills

| Skill | Responsibility | Writes by default? |
|---|---|---:|
| `adw:init` | Initialize project artifacts and the docs worktree | Yes, after preview |
| `adw:update` | Preview and apply required project artifact migrations | Yes, after confirmation |
| `adw:doctor` | Diagnose compatibility, context, safety, and integration problems | No |
| `adw:status` | Reconstruct current work from durable artifacts | No |
| `adw:discover` | Propose concise project and component context | Only after approval |
| `adw:plan` | Create or revise a specification and execution plan | Yes |
| `adw:approve` | Record explicit approval bound to current contents | Yes, after confirmation |
| `adw:execute` | Implement an approved plan, validate it, and prepare a draft PR | Yes |
| `adw:quick` | Implement a small, low-risk change using a reduced contract | Yes |
| `adw:amend` | Change an approved specification and invalidate approval | Yes |
| `adw:address-review` | Triage and address pull-request feedback | Only when requested |
| `adw:sync-docs` | Report documentation drift; update only when authorized | No |

### Optional supporting skills

| Skill | Responsibility |
|---|---|
| `adw:brainstorm` | Explore a fuzzy idea without creating durable artifacts |
| `adw:review-plan` | Adversarially review a plan without editing or approving it |
| `adw:add-mcp` | Add a requested MCP connection without storing credentials |

Skills that write files, change branches, push commits, open pull requests, modify external systems, or start authentication must run only on an explicit user request.

## 8. Artifact contracts

### 8.1 Project configuration

Root-level `adw.yaml` is committed and contains only shared project facts:

- Workflow schema and default branch.
- Components and their paths.
- Setup, formatting, lint, test, and build commands.
- Protected paths.
- Draft pull-request conventions.
- Quick-change restrictions.

Detected values must be derived from manifests, CI, task runners, or existing documentation and shown for review. ADW must not invent plausible commands.

Secrets, developer identity, host paths, and personal authentication configuration belong in ignored `.adw/local.yaml` or external credential stores.

### 8.2 Specification

`changes/<change-id>/spec.md` on the docs branch states:

- The problem and desired outcome.
- Observable behavior that will change.
- Scope and explicit non-goals.
- Important decisions and rejected alternatives.
- Risks and edge cases.
- Acceptance criteria.
- Documentation impact (`none`, `update`, or `new`) and affected files.

### 8.3 Plan

`changes/<change-id>/plan.yaml` on the docs branch contains:

- Affected components.
- Relevant files or symbols.
- Ordered implementation tasks.
- Expected file areas.
- Acceptance criteria mapped to tasks.
- Exact validation commands.
- Restrictions and known dependencies.

The MVP uses one sequential task list. Parallel execution is out of scope.

### 8.4 Approval

`approval.json` contains:

- Change identifier.
- Approver from local Git identity or explicit local configuration.
- Timestamp.
- Digest of `spec.md` and `plan.yaml`.
- ADW schema version.
- Installed plugin version and approved docs commit SHA.

### 8.5 Validation evidence

`changes/<change-id>/validation.json` on the docs branch contains the plugin version and, for every configured check:

- Exact command.
- Start time and duration.
- Exit code.
- Short output summary or log reference.
- Status: passed, failed, or deferred.
- Reason and user authorization for any deferred required check.

## 9. Installation, ownership, and updates

The private ADW repository contains a Codex manifest, a Claude Code manifest, and one shared skill, schema, template, and helper tree. Personal marketplaces point both providers at that plugin root; an organization may later mirror the same tagged repository and grant read access to selected users.

ADW distinguishes three kinds of files:

1. **Plugin-owned files:** skills, schemas, templates, and internal helpers distributed by provider plugin managers and absent from target projects.
2. **Project-owned files:** `adw.yaml`, routing blocks, authoritative project docs, docs-branch context, and change records.
3. **Machine-local files:** credentials, identity overrides, host paths, caches, and local authentication state under ignored `.adw/` paths.

Plugin managers install, pin, update, and roll back plugin code. A compatible plugin update modifies no target-project files. `adw:update` handles only workflow-schema migrations: it previews a reviewable change, applies it after confirmation, and never rewrites historical specifications, approvals, or validation evidence. A failed migration must leave the previous project schema usable.

No background check may apply an update or change repository files.

## 10. Execution environment and security

The default execution boundary is the active agent's existing sandbox and permission model. ADW uses it without installing or changing a container.

Devcontainer support is optional. `adw:init` never creates or edits `.devcontainer/`; a separate explicit request is required for any such change, and existing image, features, mounts, and lifecycle behavior must be preserved unless the user authorizes specific differences.

The security model must be described honestly:

- A skill is guidance, not a security boundary.
- Agent permission rules and hooks are guardrails, not perfect isolation.
- A writable repository remains writable from the selected execution environment.
- An allowed network destination can receive repository data.
- ADW does not protect against malicious project dependencies.
- Production credentials and production write access are out of scope.

ADW must never commit secrets or machine-local authentication state.

## 11. Git and delivery policy

The default workflow uses:

- One active agent.
- One feature branch per planned change.
- One sequential plan.
- One draft GitHub pull request.
- The repository's existing CI and human review process.

ADW may create or update a draft pull request only after explicit user authorization. It may report CI results and address review feedback when asked.

ADW must never merge, release, deploy, write to production systems, or dispatch unrelated workflows.

## 12. MVP scope

### Must have

- Equivalent Codex and Claude Code skills loaded from one canonical workflow source.
- Private personal marketplace installation, with a documented path to organization-private distribution.
- Repository-aware initialization without an ADW CLI.
- Concise project and component discovery.
- Git-native specification, plan, approval, and validation artifacts.
- Approval invalidation when approved contents change.
- Deterministic recording of real validation results.
- Planned and quick-change workflows.
- One-branch implementation and draft GitHub pull-request delivery.
- A separate docs branch checked out at ignored root-level `worktrees/docs`.
- Safe separation of plugin-owned, project-owned, and machine-local files.
- Read-only diagnostics and status reconstruction.
- Clear security and credential boundaries.

### Not in the MVP

- An `adw` executable or public command API.
- Headless invocation of Codex or Claude Code.
- A hosted service, dashboard, workflow database, or telemetry.
- Multi-agent scheduling or parallel worktrees.
- Automatic merging or deployment.
- A universal ticket-system abstraction.
- Notion, Jira, Linear, or Azure DevOps as required dependencies.
- Public marketplace publication or third-party executable profiles.
- Cryptographic or enterprise-grade approval enforcement.
- Support for source-control hosts other than GitHub.

## 13. Quality requirements

- **Understandable:** A developer can explain what ADW installed and what each artifact means.
- **Inspectible:** All workflow state and generated configuration are ordinary readable files.
- **Recoverable:** An interrupted skill leaves valid artifacts or clearly reports incomplete work.
- **Idempotent:** Repeating initialization or an update does not create duplicate or unrelated changes.
- **Portable:** Provider-neutral artifacts behave the same with Codex and Claude Code.
- **Accurate:** Validation uses real process exit codes; project commands come from observable repository sources.
- **Private:** No telemetry; no source code or prompts are sent to an ADW-operated service.
- **Maintainable:** Shared behavior has one canonical source and provider packages are contract-tested.

## 14. MVP acceptance criteria

The MVP is complete when all of the following work on at least two different real repositories:

1. A developer privately installs the ADW plugin and invokes `adw:init` without installing or running an ADW CLI.
2. Initialization preserves existing project instructions and devcontainer behavior.
3. Codex and Claude Code expose equivalent required skills and produce the same artifact formats.
4. Project discovery identifies accurate component paths and validation commands.
5. A developer creates and reviews a specification and sequential plan.
6. `adw:approve` records explicit human approval bound to the current contents and docs commit.
7. Editing the approved specification or plan causes execution to stop until reapproval.
8. Either agent implements the plan on one feature branch.
9. Required checks are actually executed and their exit codes are recorded.
10. A failed required check prevents a successful completion claim.
11. The agent can prepare a draft GitHub pull request but cannot merge it.
12. A quick change that becomes risky or cross-cutting is routed to the planned workflow.
13. A new session can reconstruct work using `adw:status` without the old chat transcript.
14. Machine-local values and credentials remain outside committed files.
15. Compatible plugin updates touch no project artifacts; a required migration is previewed and cannot leave a partially updated project schema.

## 15. Product decisions

| Area | Decision |
|---|---|
| Product form | Privately installed dual-provider plugin plus durable project artifacts |
| User interface | Codex and Claude Code skills; no ADW CLI |
| Active agent | Started and controlled by the developer |
| Source of truth | Git repository |
| Required change document | Specification and sequential plan |
| Approval | Explicit human confirmation bound to file digests |
| Default execution | One agent, one branch, sequential tasks |
| Validation | Existing project commands with recorded process results |
| Safety boundary | Use the agent's existing sandbox; devcontainers are optional |
| Delivery boundary | Draft GitHub pull request |
| Merge and deployment | Always human-controlled and outside ADW |
| External systems | Optional; never required for the core workflow |
| Telemetry | None |

## 16. Final product statement

ADW is a shared way of working with coding agents, packaged as one private dual-provider plugin plus project-specific repository artifacts.

It does not compete with Codex or Claude Code and does not add another tool the developer must operate. It gives those agents a durable specification, an explicit approval boundary, known project commands, and a consistent definition of done.

If the installed skills and project artifacts do not make real feature work clearer and safer than an ordinary agent conversation, ADW has not earned its place.
