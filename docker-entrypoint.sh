#!/bin/sh
set -e

echo "MailHub: running migrations…"
node scripts/migrate.mjs

echo "MailHub: starting server on :${PORT:-3480}"
exec node server.js
