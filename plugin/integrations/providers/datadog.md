# Datadog provider

Use Datadog for the `observability` capability. It is read-only by default. Resolve an available MCP server, CLI, or API without authenticating or persisting credentials during the workflow.

`read` is available without an approval prompt. Writes require both provider `access: read-write` and an exact permission-policy operation/tool mapping; their default decision is `ask`. Delete remains denied. Credentials alone never grant an operation.

Permit scoped searches and reads of logs, metrics, traces, monitors, incidents, dashboards, and CI visibility when they are relevant to planning, diagnosis, validation, or review. Bound every query by the configured site, service, environment, and a specific time range. Show the query before running it when it may expose broad or sensitive data.

Summarize evidence and retain canonical links, time windows, and stable event or trace identifiers where useful. Do not copy raw log streams, full traces, customer data, secrets, credentials, or unrestricted event payloads into ADW artifacts, prompts, comments, or pull requests.

When `access: read-write` is configured, a mapped create/update/comment action may proceed under its effective `allow` or `ask` decision. Always read back and verify the result. Delete, notification delivery, paging, incident resolution, and broad unscoped mutations remain unavailable.
