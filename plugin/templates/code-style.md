# Code-style convention catalog

A menu for `adw:init` to offer for `docs/conventions.md`. Nothing parses this
file. Take what fits, reword it, drop the rest. Never copy selected rules into
`AGENTS.md` or `CLAUDE.md`.

Each rule is a threshold an agent can check itself against. Rules that cannot
be checked ("write simple code") change nothing and cost context in every
session. Prefer a tool over a rule: what a formatter or linter enforces belongs
in its config, not here.

## Comments

Default to none. A comment is a cost paid on every read, and the code is the
only part guaranteed to stay true.

- Write a comment only where its absence would mislead: a non-obvious why, a
  constraint, a surprise. Not for what the code already says.
- Before writing one, rename the thing instead. That usually removes the need.
- Delete commented-out code.

## Abstraction

- Extract a shared helper on the second copy, not the third.
- No abstraction with one caller.
- Prefer the boring construction over the clever one that saves two lines.

## Shape

- A function needing a section comment needs to be two functions.
- Return early instead of nesting the rest of the function in an `if`.
- Name a function for what it does, in the caller's vocabulary. A name needing
  a qualifier (`doWorkHelper`) marks a function doing two things.

## Consistency

- Match the surrounding file's idiom over any general preference, including these.
- Reuse the repository's existing name for a concept instead of a synonym.

## Scope

- Change what the task requires. Unrelated cleanup is a separate change.
- No compatibility shim for a caller that does not exist.
