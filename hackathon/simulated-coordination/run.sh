#!/bin/sh
set -eu
cd "$(dirname "$0")"
if command -v bun >/dev/null 2>&1; then
  exec bun server.ts
fi
exec /Users/mac/Desktop/Coding/Hackathon/.tools/bun-1.3.14/bin/bun server.ts
