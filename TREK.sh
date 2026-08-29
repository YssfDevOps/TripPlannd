#!/bin/bash
# Linux: double-click (mark executable first) or run ./TREK.sh to start TREK.
cd "$(dirname "$0")" || exit 1
exec node scripts/launch.mjs "$@"
