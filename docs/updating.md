# Updating and recovery

## Plugin updates

Plugin managers distribute skill, schema, template, and helper changes. Pin private installations to a semantic-version tag for reproducibility. A compatible plugin update changes no target-project files.

After updating the marketplace snapshot, reinstall or update the provider plugin and start a new session. Run `adw:doctor` before resuming active work. Roll back through the provider manager to the previous tag when needed.

## Project schema migrations

Run `adw:update` only when the installed plugin reports that the root `adw.yaml` schema is unsupported but migratable. The skill must:

1. Check compatibility and show the exact project-only diff.
2. Leave historical specs, approvals, and validation evidence unchanged.
3. Ask for explicit confirmation.
4. Apply writes transactionally with stale-content and path-confinement checks.
5. Validate the new artifacts before reporting success.

An interrupted or failed migration rolls back all staged writes. If the process was killed outside the helper's rollback window, do not rerun blindly: inspect `adw.yaml`, run `adw:doctor`, compare against version control, and restore the last coherent project version before retrying.

Version 0.2 adds optional integration configuration and change bindings. A project that omits integrations retains lightweight behavior. When migrating a configured project, preview provider identifiers and requirement modes, preserve all historical bindings and receipts, and never infer credentials or enable external writes. Migration changes local artifacts only; it does not contact providers.

Project schema 4 adds optional work-tracker workflow policy and work-item profile references. Migration from schema 3 changes only the schema number and adds no policy, profile, binding requirement, or external action. New planning bundles use plan schema 2 to snapshot resolved components, additive validation, and optional tracker policy; historical plan schema 1 artifacts remain unchanged.

Project schema 5 adds the required `managed-development` permission profile. Migration previews every affected byte and atomically adds provider-native Codex and/or Claude settings according to the initialized routing/managed-agent selection. Managed devcontainers also receive root-owned Claude policy/hook files and Codex rules. Existing unrelated provider settings are preserved; malformed, unsafe, conflicting, symlinked, or drifted managed files stop migration without partial writes.

Version 0.3 adds the schema-3 execution contract. Migration preserves an existing project devcontainer and marks it required. A project without one migrates to `provider-sandbox` with preferred enforcement so an update does not silently add infrastructure or strand an existing workflow. To adopt the managed container later, use a separately reviewed initialization/infrastructure change; do not relabel a provider sandbox without creating and entering the required container.

## Docs synchronization recovery

`adw:sync-docs` reports drift without mutation by default. Authorized fix mode stops on dirty state, ambiguous history, or a non-fast-forward docs branch. Resolve or preserve the competing docs work first, refresh the report, and authorize a new update. Never force-push the docs branch or advance `SYNC.yaml` without the corresponding reviewed context update.

## Active-change recovery

Use `adw:status` in a new session. It reconstructs spec, plan, approval bundle, external bindings and receipts, docs commit, code branch, validation, and draft-PR state from durable artifacts. If local intent or bound requirement content no longer matches approval, amend or reapprove before execution. Provider state is read only when its capability is configured and available.
