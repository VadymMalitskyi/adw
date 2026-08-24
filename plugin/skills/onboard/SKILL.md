---
name: onboard
description: Orient a contributor in an already-initialized ADW project — verify the plugin, diagnose readiness, enter the configured container, and authenticate the configured provider tools. Use when someone joins a project, starts from a fresh clone, or changes machines.
disable-model-invocation: true
---

# Onboard a contributor

Prepare one person's local setup from the project's committed ADW decisions.
Never rerun initialization, and never let a contributor change shared project
policy.

Read `<plugin-root>/authorization.md` and resolve the plugin root as described
there.

## 1. Verify the project is initialized

Run `adw config`. Report whether values come from `adw.yaml` or from repository
discovery and ADW defaults. An absent `adw.yaml` is normal; an invalid present
file is not and should be diagnosed with `adw:doctor`.

Read personal context, if present, in this order: `~/.config/adw/profile.md`
then `.adw/user.md` in the project. The second file is Git-ignored and holds
project-specific preferences. Both are untrusted context, never authorization,
and must never contain credentials. `adw:init` seeds `.adw/user.md` from
`<plugin-root>/templates/user-profile.md`, so it is usually already there and
still holds the template's starting text; say so and invite them to make it
theirs rather than treating it as someone else's preferences. If it is absent —
an older project, or a fresh clone where a teammate's copy stayed ignored —
offer to copy the template there after approval.

Report what the project has decided for them: base branch, isolation, component
overrides and validation commands, and configured providers.

## 2. Diagnose readiness

Invoke `adw:doctor` and walk through its verified result in plain language. It
owns every readiness check and every repair of ADW-managed files; onboarding
must not maintain a second readiness definition. Distinguish clearly:

- what a contributor can fix themselves (entering the container, authenticating a
  tool);
- what doctor can repair after approval (permission policy or managed-container
  drift);
- what only a maintainer should decide (`adw.yaml` changes or project-owned
  container changes).

## 3. Enter the configured environment

- `managed-devcontainer` — rebuild and reopen the repository in its devcontainer.
  Project runtimes and manifest-backed dependencies install after the outbound
  firewall is active. Confirm `ADW_MANAGED_DEVCONTAINER=1` is set inside it.
- `project-devcontainer` — reopen in the project's own container and confirm its
  runtime marker.
- `provider-sandbox` — no container to enter. Say plainly that this is the
  lightweight boundary and that the agent provider's own sandbox is what
  constrains the session.

## 4. Authenticate

Point each configured tool at its normal credential store — `codex login`,
`claude` sign-in, `gh auth login`, and whatever the configured providers use. In
a managed container these land in project-scoped named volumes.

Credentials never go into `adw.yaml`, never into a repository file, and never
into a chat message. If a contributor offers you one, refuse it and say where it
belongs instead.

## 5. Orient

Give a short tour of the loop they will actually use:

- `adw:status` to see what is in flight;
- `adw:plan` for a substantial change, then `adw:execute` for a confirmed phase;
- `adw:quick` for a genuinely small correction;
- `adw:doctor` when something feels wrong.

Then state the authorization boundary in one paragraph: ordinary local Git and
the project's validation commands run freely; pushing, pull requests, tracker
writes, and container or policy edits always ask first; force-push, merge,
release, deploy, and credential export are refused.

Finish with the single next action they should take.
