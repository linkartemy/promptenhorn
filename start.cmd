@echo off
rem Starts the Minecraft server and the Claude Alps bridge in two windows.
cd /d "%~dp0"
start "Claude Alps - Minecraft server" /min cmd /k "cd /d server && java -Xms1G -Xmx3G -jar paper.jar nogui"
start "Claude Alps - bridge" /min cmd /k "node bridge\bridge.mjs"
echo Claude Alps is starting. In TLauncher: version 1.21.11, Multiplayer, server address: localhost
