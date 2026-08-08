FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

ARG DEBIAN_FRONTEND=noninteractive
ARG NODE_MAJOR=22
ARG CODEX_VERSION
ARG CLAUDE_CODE_VERSION
ARG ADW_PROJECT_APT_PACKAGES=""

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN test -n "$NODE_MAJOR" && test -n "$CODEX_VERSION" && test -n "$CLAUDE_CODE_VERSION" \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        bubblewrap ca-certificates curl dnsutils git gnupg iproute2 ipset iptables jq \
        python3 ripgrep sudo \
        $ADW_PROJECT_APT_PACKAGES \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && chmod u+s /usr/bin/bwrap \
    && npm install -g "@openai/codex@${CODEX_VERSION}" "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && npm cache clean --force \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /root/.npm

COPY .devcontainer/allowed-domains.txt /etc/adw/allowed-domains.txt
COPY .devcontainer/init-firewall.sh /usr/local/bin/adw-init-firewall
COPY .devcontainer/post-create.sh /usr/local/bin/adw-post-create
COPY .devcontainer/project-setup.sh /usr/local/bin/adw-project-setup
COPY .devcontainer/project-requirements.json /etc/adw/project-requirements.json

RUN chown root:root /etc/adw/allowed-domains.txt /etc/adw/project-requirements.json /usr/local/bin/adw-init-firewall /usr/local/bin/adw-post-create /usr/local/bin/adw-project-setup \
    && chmod 0444 /etc/adw/allowed-domains.txt /etc/adw/project-requirements.json \
    && chmod 0500 /usr/local/bin/adw-init-firewall /usr/local/bin/adw-post-create \
    && chmod 0555 /usr/local/bin/adw-project-setup \
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
