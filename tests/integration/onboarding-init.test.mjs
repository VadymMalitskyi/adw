import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const initScript = join(repositoryRoot, "plugin/skills/init/scripts/init.mjs");

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function project() {
  const root = mkdtempSync(join(tmpdir(), "adw-onboarding-init-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Test");
  git(root, "config", "user.email", "adw@example.invalid");
  writeFileSync(join(root, "README.md"), "# Onboarding fixture\n");
  git(root, "add", "README.md");
  git(root, "commit", "-q", "-m", "fixture");
  return root;
}

function run(root, ...args) {
  return spawnSync(process.execPath, [initScript, ...args, "--project-root", root], { encoding: "utf8" });
}

test("onboarding choices are preview-bound and split shared from personal configuration", () => {
  const root = project();
  const answersPath = join(root, "onboarding.json");
  const personalValues = ["Ada Lovelace", "ada@example.invalid", "ada-tracker"];
  writeFileSync(answersPath, `${JSON.stringify({
    schema: 1,
    agents: ["codex"],
    web_access: "hosted-only",
    execution: { isolation: "managed-devcontainer" },
    documentation: { delivery: "pull-request" },
    integrations: {
      work_tracker: {
        provider: "github",
        requirement: "required",
        access: "read-only",
        settings: { owner: "example", repository: "project" },
        network_domains: ["tracker.example.com"],
      },
      code_host: {
        provider: "github",
        requirement: "required",
        access: "read-write",
      },
    },
    workflows: {
      work_tracker: {
        binding: "required",
        ensure: "link-only",
        stage: "plan",
        cardinality: "one-per-change",
      },
    },
    conventions: {
      branches: "Use one ADW branch per change.",
      pull_requests: "Create one draft pull request after validation.",
      work_items: "Link one issue per change before approval.",
    },
    local: {
      identity: {
        display_name: personalValues[0],
        email: personalValues[1],
        work_tracker_account: personalValues[2],
      },
      integrations: { work_tracker: { transport: "cli", account: personalValues[2] } },
    },
  }, null, 2)}\n`);
  git(root, "add", "onboarding.json");
  git(root, "commit", "-q", "-m", "test input");

  const statusBefore = git(root, "status", "--porcelain=v1", "--untracked-files=all");
  const previewResult = run(root, "preview", "--onboarding", answersPath);
  assert.equal(previewResult.status, 0, previewResult.stderr);
  assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), statusBefore, "preview must not write");
  const preview = JSON.parse(previewResult.stdout);
  assert.match(preview.preview_digest, /^[0-9a-f]{64}$/);
  assert.equal(preview.devcontainer.agent_tools, "both");
  assert.equal(preview.onboarding.documentation_delivery, "pull-request");
  assert.equal(preview.onboarding.web_access, "hosted-only");
  assert.equal(preview.devcontainer.web_access, "hosted-only");
  assert.deepEqual(preview.onboarding.local.identity_fields, ["display_name", "email", "work_tracker_account"]);
  for (const value of personalValues) assert.doesNotMatch(JSON.stringify(preview), new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const stale = run(root, "apply", "--confirmed", "--preview-digest", "0".repeat(64), "--onboarding", answersPath);
  assert.equal(stale.status, 2, stale.stderr || stale.stdout);
  assert.match(stale.stderr, /exact --preview-digest/);
  assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), statusBefore, "stale approval must not write");

  const applied = run(root, "apply", "--confirmed", "--preview-digest", preview.preview_digest, "--onboarding", answersPath);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(existsSync(join(root, "AGENTS.md")), true);
  assert.equal(existsSync(join(root, "CLAUDE.md")), true);
  assert.equal(existsSync(join(root, ".codex/config.toml")), true);
  assert.equal(existsSync(join(root, ".codex/rules/adw.rules")), true);
  assert.equal(existsSync(join(root, ".claude/settings.json")), true);
  const projectConfig = readFileSync(join(root, "adw.yaml"), "utf8");
  assert.match(projectConfig, /delivery: pull-request/);
  assert.match(projectConfig, /work_tracker:[\s\S]*provider: "github"[\s\S]*requirement: "required"/);
  assert.match(projectConfig, /ensure: "link-only"/);
  const routing = readFileSync(join(root, "AGENTS.md"), "utf8");
  assert.match(routing, /Project workflow conventions/);
  assert.match(routing, /Create one draft pull request after validation/);

  const containerConfig = JSON.parse(readFileSync(join(root, ".devcontainer/devcontainer.json"), "utf8"));
  assert.equal(containerConfig.build.args.ADW_AGENT_TOOLS, "both");
  assert.deepEqual(containerConfig.customizations.vscode.extensions, ["openai.chatgpt", "anthropic.claude-code"]);
  assert.ok(containerConfig.mounts.some((mount) => mount.includes(".codex")));
  assert.ok(containerConfig.mounts.some((mount) => mount.includes(".claude")));
  assert.match(readFileSync(join(root, ".devcontainer/allowed-domains.txt"), "utf8"), /^tracker\.example\.com$/m);

  const local = readFileSync(join(root, ".adw/local.yaml"), "utf8");
  for (const value of personalValues) assert.match(local, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const committed of [projectConfig, routing, readFileSync(join(root, ".devcontainer/devcontainer.json"), "utf8")]) {
    for (const value of personalValues) assert.doesNotMatch(committed, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(git(root, "check-ignore", "--no-index", ".adw/local.yaml"), ".adw/local.yaml");
});
