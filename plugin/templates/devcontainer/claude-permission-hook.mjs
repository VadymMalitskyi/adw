#!/usr/bin/env node
import { readFileSync } from "node:fs";

function result(permissionDecision, permissionDecisionReason) {
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason } })}\n`);
}

let input;
try { input = JSON.parse(readFileSync(0, "utf8")); }
catch (error) {
  process.stderr.write(`ADW permission hook rejected invalid input: ${error.message}\n`);
  process.exit(2);
}
const tool = String(input.tool_name ?? "");

if (tool.startsWith("mcp__")) {
  const operation = tool.split("__").at(-1).toLowerCase();
  if (/^(?:(?:wit|git|core|repo|repos|build|work|workitem)_)?(?:get|list|read|search|find|fetch|query|view|show|status|check|inspect|lookup|describe)(?:_|$)/.test(operation)) {
    result("allow", "ADW allows bounded read-only integration tools.");
  } else {
    result("ask", "ADW requires approval for unknown or mutating integration tools.");
  }
} else if (tool === "Bash") {
  const command = String(input.tool_input?.command ?? "");
  if (/\bgit\s+push\b[^\n]*(?:--force(?:-with-lease)?|(?:^|\s)-f(?:\s|$))/i.test(command)
      || /\bgh\s+pr\s+merge\b|\bgh\s+release\s+(?:create|delete|edit|upload)\b/i.test(command)
      || /\b(?:npm|pnpm|yarn)\s+(?:publish|unpublish)\b|\bdotnet\s+nuget\s+(?:push|delete)\b/i.test(command)
      || /\b(?:kubectl\s+(?:apply|delete)|helm\s+(?:install|upgrade|uninstall)|terraform\s+(?:apply|destroy))\b/i.test(command)) {
    result("deny", "ADW forbids force-push, merge, release, publish, and deployment commands in the normal workflow.");
  } else if (/\bgit\s+push\b|\bgh\s+api\b/i.test(command)
      || /\bgh\s+(?:pr|issue|run|workflow)\s+(?:close|comment|create|delete|disable|edit|enable|ready|reopen|rerun|review|run)\b/i.test(command)
      || /\baz\s+(?:boards\s+work-item\s+(?:create|delete|update)|repos\s+pr\s+(?:create|update)|devops\s+invoke)\b/i.test(command)) {
    result("ask", "ADW requires approval before an external mutation.");
  }
}
