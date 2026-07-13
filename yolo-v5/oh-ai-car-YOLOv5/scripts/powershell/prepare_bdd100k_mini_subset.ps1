param(
    [string]$ProjectRoot = "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection",
    [string]$EnvName = "vision_env",
    [string]$SourceRoot = "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\datasets\bdd100k\raw\val",
    [string]$OutputRoot = "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\datasets\bdd100k_mini",
    [int]$TrainCount = 200,
    [int]$ValCount = 50
)

$ErrorActionPreference = "Stop"

$pythonExe = Join-Path $ProjectRoot "$EnvName\Scripts\python.exe"
$scriptPath = Join-Path $ProjectRoot "scripts\prepare_bdd100k_mini_subset.py"
$convertScript = Join-Path $ProjectRoot "scripts\bdd100k_to_yolo_vehicle.py"

if (-not (Test-Path $pythonExe)) {
    throw "Python executable not found: $pythonExe"
}

if (-not (Test-Path $scriptPath)) {
    throw "prepare_bdd100k_mini_subset.py not found: $scriptPath"
}

if (-not (Test-Path $SourceRoot)) {
    throw "Source root not found: $SourceRoot"
}

& $pythonExe $scriptPath `
    --source-root $SourceRoot `
    --output-root $OutputRoot `
    --train-count $TrainCount `
    --val-count $ValCount

if ($LASTEXITCODE -ne 0) {
    throw "prepare_bdd100k_mini_subset.py exited with code $LASTEXITCODE"
}

& $pythonExe $convertScript --dataset-root $OutputRoot

if ($LASTEXITCODE -ne 0) {
    throw "bdd100k_to_yolo_vehicle.py exited with code $LASTEXITCODE"
}

Write-Host "BDD100K mini subset and YOLO labels are ready."
