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
2. Resolve the project root and read `adw.yaml`. Require an attached configured docs worktree; recommend `adw:init` if initialization is incomplete.
3. Inspect repository-owned sources in this order:
   - manifests, workspace declarations, and task runners;
   - CI workflows and build configuration;
   - source entry points and dependency boundaries;
   - `README.md`, `docs/`, ADRs, runbooks, and provider instruction files.
4. Propose:
   - project purpose, component paths, responsibilities, and dependencies;
   - important entry points, conventions, and protected areas;
   - validation commands with an exact source path and key, target, job, or heading;
   - links to authoritative project documentation instead of copied detail.
5. Separate verified facts, inferences requiring confirmation, and unresolved values. Never invent a command or mark an inferred command verified.
6. Show the exact proposed diff for `adw.yaml`, `worktrees/docs/architecture.md`, and only the necessary `worktrees/docs/components/<component>.md` files. Preserve unrelated config, historical `changes/`, `SYNC.yaml`, and repository-owned docs.
7. Request explicit approval. If approval is absent, stop after the proposal.
8. After approval, recheck that source files and target bytes have not changed, apply only the approved diff, validate `adw.yaml` with `<plugin-root>/lib/adw-helper.mjs`, and show the resulting diff. Do not commit or push unless separately authorized.

Keep context concise and navigational. Never create plugin files, edit devcontainers, or duplicate detailed project documentation.
