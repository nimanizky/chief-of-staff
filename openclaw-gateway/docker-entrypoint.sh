#!/bin/sh
set -eu
node /app/bootstrap.mjs
exec /app/node_modules/.bin/openclaw gateway run
