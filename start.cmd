@echo off
rem Starts the Minecraft server and the Claude Alps bridge in two windows.
rem JVM settings from tools/tune.mjs (profile medium); run "node tools/tune.mjs" to retune.
cd /d "%~dp0"
start "Claude Alps - Minecraft server" /min cmd /k "cd /d server && java -Xms1G -Xmx2560M -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 -Dusing.aikars.flags=https://mcflags.emc.gs -Daikars.new.flags=true -jar paper.jar nogui"
start "Claude Alps - bridge" /min cmd /k "node bridge\bridge.mjs"
echo Claude Alps is starting. In TLauncher: version 1.21.11, Multiplayer, server address: localhost
