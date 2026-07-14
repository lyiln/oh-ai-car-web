param(
    [string]$ProjectRoot = "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection",
    [string]$EnvName = "vision_env",
    [string]$CarWeights = "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\weights\yolov5s.pt",
    [string]$PlateWeights = "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\weights\best_plate_detector.pt",
    [string]$Source = "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\demo_input",
    [string]$RunName = "car_plate_demo",
    [int]$ImgSize = 640,
    [double]$CarConfThres = 0.15,
    [double]$CarIouThres = 0.45,
    [int[]]$CarClasses = @(2, 5, 7),
    [string[]]$CarClassNames = @("car", "bus", "truck"),
    [double]$PlateConfThres = 0.25,
    [double]$PlateIouThres = 0.45,
    [double]$OcrMinScore = 0.75,
    [string]$Device = "0"
)

$ErrorActionPreference = "Stop"

$pythonExe = Join-Path $ProjectRoot "$EnvName\Scripts\python.exe"
$scriptPath = Join-Path $ProjectRoot "scripts\car_plate_pipeline.py"
$yolov5Dir = Join-Path $ProjectRoot "yolov5"
$projectDir = Join-Path $ProjectRoot "demo_output"

if (-not (Test-Path $pythonExe)) {
    throw "Python executable not found: $pythonExe"
}

if (-not (Test-Path $scriptPath)) {
    throw "car_plate_pipeline.py not found: $scriptPath"
}

if (-not (Test-Path $CarWeights)) {
    throw "Car detector weights not found: $CarWeights"
}

if (-not (Test-Path $PlateWeights)) {
    throw "Plate detector weights not found: $PlateWeights"
}

& $pythonExe $scriptPath `
    --yolov5-dir $yolov5Dir `
    --car-weights $CarWeights `
    --plate-weights $PlateWeights `
    --source $Source `
    --project $projectDir `
    --name $RunName `
    --imgsz $ImgSize `
    --car-conf-thres $CarConfThres `
    --car-iou-thres $CarIouThres `
    --car-classes $CarClasses `
    --car-class-names $CarClassNames `
    --plate-conf-thres $PlateConfThres `
    --plate-iou-thres $PlateIouThres `
    --ocr-min-score $OcrMinScore `
    --device $Device `
    --save-csv

if ($LASTEXITCODE -ne 0) {
    throw "car_plate_pipeline.py exited with code $LASTEXITCODE"
}

Write-Host "Car-gated plate pipeline finished."
