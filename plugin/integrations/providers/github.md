# GitHub provider

Use GitHub for `code_host` and, when configured, `work_tracker` through Issues. Resolve transport independently through an available native connector, the GitHub MCP server, an authenticated `gh`, or the API. Do not authenticate, install `gh`, change Git remotes, or persist tokens implicitly.

## code_host defaults

Identify the exact owner/repository, base branch, and head branch. Reuse the open pull request for that exact head rather than creating a duplicate. Before creation or update, show the title, draft state, base/head, and complete redacted body.

ADW may create only a **draft** pull request — one per execution group by default, or one for `adw/<change-id>/integration` in integration-PR delivery. It never marks ready, approves, merges, closes, releases, or deploys.

Carry the idempotency marker in a durable HTML comment inside the created object's body, and search the exact head plus marker before creating. Read back number, canonical URL, state, draft flag, and base/head. Update the existing ADW status comment rather than stacking duplicates.

## work_tracker defaults

Default object types are one **Issue** for the plan's parent item and one **Issue** per execution group, linked to the parent through a task-list reference. The optional `labels` setting may add project labels; ADW ships no field manifest.

Map the shared operations to issue search/read, issue creation with title and body, issue body or label update, and issue-to-issue or issue-to-pull-request linking. State, assignee, milestone, project fields, comments, and reactions are operational detail. Never close an issue automatically.
