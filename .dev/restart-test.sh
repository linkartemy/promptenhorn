#!/bin/sh
# Restarts the test bridge keeping its state (picks up code changes). Dev only.
cd "$(dirname "$0")/.."
P=$(netstat -ano | grep "127.0.0.1:7778 .*LISTENING" | awk '{print $5}')
[ -n "$P" ] && taskkill //PID $P //F >/dev/null
sleep 1
ALPS_CONFIG=.dev/test-config.json nohup node bridge/bridge.mjs >> .dev/tb.log 2>&1 &
sleep 4
