#!/usr/bin/env bash
set -euo pipefail

for command in docker jq shellcheck; do
  command -v "$command" >/dev/null || {
    printf 'Missing required command: %s\n' "$command" >&2
    exit 1
  }
done

stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/adw-managed-container.XXXXXX")"
image_tag="adw-managed-security-local-$$"
runtime_name="adw-security-runtime-$$"

cleanup() {
  docker rm --force "$runtime_name" >/dev/null 2>&1 || true
  docker image rm --force "$image_tag" >/dev/null 2>&1 || true
  rm -rf "$stage_dir"
}
trap cleanup EXIT

npm ci
npm test

shellcheck --severity=warning \
  plugin/templates/devcontainer/init-firewall.sh \
  plugin/templates/devcontainer/post-create.sh \
  plugin/templates/devcontainer/project-setup.sh

npm run stage:managed-container -- "$stage_dir"
npx --yes @devcontainers/cli@0.88.0 read-configuration --workspace-folder "$stage_dir" >/dev/null

config="$stage_dir/.devcontainer/devcontainer.json"
docker build \
  --build-arg "NODE_MAJOR=$(jq -r '.build.args.NODE_MAJOR' "$config")" \
  --build-arg ADW_AGENT_TOOLS=both \
  --build-arg ADW_WEB_ACCESS=public-pages \
  --build-arg "CODEX_VERSION=$(jq -r '.build.args.CODEX_VERSION' "$config")" \
  --build-arg "CLAUDE_CODE_VERSION=$(jq -r '.build.args.CLAUDE_CODE_VERSION' "$config")" \
  --build-arg ADW_PROJECT_APT_PACKAGES= \
  --tag "$image_tag" \
  --file "$stage_dir/.devcontainer/Dockerfile" \
  "$stage_dir"

codex_version="$(jq -r '.build.args.CODEX_VERSION' "$config")"
claude_version="$(jq -r '.build.args.CLAUDE_CODE_VERSION' "$config")"
docker run --rm --entrypoint bash \
  -e "EXPECTED_CODEX=$codex_version" \
  -e "EXPECTED_CLAUDE=$claude_version" \
  "$image_tag" -lc '
    test "$(codex --version | awk "{print \$2}")" = "$EXPECTED_CODEX"
    test "$(claude --version | awk "{print \$1}")" = "$EXPECTED_CLAUDE"
    test "$(stat -c "%U:%G %a" /etc/adw/codex.rules)" = "root:root 444"
    test "$(stat -c "%U:%G %a" /etc/claude-code/managed-settings.d/20-adw.json)" = "root:root 444"
    test "$(stat -c "%U:%G %a" /usr/local/bin/adw-claude-permission-hook)" = "root:root 555"
    test "$(stat -c "%U:%G %a" /usr/local/bin/adw-init-firewall)" = "root:root 500"
    test "$(stat -c "%U:%G %a" /usr/local/bin/adw-post-create)" = "root:root 500"
    printf "%s\n" "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git status\"}}" | /usr/local/bin/adw-claude-permission-hook | grep -q "\"permissionDecision\":\"allow\""
    codex execpolicy check --rules /etc/adw/codex.rules git push --force origin main | grep -Eq "\"decision\"[[:space:]]*:[[:space:]]*\"forbidden\""
  '

docker run --detach --name "$runtime_name" \
  --cap-drop=ALL \
  --cap-add=CHOWN \
  --cap-add=KILL \
  --cap-add=SETUID \
  --cap-add=SETGID \
  --cap-add=NET_ADMIN \
  -e HTTP_PROXY=http://127.0.0.1:18080 \
  -e HTTPS_PROXY=http://127.0.0.1:18080 \
  -e NO_PROXY=localhost,127.0.0.1 \
  -e http_proxy=http://127.0.0.1:18080 \
  -e https_proxy=http://127.0.0.1:18080 \
  -e no_proxy=localhost,127.0.0.1 \
  --entrypoint sleep \
  "$image_tag" infinity

test "$(docker inspect --format '{{json .HostConfig.CapDrop}} {{json .HostConfig.CapAdd}}' "$runtime_name")" = '["ALL"] ["CAP_CHOWN","CAP_KILL","CAP_NET_ADMIN","CAP_SETGID","CAP_SETUID"]'
test "$(docker exec "$runtime_name" stat -c '%U:%G %a' /usr/bin/bwrap)" = 'root:root 755'
docker exec "$runtime_name" sudo /usr/local/bin/adw-init-firewall
docker exec "$runtime_name" curl --connect-timeout 8 --silent --show-error https://api.openai.com >/dev/null
! docker exec "$runtime_name" curl --noproxy '*' --connect-timeout 3 --silent --show-error https://api.openai.com >/dev/null
! docker exec "$runtime_name" curl --connect-timeout 3 --silent --show-error https://example.com >/dev/null
! docker exec "$runtime_name" sh -c "timeout 8 openssl s_client -quiet -proxy 127.0.0.1:18080 -connect api.openai.com:443 -servername example.com </dev/null >/dev/null 2>&1"
docker exec "$runtime_name" curl --fail --silent --show-error \
  --header 'User-Agent: Claude-User (claude-code/security-test; +https://support.anthropic.com/)' \
  --header 'Accept: text/markdown, text/html, */*' \
  --request-target 'https://example.com/' \
  http://127.0.0.1:18080/ >/dev/null
! docker exec "$runtime_name" curl --fail --silent --show-error \
  --header 'User-Agent: curl/security-test' \
  --header 'Accept: text/markdown, text/html, */*' \
  --request-target 'https://example.com/' \
  http://127.0.0.1:18080/ >/dev/null
