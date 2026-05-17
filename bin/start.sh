#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Preparing local config and data..."
node --loader ts-node/esm "$DIR/bin/setup.ts" >/dev/null
DASHBOARD_URL="$(node --loader ts-node/esm "$DIR/bin/dashboard-url.ts")"

# Start collector daemon in background
echo "Starting collector daemon..."
node --loader ts-node/esm "$DIR/src/collector/daemon.ts" &
DAEMON_PID=$!
echo "  Daemon PID: $DAEMON_PID"

# Start dashboard
echo "Starting dashboard..."
node --loader ts-node/esm "$DIR/src/dashboard/server.ts" &
DASH_PID=$!
echo "  Dashboard PID: $DASH_PID"

echo ""
echo "AI Team Sidecar is running."
echo "  Daemon:   PID $DAEMON_PID"
echo "  Dashboard: PID $DASH_PID  ->  $DASHBOARD_URL"
echo ""
echo "Press Ctrl+C to stop both."

cleanup() {
  echo ""
  echo "Stopping..."
  kill $DAEMON_PID $DASH_PID 2>/dev/null
  wait $DAEMON_PID $DASH_PID 2>/dev/null
  echo "Stopped."
}
trap cleanup EXIT INT TERM

wait
