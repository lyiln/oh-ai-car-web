param(
    [string]$ProjectRoot = "C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection",
    [string]$SourceDir = "C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\datasets\CCPD-Base",
    [string]$OutputDir = "C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\datasets\ccpd_plate_base1000",
    [int]$TrainCount = 800,
    [int]$ValCount = 200,
    [int]$Seed = 42,
    [string]$EnvName = "vision_env"
)

$ErrorActionPreference = "Stop"

$pythonExe = Join-Path $ProjectRoot "$EnvName\Scripts\python.exe"
$scriptPath = Join-Path $ProjectRoot "scripts\ccpd_to_yolo.py"

if (-not (Test-Path $pythonExe)) {
    throw "Python executable not found: $pythonExe"
}

if (-not (Test-Path $scriptPath)) {
    throw "Conversion script not found: $scriptPath"
}

& $pythonExe $scriptPath `
    --source-dir $SourceDir `
    --output-dir $OutputDir `
    --train-count $TrainCount `
    --val-count $ValCount `
    --seed $Seed

Write-Host "Base1000 dataset preparation finished."
