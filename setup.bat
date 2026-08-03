@echo off
REM SPDX-License-Identifier: MPL-2.0
REM This Source Code Form is subject to the terms of the Mozilla Public
REM License, v. 2.0. If a copy of the MPL was not distributed with this
REM file, You can obtain one at https://mozilla.org/MPL/2.0/.
REM
REM (c) Copyright 2026 Technical University of Denmark
REM Lead developer: Leonardo Ferhati
REM
REM Optional convenience wrapper. The documented setup path is:
REM
REM     conda env create -f environment.yml
REM     conda activate map
REM     cd mapper-frontend ^&^& npm ci
REM
REM This script runs exactly those steps and then writes start.bat.
REM
REM It will NOT touch an existing "map" environment. The previous version ran
REM `conda create -n map` and then pip-installed into whatever "map" already
REM was, silently mutating a working environment. Recreating is opt-in:
REM
REM     setup.bat --force
REM
REM scikit-umfpack is NOT installed here: conda-forge publishes no win-64 build.
REM Windows uses the spsolve fallback, which is correct but slower for
REM prospective LCA.
setlocal enabledelayedexpansion

set FORCE=0
if /I "%~1"=="--force" set FORCE=1

echo === MApper setup ===
echo.

where conda >nul 2>nul
if errorlevel 1 (
    echo conda not found. Install Miniconda: https://docs.conda.io/en/latest/miniconda.html
    exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js not found. Install from https://nodejs.org ^(v20+; CI uses 24^)
    exit /b 1
)

REM --- conda environment -----------------------------------------------------
call conda env list | findstr /R /C:"^map " >nul 2>nul
if not errorlevel 1 (
    if "!FORCE!"=="1" (
        echo Removing existing "map" environment ^(--force^)...
        call conda env remove -n map -y
        echo Creating "map" from environment.yml...
        call conda env create -f environment.yml
        if errorlevel 1 exit /b 1
    ) else (
        echo A conda environment named "map" already exists - leaving it alone.
        echo.
        echo   Update it in place:  conda env update -f environment.yml --prune
        echo   Recreate it:         setup.bat --force
        echo.
        echo Skipping environment creation; continuing with the frontend.
    )
) else (
    echo Creating "map" from environment.yml...
    call conda env create -f environment.yml
    if errorlevel 1 exit /b 1
)

call conda activate map
if errorlevel 1 (
    echo Failed to activate conda environment "map"
    exit /b 1
)

REM --- frontend --------------------------------------------------------------
echo Installing frontend packages...
pushd mapper-frontend
call npm ci
if errorlevel 1 (
    popd
    echo npm ci failed
    exit /b 1
)
popd

REM --- start.bat -------------------------------------------------------------
REM Unlike start.sh, start.bat is not tracked in the repository, so this script
REM is its only source. Written fresh on each run.
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
echo Setup complete.
echo.
echo   Start MApper:   start.bat     ^(then open http://localhost:5173^)
echo.
echo   No ecoinvent licence? Run the demo - synthetic data, nothing to download:
echo       cd mapper-backend ^&^& python scripts\load_demo_project.py --verify
echo.
echo   Real assessments need your own ecoinvent database:
echo       Database Explorer -^> Import -^> select your ecoinvent .7z
echo.
echo   Prospective LCA additionally needs a premise key:
echo       Settings -^> Premise -^> paste your Fernet key
echo.

endlocal
