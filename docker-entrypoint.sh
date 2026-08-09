#!/bin/sh
# Runs the read-only web API and the sentinel daemon side by side in one container.
# If either dies, bring the whole container down rather than limp along half-alive —
# an API with no daemon behind it (or vice versa) is a worse failure mode than a
# clean restart, which Docker's restart policy handles on its own.
set -e

node src/web/server.js &
WEB_PID=$!
node bin/sre start &
DAEMON_PID=$!

term() {
  kill -TERM "$WEB_PID" "$DAEMON_PID" 2>/dev/null
}
trap term TERM INT

while kill -0 "$WEB_PID" 2>/dev/null && kill -0 "$DAEMON_PID" 2>/dev/null; do
  sleep 2
done

term
wait
