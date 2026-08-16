---
name: onboard
description: Orient a contributor in an already-initialized ADW project — verify the plugin, diagnose readiness, enter the configured container, and authenticate the configured provider tools. Use when someone joins a project, starts from a fresh clone, or changes machines.
---

# Onboard a contributor

Prepare one person's local setup from the project's committed ADW decisions.
Never rerun initialization, and never let a contributor change shared project
policy.

Read `<plugin-root>/authorization.md` and resolve the plugin root as described
there.

## 1. Verify the project is initialized

Run `adw config`. If `adw.yaml` is missing, stop: only a maintainer should run
`adw:init`. If it is present but invalid, stop and point at `adw:doctor`, which
reports the exact errors without changing anything.

Report what the project has decided for them: base branch, isolation, components
and their validation commands, and any configured providers.

## 2. Diagnose readiness

Run `adw doctor --project-root <project-root>` and walk through the results in
plain language. Distinguish clearly:

- what a contributor can fix themselves (entering the container, authenticating a
  tool);
- what only a maintainer should fix (permission policy drift, managed container
  drift — those go through `adw:update`).

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
