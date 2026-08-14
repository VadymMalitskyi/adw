---
name: discover
description: Analyze a repository and propose concise ADW project and component context grounded in observable sources. Use when initially mapping architecture, refreshing component boundaries, or discovering verified validation commands; write only after explicit approval.
---

# Discover Project Context

Inspect first and propose a reviewable context diff. Write nothing until the user explicitly approves that diff.

1. Resolve the installed plugin root from this loaded skill:
   - In Claude Code, expand `${CLAUDE_PLUGIN_ROOT}` and use `${CLAUDE_PLUGIN_ROOT}/skills/discover/SKILL.md` as this skill's absolute locator.
   - In Codex, use the absolute loaded source location advertised when this skill loaded, ending in `/skills/discover/SKILL.md`.
   - Remove `/skills/discover/SKILL.md` from that locator to obtain `<plugin-root>`. Never derive plugin resources from the current working directory or from the target project.
   - Resolve `execution/contracts.md`, `integrations/contracts.md`, and any selected provider reference from that same `<plugin-root>`.
2. Resolve the project root and read the root `adw.yaml`. It is the small handwritten `adw: 1` contract; there is no project schema version to dispatch on and no artifact registry to consult. Require an attached configured docs worktree at `docs.worktree`; recommend `adw:init` when initialization is incomplete.
3. Enforce the configured `execution.isolation` before running any project command or writing anything. When a discovered tool or provider needs a network destination that a managed devcontainer does not already allow, include the exact reviewed `allowed-domains.txt` addition and the required rebuild in the proposal. That addition is the only devcontainer edit this workflow may propose.
4. Treat external systems as the provider-neutral `work_tracker`, `code_host`, `observability`, and `knowledge` capabilities defined in `integrations/contracts.md`. Keep the provider separate from its `native|mcp|cli|api` transport, and express availability only as `required: true` or `required: false`.
5. Inspect repository-owned sources read-only, in this order:
   - manifests, workspace declarations, and task runners;
   - CI workflows and build configuration;
   - source entry points and dependency boundaries;
   - `README.md`, `docs/`, ADRs, runbooks, and provider instruction files.
6. Propose:
   - project purpose, component ids, component paths, responsibilities, and dependencies;
   - important entry points, conventions, and protected areas;
   - `components.<id>.validate` commands, each carrying an exact observable source: a source path plus the key, target, job, or heading that declares it;
   - links to authoritative project documentation instead of copied detail;
   - when the user requests provider discovery, `providers:` entries keyed by capability, each with `provider`, `required: true|false`, and only non-secret opaque `settings` such as an organization, project, repository, or parent identifier.
7. Separate verified facts, inferences that need confirmation, and unresolved values. A command is verified only when an observable repository source declares it and you name that source. Never invent a command, never mark an inferred command verified, and never promote a plausible convention to a fact.
8. Never derive provider binding, creation intent, cardinality, object type, or business-field requirements from repository layout or from a provider merely being installed. Those come only from an explicit statement by the project owner. ADW has no work-item profiles, payload profiles, or tracker workflow policy to discover.
9. Show the exact proposed diff for `adw.yaml`, the docs-worktree `architecture.md`, and only the necessary docs-worktree `components/<component>.md` files. Preserve unrelated configuration, `changes/`, `SYNC.yaml`, and repository-owned documentation exactly as they are.
10. Request explicit approval of that diff. If approval is absent, stop after the proposal.
11. For proposed providers, inspect only existing local configuration and authentication status. Record a machine-local transport choice in ignored `.adw/local.yaml`. Never authenticate, install a tool, copy credentials, broaden permissions, or contact an external system merely to discover configuration. Omit `providers:` entirely for a lightweight project.
12. After approval, recheck that the inspected sources and the target bytes have not changed, apply only the approved diff, then validate the result by piping `{"project_root":"<project-root>","path":"adw.yaml"}` to:

```text
node <plugin-root>/lib/adw-helper.mjs load-project
```

Use `validate-project` with `{"data":<proposed config>}` to check a candidate configuration before writing it. Correct every reported error without weakening evidence or inventing a value, then show the resulting diff. Do not commit or push unless separately authorized.

Keep context concise and navigational. Never create plugin files, alter managed container invariants, or duplicate detailed project documentation.
