# Migrating from ADW 0.6

ADW 1.0 intentionally breaks the 0.6 artifact contract. There is no migration framework, no compatibility shim, and no automatic rewriting of historical evidence. `adw:doctor` recognizes an 0.6 project and returns this guidance without modifying anything.

## What changed

| 0.6 | 1.0 |
|---|---|
| `adw.yaml` with `schema: 5` | `adw.yaml` with `adw: 1` |
| `changes/<id>/spec.md` + `plan.yaml` | one `changes/<id>/plan.md` |
| `integrations.yaml` bindings and requirement digests | tracker intent stated in the plan; results recorded in run records |
| `approval.json` schema 2 ordered input bundle | simple exact-byte plan approval |
| standalone `validation.json` | validation inside `runs/<phase-id>.json` |
| `external-events/*.json` receipts | stable id, URL, and outcome in the run record |
| `adw/work-items/*.yaml` payload profiles | adapter defaults plus optional opaque provider `settings` |
| `plugin/schemas/*.json` and AJV | small handwritten validation in the helper |
| `effective_policy` snapshots and digests | components resolved at execution time |
| one sequential branch | phases, parallel groups, isolated worktrees |
| `execution.enforcement` | isolation mode alone; `provider-sandbox` is the lightweight default |
| `documentation.mode/branch/worktree/delivery` | `docs.branch` / `docs.worktree` / `docs.sync_marker` |
| `git.default_branch` | `git.base_branch` |
| `components.<id>.validation.default`, top-level `validation.default` | `components.<id>.validate` |
| `integrations:` + `workflows:` | `providers:` keyed by capability |

## Choose one of two supported paths

### 1. Finish active work on 0.6, then upgrade

If a change is already approved and partly executed, keep using the pinned 0.6 plugin until it ships.

```bash
codex plugin add adw@adw-local --version 0.6.0
claude plugin install adw@adw-local --version 0.6.0 --scope user
```

Complete `adw:execute`, deliver the draft pull request, and let a human merge it. Then upgrade with path 2. Do not run 1.0 skills against an 0.6 change: the 1.0 plugin cannot read `plan.yaml`, schema-2 approvals, or requirement bindings, and it will stop rather than guess.

### 2. Preserve 0.6 artifacts as history and reinitialize

1. Commit and push the docs branch so every 0.6 `spec.md`, `plan.yaml`, `approval.json`, `validation.json`, and receipt stays in Git history. Nothing is deleted.
2. Install ADW 1.0 in both providers.
3. Run `adw:doctor`. It reports the `schema: 5` configuration and confirms it changed nothing.
4. Run `adw:init` and review the preview carefully. It will not overwrite an existing `adw.yaml`; replace it deliberately with the reviewed `adw: 1` configuration, mapping your old fields with the table above.
5. Re-plan any work that was not yet merged as a fresh `changes/<change-id>/plan.md`. Use the old `spec.md` as source material for PART 1 and the old `plan.yaml` tasks as source material for PART 2 groups.
6. Run `adw:review-plan`, then `adw:approve`, then `adw:execute`.

## What is preserved

Existing merged code is untouched. Historical docs-branch artifacts remain readable in Git history. Security hardening carries forward unchanged: permission hooks, the fail-closed egress proxy and firewall, atomic managed-file writes, timeout process-tree termination, exact remote-ref matching, path confinement, and symlink defenses. The managed devcontainer still works — it is simply no longer the default.

## What is not preserved

- 0.6 approvals do not verify under 1.0 and cannot be converted. Reapprove the new plan.
- Requirement digests and authorization digests are gone. External requirement drift is now a judgment call made during plan review and execution scope checks, not a digest comparison.
- `resolve-project-policy`, `validateArtifact`, `load-artifact-file`, `digest-bundle`, `digest-requirements`, `digest-authorization`, `record-external-action`, and `validate-work-item-payload` are removed from the helper. Any project script that called them must be updated.
