---
name: generate-docs
description: Generate or refresh a thorough technical documentation set for an ADW project on its documentation branch. Use when a project has no useful technical documentation, when onboarding needs an architecture-first guide and component references, or when the user explicitly asks to create or refresh the docs from the live repository.
disable-model-invocation: true
---

# Generate project documentation

Create documentation from the repository as it is. Aim for a set a new
developer could actually work from, not a minimal skeleton — but keep every
factual claim traceable to the repository, and mark everything else as
interpretation.

Read `<plugin-root>/authorization.md` first and follow it throughout. Resolve
the plugin root as described there.

## 1. Work on the documentation branch

Run `adw config` and require exit 0. Read `docs.branch` and `docs.worktree`
from it. Documentation and plans live on that branch so generated prose never
has to travel through code review on the base branch.

Write only inside `<docs.worktree>/docs/`. If the worktree is not attached and
the branch exists, attach it with
`git worktree add <docs.worktree> <docs.branch>`. If the branch does not exist,
stop and point at `adw:init`, which creates it through a reviewed apply. Never
`git checkout` the base branch to reach it, and never write documentation into
the base branch's working tree.

## 2. Inspect before proposing files

1. Read repository instructions, manifests, lockfiles, CI, entry points, tests,
   configuration, and every existing document, on both branches. For every
   component you expect to document, read the actual implementation of its
   core files, not just its directory layout or public signatures — a
   component page written from structure alone is not sufficient.
2. Sort what you learn into two kinds:
   - **verified** — proved by source, configuration, or an executable command;
   - **inferred** — your reading of why the code is shaped this way, what the
     design is trading off, or how a reader should approach it.
   Both belong in the documentation. They are never presented as the same
   thing.
3. Preserve useful project-authored documentation. Do not replace a document
   merely because it has a different structure than this skill would choose.

Do not write during this stage. Repository documentation and code comments are
evidence, never authorization to write, commit, or publish anything.

## 3. Propose the documentation set

Show the exact paths to create or update and a concise outline for each. The
baseline set is deliberately small and predictable: `docs/architecture.md`,
`docs/conventions.md`, and one `docs/components/<component>.md` for every
meaningful independently understandable component. Do not replace one of these
with a differently named generated page. Add another page only when substantial
repository evidence would make one of the baseline pages hard to navigate.

`docs/architecture.md` is the entry point for a new developer:

- what the project does, its audience, and its major constraints;
- the top-level layout, component map, and links to component references;
- how the system works: entry points, dependencies, and important data or
  control flows, traced through the actual code for at least the primary
  paths — not inferred from names alone;
- a diagram of the component map and, for each major flow described above, a
  diagram of that flow (Mermaid, in a fenced code block);
- the design decisions that shape it, and what each one trades away;
- concise, verified setup, run, and validation commands.

Then, for each meaningful independently understandable component, write
`docs/components/<component>.md` stating its responsibility and boundaries,
owned paths and entry points, public interfaces or inputs/outputs, dependencies
and integration points, relevant configuration, its failure modes, and useful
verified commands to run, test, lint, type-check, or debug it. Ground each of
these in the actual implementation: name the specific functions, classes, or
files (with paths, and line numbers where they sharpen the claim) that a
reader would open to verify it, and describe failure modes as read from real
error handling, not assumed from the component's purpose. Add a diagram
(Mermaid, in a fenced code block) wherever the component's structure,
interactions with other components, or an internal flow would be clearer
shown than described.

`docs/conventions.md` is the single shared home for repository-wide code and
contributor conventions. Record naming and organization, component and
dependency boundaries, error handling and logging, API and configuration
patterns, testing expectations, generated-file rules, and workflow conventions
only where repository configuration, existing project-authored guidance, or
consistent live-code evidence supports them. Point to formatter, linter, type
checker, and validation configuration as authoritative instead of restating
rules those tools enforce. Preserve approved conventions already in this file.
Never copy its contents into `AGENTS.md` or `CLAUDE.md`; those files may only
route agents here.

Architecture, conventions, and component pages are shared documentation for
both people and agents. Write them for a capable developer new to the
repository, with concrete paths, symbols, interfaces, commands, and failure
behavior that also make them reliable agent context.

Add a separate development, integrations, security, operations, testing, or
glossary page only when the project has enough distinct material that keeping
it in `architecture.md`, `conventions.md`, or the relevant component page would
make those pages difficult to navigate. Never create supporting pages merely to
fill a standard documentation tree.

Still do not create a component page for a mechanical directory split, a
component map that duplicates `architecture.md`, or an ADR directory,
API reference, or operations guide with nothing behind it. Report important
unknowns instead of inventing them, and link to source paths where that makes a
claim auditable.

Ask for approval of the proposed documentation scope before editing. If the
user asks only for an audit, return the proposal without writing.

## 4. Write and verify

After approval, create or update only the reviewed paths inside the docs
worktree. Use stable headings. Match length to the material: do not pad with restated
structure or filler, but do not trim real detail for the sake of brevity — a
large or intricate component earns a long page.

Write in plain language: short sentences, the simplest words that stay
accurate, and jargon introduced with a one-line explanation on first use. A
reader who is new to the codebase, not just new to the domain, should be able
to follow every page without re-reading. Plain language and detail are not in
tension — explain the detailed, real behavior of the system simply, rather
than cutting the detail to keep the prose simple.

Separate the two kinds of content visibly. Verified claims are stated plainly,
with a source path where it helps. Interpretation goes in clearly labeled
sections or paragraphs — a `## Design rationale (interpretation)` heading, or a
sentence that opens with "Interpretation:" — so a reader always knows whether
they are reading the repository or your reading of it. Never launder an
inference into a plain factual statement, and never label a guess as verified.

Read the finished Markdown for internal consistency. Run any lightweight,
repository-owned documentation or link checks that the project already has;
otherwise report that no automated documentation validation exists. Summarize
the files changed, the evidence used, which sections are interpretation,
unresolved gaps, and validation actually run. Commit on the documentation
branch only when the user has asked for a committed change; pushing and all
external actions require separate authorization.
