# <Change title>

Optional skeleton for `adw:plan` when the user asks for a plan file. Nothing
parses this file — it is a shape, not a contract. Rename, reorder, or drop
sections whenever the change is better served that way.

## Feature overview

What problem this solves and what changes for the people who use the software.
This section must stand on its own for a reader who never sees the phases below.

**Out of scope:** what this change deliberately does not do.

## Acceptance criteria

- Observable, checkable statements. Not implementation steps.

## Implementation plan

### Phase 1 — <what this phase delivers>

Why this phase comes first, and what it unblocks.

#### Group `<group-id>`

- **Tasks:** the interpreted instructions, complete enough for an agent that
  sees only this text.
- **Writes:** the exact project-relative paths this group will write. Groups in
  one phase must have disjoint write paths.
- **Validation:** the commands that prove this group works.

#### Phase validation

The commands that prove the phase works as a whole.

### Phase 2 — <...>

## Whole-change validation

What proves the acceptance criteria are met once every phase has landed.

## Risks and open questions

What could go wrong, and what is still undecided.
