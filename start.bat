@echo off
cd /d "%~dp0"

set PYTHON_CMD=

python --version >nul 2>nul
if not errorlevel 1 (
    set PYTHON_CMD=python
)

if "%PYTHON_CMD%"=="" (
    python3 --version >nul 2>nul
    if not errorlevel 1 (
        set PYTHON_CMD=python3
    )
)

if "%PYTHON_CMD%"=="" (
    py --version >nul 2>nul
    if not errorlevel 1 (
        set PYTHON_CMD=py
    )
)

if "%PYTHON_CMD%"=="" (
    echo.
    echo Python not found.
    echo Please install Python 3 from https://www.python.org/downloads/
    echo and make sure "Add Python to PATH" is checked during installation.
    echo.
    pause
    exit /b 1
)

echo Using Python: %PYTHON_CMD%

if not exist ".venv\" (
    echo Creating virtual environment...
    %PYTHON_CMD% -m venv .venv
    if errorlevel 1 (
        echo Failed to create virtual environment.
        echo Please make sure Python is installed correctly.
        pause
        exit /b 1
    )
)

echo Installing / verifying dependencies...
.venv\Scripts\pip.exe install -r requirements.txt
if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
)

echo Starting server at http://127.0.0.1:1688
.venv\Scripts\python.exe web_app.py
pause
