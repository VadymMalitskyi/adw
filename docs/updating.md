# Updating and recovery

## Plugin updates

Plugin managers distribute skill, schema, template, and helper changes. Pin private installations to a semantic-version tag for reproducibility. After updating the marketplace snapshot, reinstall or update the provider plugin and start a new session.

Run `adw:doctor` before resuming active work. Roll back through the provider manager to the previous tag when needed.

## Current-schema compatibility

ADW supports only the project, plan, and approval schemas shipped by the current release: project schema 5, plan schema 2, and approval schema 2. Earlier ADW schemas and their migration paths are intentionally not bundled.

Run `adw:update` to check compatibility and preview managed-file repair:

1. It reads the installed plugin version and bundled project schema.
2. It parses and validates root `adw.yaml` through the bundled YAML 1.2 and schema validator without rewriting the file.
3. For provider-sandbox and project-owned-container profiles it reports compatibility and normally an empty write set.
4. For a managed container it deterministically regenerates current release `.devcontainer/` and selected-agent permission bytes, showing changed paths and a preview digest. `apply --confirmed --preview-digest <digest>` atomically repairs exactly those reviewed files.
5. It rejects every unsupported schema without modifying project or historical artifacts.

This repairs exact plugin-version marker drift and managed-template drift after ordinary plugin upgrades. For an unsupported project schema, perform a separately reviewed manual replacement of ADW-owned configuration. Preserve application code and repository-owned documentation, but do not copy old approvals or claim old workflow evidence remains valid under the current contracts.

## Docs synchronization recovery

`adw:sync-docs` reports drift without mutation by default. Authorized fix mode stops on dirty state, ambiguous history, or a non-fast-forward docs branch. Resolve or preserve the competing docs work first, refresh the report, and authorize a new update. Never force-push the docs branch or advance `SYNC.yaml` without the corresponding reviewed context update.

## Active-change recovery

Use `adw:status` in a new session. It reconstructs current-schema spec, plan, approval bundle, external bindings and receipts, docs commit, code branch, validation, and draft-PR state from durable artifacts. If local intent or bound requirement content no longer matches approval, amend or reapprove before execution. Provider state is read only when its capability is configured and available.
