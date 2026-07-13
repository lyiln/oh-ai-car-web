param(
    [string]$ProjectRoot = "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection",
    [int]$ApiPort = 8010,
    [int]$WebPort = 5173
)

$ErrorActionPreference = "Stop"

$pythonExe = Join-Path $ProjectRoot "vision_env\Scripts\python.exe"
$backendScript = Join-Path $ProjectRoot "scripts\web_api_server.py"
$frontendRoot = Join-Path $ProjectRoot "web_test_app"

if (-not (Test-Path $pythonExe)) {
    throw "Python executable not found: $pythonExe"
}

if (-not (Test-Path $backendScript)) {
    throw "Backend script not found: $backendScript"
}

if (-not (Test-Path $frontendRoot)) {
    throw "Frontend root not found: $frontendRoot"
}

$backendCommand = "& `"$pythonExe`" `"$backendScript`""
$frontendCommand = "npx vite --host 127.0.0.1 --port $WebPort"

Start-Process powershell -WorkingDirectory $ProjectRoot -ArgumentList @("-NoExit", "-Command", $backendCommand)
Start-Process powershell -WorkingDirectory $frontendRoot -ArgumentList @("-NoExit", "-Command", $frontendCommand)

Start-Sleep -Seconds 3
Start-Process "http://127.0.0.1:$WebPort"

Write-Host "Plate test web startup commands have been launched."
Write-Host "Frontend: http://127.0.0.1:$WebPort"
Write-Host "Backend : http://127.0.0.1:$ApiPort"
