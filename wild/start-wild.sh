#!/bin/sh
# Colonists mode (macOS / Linux): starts the colony's own Minecraft server (wild-server/, port 25567) in the
# background and the colony (wild/colony.mjs, http://127.0.0.1:7785/) in this terminal.
# First run: creates wild-server/ with node wild/setup.mjs. Ctrl+C stops the colony, then the server.
cd "$(dirname "$0")/.." || exit 1
[ -f wild-server/paper.jar ] || node wild/setup.mjs || exit 1
(cd wild-server && exec java -Xms512M -Xmx2G -jar paper.jar nogui < /dev/null > /dev/null 2>&1) &
SERVER=$!
trap 'node wild/stop.mjs >/dev/null 2>&1; sleep 2; kill $SERVER 2>/dev/null; wait $SERVER' INT TERM EXIT
echo "Colonists mode is starting (server log: wild-server/logs/latest.log). Status: http://127.0.0.1:7785/  Minecraft 1.21.11: 127.0.0.1:25567"
node wild/colony.mjs
