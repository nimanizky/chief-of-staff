#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ "$#" -eq 0 ]; then
  set -- status
fi
docker compose exec -T memory-sync node /app/sync.mjs "$@"
