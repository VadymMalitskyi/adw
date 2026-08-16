import { ContractError, isObject } from "./safe-files.mjs";

export const PERMISSION_DECISIONS = Object.freeze(["allow", "ask", "deny"]);

// These defaults preserve the existing managed-development behavior. Projects
// may customize yellow operations, but the hard floors below always win.
const DEFAULTS = Object.freeze({
  github: {
    operations: { read: "allow", comment: "ask", create: "ask", update: "ask", close: "ask", execute: "ask", merge: "deny", release: "deny" },
  },
  notion: {
    operations: { read: "allow", comment: "ask", create: "ask", update: "ask", archive: "deny", delete: "deny" },
  },
  datadog: {
    operations: { read: "allow", comment: "ask", create: "ask", update: "ask", execute: "ask", delete: "deny" },
  },
});

const HARD_FLOORS = Object.freeze({
  github: { merge: "deny", release: "deny" },
  notion: { archive: "deny", delete: "deny" },
  datadog: { delete: "deny" },
});

// `allow` removes a human checkpoint, so only reviewed exact tool mappings may
// receive it. Projects can still map any exact tool to ask or deny.
const SAFE_ALLOW_TOOLS = Object.freeze({
  github: new Map([
    ["add_comment", "comment"], ["get_file_contents", "read"], ["get_pull_request", "read"],
    ["list_issues", "read"], ["list_pull_requests", "read"], ["search_issues", "read"],
  ]),
  notion: new Map([
    ["fetch", "read"], ["get_page", "read"], ["list_pages", "read"], ["search", "read"], ["search_pages", "read"],
  ]),
  datadog: new Map([
    ["get_logs", "read"], ["get_monitor", "read"], ["list_monitors", "read"], ["query_metrics", "read"], ["search_logs", "read"],
  ]),
});

export const PROVIDER_COMMANDS = Object.freeze({
  github: {
    read: [
      ["gh", "auth", "status"], ["gh", "repo", "view"],
      ["gh", "pr", "checks"], ["gh", "pr", "diff"], ["gh", "pr", "list"], ["gh", "pr", "status"], ["gh", "pr", "view"],
      ["gh", "issue", "list"], ["gh", "issue", "status"], ["gh", "issue", "view"],
      ["gh", "run", "list"], ["gh", "run", "view"], ["gh", "run", "watch"], ["gh", "workflow", "list"], ["gh", "workflow", "view"],
    ],
    comment: [["gh", "pr", "comment"], ["gh", "issue", "comment"]],
    create: [["gh", "pr", "create"], ["gh", "issue", "create"]],
    update: [["gh", "pr", "edit"], ["gh", "pr", "ready"], ["gh", "pr", "reopen"], ["gh", "pr", "review"], ["gh", "issue", "edit"], ["gh", "issue", "reopen"]],
    close: [["gh", "pr", "close"], ["gh", "issue", "close"], ["gh", "issue", "delete"]],
    execute: [["gh", "api"], ["gh", "run", "cancel"], ["gh", "run", "delete"], ["gh", "run", "rerun"], ["gh", "workflow", "disable"], ["gh", "workflow", "enable"], ["gh", "workflow", "run"]],
    merge: [["gh", "pr", "merge"]],
    release: [["gh", "release", "create"], ["gh", "release", "delete"], ["gh", "release", "edit"], ["gh", "release", "upload"]],
  },
  notion: {
    read: [["notion", ["get", "list", "read", "search", "show"]]],
    comment: [["notion", "comment"]], create: [["notion", "create"]], update: [["notion", "update"]],
    archive: [["notion", "archive"]], delete: [["notion", "delete"]],
  },
  datadog: {
    read: [["datadog", ["get", "list", "read", "search", "show", "query"]], ["datadog-ci", ["get", "list", "read", "search", "show", "query"]]],
    comment: [["datadog", "comment"]], create: [["datadog", "create"]], update: [["datadog", ["update", "set", "mute", "unmute"]]],
    execute: [["datadog", ["run", "trigger"]], ["datadog-ci", ["run", "trigger"]]], delete: [["datadog", "delete"]],
  },
});

function cloneDefaults() {
  return Object.fromEntries(Object.entries(DEFAULTS).map(([provider, value]) => [provider, {
    app: provider,
    mcp_server: provider,
    operations: { ...value.operations },
    tools: {},
  }]));
}

export function defaultPermissionPolicy() {
  return { providers: cloneDefaults() };
}

function identifier(value) {
  return typeof value === "string" && /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/.test(value);
}

function toolName(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\0\r\n]/.test(value);
}

function toolHasDenyFloor(provider, tool) {
  const words = tool.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (provider === "github" && words.some((word) => ["merge", "release"].includes(word))) return true;
  if (provider === "notion" && words.some((word) => ["archive", "delete"].includes(word))) return true;
  if (provider === "datadog" && words.includes("delete")) return true;
  return words.some((word) => ["deploy", "publish"].includes(word));
}

// This validator deliberately owns the policy invariants instead of leaving
// them to two renderers. A config can tighten a hard floor, never weaken it.
export function normalizePermissionPolicy(raw, addError = () => {}) {
  const normalized = defaultPermissionPolicy();
  if (raw === undefined) return normalized;
  if (!isObject(raw)) { addError("/permissions", "must be a mapping object"); return normalized; }
  for (const key of Object.keys(raw)) if (key !== "providers") addError(`/permissions/${key}`, "is not supported; expected: providers");
  if (!isObject(raw.providers)) { addError("/permissions/providers", "must be a mapping object"); return normalized; }
  for (const [provider, declaration] of Object.entries(raw.providers)) {
    const path = `/permissions/providers/${provider}`;
    if (!identifier(provider)) { addError(path, "provider id must be lowercase alphanumeric with `-` or `_` separators"); continue; }
    if (!isObject(declaration)) { addError(path, "must be a mapping object"); continue; }
    for (const key of Object.keys(declaration)) if (!["app", "mcp_server", "operations", "tools"].includes(key)) addError(`${path}/${key}`, "is not supported; expected one of: app, mcp_server, operations, tools");
    const current = normalized.providers[provider] ?? { app: provider, mcp_server: provider, operations: { read: "allow" }, tools: {} };
    if (declaration.app !== undefined) {
      if (!identifier(declaration.app)) addError(`${path}/app`, "must be a lowercase app id"); else current.app = declaration.app;
    }
    if (declaration.mcp_server !== undefined) {
      if (!identifier(declaration.mcp_server)) addError(`${path}/mcp_server`, "must be a lowercase MCP server id"); else current.mcp_server = declaration.mcp_server;
    }
    if (declaration.operations !== undefined) {
      if (!isObject(declaration.operations)) addError(`${path}/operations`, "must be a mapping of operation to allow, ask, or deny");
      else for (const [operation, decision] of Object.entries(declaration.operations)) {
        const operationPath = `${path}/operations/${operation}`;
        if (!identifier(operation)) { addError(operationPath, "operation must be a lowercase identifier"); continue; }
        if (!PERMISSION_DECISIONS.includes(decision)) { addError(operationPath, `must be one of: ${PERMISSION_DECISIONS.join(", ")}`); continue; }
        if (HARD_FLOORS[provider]?.[operation] === "deny" && decision !== "deny") { addError(operationPath, "cannot weaken the ADW deny safety floor"); continue; }
        current.operations[operation] = decision;
      }
    }
    if (declaration.tools !== undefined) {
      if (!isObject(declaration.tools)) addError(`${path}/tools`, "must map exact tool names to operations");
      else for (const [tool, operation] of Object.entries(declaration.tools)) {
        if (!toolName(tool)) { addError(`${path}/tools/${tool}`, "tool name must be non-empty single-line text"); continue; }
        if (!identifier(operation) || current.operations[operation] === undefined) { addError(`${path}/tools/${tool}`, "must name an operation declared for this provider"); continue; }
        if (toolHasDenyFloor(provider, tool) && current.operations[operation] !== "deny") { addError(`${path}/tools/${tool}`, "dangerous tool names must map to a denied operation"); continue; }
        if (current.operations[operation] === "allow" && SAFE_ALLOW_TOOLS[provider]?.get(tool) !== operation) { addError(`${path}/tools/${tool}`, "cannot be auto-allowed until this exact tool-to-operation mapping is reviewed by ADW; use ask or deny"); continue; }
        current.tools[tool] = operation;
      }
    }
    normalized.providers[provider] = current;
  }
  return normalized;
}

export function effectiveEntries(policy = defaultPermissionPolicy()) {
  const entries = [];
  for (const [provider, declaration] of Object.entries(policy.providers ?? {})) {
    for (const [operation, decision] of Object.entries(declaration.operations ?? {})) {
      for (const pattern of PROVIDER_COMMANDS[provider]?.[operation] ?? []) entries.push({ kind: "command", provider, operation, decision, pattern });
    }
    for (const [tool, operation] of Object.entries(declaration.tools ?? {})) entries.push({
      kind: "tool", provider, operation, decision: declaration.operations[operation], app: declaration.app, mcp_server: declaration.mcp_server, tool,
    });
  }
  return entries;
}

export function permissionPolicyJson(policy = defaultPermissionPolicy()) {
  return `${JSON.stringify({ schema: 1, entries: effectiveEntries(policy) }, null, 2)}\n`;
}

export function explainPermission(policy, request) {
  const entries = effectiveEntries(policy);
  if (Array.isArray(request?.argv) && request.argv.every((value) => typeof value === "string")) {
    const rank = { allow: 0, ask: 1, deny: 2 };
    const matches = entries.filter((entry) => entry.kind === "command"
      && entry.pattern.length <= request.argv.length
      && entry.pattern.every((part, index) => (Array.isArray(part) ? part.includes(request.argv[index]) : part === request.argv[index])));
    const selected = matches.sort((left, right) => rank[right.decision] - rank[left.decision] || right.pattern.length - left.pattern.length)[0];
    return selected ? { matched: true, decision: selected.decision, provider: selected.provider, operation: selected.operation, pattern: selected.pattern }
      : { matched: false, decision: "ask", reason: "unknown commands are not auto-approved by provider policy" };
  }
  if (typeof request?.tool === "string") {
    const selected = entries.find((entry) => entry.kind === "tool" && request.tool === `mcp__${entry.mcp_server}__${entry.tool}`);
    return selected ? { matched: true, decision: selected.decision, provider: selected.provider, operation: selected.operation, tool: request.tool }
      : { matched: false, decision: "ask", reason: "unknown integration tools require approval" };
  }
  throw new ContractError("permission explanation requires either string argv[] or a tool name");
}

export function assertPermissionPolicy(policy) {
  const errors = [];
  const normalized = normalizePermissionPolicy({ providers: policy?.providers }, (path, message) => errors.push(`${path} ${message}`));
  if (errors.length > 0) throw new ContractError(`invalid permission policy: ${errors.join("; ")}`);
  return normalized;
}
