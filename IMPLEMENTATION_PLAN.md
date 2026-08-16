# ADW 1.0 — Implementation record

This document records the delivered 1.0 architecture and the gates that keep it honest. `PRD.md` states what ADW must do; `docs/architecture.md` explains how the pieces fit together.

## Repository layout

```text
plugin/
  .codex-plugin/plugin.json        Codex packaging metadata
  .claude-plugin/plugin.json       Claude Code packaging metadata
  skills/<name>/SKILL.md           the shared workflow surface, one physical tree
  skills/<name>/agents/openai.yaml optional Codex interface metadata
  skills/<name>/scripts/*.mjs      deterministic per-skill mechanics
  execution/contracts.md           isolation preflight contract
  execution/orchestrator.mjs       deterministic group branch/worktree mechanics
  execution/managed-development.mjs generated provider permission policy
  integrations/contracts.md        provider adapter contract
  integrations/providers.json      capability/transport registry
  integrations/providers/*.md      concrete provider references
  templates/adw.yaml               the small `adw: 1` project template
  templates/plan.md                the bundled marker-based fallback and initialization seed
  templates/preferences.md         ignored personal profile template
  templates/architecture.md        docs-branch context template
  templates/devcontainer/*         optional managed container, opt-in only
  lib/adw-helper.mjs               generated self-contained helper (never hand-edited)
  lib/local-configuration.mjs      ignored local-state rendering
src/helpers/runtime-bundle.mjs     the one canonical helper implementation
src/helpers/build-bundle.mjs       esbuild bundler with a reproducibility check
tests/helpers/                     helper unit behavior
tests/contracts/                   cross-provider parity, packaging, bundle equivalence
tests/integration/                 skill contracts and real fixture behavior
tests/fixtures/                    empty-repo, existing-project, monorepo
```

## Delivered components

### Helper runtime

`src/helpers/runtime-bundle.mjs` exposes exactly the operations that genuinely need conventional code: YAML 1.2 parsing with duplicate-key rejection, handwritten `adw: 1` project validation, project plan-template marker validation and safe selection, byte digests, plan approval creation/verification/supersession, phase run-record creation/validation/monotonic update, validation-command resolution and truthful execution, confined path resolution, and atomic managed-file writes.

Removed and never reintroduced: general JSON Schema loading and validation, artifact registries and schema-version dispatch, effective project policy and policy digests, work-item payload profile validation, requirements digests, authorization digests, external-action receipt construction, and approval bundles containing multiple ordered author inputs. AJV is no longer a dependency; the YAML 1.2 parser is the single intentional bundled dependency.

The CLI surface also includes `validate-plan-template` and `resolve-plan-template`; every operation takes one JSON object on stdin and returns one JSON object with a stable exit code.

### Orchestrator

`plugin/execution/orchestrator.mjs` provides `preview`, `prepare`, `inspect`, and `cleanup-guidance` over an explicit project root, base commit, change id, phase id, and group packets. It writes one durable empty marker commit per group carrying the change, phase, group, base branch, base commit, plan digest, and packet digest as trailers, which is what makes resume work from Git alone. It reuses a branch and worktree only when every trailer and the parent commit match; refuses dirty, ambiguous, symlinked, duplicate, mismatched, or already-owned targets; refuses overlapping write paths between concurrent groups; and never deletes a branch or worktree.

### Skill inventory

Foundation `init`, `onboard`, `doctor`, `status`, `discover`; change loop `plan`, `review-plan`, `approve`, `amend`, `execute`; delivery `quick`, `address-review`; operations and maintenance `investigate`, `sync-docs`, `update`. Both provider manifests resolve the same physical `plugin/skills/` tree.

## Invariants under test

| Invariant | Where it is proven |
|---|---|
| Handwritten project contract accepts the small config and rejects unsafe paths, modes, secrets, and duplicates | `tests/helpers/simple-contracts.test.mjs` |
| Approval binds exact plan bytes plus docs commit; one byte blocks execution | `tests/helpers/approval.test.mjs`, `tests/integration/approval-lifecycle.test.mjs` |
| Run-record status advances only forward and never leaves a terminal status | `tests/helpers/simple-contracts.test.mjs` |
| No group passes without independent review and truthful validation | `tests/helpers/simple-contracts.test.mjs` |
| Required nonzero exits, signals, timeouts, and deferrals stay failures | `tests/helpers/validation.test.mjs`, `tests/helpers/cli.test.mjs` |
| Timed-out process trees terminate with bounded escalation | `tests/helpers/validation.test.mjs` |
| Atomic writes confine paths, reject symlinks, and roll back completely | `tests/helpers/atomic-writes.test.mjs` |
| Two disjoint groups prepare concurrently; overlap is refused; interrupted runs resume | `tests/integration/orchestrated-execution.test.mjs` |
| Status stays read-only and reconstructs state from Git and artifacts | `tests/integration/status-readonly.test.mjs` |
| Project plan templates can change headings while stable semantic markers remain valid | `tests/helpers/plan-templates.test.mjs`, `tests/integration/plan-contract.test.mjs` |
| Cold review detects stale anchors, unsafe overlap, and backwards dependencies | `tests/integration/review-plan-contract.test.mjs` |
| Init/onboard/update stay digest-bound, idempotent, and confined | `tests/integration/fixture-init.test.mjs` and neighbors |
| Managed container invariants and egress policy hold | `tests/integration/managed-devcontainer.test.mjs`, `tests/integration/egress-proxy.test.mjs`, `npm run test:security` |
| Sync-docs reports read-only, refuses out-of-scope proposals, and never force-pushes | `tests/integration/docs-sync.test.mjs` |
| Both providers expose the same skills, frontmatter, and safety boundaries | `tests/contracts/cross-provider-contracts.test.mjs` |
| The helper bundle is self-contained, reproducible, and free of schema and policy machinery | `tests/contracts/helper-bundle-equivalence.test.mjs`, `tests/contracts/helper-reproducibility.test.mjs` |

## Release gates

```bash
npm test
npm run check:helper
git diff --check
claude plugin validate --strict plugin
claude plugin validate --strict .claude-plugin/marketplace.json
npm run test:security   # requires Docker, jq, and ShellCheck
```

`VERSION`, `package.json`, both provider manifests, both marketplace catalogs, and the managed devcontainer marker must all report the same version.

## Manual acceptance scenarios

Run these with both Codex and Claude Code where provider functionality exists:

1. Initialize and onboard a small repository without Docker or providers.
2. Create a plan with one human design section and two parallel groups.
3. Run review-plan cold and fix an intentionally stale anchor.
4. Approve the exact plan, edit one byte, and prove execute stops.
5. Restore and reapprove the plan.
6. Execute two Phase 1 groups concurrently in isolated worktrees.
7. Produce an implementation defect, have independent review identify and fix it, and rerun validation.
8. Interrupt after one group passes, start a new session, and resume from Git and run records.
9. Preview and authorize tracker child creation and draft group pull requests.
10. Confirm ADW never merges the pull requests and that a dependent phase waits for those merges.
11. Exercise integration-PR delivery in a separate fixture.
12. Onboard a second developer who only needs the five core workflow concepts.
