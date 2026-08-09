---
name: discover
description: Analyze a repository and propose concise ADW project and component context grounded in observable sources. Use when initially mapping architecture, refreshing component boundaries, or discovering verified validation commands; write only after explicit approval.
---

# Discover Project Context

Inspect first and propose a reviewable context diff. Write nothing until the user explicitly approves that diff.

1. Resolve the installed plugin root from this loaded skill:
   - In Claude Code, expand `${CLAUDE_PLUGIN_ROOT}` and use `${CLAUDE_PLUGIN_ROOT}/skills/discover/SKILL.md` as this skill's absolute locator.
   - In Codex, use the absolute `SKILL.md` source locator advertised when this skill loaded.
   - Remove `/skills/discover/SKILL.md` from that locator. Never derive plugin resources from the current working directory.
   - Resolve `execution/contracts.md`, `integrations/contracts.md`, and selected provider references from that same root.
2. Resolve the project root and read `adw.yaml`. Require an attached configured docs worktree; recommend `adw:init` if initialization is incomplete.
3. Enforce the configured execution profile before project commands or writes. When adding an integration or tool domain to a managed container, include the exact `allowed-domains.txt` change and required rebuild in the proposal.
4. Treat integrations as provider-neutral `work_tracker`, `code_host`, `observability`, and `knowledge` capabilities. Keep providers separate from `native|mcp|cli|api` transports and classify each as `disabled`, `optional`, or `required`.
5. Inspect repository-owned sources in this order:
   - manifests, workspace declarations, and task runners;
   - CI workflows and build configuration;
   - source entry points and dependency boundaries;
   - `README.md`, `docs/`, ADRs, runbooks, and provider instruction files.
6. Propose:
   - project purpose, component paths, responsibilities, and dependencies;
   - important entry points, conventions, and protected areas;
   - validation commands with an exact source path and key, target, job, or heading;
   - links to authoritative project documentation instead of copied detail.
   - when the user requests integration discovery, capability-based `integrations` entries with provider, `disabled|optional|required` requirement, non-secret organization/project/repository or parent identifiers, and read/write policy.
   - only from explicit project-owner requirements, optional schema-4-or-5 `workflows.work_tracker` policy and project-owned `adw/work-items/*.yaml` profiles defining provider, object type, required/allowed/default fields, and requirement-bearing fields.
7. Separate verified facts, inferences requiring confirmation, and unresolved values. Never invent a command or mark an inferred command verified.
8. Validate proposed work-item profiles as artifact `work-item-profile`. Show the exact proposed diff for `adw.yaml`, explicitly requested `adw/work-items/*.yaml` profiles, `worktrees/docs/architecture.md`, and only the necessary `worktrees/docs/components/<component>.md` files. Preserve unrelated config, historical `changes/`, `SYNC.yaml`, and repository-owned docs. Never infer binding, creation, cardinality, object type, or business-field requirements from repository layout or provider availability.
9. Request explicit approval. If approval is absent, stop after the proposal.
10. For proposed integrations, inspect only existing local configuration and authentication status. Put machine-local transport selection in ignored `.adw/local.yaml`, and never authenticate, install a tool, copy credentials, or contact an external system merely to discover configuration. Omit integrations entirely for a lightweight project.
11. After approval, recheck that source files and target bytes have not changed, apply only the approved diff, validate `adw.yaml` with `<plugin-root>/lib/adw-helper.mjs`, and show the resulting diff. Do not commit or push unless separately authorized.

Keep context concise and navigational. Never create plugin files, alter managed container invariants, or duplicate detailed project documentation. A reviewed allowed-domain addition is the only devcontainer edit in this workflow.
