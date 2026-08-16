#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const policyPath = process.env.ADW_PERMISSION_POLICY ?? "/etc/adw/permission-policy.json";

function loadPolicy() {
  if (!existsSync(policyPath)) return [];
  const parsed = JSON.parse(readFileSync(policyPath, "utf8"));
  if (parsed?.schema !== 1 || !Array.isArray(parsed.entries)) throw new Error("ADW permission policy has an invalid schema");
  return parsed.entries;
}

const policyEntries = loadPolicy();

function result(permissionDecision, permissionDecisionReason) {
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason } })}\n`);
}

function block(error) {
  process.stderr.write(`ADW permission hook failed closed: ${error.message}\n`);
  process.exit(2);
}

function shellAnalysis(command) {
  const segments = [];
  let words = [];
  let word = "";
  let quote = null;
  let dynamic = false;

  function finishWord() {
    if (word || dynamic) words.push({ value: word, dynamic });
    word = "";
    dynamic = false;
  }

  function finishSegment() {
    finishWord();
    if (words.length) segments.push(words);
    words = [];
  }

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote === "'") {
      if (character === "'") quote = null;
      else word += character;
      continue;
    }
    if (quote === '"') {
      if (character === '"') {
        quote = null;
      } else if (character === "\\" && index + 1 < command.length && /[\\"$`\n]/.test(command[index + 1])) {
        if (command[index + 1] !== "\n") word += command[index + 1];
        index += 1;
      } else {
        if (character === "$" || character === "`") dynamic = true;
        word += character;
      }
      continue;
    }
    if (character === "\\") {
      if (index + 1 >= command.length) {
        dynamic = true;
      } else {
        if (command[index + 1] !== "\n") word += command[index + 1];
        index += 1;
      }
    } else if (character === "'" || character === '"') {
      // $'...' and $"..." are quoting constructs, not a literal dollar prefix.
      if (word.endsWith("$")) word = word.slice(0, -1);
      quote = character;
    } else if (character === "\n") {
      finishSegment();
    } else if (/\s/.test(character)) {
      finishWord();
    } else if (/[;|&]/.test(character)) {
      finishSegment();
      while (index + 1 < command.length && command[index + 1] === character) index += 1;
    } else {
      if (character === "$" || character === "`") dynamic = true;
      word += character;
    }
  }
  if (quote) dynamic = true;
  finishSegment();
  return segments;
}

function shellSegments(command) {
  return shellAnalysis(command)
    .map((words) => words.map(({ value }) => value).join(" "))
    .filter(Boolean);
}

function providerCommand(segment, executable) {
  const escaped = executable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[\\s'\"])(?:[^\\s'\"]*/)?${escaped}\\s+`, "i").test(segment);
}

function knownProviderRead(segment) {
  return /(?:^|[\s'"])(?:[^\s'"]*\/)?gh\s+(?:(?:-R|--repo|--hostname)\s+\S+\s+)*(?:auth\s+status|repo\s+view|pr\s+(?:checks|diff|list|status|view)|issue\s+(?:list|status|view)|run\s+(?:list|view|watch)|workflow\s+(?:list|view))(?:\s|$)/i.test(segment)
    || /(?:^|[\s'"])(?:[^\s'"]*\/)?az\s+(?:(?:--organization|--project)\s+\S+\s+)*(?:boards\s+query|boards\s+work-item\s+show|repos\s+pr\s+(?:list|show))(?:\s|$)/i.test(segment);
}

function commandTokens(words) {
  return words.flatMap(({ value, dynamic }) => value
    .replace(/[$`(){}]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => ({ value: token, dynamic, dynamicValue: dynamic && (value.includes("$") || value.startsWith("`")) })));
}

function gitInvocations(command) {
  const invocations = [];
  for (const segment of shellAnalysis(command)) {
    const tokens = commandTokens(segment);
    for (let index = 0; index < tokens.length; index += 1) {
      if (!/(?:^|\/)git$/i.test(tokens[index].value)) continue;
      let cursor = index + 1;
      let ambiguous = tokens[index].dynamic;
      while (cursor < tokens.length && tokens[cursor].value.startsWith("-")) {
        const option = tokens[cursor];
        ambiguous ||= option.dynamic;
        if (/^(?:-C|-c|--git-dir|--work-tree|--namespace|--super-prefix|--config-env)$/.test(option.value)) {
          cursor += 1;
          if (cursor >= tokens.length) {
            ambiguous = true;
            break;
          }
          ambiguous ||= tokens[cursor].dynamic;
        } else if (!/^(?:--bare|--no-pager|--paginate|--no-replace-objects|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks|--exec-path(?:=.*)?|--git-dir=.+|--work-tree=.+|--namespace=.+|--super-prefix=.+|--config-env=.+|-c.+|-C.+)$/.test(option.value)) {
          ambiguous = true;
        }
        cursor += 1;
      }
      const verb = tokens[cursor];
      invocations.push({
        verb: verb?.value.toLowerCase() ?? "",
        arguments: verb ? tokens.slice(cursor + 1) : [],
        ambiguous: ambiguous || !verb || verb.dynamic,
      });
      index = Math.max(index, cursor);
    }
  }
  return invocations;
}

function isForcePush(command) {
  return gitInvocations(command).some(({ verb, arguments: args }) => {
    if (verb !== "push") return false;
    return args.some(({ value, dynamicValue }) => {
      const token = value.replace(/^["']+|["']+$/g, "");
      return /^--force(?:=.*)?$/i.test(token)
        || /^--force-with-lease(?:=.*)?$/i.test(token)
        || /^-[^-]*f[^-]*$/.test(token)
        || token.toLowerCase() === "--mirror"
        || token.startsWith("+")
        || dynamicValue;
    });
  });
}

const knownLocalGitCommands = new Set([
  "add", "am", "annotate", "apply", "archive", "bisect", "blame", "branch", "checkout", "cherry", "cherry-pick",
  "citool", "clean", "clone", "commit", "config", "describe", "diff", "difftool", "fetch", "format-patch", "fsck",
  "gc", "grep", "help", "init", "log", "maintenance", "merge", "merge-base", "mergetool", "mv", "notes", "pull",
  "range-diff", "read-tree", "rebase", "reflog", "remote", "repack", "replace", "reset", "restore", "revert",
  "rev-list", "rev-parse", "rm", "shortlog", "show", "show-branch", "sparse-checkout", "stash", "status", "submodule",
  "switch", "tag", "worktree",
]);

function hasUnclassifiedGitCommand(command) {
  return gitInvocations(command).some(({ verb, ambiguous }) => ambiguous || (verb !== "push" && !knownLocalGitCommands.has(verb)));
}

function isRecursiveForcedRemove(command) {
  return shellSegments(command).some((segment) => {
    const remove = /(?:^|[^A-Za-z0-9_.-])(?:[^\s]*\/)?rm\s+(.+)/i.exec(segment);
    if (!remove) return false;
    let recursive = false;
    let force = false;
    for (const token of remove[1].trim().split(/\s+/)) {
      if (token === "--") break;
      if (token === "--recursive") recursive = true;
      else if (token === "--force") force = true;
      else if (/^-[^-]/.test(token)) {
        recursive ||= /[rR]/.test(token.slice(1));
        force ||= /f/.test(token.slice(1));
      }
    }
    return recursive && force;
  });
}

function hasAmbiguousSensitiveSyntax(command) {
  return shellAnalysis(command).some((words) => {
    const normalized = words.map(({ value }) => value).join(" ");
    const sensitive = /(?:^|\s)(?:[^\s/]+\/)*(?:git|rm|gh|az|glab|jira|datadog-ci|datadog|notion|curl|wget)(?:\s|$)/i.test(normalized);
    if (sensitive && words.some(({ dynamic }) => dynamic)) return true;
    return Boolean(words[0]?.dynamic);
  });
}

function policyResult(decision, subject) {
  if (decision === "allow") return ["allow", `ADW project policy allows ${subject}.`];
  if (decision === "ask") return ["ask", `ADW project policy requires approval for ${subject}.`];
  if (decision === "deny") return ["deny", `ADW project policy denies ${subject}.`];
  throw new Error(`invalid ADW permission decision: ${String(decision)}`);
}

function configuredCommandDecision(command) {
  const segments = shellAnalysis(command);
  let selected = null;
  const rank = { allow: 0, ask: 1, deny: 2 };
  for (const entry of policyEntries) {
    if (entry?.kind !== "command" || !Array.isArray(entry.pattern) || !rank.hasOwnProperty(entry.decision)) continue;
    const matches = segments.some((words) => entry.pattern.length <= words.length && entry.pattern.every((part, index) => {
      const value = words[index]?.value;
      return Array.isArray(part) ? part.includes(value) : part === value;
    }));
    if (matches && (!selected || rank[entry.decision] > rank[selected.decision])) selected = entry;
  }
  return selected ? policyResult(selected.decision, `${selected.provider}.${selected.operation}`) : null;
}

function configuredToolDecision(tool) {
  const selected = policyEntries.find((entry) => entry?.kind === "tool" && tool === `mcp__${entry.mcp_server}__${entry.tool}`);
  return selected ? policyResult(selected.decision, `${selected.provider}.${selected.operation}`) : null;
}

const providerExecutables = ["gh", "az", "glab", "jira", "datadog-ci", "datadog", "notion"];

function classifyBash(command) {
  const normalized = shellSegments(command).join(" ; ");
  if (isForcePush(command)
      || /\bgit\b[^;|&\n]*\breset\s+--hard\b|\bgit\b[^;|&\n]*\bclean\s+-[^\s;|&]*f/i.test(normalized)
      || /\bgh\s+pr\s+merge\b|\bgh\s+release\s+(?:create|delete|edit|upload)\b/i.test(normalized)
      || /\b(?:npm|pnpm|yarn)\s+(?:publish|unpublish)\b|\bdotnet\s+nuget\s+(?:push|delete)\b/i.test(normalized)
      || /\b(?:kubectl\s+(?:apply|delete)|helm\s+(?:install|upgrade|uninstall)|terraform\s+(?:apply|destroy))\b/i.test(normalized)
      || /\bgh\s+auth\s+token\b/i.test(normalized)) {
    return ["deny", "ADW forbids destructive history changes, credential export, force-push, merge, release, publish, and deployment commands."];
  }
  const configured = configuredCommandDecision(command);
  if (configured) return configured;
  if (/\bgit\b[^;|&\n]*\bpush\b|\bgh\s+api\b/i.test(normalized)
      || /\bgh\s+(?:pr|issue|run|workflow)\s+(?:close|comment|create|delete|disable|edit|enable|ready|reopen|rerun|review|run)\b/i.test(normalized)
      || /\baz\s+(?:boards\s+work-item\s+(?:create|delete|update)|repos\s+pr\s+(?:create|update)|devops\s+invoke)\b/i.test(normalized)
      || /\bgit\b[^;|&\n]*\b(?:reset|branch\s+-D|checkout\s+--|restore\s+--worktree)\b/i.test(normalized)
      || isRecursiveForcedRemove(command)
      || /\b(?:npm|pnpm|yarn|bun)\s+run\s+(?:release|publish|deploy)\b|\b(?:make|just|task)\s+(?:release|publish|deploy)\b/i.test(normalized)
      || /\b(?:docker\s+push|ssh|scp|sftp)\b/i.test(normalized)
      || /\bcurl\b[^;\n|&]*(?:-X|--request(?:=|\s+)|-d(?:\s|=)|--data(?:-[a-z-]+)?(?:=|\s+)|-T(?:\s|=)|--upload-file(?:=|\s+))\s*(?:POST|PUT|PATCH|DELETE)?/i.test(normalized)
      || /\bwget\b[^;\n|&]*(?:--post-data|--post-file|--method(?:=|\s+)(?:POST|PUT|PATCH|DELETE))/i.test(normalized)
      || hasUnclassifiedGitCommand(command)
      || hasAmbiguousSensitiveSyntax(command)) {
    return ["ask", "ADW requires approval before an external or destructive mutation."];
  }
  for (const segment of shellSegments(command)) {
    if (providerExecutables.some((executable) => providerCommand(segment, executable)) && !knownProviderRead(segment)) {
      return ["ask", "ADW requires approval for an unclassified provider command."];
    }
  }
  return ["allow", "ADW allows commands that remain inside the enforced development sandbox."];
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const tool = String(input.tool_name ?? "");
  if (tool.startsWith("mcp__")) {
    const configured = configuredToolDecision(tool);
    if (configured) {
      result(...configured);
      process.exit(0);
    }
    const operation = tool.split("__").at(-1).toLowerCase();
    const mutating = /(?:^|_)(?:add|approve|archive|assign|cancel|close|comment|create|delete|deploy|disable|edit|enable|execute|merge|modify|move|publish|release|remove|resolve|run|send|set|submit|transition|trigger|update|upload|write)(?:_|$)/.test(operation);
    if (!mutating && /^(?:(?:wit|git|core|repo|repos|build|work|workitem)_)?(?:get|list|read|search|find|fetch|query|view|show|status|check|inspect|lookup|describe)(?:_|$)/.test(operation)) {
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
