#!/bin/bash
# macOS: double-click this file to start TREK (opens in Terminal).
# If macOS blocks it the first time: right-click -> Open, or run
# `chmod +x TREK.command` once in Terminal.
cd "$(dirname "$0")" || exit 1
exec node scripts/launch.mjs "$@"
