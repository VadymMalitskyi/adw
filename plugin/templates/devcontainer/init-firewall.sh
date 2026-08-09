#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

readonly domains_file="/etc/adw/allowed-domains.txt"
readonly agent_tools_file="/etc/adw/agent-tools"
readonly ipset_name="adw-allowed-egress"
readonly entry_timeout=900
readonly refresh_interval=120
readonly dns_attempts=3
readonly dns_timeout=2
readonly pid_file="/run/adw-firewall-refresh.pid"
readonly refresh_log="/var/log/adw-firewall-refresh.log"

mapfile -t allowed_domains < <(sed -E '/^[[:space:]]*(#|$)/d' "$domains_file" | sort -u)
if [ "${#allowed_domains[@]}" -eq 0 ]; then
  echo "[adw-firewall] no allowed domains configured; refusing to start" >&2
  exit 1
fi

mapfile -t dns_resolvers < <(awk '$1 == "nameserver" { print $2 }' /etc/resolv.conf | sort -u)
if [ "${#dns_resolvers[@]}" -eq 0 ]; then
  echo "[adw-firewall] no DNS resolvers configured; refusing to open port 53" >&2
  exit 1
fi
for resolver in "${dns_resolvers[@]}"; do
  if [[ ! "$resolver" =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then
    echo "[adw-firewall] unsupported non-IPv4 DNS resolver: $resolver" >&2
    exit 1
  fi
done

case "$(cat "$agent_tools_file")" in
  codex|both) verification_domain="api.openai.com" ;;
  claude) verification_domain="api.anthropic.com" ;;
  *)
    echo "[adw-firewall] invalid agent tools profile" >&2
    exit 1
    ;;
esac

resolve_domains() {
  local domain ips ip resolver attempt failed=0
  for domain in "${allowed_domains[@]}"; do
    if [[ ! "$domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$ ]]; then
      echo "[adw-firewall] invalid domain: $domain" >&2
      return 1
    fi
    ips=""
    for ((attempt = 1; attempt <= dns_attempts && ${#ips} == 0; attempt++)); do
      for resolver in "${dns_resolvers[@]}"; do
        if ! ips="$(dig +short +time="$dns_timeout" +tries=1 @"$resolver" A "$domain" | sed -nE '/^[0-9]+(\.[0-9]+){3}$/p' | sort -u)"; then
          ips=""
        fi
        if [ -n "$ips" ]; then
          break
        fi
        echo "[adw-firewall] DNS attempt ${attempt}/${dns_attempts} failed for ${domain} via ${resolver}" >&2
      done
    done
    if [ -z "$ips" ]; then
      echo "[adw-firewall] failed to resolve required domain after ${dns_attempts} attempts: $domain" >&2
      failed=1
      continue
    fi
    while IFS= read -r ip; do
      ipset add "$ipset_name" "$ip" timeout "$entry_timeout" -exist
    done <<< "$ips"
  done
  return "$failed"
}

if [ "${1:-}" = "--refresh" ]; then
  while true; do
    sleep "$refresh_interval"
    resolve_domains || true
  done
fi

# Establish a fail-closed base that permits DNS only to resolvers from
# /etc/resolv.conf while the allowlist resolves. Never open arbitrary port 53.
iptables -P OUTPUT DROP
iptables -F OUTPUT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
for resolver in "${dns_resolvers[@]}"; do
  iptables -A OUTPUT -p udp -d "$resolver" --dport 53 -j ACCEPT
  iptables -A OUTPUT -p tcp -d "$resolver" --dport 53 -j ACCEPT
done
if ipset list "$ipset_name" >/dev/null 2>&1; then
  ipset flush "$ipset_name"
else
  ipset create "$ipset_name" hash:net timeout "$entry_timeout"
fi
resolve_domains

iptables -A OUTPUT -m set --match-set "$ipset_name" dst -j ACCEPT
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

if ! command -v ip6tables >/dev/null 2>&1; then
  echo "[adw-firewall] ip6tables is required for fail-closed IPv6 policy" >&2
  exit 1
fi
ip6tables -F OUTPUT
ip6tables -A OUTPUT -o lo -j ACCEPT
ip6tables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -A OUTPUT -j REJECT --reject-with icmp6-adm-prohibited
ip6tables -P OUTPUT DROP

if [ -f "$pid_file" ]; then
  kill "$(cat "$pid_file")" 2>/dev/null || true
fi
: > "$refresh_log"
chmod 0600 "$refresh_log"
nohup "$0" --refresh >>"$refresh_log" 2>&1 &
echo "$!" > "$pid_file"

if curl --connect-timeout 3 -sS https://example.com >/dev/null 2>&1; then
  echo "[adw-firewall] verification failed: unlisted egress succeeded" >&2
  exit 1
fi
if ! curl --connect-timeout 5 -sS "https://${verification_domain}" >/dev/null 2>&1; then
  echo "[adw-firewall] verification failed: ${verification_domain} is unreachable" >&2
  exit 1
fi
echo "[adw-firewall] strict egress policy active"
