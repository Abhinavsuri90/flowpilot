#!/usr/bin/env bash
# Sets up (or updates) FlowPilot on an Ubuntu server, e.g. an Oracle Cloud
# Always Free VM. Safe to run again: every step checks before it changes anything.
#
#   sudo bash deploy/oracle/setup.sh [domain]
#
# 1. installs Docker (from Ubuntu's own archive) if it's missing
# 2. opens ports 80 and 443 in the server's firewall (Oracle's Ubuntu images allow only SSH)
# 3. adds a swap file on small machines, so the build doesn't run out of memory
# 4. first run only: writes deploy/oracle/.env (domain, settings, optional AI key)
# 5. builds the image and starts the app behind Caddy (automatic HTTPS)
# 6. installs a daily database backup (deploy/oracle/backup.sh)
#
# Without a domain, it uses <public-ip>.sslip.io, which points at this server.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HERE/.env"
COMPOSE=(docker compose -f "$HERE/docker-compose.yml" --project-directory "$HERE")

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die() {
  printf '\n\033[31mStopped: %s\033[0m\n' "$*" >&2
  exit 1
}

[ "$(id -u)" = 0 ] || die "run it with sudo: sudo bash deploy/oracle/setup.sh"
# shellcheck source=/dev/null
. /etc/os-release
[ "${ID:-}" = ubuntu ] || die "this script is written for Ubuntu (this server runs ${PRETTY_NAME:-something else})"

# ---- 1. Docker ---------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  say "Installing Docker"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose-v2 docker-buildx >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker info >/dev/null 2>&1 || die "Docker is installed but not running (try: sudo systemctl start docker)"
note "$(docker --version); $(docker compose version)"

# ---- 2. Firewall ---------------------------------------------------------------
say "Opening ports 80 and 443 on this server"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  note "ufw: allowed 80/tcp and 443/tcp"
fi
if command -v iptables >/dev/null 2>&1; then
  for port in 443 80; do
    rule=(INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT)
    iptables -C "${rule[@]}" 2>/dev/null || iptables -I "${rule[@]:0:1}" 1 "${rule[@]:1}"
  done
  # Oracle's images restore /etc/iptables/rules.v4 at boot: add the same rules
  # there, above its catch-all REJECT, so they survive a reboot.
  saved=/etc/iptables/rules.v4
  if [ -f "$saved" ] && ! grep -q -- '--dport 443 -j ACCEPT' "$saved"; then
    if grep -q -- '^-A INPUT -j REJECT' "$saved"; then
      sed -i '0,/^-A INPUT -j REJECT/s//-A INPUT -p tcp -m state --state NEW -m tcp --dport 80 -j ACCEPT\n-A INPUT -p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT\n&/' "$saved"
      note "saved in $saved"
    fi
  fi
  note "iptables: ports 80 and 443 accept new connections"
fi
note "Oracle also filters traffic outside the VM: its VCN security list must allow TCP 80 and 443 (see deploy/oracle/README.md, step 3)."

# ---- 3. Swap on small machines -------------------------------------------------
mem_kib=$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)
if [ "$mem_kib" -lt 3000000 ] && ! swapon --show=NAME --noheadings | grep -q .; then
  say "Adding a 2 GB swap file (this machine has $((mem_kib / 1024)) MB of memory)"
  if { [ -f /swapfile ] || fallocate -l 2G /swapfile; } && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile; then
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  else
    note "couldn't add swap here; the build may be slow or fail on very small machines"
  fi
fi

# ---- 4. Settings (first run only) ----------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  say "Writing settings to $ENV_FILE"
  domain="${1:-}"
  if [ -z "$domain" ]; then
    ip="$(curl -4 -fsS --max-time 10 https://api.ipify.org || curl -4 -fsS --max-time 10 https://ifconfig.me || true)"
    [[ "$ip" =~ ^[0-9]+(\.[0-9]+){3}$ ]] || die "couldn't find this server's public address; pass a domain: sudo bash deploy/oracle/setup.sh your.domain"
    domain="${ip//./-}.sslip.io"
  fi
  key=""
  if [ -t 0 ]; then
    printf '    OpenRouter API key for AI drafting (input hidden; press Enter to skip and add it later): '
    read -rs key || true
    echo
  fi
  umask 077
  cat >"$ENV_FILE" <<EOF
# FlowPilot server settings; variable names are documented in .env.example.
# After editing, apply with: sudo bash deploy/oracle/setup.sh
DOMAIN=$domain
APP_URL=https://$domain
# Who can create accounts: open, invite-only or closed.
REGISTRATION=open
# One-click demo accounts (locked against changes) for a public showcase; false for a company's own server.
DEMO_MODE=true
MODEL_PROVIDER=openrouter
MODEL_NAME=openai/gpt-6-luna
OPENROUTER_API_KEY=$key
# Email for invites and password resets (optional; without it they're written to the app log):
# RESEND_API_KEY=
# MAIL_FROM=FlowPilot <no-reply@your-domain>
EOF
  note "domain: $domain"
fi
domain="$(sed -n 's/^DOMAIN=//p' "$ENV_FILE" | tail -n 1)"
if [ -n "${1:-}" ] && [ "$1" != "$domain" ]; then
  say "Changing the domain from ${domain:-nothing} to $1"
  sed -i "s|^DOMAIN=.*|DOMAIN=$1|; s|^APP_URL=.*|APP_URL=https://$1|" "$ENV_FILE"
  domain="$1"
fi
[ -n "$domain" ] || die "DOMAIN is empty in $ENV_FILE"

# ---- 5. Build and start --------------------------------------------------------
data_dir="$(sed -n 's/^DATA_DIR=//p' "$ENV_FILE" | tail -n 1)"
mkdir -p "${data_dir:-/srv/flowpilot/data}"
say "Building and starting FlowPilot (the first build takes a few minutes)"
"${COMPOSE[@]}" up -d --build --remove-orphans
docker image prune -f >/dev/null 2>&1 || true

say "Waiting for the app to report healthy"
healthy=""
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" >/dev/null 2>&1; then
    healthy=yes
    break
  fi
  sleep 2
done
[ -n "$healthy" ] || die "the app didn't become healthy; see: sudo docker compose -f $HERE/docker-compose.yml logs app"
note "app: healthy"

# ---- 6. Daily backup -----------------------------------------------------------
cat >/etc/cron.d/flowpilot-backup <<EOF
# FlowPilot: daily online database backup (keeps the 14 newest), 03:15 server time.
15 3 * * * root /bin/bash $HERE/backup.sh >>/var/log/flowpilot-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/flowpilot-backup
note "daily backup installed (/etc/cron.d/flowpilot-backup)"

# ---- Done ------------------------------------------------------------------------
say "Checking https://$domain from here"
if curl -fsS --max-time 20 --retry 6 --retry-delay 5 --retry-all-errors "https://$domain/api/health" >/dev/null 2>&1; then
  note "reachable over HTTPS with a valid certificate"
else
  note "not reachable yet. If this is the first start, give Caddy a minute to get the certificate."
  note "Still failing? Check the VCN security list (TCP 80 and 443), then: sudo docker compose -f $HERE/docker-compose.yml logs caddy"
fi

cat <<EOF

FlowPilot is running: https://$domain
  Check everything from your computer:  npm run smoke -- --base https://$domain
  Logs:        sudo docker compose -f $HERE/docker-compose.yml logs -f app
  Settings:    sudo nano $ENV_FILE   (then run this script again)
  Backups:     ${data_dir:-/srv/flowpilot/data}/backups (daily; run now: sudo bash $HERE/backup.sh)
EOF
