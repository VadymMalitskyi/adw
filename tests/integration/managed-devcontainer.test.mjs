// The managed devcontainer is the strongest isolation ADW offers, so its
// rendering is asserted directly against `managedDevelopmentFiles`: what a
// project actually receives on disk, not what the template happens to contain.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MANAGED_FILES, managedDevelopmentFiles } from "../../plugin/lib/managed-environment.mjs";
import { defaultPermissionPolicy } from "../../plugin/lib/permission-policy.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const templateRoot = join(repositoryRoot, "plugin/templates/devcontainer");

// Every recorded digest names exactly one generated file; the marker must not
// grow a digest that nothing proves.
const DIGESTED_FILES = {
  allowed_domains_sha256: "allowed-domains.txt",
  codex_rules_sha256: "codex.rules",
  permission_policy_sha256: "permission-policy.json",
  git_wrapper_sha256: "git-wrapper.sh",
  claude_settings_sha256: "claude-settings.json",
  claude_hook_sha256: "claude-permission-hook.mjs",
  egress_proxy_sha256: "egress-proxy.mjs",
  project_requirements_sha256: "project-requirements.json",
  project_setup_sha256: "project-setup.sh",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function render(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "adw-managed-"));
  const generated = managedDevelopmentFiles(root, templateRoot, options);
  const files = generated.files;
  return {
    root,
    files,
    config: JSON.parse(files.get("devcontainer.json")),
    configText: files.get("devcontainer.json"),
    dockerfile: files.get("Dockerfile"),
    marker: JSON.parse(files.get("adw-managed.json")),
    claudeSettings: JSON.parse(files.get("claude-settings.json")),
    allowedDomains: new Set(files.get("allowed-domains.txt").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))),
  };
}

test("the generated managed container pins agents, runs non-root, and drops every capability it does not need", () => {
  const { config, configText, dockerfile, marker } = render();

  assert.equal(config.remoteUser, "vscode");
  assert.match(dockerfile, /USER vscode/);
  assert.match(dockerfile, /gpasswd -d vscode sudo/);

  assert.match(config.build.args.CODEX_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(config.build.args.CLAUDE_CODE_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(marker.codex_version, config.build.args.CODEX_VERSION);
  assert.equal(marker.claude_code_version, config.build.args.CLAUDE_CODE_VERSION);
  assert.match(dockerfile, /npm install -g "@openai\/codex@\$\{CODEX_VERSION\}" "@anthropic-ai\/claude-code@\$\{CLAUDE_CODE_VERSION\}"/);

  assert.equal(config.runArgs.includes("--cap-drop=ALL"), true);
  assert.deepEqual(config.runArgs.filter((argument) => argument.startsWith("--cap-add=")).sort(), [
    "--cap-add=CHOWN",
    "--cap-add=KILL",
    "--cap-add=NET_ADMIN",
    "--cap-add=SETGID",
    "--cap-add=SETUID",
  ]);
  for (const argument of ["--privileged", "--network=host", "--pid=host"]) {
    assert.equal(config.runArgs.includes(argument), false, `${argument} must never be requested`);
  }
  assert.doesNotMatch(configText, /SYS_ADMIN|SYS_PTRACE|NET_RAW|seccomp=unconfined|apparmor=unconfined/);
  assert.doesNotMatch(dockerfile, /chmod u\+s \/usr\/bin\/bwrap/);
  assert.match(dockerfile, /bubblewrap/);
  assert.match(dockerfile, /chmod 0555 \/usr\/local\/bin\/adw-project-setup/);
  assert.match(dockerfile, /chmod 0555 \/usr\/local\/bin\/adw-claude-permission-hook/);
  assert.match(dockerfile, /COPY \.devcontainer\/git-wrapper\.sh \/usr\/local\/bin\/git/);
  assert.match(dockerfile, /COPY \.devcontainer\/codex\.rules/);
  assert.match(dockerfile, /managed-settings\.d\/20-adw\.json/);
});

test("Codex, Claude, and gh credentials live in project-scoped named volumes, with only a read-only host staging mount for auth and no other host path mounted", () => {
  const { config, configText } = render();

  assert.ok(config.mounts.length > 0);
  for (const target of ["/home/vscode/.codex", "/home/vscode/.claude", "/home/vscode/.config/gh"]) {
    const mount = config.mounts.find((entry) => entry.includes(`target=${target},`));
    assert.ok(mount, `${target} must be mounted`);
    assert.match(mount, /type=volume/);
    assert.match(mount, /\$\{devcontainerId\}/);
  }
  for (const [target, suffix] of [["/mnt/host-codex", ".codex"], ["/mnt/host-claude", ".claude"]]) {
    const mount = config.mounts.find((entry) => entry.includes(`target=${target},`));
    assert.ok(mount, `${target} must be mounted`);
    assert.match(mount, /type=bind/);
    assert.match(mount, new RegExp(`source=\\$\\{localEnv:HOME\\}/${suffix.replace(".", "\\.")},`));
    assert.match(mount, /(?:^|,)readonly(?:,|$)/, `${target} must be read-only`);
  }

  assert.doesNotMatch(configText, /docker\.sock/i);
  assert.doesNotMatch(configText, /\.ssh|\.aws|\.azure|\.config\/gcloud/i);
  // The only permitted `localEnv:HOME` usage is the two read-only host staging mounts above.
  const otherHomeMounts = config.mounts.filter((mount) => /localEnv:HOME/.test(mount) && !/target=\/mnt\/host-(?:codex|claude),/.test(mount));
  assert.deepEqual(otherHomeMounts, []);
  assert.match(config.workspaceMount, /target=\/workspace,type=bind/);
});

test("the proxy environment is set and the firewall runs before any project setup", () => {
  const { config } = render();

  assert.equal(config.containerEnv.ADW_MANAGED_DEVCONTAINER, "1");
  assert.equal(config.containerEnv.HTTP_PROXY, "http://127.0.0.1:18080");
  assert.equal(config.containerEnv.HTTPS_PROXY, "http://127.0.0.1:18080");
  assert.equal(config.containerEnv.NO_PROXY, "localhost,127.0.0.1");
  assert.match(config.postStartCommand, /adw-init-firewall/);
  assert.ok(config.postCreateCommand.indexOf("adw-init-firewall") !== -1);
  assert.ok(config.postCreateCommand.indexOf("adw-init-firewall") < config.postCreateCommand.indexOf("adw-project-setup"));
});

test("the generated file set is exactly MANAGED_FILES and every recorded digest matches its own bytes", () => {
  const { files, marker } = render();

  assert.deepEqual([...files.keys()].sort(), [...MANAGED_FILES].sort());
  assert.equal(MANAGED_FILES.length, 14);
  assert.equal(files.has("project-requirements.md"), false, "project-requirements.md is no longer generated");

  const digestKeys = Object.keys(marker).filter((key) => key.endsWith("_sha256")).sort();
  assert.deepEqual(digestKeys, Object.keys(DIGESTED_FILES).sort(), "every marker digest must name a generated file");
  for (const [key, name] of Object.entries(DIGESTED_FILES)) {
    assert.equal(marker[key], sha256(files.get(name)), `${key} must be the digest of ${name}`);
  }

  assert.equal(marker.schema, 3);
  assert.equal(marker.profile, "managed-devcontainer");
  assert.equal(marker.permission_profile, "managed-development");
  assert.equal(marker.requirements_schema, JSON.parse(files.get("project-requirements.json")).schema);
  assert.equal(Object.hasOwn(marker, "agent_tools"), false, "the per-agent profile no longer exists");
});

test("one custom provider policy renders into both agent adapters and the canonical container file", () => {
  const permissionPolicy = defaultPermissionPolicy();
  permissionPolicy.providers.github.operations.comment = "allow";
  permissionPolicy.providers.github.tools.add_comment = "comment";
  const { files, marker } = render({ permissionPolicy });
  assert.match(files.get("codex.rules"), /pattern = \["gh","pr","comment"\], decision = "allow"/);
  assert.equal(JSON.parse(files.get("permission-policy.json")).entries.some(({ kind, provider, operation, decision }) => kind === "tool" && provider === "github" && operation === "comment" && decision === "allow"), true);
  assert.ok(JSON.parse(files.get("claude-settings.json")).permissions.allow.includes("mcp__github__add_comment"));
  assert.equal(marker.permission_policy_sha256, sha256(files.get("permission-policy.json")));
});

test("a managed container always provisions both agents", () => {
  const { config, allowedDomains, claudeSettings } = render();

  for (const target of ["/home/vscode/.codex", "/home/vscode/.claude"]) {
    assert.equal(config.mounts.some((mount) => mount.includes(`target=${target},`)), true, `${target} must be mounted`);
  }
  for (const extension of ["openai.chatgpt", "anthropic.claude-code"]) {
    assert.equal(config.customizations.vscode.extensions.includes(extension), true, `${extension} must be installed`);
  }
  for (const domain of ["api.openai.com", "auth.openai.com", "chatgpt.com", "api.anthropic.com", "claude.ai", "claude.com", "console.anthropic.com", "platform.claude.com"]) {
    assert.equal(allowedDomains.has(domain), true, `${domain} must be reachable`);
  }
  assert.equal(config.containerEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
  assert.equal(config.containerEnv.DISABLE_AUTOUPDATER, "1");
  assert.equal(config.build.args.ADW_AGENT_TOOLS, "both");

  assert.deepEqual(new Set(claudeSettings.sandbox.network.allowedDomains), allowedDomains);
  assert.equal(claudeSettings.sandbox.network.strictAllowlist, true);
  assert.equal(claudeSettings.sandbox.autoAllowBashIfSandboxed, true);
  // Bubblewrap can never start in this container (no CAP_SYS_ADMIN, no
  // apparmor=unconfined), so Bash must fall back to running unsandboxed
  // rather than becoming permanently unavailable to Claude.
  assert.equal(claudeSettings.sandbox.failIfUnavailable, false);
  assert.equal(claudeSettings.sandbox.allowUnsandboxedCommands, true);
  assert.deepEqual(claudeSettings.permissions.allow, ["WebSearch"]);
  assert.equal(claudeSettings.hooks.PreToolUse.length, 2);
});

test("a detected .NET SDK also points the C# extension's runtime acquisition at that SDK, so it never falls back to a firewall-blocked download", () => {
  const root = mkdtempSync(join(tmpdir(), "adw-managed-dotnet-"));
  writeFileSync(join(root, "App.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\" />\n");
  const { files } = managedDevelopmentFiles(root, templateRoot, { runtimeVersions: { dotnet: "8" } });
  const config = JSON.parse(files.get("devcontainer.json"));

  assert.equal(config.features["ghcr.io/devcontainers/features/dotnet:1"].version, "8");
  assert.deepEqual(config.customizations.vscode.settings["dotnetAcquisitionExtension.existingDotnetPath"], [
    { extensionId: "ms-dotnettools.csharp", path: "/usr/local/dotnet/current/dotnet" },
  ]);
  // The setting must not crowd out the extension list already living on the same node.
  assert.equal(config.customizations.vscode.extensions.includes("anthropic.claude-code"), true);
});

test("web access is reflected consistently in the build arg, the marker, and the managed Claude settings", async (t) => {
  await t.test("public-pages", () => {
    const { config, marker, claudeSettings } = render({ webAccess: "public-pages" });
    assert.equal(config.build.args.ADW_WEB_ACCESS, "public-pages");
    assert.equal(marker.web_access, "public-pages");
    assert.equal(claudeSettings.sandbox.network.strictAllowlist, true);
    assert.equal(claudeSettings.sandbox.network.allowManagedDomainsOnly, undefined);
  });

  await t.test("hosted-only", () => {
    const { config, marker, claudeSettings } = render({ webAccess: "hosted-only" });
    assert.equal(config.build.args.ADW_WEB_ACCESS, "hosted-only");
    assert.equal(marker.web_access, "hosted-only");
    assert.equal(claudeSettings.sandbox.network.strictAllowlist, true);
    assert.equal(claudeSettings.sandbox.network.allowManagedDomainsOnly, true);
  });

  const root = mkdtempSync(join(tmpdir(), "adw-managed-web-"));
  assert.throws(() => managedDevelopmentFiles(root, templateRoot, { webAccess: "unrestricted" }), /unsupported web access profile/);
});

test("integration domains are validated, deduplicated, and recorded in both the allowlist and the marker", () => {
  const { files, marker, allowedDomains } = render({ integrationDomains: ["tracker.example.com", "tracker.example.com"] });

  assert.deepEqual(marker.integration_domains, ["tracker.example.com"]);
  assert.equal(allowedDomains.has("tracker.example.com"), true);
  const text = files.get("allowed-domains.txt");
  assert.equal(text.split(/\r?\n/).filter((line) => line.trim() === "tracker.example.com").length, 1);
  assert.doesNotMatch(text, /\*|https?:\/\//);

  const root = mkdtempSync(join(tmpdir(), "adw-managed-domains-"));
  assert.throws(() => managedDevelopmentFiles(root, templateRoot, { integrationDomains: "tracker.example.com" }), /must be an array/);
  assert.throws(() => managedDevelopmentFiles(root, templateRoot, { integrationDomains: ["https://tracker.example.com/path"] }), /invalid integration domain/);
  assert.throws(() => managedDevelopmentFiles(root, templateRoot, { integrationDomains: ["tracker.example.com\nmalicious.example.com"] }), /invalid integration domain/);
  assert.throws(() => managedDevelopmentFiles(root, templateRoot, { integrationDomains: ["*.example.com"] }), /invalid integration domain/);
});

test("the generated project setup script is valid shell and never copies repository prose into a command", () => {
  const root = mkdtempSync(join(tmpdir(), "adw-managed-setup-"));
  writeFileSync(join(root, "package.json"), `${JSON.stringify({
    private: true,
    engines: { node: ">=20" },
    scripts: { dev: "malicious-repository-text-must-not-be-copied --port 4173" },
  }, null, 2)}\n`);
  writeFileSync(join(root, "package-lock.json"), `${JSON.stringify({ name: "fixture", lockfileVersion: 3, packages: {} }, null, 2)}\n`);

  const setup = managedDevelopmentFiles(root, templateRoot, {}).files.get("project-setup.sh");
  const scriptPath = join(root, "generated-project-setup.sh");
  writeFileSync(scriptPath, setup);
  const parsed = spawnSync("bash", ["-n", scriptPath], { encoding: "utf8" });
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.match(setup, /^npm ci$/m);
  assert.doesNotMatch(setup, /malicious-repository-text-must-not-be-copied/);
});

test("managed firewall scripts are valid shell and establish deny-by-default before DNS resolution", () => {
  for (const name of ["init-firewall.sh", "post-create.sh"]) {
    const result = spawnSync("bash", ["-n", join(templateRoot, name)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const firewall = readFileSync(join(templateRoot, "init-firewall.sh"), "utf8");
  assert.ok(firewall.indexOf("iptables -P OUTPUT DROP") < firewall.lastIndexOf("resolve_domains\n"));
  assert.match(firewall, /ip6tables -P OUTPUT DROP/);
  assert.match(firewall, /awk '\$1 == "nameserver"/);
  assert.match(firewall, /dig \+short \+time="\$dns_timeout" \+tries=1 @"\$resolver"/);
  assert.match(firewall, /--uid-owner "\$uid" -p udp -d "\$resolver" --dport 53 -j ACCEPT/);
  assert.match(firewall, /--uid-owner "\$uid" -p tcp -d "\$resolver" --dport 53 -j ACCEPT/);
  assert.match(firewall, /--uid-owner "\$proxy_uid" -p tcp --dport 443 -j "\$dispatcher_chain"/);
  assert.match(firewall, /public-pages\) web_fetch_enabled=1/);
  assert.match(firewall, /iptables -I "\$dispatcher_chain" 1 -j "\$next_chain"/);
  assert.match(firewall, /--chuid "\$proxy_user" --exec \/usr\/local\/bin\/adw-egress-proxy/);
  assert.match(firewall, /failed to resolve required domain after \$\{dns_attempts\} attempts/);
  assert.doesNotMatch(firewall, /^iptables -A OUTPUT -p (?:udp|tcp) --dport 53 -j ACCEPT$/m);
  assert.doesNotMatch(firewall, /iptables -P OUTPUT ACCEPT/);
  assert.doesNotMatch(firewall, /\bipset\b/);

  // The post-create step verifies both pinned agents before it touches credentials.
  const postCreate = readFileSync(join(templateRoot, "post-create.sh"), "utf8");
  assert.match(postCreate, /agent_commands=\(codex claude\)/);
  assert.match(postCreate, /command -v "\$command"/);
  assert.doesNotMatch(postCreate, /\/usr\/local\/bin\/(codex|claude)/);
});

test("managed shell templates pass shellcheck when it is available", { skip: spawnSync("shellcheck", ["--version"], { encoding: "utf8" }).status === 0 ? false : "shellcheck is not installed" }, () => {
  const result = spawnSync("shellcheck", ["--severity=warning", join(templateRoot, "init-firewall.sh"), join(templateRoot, "post-create.sh")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout || result.stderr);
});

test("the managed git wrapper permits ordinary Git and blocks unsafe auto-approved pushes", () => {
  const wrapper = join(templateRoot, "git-wrapper.sh");
  const version = spawnSync("bash", [wrapper, "--version"], { encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /^git version /);

  for (const args of [
    ["push", "origin", "main", "--force"],
    ["push", "-uf", "origin", "main"],
    ["push", "origin", "+main"],
    ["push", "origin", ":main"],
    ["push", "--delete", "origin", "main"],
  ]) {
    const result = spawnSync("bash", [wrapper, ...args], { encoding: "utf8" });
    assert.equal(result.status, 64, `${args.join(" ")}: ${result.stderr}`);
    assert.match(result.stderr, /ADW blocks/);
  }
});
