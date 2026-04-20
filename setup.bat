@echo off
setlocal enabledelayedexpansion

echo === MApper Setup ===
echo.

REM Check prerequisites
where conda >nul 2>nul
if errorlevel 1 (
    echo [X] conda not found. Install Miniconda first: https://docs.conda.io/en/latest/miniconda.html
    exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
    echo [X] Node.js not found. Install from https://nodejs.org ^(v18+^)
    exit /b 1
)

REM Create conda environment
echo Creating conda environment "map"...
call conda create -n map python=3.11 -y 2>nul
if errorlevel 1 echo Environment "map" already exists

REM Activate environment
call conda activate map
if errorlevel 1 (
    echo [X] Failed to activate conda environment "map"
    exit /b 1
)

REM Install Python dependencies
echo Installing Python packages...
cd mapper-backend
pip install -r requirements.txt -q
if errorlevel 1 (
    echo [X] pip install failed
    cd ..
    exit /b 1
)
cd ..

REM Install Node dependencies
echo Installing frontend packages...
cd mapper-frontend
call npm install --silent
if errorlevel 1 (
    echo [X] npm install failed
    cd ..
    exit /b 1
)
cd ..

REM Create start.bat
> start.bat (
    echo @echo off
    echo setlocal
    echo call conda activate map
    echo.
    echo start "MApper Backend" cmd /c "cd mapper-backend ^&^& uvicorn mapper.main:app --reload --port 8000"
    echo start "MApper Frontend" cmd /c "cd mapper-frontend ^&^& npm run dev"
    echo.
    echo echo.
    echo echo MApper is running!
    echo echo    Open: http://localhost:5173
    echo echo    Close the backend/frontend windows to stop.
    echo echo.
)

echo.
echo Setup complete!
echo.
echo To start MApper:
echo    start.bat
echo.
echo To import ecoinvent:
echo    1. Start MApper
echo    2. Go to Database Explorer
echo    3. Click Import ^> select your ecoinvent .7z file
echo.
echo To configure premise ^(optional, for prospective LCA^):
echo    Open MApper ^> Settings ^> Premise ^> paste your Fernet key
echo    Request a key from romain.sacchi@psi.ch
echo.

endlocal
