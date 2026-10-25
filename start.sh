#!/bin/sh
# Starts the Minecraft server in the background and the Claude Alps bridge in this terminal (macOS / Linux).
# JVM settings from tools/tune.mjs (profile medium); run "node tools/tune.mjs" to retune.
# Ctrl+C stops the bridge and then the server (it saves the world on the way out).
cd "$(dirname "$0")" || exit 1
(cd server && exec java -Xms1G -Xmx2560M -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 -Dusing.aikars.flags=https://mcflags.emc.gs -Daikars.new.flags=true -jar paper.jar nogui < /dev/null > /dev/null 2>&1) &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; wait $SERVER' INT TERM EXIT
echo "Claude Alps is starting (server log: server/logs/latest.log). Minecraft 1.21.11, Multiplayer, server address: localhost"
node bridge/bridge.mjs
