# GitHub provider

Use GitHub for `code_host` and, when configured, `work_tracker` through Issues. Resolve transport independently through an available native connector, GitHub MCP server, authenticated `gh`, or API. Do not authenticate, install `gh`, change Git remotes, or persist tokens implicitly.

For pull requests, identify the exact owner/repository, base branch, and head branch. Reuse the open pull request for that exact head rather than creating a duplicate. Before creation or update, show the title, draft state, base/head, and complete redacted body or comment. ADW may create only a draft pull request; it never marks ready, approves, merges, closes, releases, or deploys.

Use the idempotency key in a durable HTML comment in a created issue, pull-request body, or status comment, and search exact head/object plus marker before creating. Read back node/number, canonical URL, state, draft flag, base/head, and updated revision timestamp. Update the existing ADW status comment rather than stacking duplicates.

For GitHub Issues as `work_tracker`, normalize title, body requirement sections, and configured labels as requirement-bearing. Treat state, assignee, milestone, project fields, comments, reactions, and linked pull requests as operational unless explicitly included by the specification.
