---
name: investigate
description: Investigate an operational alert against configured observability evidence and repository code without changing either, producing a severity assessment, likely cause, and a safe remediation proposal. Use when a monitor, incident, error spike, trace, or log signal needs analysis.
---

# Investigate an alert

The entire workflow is read-only. Produce an evidence-backed report; do not edit
code, create branches, run project commands, write files, send notifications, or
mutate any external system.

Read `<plugin-root>/authorization.md` and resolve the plugin root as described
there. Follow `<plugin-root>/integrations/contracts.md` for provider reads.

## 1. Establish the signal

Run `adw config` to learn the components and the configured observability
provider. Identify precisely what fired: the monitor or alert, when it started,
what it measures, and its threshold. If any of that is unclear, ask rather than
assume — an investigation built on a misread alert is worse than none.

## 2. Gather evidence

Use read-only provider operations only. Skip any provider that is not
authenticated and say so; never authenticate, refresh a token, or install
anything.

Correlate:

- the observability signal — error rates, latency, traces, logs around the onset;
- deployment and merge history near the onset (`git log`, and read-only code-host
  queries);
- the code paths the signal implicates.

Anchor each claim to the evidence that supports it. Where the evidence is thin,
say the conclusion is provisional.

## 3. Report

- **Severity** — user-visible impact, scope, and whether it is worsening.
- **Likely cause** — the most probable explanation with its evidence, and the
  next most probable alternative with what would distinguish them.
- **What you ruled out** — and why.
- **Remediation proposal** — the smallest safe change, and separately any
  operational mitigation. Say what you are uncertain about.
- **What would confirm it** — the specific query, log, or test that would settle
  the open question.

## 4. Hand off

Stop at the report. If the user wants the fix, that is `adw:plan` for anything
substantial or `adw:quick` for a genuinely small correction — each starts from
this evidence rather than acting on it here.

Never post the report to an external system, update an incident record, or
comment on a tracker item without explicit approval for that exact action.
