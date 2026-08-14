---
name: doctor
description: Diagnose an ADW installation and initialized project without changing it. Use when checking the project contract, execution isolation, managed or project devcontainers, provider availability, routing blocks, or docs freshness.
---

# Diagnose ADW

Perform every check read-only. Do not repair files, create caches, refresh providers, or run project commands.

1. Resolve the installed plugin root from this loaded skill:
   - In Claude Code, expand `${CLAUDE_PLUGIN_ROOT}` and use `${CLAUDE_PLUGIN_ROOT}/skills/doctor/SKILL.md` as this skill's absolute locator.
   - In Codex, use the absolute source location advertised for this skill, specifically its absolute `SKILL.md` locator.
   - Remove `/skills/doctor/SKILL.md` from that locator. Never assume that the current working directory is the plugin root, and never derive plugin resources from the target project.
   - Resolve `execution/contracts.md`, `integrations/contracts.md`, and provider references from that same root.
2. Resolve the project root with `git rev-parse --show-toplevel`. Stop if the requested directory is not that root.
3. Run `node <plugin-root>/skills/doctor/scripts/snapshot.mjs --project-root <project-root>`.
4. Report each pass, warning, informational result, and failure. Include:
   - both provider manifests, the shared version, and the shared skill tree;
   - the `adw: 1` project contract and its configured docs checkout;
   - exactly one bounded routing block in `AGENTS.md` and `CLAUDE.md`;
   - ignored `.adw/` and root-level `/worktrees/` paths;
   - the attached docs worktree and sync-marker freshness;
   - declared components, their paths, and whether each has a validation command;
   - optional origin and project-owned devcontainer state.
5. If `adw.yaml` cannot be read against the `adw: 1` contract, report the exact validation errors and stop before every check that assumes a readable configuration. Change nothing, and never translate, rewrite, or reinterpret the file — offer `adw:init` as a separate reviewed follow-up instead.
6. Follow the execution contract for the configured isolation, and only that one:
   - `provider-sandbox`: report the real active filesystem, network, and approval policy that a script cannot attest, and say plainly that this is the lightweight boundary.
   - `project-devcontainer`: require its runtime marker and report material deviations from the managed baseline without changing the project-owned container.
   - `managed-devcontainer`: verify the marker, pinned agents, root-owned firewall wiring, project-scoped volumes, absence of forbidden mounts, the non-root runtime marker, the generated permission files for both providers, and current execution inside the container.
   Summarize each as a concise pass or fail. Keep marker digests, permission-rule generation, proxy implementation, and firewall internals out of the ordinary report; include them only when a failure needs that detail to diagnose. A configured container that is not the active runtime is a failure for workflows that execute project code.
7. If `adw.yaml` declares providers, follow the integration contract and inspect `work_tracker`, `code_host`, `observability`, and `knowledge` independently. Report capability, provider, whether it is required, selected or available `native|mcp|cli|api` transports, existing authentication state, and which of `read`, `create`, `update`, and `link` are actually supported. Do not authenticate, refresh tokens, install software, retrieve business content, or mutate anything. Treat an unavailable required capability as a failure, and an unavailable optional capability as a warning that never blocks the lightweight path. Never print credentials or secret environment values.
8. If no providers are declared, report `lightweight: no providers configured` and do not probe external tools.
9. Treat a missing resource, a literal unexpanded Claude variable, or a path outside the installed plugin root as a plugin failure.
10. Offer `adw:init`, `adw:update`, or a manual project edit as a separate follow-up. Make no repair during doctor.

Resolve any bundled template, helper, or script from the same plugin root. Never write generated state into the installed plugin directory.
