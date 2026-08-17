FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

ARG DEBIAN_FRONTEND=noninteractive
ARG NODE_MAJOR=22
ARG ADW_AGENT_TOOLS=both
ARG ADW_WEB_ACCESS=public-pages
ARG CODEX_VERSION
ARG CLAUDE_CODE_VERSION
ARG ADW_PROJECT_APT_PACKAGES=""

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN test -n "$NODE_MAJOR" \
    && test -n "$CODEX_VERSION" \
    && test -n "$CLAUDE_CODE_VERSION" \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        bubblewrap build-essential ca-certificates curl dnsutils fd-find git gnupg \
        iproute2 iptables jq python3 ripgrep socat sudo unzip zip \
        $ADW_PROJECT_APT_PACKAGES \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs gh \
    && npm install -g "@openai/codex@${CODEX_VERSION}" "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && npm cache clean --force \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /root/.npm

COPY .devcontainer/allowed-domains.txt /etc/adw/allowed-domains.txt
COPY .devcontainer/egress-proxy.mjs /usr/local/bin/adw-egress-proxy
COPY .devcontainer/init-firewall.sh /usr/local/bin/adw-init-firewall
COPY .devcontainer/post-create.sh /usr/local/bin/adw-post-create
COPY .devcontainer/codex.rules /etc/adw/codex.rules
COPY .devcontainer/permission-policy.json /etc/adw/permission-policy.json
COPY .devcontainer/git-wrapper.sh /usr/local/bin/git
COPY .devcontainer/claude-settings.json /etc/claude-code/managed-settings.d/20-adw.json
COPY .devcontainer/claude-permission-hook.mjs /usr/local/bin/adw-claude-permission-hook
COPY .devcontainer/project-setup.sh /usr/local/bin/adw-project-setup
COPY .devcontainer/project-requirements.json /etc/adw/project-requirements.json

RUN useradd --system --no-create-home --shell /usr/sbin/nologin adw-egress \
    && case "$ADW_WEB_ACCESS" in hosted-only|public-pages) ;; *) echo "Unsupported ADW web access profile: $ADW_WEB_ACCESS" >&2; exit 1 ;; esac \
    && printf '%s\n' both > /etc/adw/agent-tools \
    && printf '%s\n' "$ADW_WEB_ACCESS" > /etc/adw/web-access \
    && chown root:root /etc/adw/agent-tools /etc/adw/web-access /etc/adw/allowed-domains.txt /etc/adw/codex.rules /etc/adw/permission-policy.json /etc/adw/project-requirements.json /etc/claude-code/managed-settings.d/20-adw.json /usr/local/bin/adw-egress-proxy /usr/local/bin/adw-claude-permission-hook /usr/local/bin/adw-init-firewall /usr/local/bin/adw-post-create /usr/local/bin/adw-project-setup /usr/local/bin/git \
    && chmod 0444 /etc/adw/agent-tools /etc/adw/web-access /etc/adw/allowed-domains.txt /etc/adw/codex.rules /etc/adw/permission-policy.json /etc/adw/project-requirements.json /etc/claude-code/managed-settings.d/20-adw.json \
    && chmod 0500 /usr/local/bin/adw-init-firewall /usr/local/bin/adw-post-create \
    && chmod 0555 /usr/local/bin/adw-project-setup \
    && chmod 0555 /usr/local/bin/adw-egress-proxy \
    && chmod 0555 /usr/local/bin/adw-claude-permission-hook \
    && chmod 0555 /usr/local/bin/git \
    # Root intentionally has no CAP_DAC_OVERRIDE at runtime. Make the known
    # credential mount paths traversable and root-owned before named volumes
    # are attached, so the narrowly sudo-authorized bootstrap can initialize
    # them and then hand them to vscode. The host's real Codex/Claude home
    # directories are staged read-only at /mnt/host-* instead (see
    # devcontainer.json); only root reads them, to seed a single auth file
    # each into the isolated volumes below, so they need no bootstrap here.
    && chmod 0751 /home/vscode \
    && install -d -m 0755 -o root -g root /home/vscode/.codex /home/vscode/.claude /home/vscode/.config /home/vscode/.config/gh \
    && (gpasswd -d vscode sudo 2>/dev/null || true) \
    && rm -f /etc/sudoers.d/vscode \
    && printf '%s\n' \
      'vscode ALL=(root) NOPASSWD: /usr/local/bin/adw-init-firewall' \
      'vscode ALL=(root) NOPASSWD: /usr/local/bin/adw-post-create' \
      > /etc/sudoers.d/adw-managed \
    && chmod 0440 /etc/sudoers.d/adw-managed \
    && visudo -cf /etc/sudoers.d/adw-managed

ENV ADW_MANAGED_DEVCONTAINER=1
USER vscode
WORKDIR /workspace
