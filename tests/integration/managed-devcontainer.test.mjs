import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const templateRoot = join(repositoryRoot, "plugin/templates/devcontainer");
const initScript = join(repositoryRoot, "plugin/skills/init/scripts/init.mjs");
const doctorScript = join(repositoryRoot, "plugin/skills/doctor/scripts/snapshot.mjs");

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

test("managed template pins agents, runs non-root, scopes credentials, and denies broad host access", () => {
  const configText = readFileSync(join(templateRoot, "devcontainer.json"), "utf8");
  const config = JSON.parse(configText);
  const dockerfile = readFileSync(join(templateRoot, "Dockerfile"), "utf8");
  const marker = JSON.parse(readFileSync(join(templateRoot, "adw-managed.json"), "utf8"));

  assert.equal(config.remoteUser, "vscode");
  assert.equal(config.containerEnv.ADW_MANAGED_DEVCONTAINER, "1");
  assert.match(config.build.args.CODEX_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(config.build.args.CLAUDE_CODE_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(marker.codex_version, config.build.args.CODEX_VERSION);
  assert.equal(marker.claude_code_version, config.build.args.CLAUDE_CODE_VERSION);
  assert.match(dockerfile, /@openai\/codex@\$\{CODEX_VERSION\}/);
  assert.match(dockerfile, /@anthropic-ai\/claude-code@\$\{CLAUDE_CODE_VERSION\}/);
  assert.match(dockerfile, /USER vscode/);
  assert.match(dockerfile, /gpasswd -d vscode sudo/);
  assert.ok(config.mounts.every((mount) => /type=volume/.test(mount)));
  assert.doesNotMatch(configText, /docker\.sock|\.ssh|\.aws|\.azure|\.config\/gcloud|localEnv:HOME/i);
  assert.match(config.postStartCommand, /adw-init-firewall/);
});

test("managed firewall scripts are valid shell and establish deny-by-default before DNS resolution", () => {
  for (const name of ["init-firewall.sh", "post-create.sh"]) {
    const result = spawnSync("bash", ["-n", join(templateRoot, name)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const firewall = readFileSync(join(templateRoot, "init-firewall.sh"), "utf8");
  assert.ok(firewall.indexOf("iptables -P OUTPUT DROP") < firewall.lastIndexOf("resolve_domains\n"));
  assert.match(firewall, /ip6tables -P OUTPUT DROP/);
  assert.doesNotMatch(firewall, /iptables -P OUTPUT ACCEPT/);
});

test("doctor blocks a required managed profile outside its runtime and passes its runtime evidence inside", () => {
  const root = mkdtempSync(join(tmpdir(), "adw-managed-doctor-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Test");
  git(root, "config", "user.email", "adw@example.invalid");
  writeFileSync(join(root, "README.md"), "# fixture\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture");
  const initialized = spawnSync(process.execPath, [initScript, "apply", "--confirmed", "--project-root", root], { encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);

  const outside = spawnSync(process.execPath, [doctorScript, "--project-root", root], { encoding: "utf8" });
  assert.equal(outside.status, 1, outside.stderr || outside.stdout);
  assert.equal(JSON.parse(outside.stdout).checks.find(({ id }) => id === "execution:runtime").status, "fail");

  const inside = spawnSync(process.execPath, [doctorScript, "--project-root", root], {
    encoding: "utf8",
    env: { ...process.env, ADW_MANAGED_DEVCONTAINER: "1" },
  });
  assert.equal(inside.status, 0, inside.stderr || inside.stdout);
  assert.equal(JSON.parse(inside.stdout).checks.find(({ id }) => id === "execution:runtime").status, "pass");
});
