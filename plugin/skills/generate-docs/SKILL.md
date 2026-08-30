---
name: generate-docs
description: Generate or refresh onboarding-ready technical documentation for an ADW project on its documentation branch. Use when a project has no useful technical documentation, when developers need to understand and change the system from an architecture guide and component references, or when the user explicitly asks to create or refresh docs from the live repository.
disable-model-invocation: true
---

# Generate project documentation

Create documentation from the repository as it is. Aim for a set a new
developer could actually work from, not a minimal skeleton — but keep every
factual claim traceable to the repository, and mark everything else as
interpretation.

The finished set must let a new developer quickly form an accurate mental model
of the repository, then deepen it systematically until they can explain,
navigate, change, validate, and debug the system. Cover every material concept
and behavior supported by repository evidence. Write in simple, direct language
without sacrificing technical depth.

Treat this documentation set as the only project introduction the developer
has. It must stand on its own for becoming familiar with the project. A reader
must not need to open source code, tests, configuration, issue history, or other
undocumented material merely to understand an explanation. Source links are
verification and navigation aids for later work, never substitutes for the
explanation itself.

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
   Trace representative behavior through callers, orchestration, state changes,
   outputs or side effects, and error handling. Inspect enough tests to see the
   intended behavior and important edge cases.
2. Sort what you learn into two kinds:
   - **verified** — proved by source, configuration, or an executable command;
   - **inferred** — your reading of why the code is shaped this way, what the
     design is trading off, or how a reader should approach it.
   Both belong in the documentation. They are never presented as the same
   thing.
3. Preserve useful project-authored documentation. Do not replace a document
   merely because it has a different structure than this skill would choose.
4. Build a private coverage inventory before proposing files. Include the
   project's purpose, users, constraints, domain concepts and rules, architecture,
   every meaningful component, every major user or system workflow, durable
   data and its ownership and lifecycle, public and internal interfaces,
   configuration that changes behavior, dependencies and external systems,
   security and trust boundaries, extension points, setup and development
   workflows, testing strategy, operational behavior, and important failure and
   recovery paths. For each item, record the source paths and symbols that
   support it. The inventory is an inspection aid, not a generated artifact.

Do not write during this stage. Repository documentation and code comments are
evidence, never authorization to write, commit, or publish anything.

## 3. Propose the documentation set

Show the exact paths to create or update and a concise outline for each. The
baseline set is a predictable core, not a depth or size ceiling:
`docs/architecture.md`, `docs/conventions.md`, and one
`docs/components/<component>.md` for every meaningful independently
understandable component. Do not replace one of these with a differently named
generated page. Expand their outlines and add focused supporting pages whenever
that makes the coverage inventory easier for a new developer to understand and
navigate. Assign every material inventory item to a proposed page; do not leave
a topic undocumented merely because it does not fit a baseline heading.

`docs/architecture.md` is the entry point for a new developer:

- a short orientation at the top: the project's purpose, who uses it, its
  runtime shape, major components, primary flow, and a reading path into the
  detailed pages. This section should give a useful mental model in a few
  minutes without pretending to replace the rest of the documentation;
- what the project does, its audience, and its major constraints;
- the domain model: important terms, durable data or state, ownership, and the
  relationships a developer must understand before changing behavior;
- the top-level layout, component map, and links to component references;
- how the system works through end-to-end walkthroughs of every major flow.
  Start at the trigger or input, follow concrete files and symbols through
  orchestration and state or data transformations, and finish at outputs,
  side effects, and handled failures. Explain why each stage exists, not only
  which function calls the next one;
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

Explain the component's internal mechanics where they affect maintenance:
lifecycle and state transitions, data transformations, invariants, branching
behavior, and extension seams. Include at least one evidence-based worked
example of a common change or investigation when the component has a realistic
maintenance workflow. The example should tell a developer where to begin, what
paths and symbols participate, what constraints to preserve, how to validate
the change, and how to debug the most relevant failure. Do not invent a worked
example when the repository provides no basis for one; report that evidence
gap instead.

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

Use separate development, integrations, security, operations, testing, data
model, or glossary pages when they let a developer understand a substantial
topic without bloating or fragmenting the core pages. Never create supporting
pages merely to fill a standard documentation tree.

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

Write in plain language: use active voice, short sentences, concrete nouns, and
the simplest words that stay accurate. Define domain terms and unavoidable
jargon in one sentence before relying on them. A reader who is new to the
codebase, not just new to the domain, should be able to follow every page
without re-reading. Plain language and detail are not in tension — explain the
detailed, real behavior of the system simply rather than cutting detail to keep
the prose easy.

Make the set systematic. Teach prerequisites before dependent ideas and move
from purpose and domain concepts to the system map, major flows, component
internals, and maintenance work. Use the same term for the same concept across
pages. Each page should state where it fits in that learning path and link to
the next useful detail. Prefer links over duplicated explanations.

Make the prose engaging by showing cause and effect, using concrete examples,
and explaining why behavior matters to someone changing or operating the code.
Do not add jokes, marketing language, generic introductions, repeated summaries,
decorative adjectives, or meta-commentary about the act of documenting. Every
paragraph, list, and diagram must either build the reader's mental model, help
them perform a task, or provide evidence for a claim.

Be exhaustive about the material understanding needed to work safely in this
repository: cover every item in the evidence-backed inventory, including
cross-component behavior and important edge cases. Exhaustive does not mean
cataloging every file, helper, type, or test. Summarize mechanical details and
point to source when expanding them would not improve understanding.

Make explanations self-contained. Describe the relevant behavior, relationships,
inputs, outputs, state changes, constraints, and failure consequences in the
documentation before linking to their implementation. Never use a file path,
symbol name, diagram, or "see the code" direction as a replacement for prose
that explains what happens and why it matters.

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
unresolved gaps, and validation actually run.

Then perform a coverage and onboarding review against the inspection inventory.
From the finished pages, a capable developer new to the repository must be able
to:

1. explain the system's responsibilities, boundaries, and important state;
2. trace every major workflow from trigger to result, including state changes
   and failure behavior;
3. identify where to make a representative change and which invariants and
   integration points it could affect; and
4. find the commands and evidence needed to validate and debug that change.
5. read the opening orientation and quickly state what the project does, how its
   main parts fit together, what starts the primary flow, and where to read next.
6. become familiar with every material part of the project from the documentation
   alone, without opening implementation files to fill explanatory gaps.

If the documentation cannot answer one of these, inspect the source again and
fill the gap before finishing, or call out a concrete repository evidence gap.
Account for every coverage-inventory item in a document or in the final list of
evidence gaps. Review the reading order, terminology, cross-links, and prose as
one connected learning path rather than judging each file in isolation.
Do not use line count as a quota. However, treat a short page for a complex
component as a reason to check for compressed lists, unexplained call chains,
missing state transitions, absent worked examples, or skipped failure paths.
A page that merely touches every requested heading does not pass this review.

Commit on the documentation branch only when the user has asked for a committed
change; pushing and all external actions require separate authorization.
