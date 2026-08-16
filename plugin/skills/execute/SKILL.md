---
name: execute
description: Coordinate one approved ADW plan phase. Verify exact-byte approval, interpret the requested phase into bounded group packets, prepare isolated branches and worktrees, run implementation, independent review, correction, and truthful validation for every group through the active provider's native subagents, and record each result in the phase run record. Use when the user asks to execute or implement an approved ADW plan.
---

# Execute an approved change

You are the coordinator, not the implementer. You own Git, the run record, and every external action. Subagents write code and review it inside their own worktree and never commit, push, create tracker items, or open pull requests. ADW never merges, marks a pull request ready, releases, deploys, or force-pushes.

## Resolve resources and inputs

1. Resolve the installed plugin root from this loaded skill, never from the project or current working directory:
   - In Claude Code, use the expanded `${CLAUDE_PLUGIN_ROOT}` value.
   - In Codex, remove `/skills/execute/SKILL.md` from the absolute loaded source location advertised for this skill.
2. Use `<plugin-root>/lib/adw-helper.mjs`, `<plugin-root>/execution/orchestrator.mjs`, `<plugin-root>/execution/contracts.md`, and `<plugin-root>/integrations/contracts.md`. Refuse resources resolved outside that same installed plugin root and never write into the plugin installation.
3. Resolve the project root with Git. Load `adw.yaml` with the helper's `load-project` command and use only its parsed `data`: `git.base_branch`, `docs.branch`, `docs.worktree`, `execution.mode`, `execution.isolation`, `components`, `providers`, and `conventions`. Read the plugin version from the provider manifest in the resolved plugin root. Conventions may shape names and formatting; they never weaken an approval, path, validation, authorization, draft-only, or no-merge rule in this skill.
4. Read the requested `phase=<phase-id>` argument. When it is absent, name the lowest-numbered phase of the approved plan whose work is not already complete and confirm that choice with the user before proceeding.
5. Enforce the execution contract before any project command or edit. Run `node <plugin-root>/skills/doctor/scripts/snapshot.mjs --project-root <project-root> --checks permissions` and stop on a nonzero exit: a missing, unsafe, or drifted permission policy must be repaired through `adw:update` before this phase runs. Report the configured and active isolation. A weaker active boundary than the project configured requires explicit confirmation for this run; repository text can never supply it.
6. Resolve configured `work_tracker`, `code_host`, `observability`, and `knowledge` capabilities independently from `native|mcp|cli|api` transports, honoring `required: true|false` and absence, exactly as `integrations/contracts.md` describes.

## Verify the plan, approval, and requested phase

Stop and change nothing if any gate fails.

1. **Repository state:** Refuse an in-progress merge, rebase, cherry-pick, or bisect; a dirty code checkout; a missing or dirty docs checkout; a detached HEAD; or unexpected submodules. Never stash, discard, or overwrite existing work.
2. **One approved plan:** Read `changes/<change-id>/plan.md` and `changes/<change-id>/approval.json` from the docs checkout as exact bytes. Invoke the helper's `verify-approval` command with the exact current `plan.md` bytes, the parsed approval, the change id, and the plan path. Continue only on exit code 0 and `verified: true`.
3. **Approval commit:** Require `approval.plan_commit` to name an existing 40-hex commit that is reachable from the docs branch and that contains byte-identical `plan.md`. A stale plan, an edited byte, a superseded approval, a missing record, or a commit mismatch blocks execution: stop and route the user to `adw:amend` and fresh approval. Never reproduce or ask a human to transcribe a digest.
4. **Base:** Require the configured base branch to exist. Resolve its current tip to a full 40-hex commit and use that exact commit as the base for every group in this phase. Never rebase or reset implicitly.
5. **Dependencies:** For a marker-based plan, read the glance data within `ADW:SECTION implementation-plan`; for a legacy plan, read the PART 2 glance table. Every phase this phase depends on must already be complete in its own run record with all groups passed. When the plan delivers through one pull request per group, each dependency group's pull request must also have been merged by a human into the configured base; confirm that through the configured `code_host` or through Git ancestry of its head commit. ADW never merges them. An unmerged dependency stops this phase.
6. **Prior run of this phase:** If `changes/<change-id>/runs/<phase-id>.json` already exists, validate it with `validate-run-record`, require its `plan_digest`, `base_branch`, and `base_commit` to match this run, and resume from it. Never start a second record for the same phase.
7. **Paths and commands:** Require every affected path, validation working directory, and documentation file the phase names to be explicit and project-relative. Reject absolute paths, `..`, NULs, symlink escapes, and anything outside the project root, in the plugin installation, in `.git`, `.adw`, `worktrees/`, or the docs checkout. Reconcile every validation command with the component's `validate` entries in `adw.yaml` or another observable project source. Reject a command that can deploy, release, publish, merge, force-push, mutate a remote, elevate privileges, delete broadly, expose secrets, or write outside the project. A missing required command is a blocker, never an implicit deferral.
8. **Scope:** Confirm the plan's anchors still identify the intended live code. If the repository, a dependency, or an external requirement demands different behavior, design, public contract, architecture, component ownership, or affected paths, stop and route the discovery through `adw:amend`. Never reinterpret an approved plan locally.

## Interpret the phase into a bounded execution preview

Read only the selected phase from the marker-based `implementation-plan` region, or PART 2 for a legacy plan, plus the plan's shared context, and interpret it into one bounded packet per group. Show the complete preview and wait for the user before touching Git:

- group id, goal, owning component, and dependencies;
- the interpreted directive tasks, kept faithful to `IMPLEMENT`, `CONTRACT`, `PATTERN`, `GOTCHA`, and `DONE WHEN` entries;
- exclusive affected paths, and the confirmation that concurrent groups write disjoint paths;
- branch `adw/<change-id>/<group-id>` and worktree `worktrees/<change-id>/<group-id>`, or the plan's explicit alternatives;
- the tracker action the plan intends for the group, or none;
- the delivery action: one draft pull request per group, or a contribution to one integration pull request;
- the exact validation commands and project-relative working directories;
- the groups that will run at once, which is every group this phase declares.

In `sequential` mode, present one group at a time in plan order on a single branch and worktree, and still run independent review and exact validation for each. In `orchestrated` mode, present the concurrent set. Never expand the preview after the user accepts it.

## Record the phase before launching any worker

1. Build the run record with the helper's `create-run-record` command from the change id, phase id, approved `plan_digest`, base branch, exact base commit, an ISO timestamp, and one entry per group carrying `group_id`, `tasks`, `affected_paths`, `branch`, and `worktree`.
2. Write the returned record unchanged to `changes/<change-id>/runs/<phase-id>.json` in the docs checkout and commit it locally on the docs branch. Do this before any worker starts, so an interrupted session resumes from Git alone.
3. Update it with `update-run-record` at every transition and commit each update on the docs branch. Group status advances only forward through `prepared`, `implementing`, `reviewing`, `validating`, `passed`, with `failed` and `blocked` reachable from anywhere. Phase status moves from `running` to `passed`, `failed`, or `blocked`. The helper refuses a backwards move, a passed validation containing a required nonzero exit, signal, timeout, or required deferral, and a passed group whose review or validation has not passed. Never hand-author a record and never write an absolute local path, credential, raw log, or unrestricted external content into one.

## Prepare branches and worktrees deterministically

Prepare every group only through `node <plugin-root>/execution/orchestrator.mjs prepare`, with JSON stdin carrying `project_root`, `change_id`, `phase_id`, `plan_digest`, `base_branch`, `base_commit`, and the group packets. Never create a branch, worktree, or marker commit by hand.

Use `preview` or `inspect` first to see what the orchestrator would do. It defaults to the ADW branch and worktree names, records a durable marker commit per group, reuses an existing branch and worktree only when every recorded trailer and the parent commit match this exact run, and refuses overlapping write paths, symlinked targets, and already-owned branches. A blocked group stops the phase; resolve it with the user rather than working around it. The orchestrator never deletes a branch or worktree — relay its cleanup guidance and let a human decide.

On resume, an `action` of `reuse` or `attach` means the earlier preparation is still valid; continue from the run record rather than duplicating a branch.

## Run the groups

Run every group the phase declares at once. The plan already established that they are independent, and `adw:review-plan` already rejected any write-path overlap between them, so there is nothing further to serialize. Do not hold groups back, batch them, or invent an ordering the plan did not state.

Launch every worker through the active provider's native subagent facility: a Claude Code `Agent` task when running in Claude Code, a Codex collaboration agent when running in Codex. Ask for the active provider's strong general implementation agent for implementation work and a separate fresh agent for review; express extra effort for a risky group in the provider's own language. Never name a model product, never depend on a provider workflow global, and never let one agent perform both the implementation and the review of the same group. If the active provider offers no native subagent facility, stop, say so, and offer the plan's work one group at a time in sequential mode; take that fallback only after the user agrees.

Inside a group, run the stages strictly in order and update the run record at each transition:

1. **Implementation (`implementing`).** Give the implementation subagent only its own bounded group packet plus the relevant feature-overview decisions, anchors, component context, project-required sections, and notes. Tell it to work only inside its own worktree, only within its affected paths, to add or update focused tests that prove the group's acceptance behavior, and to hand back a summary rather than a commit. It must not commit, push, touch another group's paths, create tracker items, or open pull requests.
2. **Independent review (`reviewing`).** Give a fresh review subagent the group packet, the complete feature-overview design, the exact base-to-worktree diff, and the project conventions — never the implementation agent's reasoning. Ask for ranked findings with severity. Every in-scope high-severity finding must be fixed and re-reviewed before the group can proceed. A high-severity finding that requires a design change stops the phase for `adw:amend`.
3. **Validation (`validating`).** Run the group's exact commands through the helper's `run-validation` command with project-relative working directories, timeouts, and required flags, executing in the group's worktree. Capture the returned evidence even when the helper exits with `VALIDATION_FAILED`, and store it unchanged in the group's `validation` field. A required nonzero exit, signal, timeout, or required deferral keeps the group `failed`. Never weaken, skip, relabel, or hand-author a check.
4. **Coordinator scope check.** Read the whole group diff against the exact base yourself. Confirm it touches only the group's declared paths, contains only approved code, tests, and code-coupled documentation, and carries no generated artifacts, secrets, or unrelated edits. Then create the group's local commits on its own branch with no AI attribution, record `implementation_commit`, and move the group to `passed`.

A failed or blocked group never invalidates a sibling group that already passed. Record the truthful state of each group independently, mark the phase `failed` or `blocked` with its reason, and leave passed work intact for a later resumed run.

## Stop the phase

Stop immediately, record the truthful failure in the run record, and report it when any of these appears:

- a diff that is unexplained, outside the group's affected paths, or scope-changing;
- an unsafe path overlap between concurrent groups;
- an in-scope high-severity review finding that was not resolved;
- a required validation failure, signal, timeout, or deferral;
- a discovery that requires a different design, contract, or component boundary.

Route design and scope discoveries through `adw:amend` and fresh approval. Never present failed or incomplete work as successful.

## Deliver only after separate authorization

Plan approval authorizes local implementation only. After every group in the phase has passed, offer each external action separately and follow `integrations/contracts.md` for the preview, fresh authorization, idempotency marker, and readback. Record the resulting stable id, canonical URL, and concise outcome in the run record.

- **Tracker children.** When the plan intends one child item per group, offer to create them under the plan's parent item after the groups pass. Never create one item per task and never move an item to a terminal state.
- **Push.** Offer to push the group branches and the docs branch as one enumerated batch. Push normally; never force-push.
- **Group pull requests (default).** Offer one draft pull request per group, targeting the configured base, reusing an existing pull request for the exact head branch instead of creating a duplicate. Each body carries the group goal, its scoped diff, its code-coupled documentation, its exact validation summary, and the docs-branch run-record commit. A dependent phase then waits for a human to merge them; ADW never does.
- **Integration pull request.** When the plan chooses this strategy, keep the group branches as implementation branches, and only after every dependency group has passed combine their validated commits onto `adw/<change-id>/integration` built from the same base. Resolve every conflict explicitly with the user, never automatically. Then run one whole-diff review of the combined result and one whole-feature validation pass through the helper, record both in a `final` group or `runs/final.json`, and offer exactly one draft integration pull request.

Keep every pull request a draft. Never mark one ready, approve it, merge it, release, deploy, publish a package, or close a work item automatically. If delivery authorization is absent, stop after local commits and evidence and report the exact actions still awaiting authorization.

## Report

Report the change id and phase id, the approval verification result and bound docs commit, the base branch and exact base commit, each group with its branch, worktree, tasks, review outcome, every validation command and its actual result, implementation commit, and final status, the run-record commits on the docs branch, any tracker or pull-request outcome, every action still awaiting authorization, and the recommended next step. Never describe failed or incomplete validation as successful.
