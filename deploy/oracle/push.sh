#!/usr/bin/env bash
# Copies this project to your server and deploys it (first time and every update).
# Run it on your own computer, from the project folder:
#
#   deploy/oracle/push.sh ubuntu@<server-ip> [domain]
#
# If Oracle gave you a key file when you created the VM:
#   SSH_KEY=~/Downloads/ssh-key-2026-09-26.key deploy/oracle/push.sh ubuntu@<server-ip>
#
# Your local .env (and its API keys) is never copied: the server keeps its own
# settings in deploy/oracle/.env, written on the first run.
set -euo pipefail

target="${1:-}"
[ -n "$target" ] || {
  echo "usage: deploy/oracle/push.sh ubuntu@<server-ip> [domain]" >&2
  exit 64
}
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
remote_dir="${REMOTE_DIR:-flowpilot}"

ssh_opts=(-o ServerAliveInterval=30)
[ -n "${SSH_KEY:-}" ] && ssh_opts+=(-i "$SSH_KEY")
[ -n "${SSH_PORT:-}" ] && ssh_opts+=(-p "$SSH_PORT")
# Extra options for special cases, e.g. SSH_OPTS="-o StrictHostKeyChecking=accept-new".
[ -n "${SSH_OPTS:-}" ] && read -r -a extra <<<"$SSH_OPTS" && ssh_opts+=("${extra[@]}")

echo "==> Copying the project to $target:~/$remote_dir"
# Excluded paths are also protected from --delete, so the server's
# deploy/oracle/.env and anything else listed here survive every update.
rsync -rlptz --delete \
  --exclude .git --exclude node_modules --exclude .output --exclude .nitro --exclude .tanstack \
  --exclude .vite --exclude dist --exclude data --exclude '*.db' --exclude '*.db-wal' --exclude '*.db-shm' \
  --exclude .env --exclude '.env.local' --exclude test-results --exclude playwright-report \
  --exclude blob-report --exclude docs/screenshots --exclude .DS_Store --exclude '*.log' \
  -e "ssh ${ssh_opts[*]}" "$root/" "$target:$remote_dir/"

echo "==> Deploying on the server"
ssh -t "${ssh_opts[@]}" "$target" "cd '$remote_dir' && sudo bash deploy/oracle/setup.sh ${2:-}"
