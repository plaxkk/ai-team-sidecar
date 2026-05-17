#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
PIPE="$DIR/data/feedback-pipe"

# Create FIFO if needed
mkdir -p "$DIR/data"
if [[ ! -p "$PIPE" ]]; then
  mkfifo "$PIPE" 2>/dev/null || true
fi

# Start collector daemon in background
echo "Starting collector daemon..."
node --loader ts-node/esm "$DIR/src/collector/daemon.ts" &
DAEMON_PID=$!
echo "  Daemon PID: $DAEMON_PID"

# Start dashboard
echo "Starting dashboard on http://localhost:4041..."
node --loader ts-node/esm "$DIR/src/dashboard/server.ts" &
DASH_PID=$!
echo "  Dashboard PID: $DASH_PID"

echo ""
echo "AI Team Sidecar is running."
echo "  Daemon:   PID $DAEMON_PID"
echo "  Dashboard: PID $DASH_PID  →  http://localhost:4041"
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
