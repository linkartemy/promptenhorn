#!/bin/sh
# Restarts the bots agent's test bridge (port 7781). Dev only.
cd "$(dirname "$0")/.."
PID=$(netstat -ano | grep "127.0.0.1:7781 .*LISTENING" | awk '{print $5}' | head -1)
[ -n "$PID" ] && taskkill //PID $PID //T //F > /dev/null 2>&1
sleep 2
ALPS_CONFIG=.dev/test-config-bots.json nohup node bridge/bridge.mjs >> .dev/bots-bridge.log 2>&1 &
echo "started"
