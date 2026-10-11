@echo off
REM Starts the app change worker.
REM
REM Double-click it, or run it from any folder — it changes to the repo root
REM itself, which is the one thing that is easy to get wrong by hand. Leave the
REM window open; closing it stops the worker.
cd /d "%~dp0.."
echo Starting the Dekker App change worker...
echo Leave this window open. Close it to stop.
echo.
node automation/app-worker.js
REM Only reached if the worker exits, which it does only on a setup problem —
REM so hold the window open long enough to read why.
echo.
echo The worker stopped. The message above says why.
pause
