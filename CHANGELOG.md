# Changelog

All notable changes to this private plugin are documented here.

## 0.2.0 - 2026-08-05

- Add provider-neutral integration contracts for work trackers, code hosts, observability systems, and knowledge systems.
- Add optional, required, and disabled integration behavior so lightweight projects remain unchanged.
- Add Azure DevOps-first work tracking, GitHub code hosting, Datadog read-only observability, and Notion knowledge-provider profiles.
- Add explicit authorization, idempotency, post-write readback, drift detection, and durable redacted receipts for external actions.
- Keep credentials outside committed ADW artifacts and allow native connector, MCP, CLI, or API transports without coupling workflows to one transport.

## 0.1.0 release candidate - 2026-08-05

- Add one shared ADW skill tree for Codex and Claude Code.
- Add private marketplace manifests for both providers.
- Add schema-validated project, planning, approval, and validation artifacts.
- Add the plan, approval, execution, maintenance, and migration workflows.
