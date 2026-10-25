@echo off
rem Colonists mode: starts the colony's own Minecraft server (wild-server\, port 25567) and the colony
rem (wild\colony.mjs, http://127.0.0.1:7785/) in two minimized windows. First run: creates wild-server\.
rem Stop: node wild\stop.mjs (colonists put their things away and leave), then "stop" in the server window.
cd /d "%~dp0.."
if not exist wild-server\paper.jar node wild\setup.mjs || exit /b 1
start "Promptenhorn colonists - server" /min cmd /k "cd /d wild-server && java -Xms512M -Xmx2G -jar paper.jar nogui"
start "Promptenhorn colonists - colony" /min cmd /k "node wild\colony.mjs"
echo Colonists mode is starting. Status: http://127.0.0.1:7785/   Minecraft 1.21.11: 127.0.0.1:25567
