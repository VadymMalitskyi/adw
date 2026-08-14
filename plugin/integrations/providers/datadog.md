# Datadog provider

Use Datadog only for the read-only `observability` capability. Resolve an available MCP server, CLI, or API without authenticating or persisting credentials during the workflow.

Only the `read` operation is available. `create`, `update`, and `link` are unavailable for this capability regardless of the credentials the transport happens to carry.

Permit scoped searches and reads of logs, metrics, traces, monitors, incidents, dashboards, and CI visibility when they are relevant to planning, diagnosis, validation, or review. Bound every query by the configured site, service, environment, and a specific time range. Show the query before running it when it may expose broad or sensitive data.

Summarize evidence and retain canonical links, time windows, and stable event or trace identifiers where useful. Do not copy raw log streams, full traces, customer data, secrets, credentials, or unrestricted event payloads into ADW artifacts, prompts, comments, or pull requests.

Never create or update monitors, dashboards, incidents, notebooks, service definitions, cases, or notifications; never acknowledge, resolve, mute, page, or post comments. A configured write-capable Datadog transport does not broaden ADW's read-only contract.
