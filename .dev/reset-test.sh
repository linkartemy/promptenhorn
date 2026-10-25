#!/bin/sh
# Restarts the test bridge with a fresh state at a new search origin (arg: x z). Dev only.
cd "$(dirname "$0")/.."
P=$(netstat -ano | grep "127.0.0.1:7778 .*LISTENING" | awk '{print $5}')
[ -n "$P" ] && taskkill //PID $P //F >/dev/null
node .dev/rc.mjs "kill @e[tag=alps]" "forceload remove all" >/dev/null
[ -f .dev/test-state.json ] && mv .dev/test-state.json ".dev/old/test-state-$(date +%H%M%S).json"
node -e "const f='.dev/test-config.json';const c=JSON.parse(require('fs').readFileSync(f));c.searchOrigin=[Number(process.argv[1]),Number(process.argv[2])];require('fs').writeFileSync(f,JSON.stringify(c,null,2))" "$1" "$2"
ALPS_CONFIG=.dev/test-config.json nohup node bridge/bridge.mjs > .dev/tb.log 2>&1 &
sleep 4
