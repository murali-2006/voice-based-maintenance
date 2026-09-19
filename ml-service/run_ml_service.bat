@echo off
title Voice Maintenance - Whisper ML Service
echo ========================================================
echo Starting OpenAI Whisper ML Service (FastAPI) on Port 8000
echo ========================================================
cd /d "%~dp0"
python -m uvicorn app:app --host 0.0.0.0 --port 8000
pause
