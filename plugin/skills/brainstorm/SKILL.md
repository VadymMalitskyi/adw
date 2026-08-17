---
name: brainstorm
description: Facilitate a rigorous, interactive discovery conversation for an early product, engineering, or process idea. Use when the user has an uncertain idea and wants probing questions, challenged assumptions, alternative directions, and a decision-ready brief before invoking adw:plan. Do not use when the user has already chosen a direction and asks for an implementation plan.
---

# Brainstorm an idea

Keep this conversation exploratory and read-only. Do not edit files, create
branches or worktrees, run project commands, produce an implementation plan, or
invoke `adw:plan`. A brainstorm brief is discussion material, never
authorization.

Read `<plugin-root>/authorization.md` and resolve the plugin root as described
there. Read repository-owned instruction files. Inspect repository code only
when it would materially answer a question about the idea; state what was read
and distinguish evidence from speculation.

## 1. Establish the problem

Start with the user's idea in their own language. Do not turn it into a solution
too soon. Learn the outcome they want, who experiences the problem, what happens
today, and why the problem matters now.

Ask a small, high-value batch of questions (normally two to four), then wait for
answers. Adapt the next batch to what remains uncertain; do not dump a generic
questionnaire or repeat answers the user already gave.

Probe, as relevant:

- the concrete user, job, workflow, or failure being addressed;
- evidence of the problem and its severity or frequency;
- desired outcome, success measures, and non-goals;
- constraints: time, budget, platform, privacy, compatibility, ownership, and
  available data or integrations;
- alternatives the user has tried or could use without building anything.

## 2. Challenge the framing

Be constructive but demanding. Name assumptions explicitly and test the
load-bearing ones. Ask follow-up questions when a request is ambiguous,
contradictory, too broad, solution-led, or based on unverified claims.

Offer a sharper restatement of the problem when useful and ask the user to
correct it. Surface scope creep, hidden stakeholders, operational costs, abuse
or failure cases, and reasons the proposed change might not solve the stated
problem. Prefer precise questions such as “What decision changes if this works?”
over vague prompts such as “Can you clarify?”

Do not be adversarial for its own sake: stop pressing a point after the user has
made an informed tradeoff, and label unresolved uncertainty rather than treating
it as failure.

## 3. Explore directions together

Once the problem is sufficiently clear, propose two to four materially distinct
directions. Include a smaller, lower-risk, or no-build option whenever it is
plausible. Do not present cosmetic variations as separate options.

For each direction, explain briefly:

- the core idea and the user outcome it targets;
- benefits and main tradeoffs;
- key assumptions, risks, and dependencies;
- the fastest useful validation or experiment; and
- rough relative effort or reversibility only when enough evidence supports it.

Invite critique and iteration. Revise, combine, or discard directions based on
the discussion. Do not select a direction on the user's behalf when the choice
depends on their priorities; state the decision clearly and ask for it.

## 4. Close with a planning handoff

When the user selects a direction, return a concise **brainstorm brief** in the
conversation:

- problem and intended outcome;
- intended users, boundaries, and non-goals;
- selected direction and why it won;
- alternatives considered and why they were not selected;
- assumptions, risks, open questions, and validation ideas; and
- a suggested next step: refine the brief, validate an uncertainty, use
  `adw:quick` for a genuinely small and well-understood correction, or invoke
  `adw:plan` for a repository-grounded implementation plan.

Never write this brief to the documentation branch or claim that it is a plan.
Start `adw:plan` only after the user explicitly asks to plan the selected
direction. Preserve unresolved decisions in the handoff rather than inventing
answers for them.
