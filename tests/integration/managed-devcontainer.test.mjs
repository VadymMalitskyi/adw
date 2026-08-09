import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { managedDevelopmentFiles } from "../../plugin/skills/init/scripts/development-environment.mjs";

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
  assert.equal(config.build.args.ADW_AGENT_TOOLS, "both");
  assert.equal(marker.agent_tools, "both");
  assert.equal(marker.schema, 2);
  assert.equal(marker.permission_profile, "managed-development");
  assert.match(config.build.args.CODEX_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(config.build.args.CLAUDE_CODE_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(marker.codex_version, config.build.args.CODEX_VERSION);
  assert.equal(marker.claude_code_version, config.build.args.CLAUDE_CODE_VERSION);
  for (const key of ["allowed_domains_sha256", "codex_rules_sha256", "claude_settings_sha256", "claude_hook_sha256", "egress_proxy_sha256", "project_requirements_sha256", "project_setup_sha256"]) {
    assert.equal(marker[key], undefined, `template must not carry stale generated digest ${key}`);
  }
  assert.match(dockerfile, /@openai\/codex@\$\{CODEX_VERSION\}/);
  assert.match(dockerfile, /@anthropic-ai\/claude-code@\$\{CLAUDE_CODE_VERSION\}/);
  assert.match(dockerfile, /case "\$ADW_AGENT_TOOLS" in/);
  assert.match(dockerfile, /npm install -g "\$\{agent_packages\[@\]\}"/);
  assert.match(dockerfile, /> \/etc\/adw\/agent-tools/);
  assert.match(dockerfile, /chmod 0444 \/etc\/adw\/agent-tools/);
  assert.match(dockerfile, /chmod 0555 \/usr\/local\/bin\/adw-claude-permission-hook/);
  assert.doesNotMatch(dockerfile, /chmod 0500 [^\n]*adw-claude-permission-hook/);
  assert.doesNotMatch(dockerfile, /npm install -g "@openai\/codex@\$\{CODEX_VERSION\}" "@anthropic-ai\/claude-code@\$\{CLAUDE_CODE_VERSION\}"/);
  const postCreate = readFileSync(join(templateRoot, "post-create.sh"), "utf8");
  assert.match(postCreate, /cat \/etc\/adw\/agent-tools/);
  assert.match(postCreate, /command -v "\$command"/);
  assert.doesNotMatch(postCreate, /\/usr\/local\/bin\/(codex|claude)/);
  assert.match(dockerfile, /USER vscode/);
  assert.match(dockerfile, /gpasswd -d vscode sudo/);
  assert.ok(config.mounts.every((mount) => /type=volume/.test(mount)));
  assert.doesNotMatch(configText, /docker\.sock|\.ssh|\.aws|\.azure|\.config\/gcloud|localEnv:HOME/i);
  assert.match(config.postStartCommand, /adw-init-firewall/);
  assert.ok(config.postCreateCommand.indexOf("adw-init-firewall") < config.postCreateCommand.indexOf("adw-project-setup"));
  assert.equal(config.runArgs.includes("--privileged"), false);
  assert.equal(config.runArgs.includes("--network=host"), false);
  assert.equal(config.runArgs.includes("--pid=host"), false);
  assert.equal(config.runArgs.includes("--cap-drop=ALL"), true);
  assert.deepEqual(config.runArgs.filter((argument) => argument.startsWith("--cap-add=")).sort(), [
    "--cap-add=CHOWN",
    "--cap-add=KILL",
    "--cap-add=NET_ADMIN",
    "--cap-add=SETGID",
    "--cap-add=SETUID",
  ]);
  assert.equal(config.containerEnv.HTTPS_PROXY, "http://127.0.0.1:18080");
  assert.doesNotMatch(configText, /SYS_ADMIN|SYS_PTRACE|NET_RAW|seccomp=unconfined|apparmor=unconfined/);
  assert.doesNotMatch(dockerfile, /chmod u\+s \/usr\/bin\/bwrap/);
});

test("managed development files scope agent tools, credentials, extensions, environment, and domains", async (t) => {
  const cases = [
    { profile: "codex", agents: ["codex"] },
    { profile: "claude", agents: ["claude"] },
    { profile: "both", agents: ["codex", "claude"] },
  ];
  const domainsByAgent = {
    codex: ["api.openai.com", "auth.openai.com", "chatgpt.com"],
    claude: ["api.anthropic.com", "claude.ai", "console.anthropic.com"],
  };
  const extensionByAgent = { codex: "openai.chatgpt", claude: "anthropic.claude-code" };
  const mountByAgent = { codex: "/home/vscode/.codex", claude: "/home/vscode/.claude" };

  for (const { profile, agents } of cases) {
    await t.test(profile, () => {
      const root = mkdtempSync(join(tmpdir(), `adw-agent-${profile}-`));
      const generated = managedDevelopmentFiles(root, templateRoot, {
        agentTools: profile,
        integrationDomains: ["tracker.example.com", "TRACKER.EXAMPLE.COM"],
      });
      const config = JSON.parse(generated.files.get("devcontainer.json"));
      const marker = JSON.parse(generated.files.get("adw-managed.json"));
      const allowedDomains = new Set(generated.files.get("allowed-domains.txt")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#")));
      const claudeSettings = JSON.parse(generated.files.get("claude-settings.json"));
      const claudeSandbox = claudeSettings.sandbox;
      assert.deepEqual(new Set(claudeSandbox.network.allowedDomains), allowedDomains);
      assert.equal(claudeSandbox.network.allowManagedDomainsOnly, true);
      assert.equal(claudeSandbox.autoAllowBashIfSandboxed, true);
      assert.equal(claudeSettings.permissions.allow, undefined);
      assert.equal(claudeSettings.hooks.PreToolUse.length, 2);

      assert.equal(config.build.args.ADW_AGENT_TOOLS, profile);
      assert.equal(marker.agent_tools, profile);
      assert.equal(marker.project_requirements_sha256, createHash("sha256").update(generated.files.get("project-requirements.json")).digest("hex"));
      assert.equal(marker.project_setup_sha256, createHash("sha256").update(generated.files.get("project-setup.sh")).digest("hex"));
      assert.equal(marker.allowed_domains_sha256, createHash("sha256").update(generated.files.get("allowed-domains.txt")).digest("hex"));
      assert.equal(marker.egress_proxy_sha256, createHash("sha256").update(generated.files.get("egress-proxy.mjs")).digest("hex"));
      assert.deepEqual(marker.integration_domains, ["tracker.example.com"]);
      assert.ok(allowedDomains.has("tracker.example.com"));
      assert.equal([...allowedDomains].filter((domain) => domain === "tracker.example.com").length, 1);

      for (const agent of ["codex", "claude"]) {
        const selected = agents.includes(agent);
        assert.equal(config.mounts.some((mount) => mount.includes(`target=${mountByAgent[agent]},`)), selected);
        assert.equal(config.customizations.vscode.extensions.includes(extensionByAgent[agent]), selected);
        for (const domain of domainsByAgent[agent]) assert.equal(allowedDomains.has(domain), selected);
      }
      assert.equal(config.containerEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === "1", agents.includes("claude"));
      assert.equal(config.containerEnv.DISABLE_AUTOUPDATER === "1", agents.includes("claude"));
      assert.doesNotMatch(generated.files.get("allowed-domains.txt"), /\*|https?:\/\//);
    });
  }
});

test("managed development files reject invalid agent profiles and integration domains", () => {
  const root = mkdtempSync(join(tmpdir(), "adw-agent-invalid-"));
  assert.throws(() => managedDevelopmentFiles(root, templateRoot, { agentTools: "other" }), /unsupported agent tools profile/);
  assert.throws(() => managedDevelopmentFiles(root, templateRoot, { integrationDomains: "tracker.example.com" }), /must be an array/);
  assert.throws(() => managedDevelopmentFiles(root, templateRoot, { integrationDomains: ["https://tracker.example.com/path"] }), /invalid integration domain/);
  assert.throws(() => managedDevelopmentFiles(root, templateRoot, { integrationDomains: ["tracker.example.com\nmalicious.example.com"] }), /invalid integration domain/);
});

test("managed firewall scripts are valid shell and establish deny-by-default before DNS resolution", () => {
  for (const name of ["init-firewall.sh", "post-create.sh"]) {
    const result = spawnSync("bash", ["-n", join(templateRoot, name)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const firewall = readFileSync(join(templateRoot, "init-firewall.sh"), "utf8");
  assert.ok(firewall.indexOf("iptables -P OUTPUT DROP") < firewall.lastIndexOf("resolve_domains\n"));
  assert.match(firewall, /ip6tables -P OUTPUT DROP/);
  assert.match(firewall, /claude\) verification_domain="api\.anthropic\.com"/);
  assert.match(firewall, /codex\|both\) verification_domain="api\.openai\.com"/);
  assert.match(firewall, /awk '\$1 == "nameserver"/);
  assert.match(firewall, /dig \+short \+time="\$dns_timeout" \+tries=1 @"\$resolver"/);
  assert.match(firewall, /--uid-owner "\$uid" -p udp -d "\$resolver" --dport 53 -j ACCEPT/);
  assert.match(firewall, /--uid-owner "\$uid" -p tcp -d "\$resolver" --dport 53 -j ACCEPT/);
  assert.match(firewall, /--uid-owner "\$proxy_uid" -p tcp --dport 443 -j "\$dispatcher_chain"/);
  assert.match(firewall, /iptables -I "\$dispatcher_chain" 1 -j "\$next_chain"/);
  assert.doesNotMatch(firewall, /\bipset\b/);
  assert.match(firewall, /--chuid "\$proxy_user" --exec \/usr\/local\/bin\/adw-egress-proxy/);
  assert.doesNotMatch(firewall, /^iptables -A OUTPUT -p (?:udp|tcp) --dport 53 -j ACCEPT$/m);
  assert.match(firewall, /failed to resolve required domain after \$\{dns_attempts\} attempts/);
  assert.match(firewall, /adw-firewall-refresh\.log/);
  assert.doesNotMatch(firewall, /iptables -P OUTPUT ACCEPT/);
});

test("managed shell templates pass shellcheck when it is available", { skip: spawnSync("shellcheck", ["--version"], { encoding: "utf8" }).status === 0 ? false : "shellcheck is not installed" }, () => {
  const result = spawnSync("shellcheck", ["--severity=warning", join(templateRoot, "init-firewall.sh"), join(templateRoot, "post-create.sh")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout || result.stderr);
});

test("init derives a reviewable project-specific development environment from repository evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "adw-managed-discovery-"));
  mkdirSync(join(root, "services/api"), { recursive: true });
  mkdirSync(join(root, "services/dotnet"), { recursive: true });
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
  writeFileSync(join(root, "services/dotnet/global.json"), `${JSON.stringify({ sdk: { version: "8.0.408" } }, null, 2)}\n`);
  writeFileSync(join(root, "services/dotnet/App.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>\n");
  writeFileSync(join(root, "services/dotnet/packages.lock.json"), `${JSON.stringify({ version: 1, dependencies: { "net8.0": {} } }, null, 2)}\n`);
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture");

  const previewResult = spawnSync(process.execPath, [initScript, "preview", "--project-root", root], { encoding: "utf8" });
  assert.equal(previewResult.status, 0, previewResult.stderr);
  const preview = JSON.parse(previewResult.stdout);
  assert.deepEqual(preview.development_environment.selected_versions, { dotnet: "8.0.408", go: "1.22.4", node: "20", python: "3.11" });
  assert.deepEqual(preview.development_environment.forward_ports.map(({ port }) => port), [3000, 4173, 55432]);
  assert.ok(preview.development_environment.setup_commands.some(({ command, source }) => command === "npm ci" && source === "package-lock.json"));
  assert.ok(preview.development_environment.setup_commands.some(({ command }) => command.includes("services/api") && command.includes("requirements.txt")));
  assert.ok(preview.development_environment.setup_commands.some(({ command }) => command.includes("services/worker") && command.includes("go mod download")));
  assert.ok(preview.development_environment.setup_commands.some(({ command, source }) => command.includes("services/dotnet") && command.includes("dotnet restore --locked-mode") && source === "services/dotnet/packages.lock.json"));
  assert.ok(preview.development_environment.system_packages.some(({ name }) => name === "libpq-dev"));
  assert.ok(preview.development_environment.unresolved.some(({ requirement }) => requirement === "compose services"));
  assert.ok(preview.development_environment.unresolved.some(({ requirement }) => requirement === "environment variable DATABASE_URL"));

  const initialized = spawnSync(process.execPath, [initScript, "apply", "--confirmed", "--preview-digest", preview.preview_digest, "--project-root", root], { encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  const config = JSON.parse(readFileSync(join(root, ".devcontainer/devcontainer.json"), "utf8"));
  assert.equal(config.build.args.NODE_MAJOR, "20");
  assert.match(config.build.args.ADW_PROJECT_APT_PACKAGES, /\blibpq-dev\b/);
  assert.equal(config.features["ghcr.io/devcontainers/features/python:1"].version, "3.11");
  assert.equal(config.features["ghcr.io/devcontainers/features/go:1"].version, "1.22.4");
  assert.equal(config.features["ghcr.io/devcontainers/features/dotnet:1"].version, "8.0.408");
  assert.deepEqual(config.forwardPorts, [3000, 4173, 55432]);
  assert.match(config.postCreateCommand, /adw-project-setup/);

  const setup = readFileSync(join(root, ".devcontainer/project-setup.sh"), "utf8");
  assert.match(setup, /^npm ci$/m);
  assert.match(setup, /go mod download/);
  assert.match(setup, /dotnet restore --locked-mode/);
  assert.doesNotMatch(setup, /malicious-repository-text-must-not-be-copied/);
  const shellCheck = spawnSync("bash", ["-n", join(root, ".devcontainer/project-setup.sh")], { encoding: "utf8" });
  assert.equal(shellCheck.status, 0, shellCheck.stderr);
  const allowedDomains = readFileSync(join(root, ".devcontainer/allowed-domains.txt"), "utf8");
  assert.match(allowedDomains, /^proxy\.golang\.org$/m);
  assert.match(allowedDomains, /^api\.nuget\.org$/m);
  assert.match(allowedDomains, /^globalcdn\.nuget\.org$/m);

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
  const previewResult = spawnSync(process.execPath, [initScript, "preview", "--project-root", root], { encoding: "utf8" });
  assert.equal(previewResult.status, 0, previewResult.stderr);
  const preview = JSON.parse(previewResult.stdout);
  const initialized = spawnSync(process.execPath, [initScript, "apply", "--confirmed", "--preview-digest", preview.preview_digest, "--project-root", root], { encoding: "utf8" });
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
  const driftedChecks = JSON.parse(drifted.stdout).checks;
  assert.equal(driftedChecks.find(({ id }) => id === "execution:generated-files").status, "fail");
  assert.equal(driftedChecks.find(({ id }) => id === "execution:managed-files").status, "pass");
  assert.equal(driftedChecks.find(({ id }) => id === "execution:hardening").status, "pass");
});

test("single-agent and dual-agent onboarding initialize only selected routing and pass doctor", async (t) => {
  for (const profile of ["codex", "claude", "both"]) {
    await t.test(profile, () => {
      const root = mkdtempSync(join(tmpdir(), `adw-managed-doctor-${profile}-`));
      git(root, "init", "-q", "-b", "main");
      git(root, "config", "user.name", "ADW Test");
      git(root, "config", "user.email", "adw@example.invalid");
      writeFileSync(join(root, "README.md"), "# fixture\n");
      git(root, "add", ".");
      git(root, "commit", "-q", "-m", "fixture");
      const onboardingPath = join(root, "onboarding.json");
      writeFileSync(onboardingPath, `${JSON.stringify({
        schema: 1,
        agents: profile === "both" ? ["codex", "claude"] : [profile],
        execution: { isolation: "managed-devcontainer" },
      }, null, 2)}\n`);
      const previewResult = spawnSync(process.execPath, [initScript, "preview", "--onboarding", onboardingPath, "--project-root", root], { encoding: "utf8" });
      assert.equal(previewResult.status, 0, previewResult.stderr || previewResult.stdout);
      const preview = JSON.parse(previewResult.stdout);
      const initialized = spawnSync(process.execPath, [initScript, "apply", "--confirmed", "--preview-digest", preview.preview_digest, "--onboarding", onboardingPath, "--project-root", root], { encoding: "utf8" });
      assert.equal(initialized.status, 0, initialized.stderr);

      const doctor = spawnSync(process.execPath, [doctorScript, "--project-root", root], {
        encoding: "utf8",
        env: { ...process.env, ADW_MANAGED_DEVCONTAINER: "1" },
      });
      assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
      const snapshot = JSON.parse(doctor.stdout);
      assert.equal(snapshot.checks.find(({ id }) => id === "execution:managed-files").status, "pass");
      assert.deepEqual(snapshot.checks.filter(({ id }) => id.startsWith("routing:")).map(({ id }) => id), profile === "codex"
        ? ["routing:AGENTS.md"]
        : profile === "claude" ? ["routing:CLAUDE.md"] : ["routing:AGENTS.md", "routing:CLAUDE.md"]);
      assert.equal(existsSync(join(root, "AGENTS.md")), profile !== "claude");
      assert.equal(existsSync(join(root, "CLAUDE.md")), profile !== "codex");

      if (profile === "codex") {
        const configPath = join(root, ".devcontainer/devcontainer.json");
        const config = JSON.parse(readFileSync(configPath, "utf8"));
        config.mounts.push("source=unexpected-claude,target=/home/vscode/.claude,type=volume");
        writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
        const drifted = spawnSync(process.execPath, [doctorScript, "--project-root", root], {
          encoding: "utf8",
          env: { ...process.env, ADW_MANAGED_DEVCONTAINER: "1" },
        });
        const driftedChecks = JSON.parse(drifted.stdout).checks;
        assert.equal(driftedChecks.find(({ id }) => id === "execution:mounts").status, "fail");
        assert.equal(driftedChecks.find(({ id }) => id === "execution:agent-profile").status, "pass");
        assert.equal(driftedChecks.find(({ id }) => id === "execution:domains").status, "pass");

        writeFileSync(join(root, ".devcontainer/allowed-domains.txt"), `${readFileSync(join(root, ".devcontainer/allowed-domains.txt"), "utf8")}evil.example.com\n`);
        const domainDrift = spawnSync(process.execPath, [doctorScript, "--project-root", root], {
          encoding: "utf8",
          env: { ...process.env, ADW_MANAGED_DEVCONTAINER: "1" },
        });
        assert.equal(JSON.parse(domainDrift.stdout).checks.find(({ id }) => id === "execution:domains").status, "fail");
      }
    });
  }
});
