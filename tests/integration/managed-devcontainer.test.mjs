import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  assert.equal(marker.project_requirements_sha256, createHash("sha256").update(readFileSync(join(templateRoot, "project-requirements.json"))).digest("hex"));
  assert.equal(marker.project_setup_sha256, createHash("sha256").update(readFileSync(join(templateRoot, "project-setup.sh"))).digest("hex"));
  assert.match(dockerfile, /@openai\/codex@\$\{CODEX_VERSION\}/);
  assert.match(dockerfile, /@anthropic-ai\/claude-code@\$\{CLAUDE_CODE_VERSION\}/);
  assert.match(dockerfile, /USER vscode/);
  assert.match(dockerfile, /gpasswd -d vscode sudo/);
  assert.ok(config.mounts.every((mount) => /type=volume/.test(mount)));
  assert.doesNotMatch(configText, /docker\.sock|\.ssh|\.aws|\.azure|\.config\/gcloud|localEnv:HOME/i);
  assert.match(config.postStartCommand, /adw-init-firewall/);
  assert.ok(config.postCreateCommand.indexOf("adw-init-firewall") < config.postCreateCommand.indexOf("adw-project-setup"));
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

test("init derives a reviewable project-specific development environment from repository evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "adw-managed-discovery-"));
  mkdirSync(join(root, "services/api"), { recursive: true });
  mkdirSync(join(root, "services/worker"), { recursive: true });
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Test");
  git(root, "config", "user.email", "adw@example.invalid");
  writeFileSync(join(root, "package.json"), `${JSON.stringify({
    private: true,
    engines: { node: ">=20" },
    scripts: { dev: "malicious-repository-text-must-not-be-copied --port 4173" },
  }, null, 2)}\n`);
  writeFileSync(join(root, "package-lock.json"), `${JSON.stringify({ name: "fixture", lockfileVersion: 3, packages: {} }, null, 2)}\n`);
  writeFileSync(join(root, ".nvmrc"), "20.11.1\n");
  writeFileSync(join(root, ".env.example"), "APP_PORT=3000\nDATABASE_URL=\n");
  writeFileSync(join(root, "compose.yaml"), "services:\n  postgres:\n    image: postgres:17\n    ports:\n      - \"55432:5432\"\n");
  writeFileSync(join(root, "services/api/pyproject.toml"), "[project]\nname = \"api\"\nversion = \"0.0.0\"\nrequires-python = \">=3.11\"\n");
  writeFileSync(join(root, "services/api/requirements.txt"), "psycopg2==2.9.10\n");
  writeFileSync(join(root, "services/worker/go.mod"), "module example.invalid/worker\n\ngo 1.22.4\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture");

  const previewResult = spawnSync(process.execPath, [initScript, "preview", "--project-root", root], { encoding: "utf8" });
  assert.equal(previewResult.status, 0, previewResult.stderr);
  const preview = JSON.parse(previewResult.stdout);
  assert.deepEqual(preview.development_environment.selected_versions, { go: "1.22.4", node: "20", python: "3.11" });
  assert.deepEqual(preview.development_environment.forward_ports.map(({ port }) => port), [3000, 4173, 55432]);
  assert.ok(preview.development_environment.setup_commands.some(({ command, source }) => command === "npm ci" && source === "package-lock.json"));
  assert.ok(preview.development_environment.setup_commands.some(({ command }) => command.includes("services/api") && command.includes("requirements.txt")));
  assert.ok(preview.development_environment.setup_commands.some(({ command }) => command.includes("services/worker") && command.includes("go mod download")));
  assert.ok(preview.development_environment.system_packages.some(({ name }) => name === "libpq-dev"));
  assert.ok(preview.development_environment.unresolved.some(({ requirement }) => requirement === "compose services"));
  assert.ok(preview.development_environment.unresolved.some(({ requirement }) => requirement === "environment variable DATABASE_URL"));

  const initialized = spawnSync(process.execPath, [initScript, "apply", "--confirmed", "--project-root", root], { encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  const config = JSON.parse(readFileSync(join(root, ".devcontainer/devcontainer.json"), "utf8"));
  assert.equal(config.build.args.NODE_MAJOR, "20");
  assert.match(config.build.args.ADW_PROJECT_APT_PACKAGES, /\blibpq-dev\b/);
  assert.equal(config.features["ghcr.io/devcontainers/features/python:1"].version, "3.11");
  assert.equal(config.features["ghcr.io/devcontainers/features/go:1"].version, "1.22.4");
  assert.deepEqual(config.forwardPorts, [3000, 4173, 55432]);
  assert.match(config.postCreateCommand, /adw-project-setup/);

  const setup = readFileSync(join(root, ".devcontainer/project-setup.sh"), "utf8");
  assert.match(setup, /^npm ci$/m);
  assert.match(setup, /go mod download/);
  assert.doesNotMatch(setup, /malicious-repository-text-must-not-be-copied/);
  const shellCheck = spawnSync("bash", ["-n", join(root, ".devcontainer/project-setup.sh")], { encoding: "utf8" });
  assert.equal(shellCheck.status, 0, shellCheck.stderr);
  const allowedDomains = readFileSync(join(root, ".devcontainer/allowed-domains.txt"), "utf8");
  assert.match(allowedDomains, /^proxy\.golang\.org$/m);

  const doctor = spawnSync(process.execPath, [doctorScript, "--project-root", root], {
    encoding: "utf8",
    env: { ...process.env, ADW_MANAGED_DEVCONTAINER: "1" },
  });
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
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

  const setupPath = join(root, ".devcontainer/project-setup.sh");
  writeFileSync(setupPath, `${readFileSync(setupPath, "utf8")}\n# unreviewed drift\n`);
  const drifted = spawnSync(process.execPath, [doctorScript, "--project-root", root], {
    encoding: "utf8",
    env: { ...process.env, ADW_MANAGED_DEVCONTAINER: "1" },
  });
  assert.equal(drifted.status, 1, drifted.stderr || drifted.stdout);
  assert.equal(JSON.parse(drifted.stdout).checks.find(({ id }) => id === "execution:managed-files").status, "fail");
});
