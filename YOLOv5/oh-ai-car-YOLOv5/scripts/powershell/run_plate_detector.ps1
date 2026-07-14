param(
    [string]$ProjectRoot = "C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection",
    [string]$EnvName = "vision_env",
    [string]$Weights = "C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\weights\best_plate_detector.pt",
    [string]$Source = "C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\demo_input",
    [string]$RunName = "batch_demo",
    [int]$ImgSize = 640,
    [double]$ConfThres = 0.25,
    [double]$IouThres = 0.45,
    [string]$Device = "0"
)

$ErrorActionPreference = "Stop"

$pythonExe = Join-Path $ProjectRoot "$EnvName\Scripts\python.exe"
$scriptPath = Join-Path $ProjectRoot "scripts\plate_detector.py"
$yolov5Dir = Join-Path $ProjectRoot "yolov5"
$projectDir = Join-Path $ProjectRoot "demo_output"

if (-not (Test-Path $pythonExe)) {
    throw "Python executable not found: $pythonExe"
}

if (-not (Test-Path $scriptPath)) {
    throw "plate_detector.py not found: $scriptPath"
}

& $pythonExe $scriptPath `
    --yolov5-dir $yolov5Dir `
    --weights $Weights `
    --source $Source `
    --project $projectDir `
    --name $RunName `
    --imgsz $ImgSize `
    --conf-thres $ConfThres `
    --iou-thres $IouThres `
    --device $Device `
    --save-csv

Write-Host "Plate detection finished."
