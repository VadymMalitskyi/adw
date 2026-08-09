#!/usr/bin/env node
import { readFileSync } from "node:fs";

function result(permissionDecision, permissionDecisionReason) {
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason } })}\n`);
}

function block(error) {
  process.stderr.write(`ADW permission hook failed closed: ${error.message}\n`);
  process.exit(2);
}

function shellSegments(command) {
  return command.split(/&&|\|\||[;|&\n]/).map((segment) => segment.trim()).filter(Boolean);
}

function providerCommand(segment, executable) {
  const escaped = executable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[\\s'\"])(?:[^\\s'\"]*/)?${escaped}\\s+`, "i").test(segment);
}

function knownProviderRead(segment) {
  return /(?:^|[\s'"])(?:[^\s'"]*\/)?gh\s+(?:(?:-R|--repo|--hostname)\s+\S+\s+)*(?:auth\s+status|repo\s+view|pr\s+(?:checks|diff|list|status|view)|issue\s+(?:list|status|view)|run\s+(?:list|view|watch)|workflow\s+(?:list|view))(?:\s|$)/i.test(segment)
    || /(?:^|[\s'"])(?:[^\s'"]*\/)?az\s+(?:(?:--organization|--project)\s+\S+\s+)*(?:boards\s+query|boards\s+work-item\s+show|repos\s+pr\s+(?:list|show))(?:\s|$)/i.test(segment);
}

function classifyBash(command) {
  if (/\bgit\b[^;\n|&]*\bpush\b[^;\n|&]*(?:--force(?:-with-lease)?|(?:^|\s)-f(?:\s|$))/im.test(command)
      || /\bgit\s+(?:-\S+\s+)*reset\s+--hard\b|\bgit\s+(?:-\S+\s+)*clean\s+-[^\s;|&]*f/i.test(command)
      || /\bgh\s+pr\s+merge\b|\bgh\s+release\s+(?:create|delete|edit|upload)\b/i.test(command)
      || /\b(?:npm|pnpm|yarn)\s+(?:publish|unpublish)\b|\bdotnet\s+nuget\s+(?:push|delete)\b/i.test(command)
      || /\b(?:kubectl\s+(?:apply|delete)|helm\s+(?:install|upgrade|uninstall)|terraform\s+(?:apply|destroy))\b/i.test(command)
      || /\bgh\s+auth\s+token\b/i.test(command)) {
    return ["deny", "ADW forbids destructive history changes, credential export, force-push, merge, release, publish, and deployment commands."];
  }
  if (/\bgit\s+(?:-\S+\s+)*push\b|\bgh\s+api\b/i.test(command)
      || /\bgh\s+(?:pr|issue|run|workflow)\s+(?:close|comment|create|delete|disable|edit|enable|ready|reopen|rerun|review|run)\b/i.test(command)
      || /\baz\s+(?:boards\s+work-item\s+(?:create|delete|update)|repos\s+pr\s+(?:create|update)|devops\s+invoke)\b/i.test(command)
      || /\bgit\s+(?:-\S+\s+)*(?:branch\s+-D|checkout\s+--|restore\s+--worktree)\b|\brm\s+-[^\s;|&]*r[^\s;|&]*f\b/i.test(command)
      || /\b(?:npm|pnpm|yarn|bun)\s+run\s+(?:release|publish|deploy)\b|\b(?:make|just|task)\s+(?:release|publish|deploy)\b/i.test(command)
      || /\b(?:docker\s+push|ssh|scp|sftp)\b/i.test(command)
      || /\bcurl\b[^;\n|&]*(?:-X|--request(?:=|\s+)|-d(?:\s|=)|--data(?:-[a-z-]+)?(?:=|\s+)|-T(?:\s|=)|--upload-file(?:=|\s+))\s*(?:POST|PUT|PATCH|DELETE)?/i.test(command)
      || /\bwget\b[^;\n|&]*(?:--post-data|--post-file|--method(?:=|\s+)(?:POST|PUT|PATCH|DELETE))/i.test(command)) {
    return ["ask", "ADW requires approval before an external or destructive mutation."];
  }
  for (const segment of shellSegments(command)) {
    if ((providerCommand(segment, "gh") || providerCommand(segment, "az")) && !knownProviderRead(segment)) {
      return ["ask", "ADW requires approval for an unclassified provider command."];
    }
  }
  return ["allow", "ADW allows commands that remain inside the enforced development sandbox."];
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const tool = String(input.tool_name ?? "");
  if (tool.startsWith("mcp__")) {
    const operation = tool.split("__").at(-1).toLowerCase();
    if (/^(?:(?:wit|git|core|repo|repos|build|work|workitem)_)?(?:get|list|read|search|find|fetch|query|view|show|status|check|inspect|lookup|describe)(?:_|$)/.test(operation)) {
      result("allow", "ADW allows bounded read-only integration tools.");
    } else {
      result("ask", "ADW requires approval for unknown or mutating integration tools.");
    }
  } else if (tool === "Bash") {
    const [decision, reason] = classifyBash(String(input.tool_input?.command ?? ""));
    result(decision, reason);
  }
} catch (error) {
  block(error);
}
