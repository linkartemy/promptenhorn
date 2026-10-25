@echo off
rem Wild mode: starts the colony server (wild-server/) and the colony (wild/colony.mjs) in two minimized windows.
cd /d "%~dp0.."
if not exist wild-server\paper.jar node wild\setup.mjs
start "Promptenhorn wild server" /min cmd /c "cd wild-server && java -Xms512M -Xmx2G -jar paper.jar nogui"
start "Promptenhorn wild colony" /min cmd /c "node wild\colony.mjs"
echo Wild colony starting. Status: http://127.0.0.1:7785/   Server: 127.0.0.1:25567
