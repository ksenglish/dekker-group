@echo off
REM Starts the website change worker. See start-app-worker.cmd — same idea.
cd /d "%~dp0.."
echo Starting the Dekker Air website change worker...
echo Leave this window open. Close it to stop.
echo.
node automation/website-worker.js
echo.
echo The worker stopped. The message above says why.
pause
