#!/bin/sh
set -eu
node /app/bootstrap.mjs
exec node /app/run.mjs
