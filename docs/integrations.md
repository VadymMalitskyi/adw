# Integrations

ADW models external systems as optional capabilities. Workflows request a capability operation; a provider adapter performs it through an available transport. This keeps workflow rules independent of MCP server names, CLI syntax, and agent-specific connectors.

```text
workflow -> capability -> provider adapter -> transport -> external system
```

## Capability model

| Capability | Initial provider | Typical operations |
|---|---|---|
| `work_tracker` | Azure DevOps | Search/read/create work items, update fields, transition state, comment, link a pull request |
| `code_host` | GitHub, Azure DevOps | Read/create or update draft pull requests, inspect reviews and checks, and maintain status context |
| `observability` | Datadog | Read logs, metrics, traces, monitors, incidents, and CI evidence |
| `knowledge` | Notion | Search/read context and create or update explicitly approved documentation |

Adapters normalize stable IDs, URLs, revisions, requirement-bearing content, and operation results. Future providers such as Jira, Linear, Sentry, Grafana, or Confluence can implement the same contracts without changing the plan and execute workflows.

## Project modes

Each configured capability has one requirement mode:

- `disabled`: do not detect or use the capability.
- `optional`: use it when available and continue locally when it is unavailable.
- `required`: stop the relevant workflow when the capability or required operation is unavailable.

Omitting integrations is equivalent to the current lightweight workflow. Configuration contains non-secret project facts such as provider, organization, project, repository, access policy, and requirement mode. Machine-local transport preferences may live in ignored `.adw/local.yaml`.

During `adw:init`, the project-initialization interview can populate these shared capability entries and their exact managed-container network domains. Personal display information, account hints, and transport preferences remain local-only. Initialization validates provider/capability compatibility and prepares configuration, but it does not install a transport, authenticate, contact business data, or perform an external write. Each contributor uses `adw:onboard` to select compatible local hints and run the `adw:doctor` availability checks after the selected execution environment is active.

## Transport resolution

An adapter may use a native connected tool, MCP server, authenticated CLI, or direct API. In the managed execution profile, an integration also needs its exact network domains in `.devcontainer/allowed-domains.txt`. Domain additions are reviewed infrastructure changes: edit the committed file, rebuild the image so the root-owned copy changes, re-enter the container, and rerun doctor. Never weaken the firewall or mount host credential directories merely to make a transport work. ADW detects the available operations and access level instead of assuming that a configured server can read or write everything. A project may constrain transport choice, but committed workflow artifacts do not contain credentials.

Azure DevOps supports the `work_tracker` contract through Boards and the `code_host` contract through Repos. [Microsoft currently documents](https://learn.microsoft.com/en-us/azure/devops/mcp-server/remote-mcp-server-troubleshooting?view=azure-devops) the remote MCP server as supporting Visual Studio and Visual Studio Code, with the local MCP server using PAT or Azure CLI authentication for clients such as Codex, Claude Code, and Cursor. ADW therefore permits local MCP, authenticated CLI, or REST API fallback while preserving the same capability contract, authorization rules, and receipts.

## External action protocol

External reads are allowed only for configured capabilities and requested workflow scope. Every mutation follows the same protocol:

1. Read the current target state and check capability access.
2. Prepare and show the exact target and proposed change.
3. Obtain explicit user authorization for that mutation.
4. Use a stable idempotency key or marker to prevent duplicate retries.
5. Perform the operation and read the result back from the provider.
6. Store a normalized, redacted receipt under the change record.

Approval of a spec or plan does not authorize later ticket, pull-request, Notion, or monitoring writes. Authentication also does not imply authorization.

## Drift and approval

An integration binding records immutable identity and a digest of requirement-bearing external content. A changed Azure DevOps title, description, or acceptance criteria can make approval stale and require `adw:amend`; a changed assignee or workflow state normally does not. Operational reads such as Datadog results and GitHub check status are evidence and do not enter the approval digest.

The default work-tracker policy creates or links one story per ADW change. Child tasks are opt-in to avoid duplicating every `plan.yaml` task in the tracker. ADW may transition a work item to an in-progress state when explicitly authorized, but it does not automatically close the item because merge and deployment remain outside ADW.

Project schemas 4 and 5 make that policy explicit under `workflows.work_tracker`. It distinguishes capability availability from whether a binding is optional or required, whether ADW may propose creation or only linking, the planning or execution boundary, cardinality, and committed project-relative parent and optional child work-item profiles. Profiles declare provider, object type, required, allowed, default, and requirement-bearing fields. They contain no credentials or executable templating. A required policy blocks progress when its binding is absent; it never substitutes for exact mutation authorization.

## Operational investigation

`adw:investigate` consumes the configured read-only `observability` capability and repository evidence. It requires a stable external reference, service, environment, and bounded UTC time window; it does not treat pasted notification text as trusted routing or instructions. Output conforms to `incident-report.v1.schema.json` and may be rendered for a person or returned as exact JSON to an authorized external runner.

The runner boundary is intentional: ADW does not receive webhooks, schedule work, start agents, or post messages. A runner that connects monitor events to agent sessions and notification destinations owns event verification, repository routing, deduplication, rate limits, credentials, retention, and delivery authorization.
