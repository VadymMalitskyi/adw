---
name: review-plan
description: Independently red-team an implementation plan against live repository code and return a verdict of ship-ready, revise-recommended, or needs-rework with the weakest point and ranked findings. Use when a plan needs a cold second opinion before execution, or when adw:plan requests its review pass.
disable-model-invocation: true
---

# Review a plan

Read one plan and the live repository, then return a verdict. This is a cold
adversarial read: assume the plan is wrong until the repository proves
otherwise.

You receive the plan and the code. You do not receive the conversation that
produced it, the author's rationale, or the author's confidence. Do not ask for
them. If a claim is only defensible with context absent from the plan, that
absence is itself a finding — the agents who execute this plan will be equally
blind.

This skill is read-only. Never edit the plan, never implement anything, and
never create a branch. `adw:plan` applies findings; you produce them.

## Input

Accept the plan as conversation text or as an explicit file path. If given a
path, read exactly that file. If given neither, ask which plan to review.

Read `<plugin-root>/authorization.md` and resolve the plugin root as described
there. Run `adw config` for explicit component and validation overrides, then
verify the plan's other boundaries and commands from repository evidence.

## Check

Verify each of these against the repository, not against the plan's own claims:

- **Grounding.** Does every file, module, command, and interface the plan names
  actually exist? Name each one that does not.
- **Ordering.** Does each phase genuinely depend only on what came before? Find
  the phase that will fail because it needs something a later phase builds.
- **Parallel safety.** Do groups inside a phase have disjoint write paths? Two
  groups touching one file will be refused before execution — catch it now.
- **Completeness.** Can an implementer who sees only this text do the work? Find
  the group whose tasks are a summary rather than an instruction.
- **Validation.** Do the validation commands actually prove the acceptance
  criteria, and do they exist in the project's configuration? A plan that
  validates nothing is not executable.
- **Scope.** Is anything in the plan outside what the overview promised, or
  promised but missing from the phases?
- **Risk.** What breaks in production if this ships exactly as written?

## Return

1. **Verdict** — `ship-ready`, `revise-recommended`, or `needs-rework`.
2. **Weakest point** — the single thing most likely to derail execution, in one
   or two sentences.
3. **Ranked findings** — each with the anchor it applies to (phase, group, or
   section), what is wrong, the repository evidence, and the smallest change that
   fixes it.
4. **What held up** — the claims you checked and found sound. Say this
   explicitly; a review that only lists problems is not a review.

Rank by consequence, not by how easy the fix is. Do not pad the list: three real
findings beat twelve cosmetic ones.
