#!/bin/sh
# Makes sure the database directory exists and belongs to the unprivileged
# "node" user (platform volumes are mounted as root), then runs the server as it.
set -e
DATA_DIR="$(dirname "${DATABASE_PATH:-/data/flowpilot.db}")"
mkdir -p "$DATA_DIR"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR"
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi
exec "$@"
