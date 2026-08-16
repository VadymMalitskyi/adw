<!-- ADW:PLAN 1 -->
<!-- ADW:REQUIRED-SECTIONS feature-overview acceptance-criteria implementation-plan whole-feature-validation -->
<!-- ADW:SECTION feature-overview -->

# PART 1 — Feature Overview

<!--
PART 1 is written for engineers and must stand alone. A reader who never opens
PART 2 should still understand the problem, the shape of the solution, and how
success is judged. Replace every placeholder and delete every instructional
comment block. Preserve the `ADW:PLAN` marker, required-sections manifest, and
every `ADW:SECTION` marker: they let the project change headings and layout
without breaking ADW.
-->

## Summary

<!--
State the problem in observable terms, who is affected, and what changes for
them. Name the real components involved. Two to six short paragraphs.
-->

Replace with the problem, the affected users or systems, and the observable
outcome once this change ships.

## Design & Architecture

<!--
Describe the chosen design: control flow, data flow, boundaries, storage,
failure behavior, and backward-compatibility posture. Name real files, modules,
and services. A small diagram is welcome when it clarifies a seam.
-->

Replace with the chosen design, the seams it touches, and what stays unchanged.

## Key Decisions & Trade-offs

<!--
One entry per material decision. Record the alternative you rejected and why,
so a future reader does not relitigate it. Include explicit exclusions.
-->

- **Decision.** Replace with the decision. **Alternative rejected:** replace with
  the option you did not take and the reason.
- **Excluded from this change.** Replace with work that is deliberately out of
  scope and where it should go instead.

## Risks and Open Questions

<!--
Rank by likely damage. Include the single load-bearing assumption most likely to
cause rework or an incident, plus its mitigation or the evidence that would
retire it. Open questions must name who answers them.
-->

- **Load-bearing assumption.** Replace with the assumption the design cannot
  survive being wrong about, and how it is de-risked.
- **Risk.** Replace with the risk, its blast radius, and the mitigation.
- **Open question.** Replace with the unresolved question and who decides.

<!-- ADW:SECTION acceptance-criteria -->

## Acceptance Criteria

<!--
Testable, observable, and numbered. Every criterion must map to executable work
in PART 2 and to at least one validation command. Avoid criteria that can only
be judged by reading the diff.
-->

1. Replace with an observable, testable criterion.
2. Replace with an observable, testable criterion.

<!-- ADW:SECTION implementation-plan -->

# PART 2 — Implementation Plan

<!--
PART 2 is written for the coordinating agent and its worker agents. A worker
must be able to execute its group with no access to the planning conversation.
Phases are dependency barriers and run in order. Groups inside one phase may run
concurrently only when their write paths and contracts are genuinely disjoint.
-->

## Plan at a glance

<!--
One row per group, in execution order. `Depends on` names earlier phases or
groups, or `—`. `Tracker` is one of: none, parent, child, link existing.
`Delivery` is `group PR` (default) or `integration PR`, and must be the same
strategy for the whole plan.
-->

| Phase | Group | Component | Primary paths | Depends on | Tracker | Delivery |
|---|---|---|---|---|---|---|
| 1 | `contracts` | `api` | `src/api/contracts/` | — | child | group PR |
| 1 | `web-client` | `web` | `apps/web/src/client/` | — | child | group PR |
| 2 | `wiring` | `api` | `src/api/handlers/` | Phase 1 | child | group PR |

## Affected Components

<!--
Only components declared in `adw.yaml`. State what changes in each and which
configured validation commands cover it. Call out any path that no component
owns and resolve that before approval.
-->

- **`api`** (`src/api`) — replace with what changes here. Validation:
  `replace with the configured command`.
- **`web`** (`apps/web`) — replace with what changes here. Validation:
  `replace with the configured command`.

## Context and Anchors

<!--
Grep-able anchors only. Use `path/to/file.ext -> symbolName`, never line
numbers. Every anchor must exist in the repository at planning time; plan review
checks each one against live code. Add a short note saying why a worker needs it.
-->

- `src/api/contracts/limits.mjs -> resolveLimit` — current limit resolution the
  new policy extends.
- `apps/web/src/client/request.mjs -> sendRequest` — client retry seam.
- `tests/api/limits.test.mjs -> "rejects an over-limit request"` — existing
  behavior that must keep passing.

## Phase 1 — Replace with the phase name

<!--
State the barrier this phase clears. Repeat the `### Group:` block for every
group in the phase. Group ids are stable, lowercase, and never renamed after
approval: run records and branches are keyed by them.
-->

Replace with what this phase establishes and why later phases depend on it.

### Group: contracts

**Goal:** Replace with the single outcome this group delivers.

**Component:** `api`

**Depends on:** —

**Affected paths:**

- `src/api/contracts/limits.mjs`
- `tests/api/limits.test.mjs`

**Delivery:** group PR

**Tracker:** child item under the plan's parent item

**IMPLEMENT:** Replace with the concrete implementation directive, phrased as
work to perform rather than as a description of the area.

- **CONTRACT:** Replace with the exact interface, signature, payload shape, or
  invariant other groups depend on. Omit when nothing else depends on this.
- **PATTERN:** Replace with the existing repository pattern to copy, cited by
  `file -> symbol` so the worker can read it.
- **GOTCHA:** Replace with the trap a competent worker would otherwise hit —
  ordering, concurrency, generated files, or a surprising existing behavior.
- **DONE WHEN:** Replace with the observable finish condition. It must be
  checkable without reading the worker's own summary.
- **VALIDATE:** `replace with an exact non-interactive command`

**IMPLEMENT:** Replace with the next directive task for this group, or delete
this block if the group needs only one.

- **DONE WHEN:** Replace with the observable finish condition.
- **VALIDATE:** `replace with an exact non-interactive command`

### Group: web-client

**Goal:** Replace with the single outcome this group delivers.

**Component:** `web`

**Depends on:** —

**Affected paths:**

- `apps/web/src/client/`

**Delivery:** group PR

**Tracker:** child item under the plan's parent item

**IMPLEMENT:** Replace with the concrete implementation directive.

- **PATTERN:** `apps/web/src/client/request.mjs -> sendRequest`
- **DONE WHEN:** Replace with the observable finish condition.
- **VALIDATE:** `replace with an exact non-interactive command`

## Phase 2 — Replace with the phase name

Replace with what this phase adds once Phase 1 has landed.

### Group: wiring

**Goal:** Replace with the single outcome this group delivers.

**Component:** `api`

**Depends on:** Phase 1 (`contracts`, `web-client`)

**Affected paths:**

- `src/api/handlers/`

**Delivery:** group PR

**Tracker:** child item under the plan's parent item

**IMPLEMENT:** Replace with the concrete implementation directive.

- **CONTRACT:** Replace with the contract consumed from Phase 1.
- **GOTCHA:** Replace with the trap specific to this integration point.
- **DONE WHEN:** Replace with the observable finish condition.
- **VALIDATE:** `replace with an exact non-interactive command`

<!-- ADW:SECTION whole-feature-validation -->

## Whole-feature validation

<!--
Commands that prove the finished feature, run after every group in the final
phase passes. Every command must be exact, non-interactive, and derived from a
real repository source: a manifest script, task runner target, CI workflow step,
or authoritative project documentation. Cite that source. Never invent a command.
-->

| Command | Working directory | Source | Required |
|---|---|---|---|
| `replace with an exact command` | `.` | `replace with package.json#scripts.test or equivalent` | yes |

Map each acceptance criterion to the work and validation that proves it:

1. Criterion 1 — Phase 1 `contracts`, proven by the command above.
2. Criterion 2 — Phase 2 `wiring`, proven by the command above.

## Notes

<!--
Everything a worker needs but should not have to derive: exact payloads, schemas,
DDL, migration steps, pseudocode, fixture data, and precise error messages. Keep
it self-contained — workers do not see the planning conversation.

Never record ticket ids, pull-request URLs, progress markers, or validation
results here. The plan is immutable after approval; that state belongs in the run
records under `runs/`. A design or scope change goes through `adw:amend`, which
supersedes the approval and requires fresh approval.
-->

Replace with the exact payloads, schemas, pseudocode, or fixture data workers
need, or state `None.` when the anchors above are sufficient.
