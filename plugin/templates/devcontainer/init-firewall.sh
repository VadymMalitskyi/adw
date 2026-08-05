#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

readonly domains_file="/etc/adw/allowed-domains.txt"
readonly ipset_name="adw-allowed-egress"
readonly entry_timeout=900
readonly refresh_interval=120
readonly pid_file="/run/adw-firewall-refresh.pid"

mapfile -t allowed_domains < <(sed -E '/^[[:space:]]*(#|$)/d' "$domains_file" | sort -u)
if [ "${#allowed_domains[@]}" -eq 0 ]; then
  echo "[adw-firewall] no allowed domains configured; refusing to start" >&2
  exit 1
fi

resolve_domains() {
  local domain ips ip
  for domain in "${allowed_domains[@]}"; do
    if [[ ! "$domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$ ]]; then
      echo "[adw-firewall] invalid domain: $domain" >&2
      return 1
    fi
    ips="$(dig +short A "$domain" | sed -nE '/^[0-9]+(\.[0-9]+){3}$/p')"
    if [ -z "$ips" ]; then
      echo "[adw-firewall] failed to resolve required domain: $domain" >&2
      return 1
    fi
    while IFS= read -r ip; do
      ipset add "$ipset_name" "$ip" timeout "$entry_timeout" -exist
    done <<< "$ips"
  done
}

if [ "${1:-}" = "--refresh" ]; then
  while true; do
    sleep "$refresh_interval"
    resolve_domains || true
  done
fi

# Establish a fail-closed base that permits only DNS while the allowlist resolves.
iptables -P OUTPUT DROP
iptables -F OUTPUT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT
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
nohup "$0" --refresh >/dev/null 2>&1 &
echo "$!" > "$pid_file"

if curl --connect-timeout 3 -sS https://example.com >/dev/null 2>&1; then
  echo "[adw-firewall] verification failed: unlisted egress succeeded" >&2
  exit 1
fi
if ! curl --connect-timeout 5 -sS https://api.openai.com >/dev/null 2>&1; then
  echo "[adw-firewall] verification failed: api.openai.com is unreachable" >&2
  exit 1
fi
echo "[adw-firewall] strict egress policy active"
