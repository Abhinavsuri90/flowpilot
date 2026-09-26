#!/usr/bin/env bash
# Online backup of FlowPilot's database into <data dir>/backups, keeping the
# newest KEEP copies (default 14). setup.sh schedules it daily; run it any time:
#   sudo bash deploy/oracle/backup.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
printf '%s ' "$(date -u +%FT%TZ)"
docker compose -f "$HERE/docker-compose.yml" --project-directory "$HERE" \
  exec -T -u node app node scripts/backup-db.mjs /data/backups "${KEEP:-14}"
