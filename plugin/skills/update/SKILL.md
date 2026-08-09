---
name: update
description: Preview and repair current-schema ADW-managed development and permission files after a plugin update while refusing unsupported project schemas. Use after a provider-managed plugin update or managed-file doctor failure.
---

# Check Compatibility and Repair Managed Files

Provider plugin managers update ADW itself. This release supports only its current project schema and does not carry automatic schema migrations. For a current-schema project, this workflow can regenerate only ADW-owned managed-development and permission files through an exact preview/digest/apply flow; it never rewrites `adw.yaml`, application code, project-owned containers, docs history, or approvals.

1. Resolve the installed plugin root from this loaded skill:
   - In Claude Code, expand `${CLAUDE_PLUGIN_ROOT}` and use `${CLAUDE_PLUGIN_ROOT}/skills/update/SKILL.md` as this skill's absolute locator.
   - In Codex, use the absolute `SKILL.md` source locator advertised when this skill loaded.
   - Remove `/skills/update/SKILL.md` from that locator. Never derive plugin resources from the current working directory.
2. Resolve the project root with `git rev-parse --show-toplevel` and run `node <plugin-root>/skills/update/scripts/update.mjs preview --project-root <project-root>`.
3. If an unsupported schema is detected, stop. Report the installed plugin version, project schema, and supported schema. Do not attempt an automatic schema migration, downgrade, or partial rewrite.
4. For a current-schema project, review every proposed write. Provider-sandbox and project-owned-container projects normally have an empty write set. Managed-container projects may propose current release bytes for `.devcontainer/` and only the selected agents' project permission files, preserving the selected agent profile and configured allowlist domains.
5. If no repair is required, report compatibility and stop. Otherwise present the full path list and preview digest and obtain explicit confirmation.
6. After confirmation, run the same command as `apply --confirmed --preview-digest <digest>`. Any change to HEAD, current managed bytes, generated environment evidence, installed plugin version, or proposed target bytes invalidates the digest. Review the resulting diff; do not commit or push unless separately authorized.

The repair is an atomic, precondition-checked regeneration of release-owned current-schema files, not a migration of historical schemas or workflow evidence.
