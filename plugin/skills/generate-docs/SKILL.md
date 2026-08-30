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

This is a completeness-first workflow. Do not optimize for fewer tokens, fewer
tool calls, fewer agent turns, shorter documents, or faster completion. There is
no maximum documentation length. Context pressure is a reason to partition the
repository, use fresh agents, and continue in additional waves; it is never a
reason to compress away behavior or stop at a summary.

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

When the runtime provides native or in-session subagents, use them. A
nontrivial repository must not be researched, written, and reviewed in one
agent context. Run parallel agents up to the available concurrency limit and
schedule more waves until every partition is covered. The coordinator owns
authorization, partitioning, reconciliation, and the final report. Subagents
never approve scope, commit, push, or perform external actions.

Before approval, every subagent is read-only. Partition the repository by real
runtime, domain, or ownership boundaries, not merely by directory. Give shared
build, CI, deployment, security, data, and repository-wide convention material
explicit cross-cutting partitions. Assign every relevant file to exactly one
primary research partition.

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
4. Build a coverage inventory before proposing files. Include the
   project's purpose, users, constraints, domain concepts and rules, architecture,
   every meaningful component, every major user or system workflow, durable
   data and its ownership and lifecycle, public and internal interfaces,
   configuration that changes behavior, dependencies and external systems,
   security and trust boundaries, extension points, setup and development
   workflows, testing strategy, operational behavior, and important failure and
   recovery paths. For each item, record the source paths and symbols that
   support it.
5. Inventory every first-party source, configuration, schema, migration, build,
   CI, deployment, and operational file that can affect behavior. Exclude
   generated output, vendored dependencies, caches, and binary assets. Give each
   remaining file an owning component, a short responsibility, its important
   symbols or settings, and the documentation section that will explain it.
6. Send each partition to a fresh research agent. Its dossier must contain the
   complete owned-file ledger; important symbols and why they matter; domain
   terms and invariants; every major flow in ordered steps; inputs, outputs,
   state changes, and side effects; public and internal interfaces; data
   ownership and lifecycle; behavior-changing configuration; dependencies and
   cross-component interactions; failure branches, recovery, and diagnostic
   signals; test evidence and edge cases; verified commands; representative
   maintenance tasks; and genuine evidence gaps. A directory listing, symbol
   catalog, or brief component summary is not a research dossier.
7. Reconcile the dossiers. Return overlapping ownership, unsupported claims,
   and uncovered files to research agents for another pass. If subagents are
   unavailable, perform the same partitions sequentially in separate passes;
   never collapse them into one repository-wide summary to save context.

Do not write during this stage. Repository documentation and code comments are
evidence, never authorization to write, commit, or publish anything.

## 3. Propose the documentation set

Show the exact paths to create or update and a concise outline for each. The
baseline set is a predictable core, not a depth or size ceiling:
`docs/architecture.md`, `docs/conventions.md`, `docs/code-map.md`, and one
`docs/components/<component>.md` for every major project subsystem. A major
subsystem is a deployable application or service, a domain library, a durable
data or learning system, a user-facing client, or a substantial toolchain with
its own responsibility and lifecycle. It is not merely a feature, API surface,
flow, adapter, storage class, directory, or convenient research partition.

Keep the document set compact. Prefer long, well-structured subsystem pages
with tables of contents and anchored sections over many small pages. HTTP and
realtime interfaces, persistence, background work, feature families, and
internal pipelines stay in their owning subsystem page unless they are genuinely
major project parts. Research partitions may be much narrower than documentation
pages: several specialist agents can research different flows and file groups
that one page-owning writer later integrates. Do not create supporting pages
only to reduce page size or writer context.

Include the coverage inventory in the proposal as a reviewable table. For each
proposed page, name the concepts, workflows, data, interfaces, failure paths,
and first-party source groups it will cover. Report the number of relevant files
discovered, assigned, and still unassigned. Assign every material inventory item
to a proposed page. Also justify why each component page represents a major
project subsystem rather than a smaller internal concern, and report the total
number of proposed documents. Do not ask for approval while any material topic
or relevant file is unassigned. The approved scope is a coverage contract, not
merely a list of filenames and generic headings.

`docs/architecture.md` is the extensive first read for a new developer. It is
the high-to-mid-level explanation of the entire project, not a short overview,
table of contents, directory map, or compressed copy of the component pages. A
developer should finish it with a coherent picture of every project feature,
how the system behaves, why its major parts exist, and how those parts work
together. It includes:

- a short orientation at the top: the project's purpose, who uses it, its
  runtime shape, major components, primary flow, and a reading path into the
  detailed pages. This section should give a useful mental model in a few
  minutes without pretending to replace the rest of the documentation;
- what the project does, its audience, and its major constraints;
- a complete system-level feature catalog. Cover every user-facing,
  developer-facing, and operational feature. For each feature, explain the
  need it serves, how it is triggered, the participating subsystems, the
  end-to-end behavior, important state or data effects, configuration and
  constraints, observable result, and significant failure behavior. Group
  related features into a readable narrative; do not reduce the catalog to a
  checklist, endpoint table, or collection of links;
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

Architecture owns the cross-system **what, why, and how**. It may name concrete
paths and symbols to keep explanations grounded, but it stays at the level
needed to understand the product, system behavior, component collaboration,
and major control and data flows. It must explain enough detail to stand alone
as the project's mental model. Links to component pages invite the reader to
go deeper; they never replace architecture's own explanation of a feature or
flow.

Then, for each major project subsystem, write a mid-to-low-level implementation
reference at `docs/components/<component>.md`. It owns **exactly how** that
subsystem is designed, implemented, tested, debugged, and changed. State its
responsibility and boundaries,
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

Explain the component's internal mechanics in enough depth that a developer can
work on it without first reconstructing its design from source: lifecycle and
state transitions, data structures and transformations, algorithms, invariants,
branching and concurrency behavior, interface contracts, dependency choices,
design rationale and tradeoffs, extension seams, error handling, recovery, and
observability. Explain its testing design too: test layers, important suites,
fixtures, factories, mocks or fakes, boundaries that tests isolate, behaviors
that receive special coverage, known coverage gaps, and how to select and run
the right tests for a change. Include at least one evidence-based worked
example of a common change or investigation when the component has a realistic
maintenance workflow. The example should tell a developer where to begin, what
paths and symbols participate, what constraints to preserve, how to validate
the change, and how to debug the most relevant failure. Do not invent a worked
example when the repository provides no basis for one; report that evidence
gap instead.

Add a complete feature and behavior catalog at implementation level inside the
owning subsystem page. This deepens the system-level catalog in architecture;
it does not replace it.
For every user-facing, developer-facing, and operational feature, explain its
purpose, entry point, inputs, outputs, important branches and algorithms,
persisted or in-memory state, configuration, side effects, integration points,
failure behavior, observability, and validation evidence. Preserve meaningful
formulas, ordering rules, defaults, limits, compatibility contracts, and edge
cases. A feature name or endpoint row without its logic does not count as
coverage.

Give every component page an owned-code tour. Account for each meaningful
first-party file the component owns: explain its responsibility, important
symbols or settings, how it participates in runtime behavior, and which other
files depend on it. Closely related mechanical files may share one entry, but a
directory summary or list of paths is not a code tour. Walk through every major
component-owned flow step by step rather than compressing several flows into one
overview paragraph.

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

`docs/code-map.md` is the auditable source-to-document index. It lists every
relevant first-party file from the inventory,
its responsibility, owning component, key symbols or settings, and a link to the
page and section that explains its behavior. It is a navigation aid, not a
replacement for those explanations. Its discovered and documented totals must
match; exclusions are listed with reasons. Use one row per meaningful file and
exact section anchors. Only generated boilerplate or mechanically identical
files may share a row, and every grouped path must still be written explicitly.

Use separate development, integrations, security, operations, testing, data
model, or glossary pages only when the user explicitly approves one because the
topic crosses several major subsystems and cannot be taught coherently in
`architecture.md` or their component pages. Do not propose supporting pages
merely because a component page will be long. Never create supporting pages to
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
worktree. If research reveals that an unapproved page is necessary, pause and
propose that scope amendment. Use stable headings. Match length to the material:
do not pad with restated structure or filler, but do not trim real detail for
the sake of brevity — a large or intricate component earns a long page.

### Writing waves

After approval, assign every component or disjoint page group to a fresh writer
with exclusive ownership of those documentation paths. Give it the approved
coverage contract and research dossier, but require it to reread the assigned
source. Run writers in parallel. Never let multiple agents edit the same file,
and never ask one agent to draft several unrelated major subsystems merely to
reduce agent turns. When several research partitions feed one subsystem page,
their agents return detailed section material to that page's single integrating
writer rather than creating extra documents.

Each writer explains every owned major flow step by step; state transitions and
data transformations; branching and failure behavior; integration contracts;
configuration and operational consequences; tests and validation strategy;
debugging procedures; at least one complete maintenance walkthrough; and the
owned-code tour. A writer reports gaps but does not certify its own page as
complete.

Each major subsystem page includes at least three end-to-end maintenance guides
grounded in the repository: one representative feature change, one failure or
debugging investigation, and one configuration, interface, or integration
change. Each guide explains how to locate the behavior, which symbols and state
participate, which invariants and consumers can break, how to implement and
validate the change, and how to recognize an incorrect result.

Give every major flow its own anchored walkthrough. State its trigger,
preconditions, ordered path-and-symbol call chain, branching decisions, data or
state transformations, outputs and side effects, failure branches, recovery and
observability, and validation evidence. Component pages also include explicit
interface, state/data, behavior-changing configuration, failure/recovery, and
maintenance-task registers. For HTTP, RPC, event, CLI, or message interfaces,
document each operation's input, output, side effects, and failure behavior;
never collapse a family of materially different operations into one sentence.

After component drafts exist, run separate synthesis passes in this order:

1. approved cross-cutting data, integration, security, testing, development, or
   operations pages;
2. `docs/architecture.md`, synthesized from all component pages, research
   dossiers, and relevant source;
3. `docs/conventions.md`, grounded in executable configuration and repeated
   code evidence; and
4. `docs/code-map.md`, built last with exact links to substantive explanations.

The architecture pass is a full project explanation, written after the
component research so it can integrate all evidence without becoming a mere
summary. It reconciles shared terminology, producer/consumer
relationships, cross-component state ownership, end-to-end flows, error
propagation, trust boundaries, startup and shutdown, operational lifecycle, and
where common categories of change begin. It walks through the complete feature
set at system level and explains how the pieces produce each behavior. Do not
produce it by shortening the component pages, listing their headings, or
delegating essential explanations to links.

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

Depth must reflect complexity. In a nontrivial multi-subsystem repository, an
architecture guide below 5,000 words or a major subsystem page below 3,000 words
fails the depth gate. Architecture is normally the longest or one of the
longest pages because it must teach the whole project and every feature at
high-to-mid level; component length then grows with implementation complexity.
These are anti-compression floors, not completeness targets: do not aim to land
near them, and never add filler to reach them. Keep adding concrete logic,
feature behavior, flow walkthroughs, state, edge cases, examples, failure
recovery, implementation and testing detail, and maintenance guidance until
coverage is actually complete. Neither the writer nor coordinator may
self-approve an exception.

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

### Independent review waves

The writers and coordinator cannot certify their own completeness. After all
drafts exist, use fresh read-only review agents. Run at least these independent
audits:

- **Source coverage:** partition source across reviewers, verify every code-map
  row and exact anchor, and confirm the linked section explains runtime behavior
  rather than merely naming the file.
- **Workflow:** retrace every major flow from source and compare its ordered
  steps, alternatives, state changes, side effects, failures, and recovery with
  the documentation.
- **Standalone onboarding:** read only the documentation first and record every
  question a new developer still cannot answer; inspect source afterward to
  find missing explanations or contradictions.
- **Prose:** check learning order, consistent terminology, simple language,
  unexplained jargon, repetition, fluff, and compressed lists masquerading as
  explanations.

Reviewers report findings and do not edit. Send every concrete finding back to
the page-owning writer in another parallel correction wave, then use fresh
reviewers to recheck it. Repeat until no material finding remains or a concrete
repository evidence gap is documented. Do not impose a remediation-cycle limit
or stop because additional review costs tokens or time.

Then perform the final coverage and onboarding review against the inspection inventory.
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
7. begin productive work without first reverse-engineering undocumented logic,
   features, state, constraints, interfaces, or failure behavior from source.
8. after reading `architecture.md`, enumerate the project's features, explain
   the domain and runtime model, trace the main control and data flows, describe
   every major subsystem and its interactions, and know which component page
   contains the next level of detail.
9. after reading a component page, explain its design and implementation, trace
   its internal behavior through concrete files and symbols, choose the right
   tests, debug likely failures, and make a representative change without first
   reverse-engineering that subsystem from scratch.

If the documentation cannot answer one of these, inspect the source again and
fill the gap before finishing, or call out a concrete repository evidence gap.
Account for every coverage-inventory item in a document or in the final list of
evidence gaps. Review the reading order, terminology, cross-links, and prose as
one connected learning path rather than judging each file in isolation.
Rebuild `docs/code-map.md` from the finished pages and verify that its discovered
and documented file totals match. Follow every section link and sample the
claimed explanation; a path mention without an explanation does not count.
Report word counts as evidence that the hard depth gates ran, not as proof of
quality. A page that merely touches every requested heading does not pass this
review, regardless of its length or code-map entry.

Commit on the documentation branch only when the user has asked for a committed
change; pushing and all external actions require separate authorization.
