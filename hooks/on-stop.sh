#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node --loader ts-node/esm "$ROOT/bin/aiteam-hook.ts" "Stop"
