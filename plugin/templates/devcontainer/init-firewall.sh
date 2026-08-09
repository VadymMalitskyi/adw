#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

readonly domains_file="/etc/adw/allowed-domains.txt"
readonly agent_tools_file="/etc/adw/agent-tools"
readonly dispatcher_chain="ADW_EGRESS"
readonly active_chain_file="/run/adw-egress-active-chain"
readonly proxy_user="adw-egress"
readonly proxy_port=18080
readonly refresh_interval=120
readonly dns_attempts=3
readonly dns_timeout=2
readonly pid_file="/run/adw-firewall-refresh.pid"
readonly refresh_log="/var/log/adw-firewall-refresh.log"
readonly proxy_pid_file="/run/adw-egress-proxy.pid"
readonly proxy_log="/var/log/adw-egress-proxy.log"

proxy_uid="$(id -u "$proxy_user")"
chain_sequence=0

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
  resolved_ips=()
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
      resolved_ips+=("$ip")
    done <<< "$ips"
  done
  if [ "$failed" -eq 0 ]; then
    mapfile -t resolved_ips < <(printf '%s\n' "${resolved_ips[@]}" | sort -u)
  fi
  return "$failed"
}

install_egress_chain() {
  local next_chain="ADW_EGRESS_${BASHPID}_$((chain_sequence += 1))" old_chain="" ip network
  iptables -N "$next_chain"
  for network in \
    0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 \
    172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.168.0.0/16 \
    198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do
    iptables -A "$next_chain" -d "$network" -j REJECT --reject-with icmp-admin-prohibited
  done
  for ip in "${resolved_ips[@]}"; do
    iptables -A "$next_chain" -d "${ip}/32" -j ACCEPT
  done
  iptables -A "$next_chain" -j REJECT --reject-with icmp-admin-prohibited
  iptables -I "$dispatcher_chain" 1 -j "$next_chain"
  if [ -f "$active_chain_file" ]; then
    old_chain="$(cat "$active_chain_file")"
  fi
  printf '%s\n' "$next_chain" > "$active_chain_file"
  if [ -n "$old_chain" ] && [ "$old_chain" != "$next_chain" ]; then
    iptables -D "$dispatcher_chain" -j "$old_chain" 2>/dev/null || true
    iptables -F "$old_chain" 2>/dev/null || true
    iptables -X "$old_chain" 2>/dev/null || true
  fi
}

if [ "${1:-}" = "--refresh" ]; then
  while true; do
    sleep "$refresh_interval"
    if resolve_domains; then
      install_egress_chain
    fi
  done
fi

if [ -f "$pid_file" ]; then
  kill "$(cat "$pid_file")" 2>/dev/null || true
fi

# Establish a fail-closed base that permits DNS only to resolvers from
# /etc/resolv.conf while the allowlist resolves. Never open arbitrary port 53.
iptables -P OUTPUT DROP
iptables -F OUTPUT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
for resolver in "${dns_resolvers[@]}"; do
  # Root refreshes the kernel egress chain; the dedicated proxy resolves upstreams.
  # The interactive vscode user receives no direct DNS path.
  for uid in 0 "$proxy_uid"; do
    iptables -A OUTPUT -m owner --uid-owner "$uid" -p udp -d "$resolver" --dport 53 -j ACCEPT
    iptables -A OUTPUT -m owner --uid-owner "$uid" -p tcp -d "$resolver" --dport 53 -j ACCEPT
  done
done
if iptables -nL "$dispatcher_chain" >/dev/null 2>&1; then
  iptables -F "$dispatcher_chain"
else
  iptables -N "$dispatcher_chain"
fi
if [ -f "$active_chain_file" ]; then
  old_chain="$(cat "$active_chain_file")"
  iptables -F "$old_chain" 2>/dev/null || true
  iptables -X "$old_chain" 2>/dev/null || true
  rm -f "$active_chain_file"
fi
resolve_domains
install_egress_chain
iptables -A OUTPUT -m owner --uid-owner "$proxy_uid" -p tcp --dport 443 -j "$dispatcher_chain"
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

: > "$refresh_log"
chmod 0600 "$refresh_log"
nohup "$0" --refresh >>"$refresh_log" 2>&1 &
echo "$!" > "$pid_file"

if [ -f "$proxy_pid_file" ]; then
  start-stop-daemon --stop --quiet --retry TERM/3/KILL/2 --pidfile "$proxy_pid_file" || true
  rm -f "$proxy_pid_file"
fi
: > "$proxy_log"
chmod 0600 "$proxy_log"
start-stop-daemon --start --background --make-pidfile --pidfile "$proxy_pid_file" \
  --chuid "$proxy_user" --exec /usr/local/bin/adw-egress-proxy -- >>"$proxy_log" 2>&1
for _ in {1..20}; do
  if (echo >"/dev/tcp/127.0.0.1/${proxy_port}") >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
if ! kill -0 "$(cat "$proxy_pid_file")" 2>/dev/null; then
  echo "[adw-firewall] hostname-verifying egress proxy failed to start" >&2
  exit 1
fi

if curl --proxy "http://127.0.0.1:${proxy_port}" --connect-timeout 3 -sS https://example.com >/dev/null 2>&1; then
  echo "[adw-firewall] verification failed: unlisted egress succeeded" >&2
  exit 1
fi
if ! curl --proxy "http://127.0.0.1:${proxy_port}" --connect-timeout 5 -sS "https://${verification_domain}" >/dev/null 2>&1; then
  echo "[adw-firewall] verification failed: ${verification_domain} is unreachable" >&2
  exit 1
fi
echo "[adw-firewall] strict hostname- and TLS-SNI-verified egress policy active"
