param(
    [string]$ProjectRoot = "C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection",
    [string]$EnvName = "vision_env",
    [string]$Weights = "C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\weights\best_plate_detector.pt",
    [string]$Source = "C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\demo_input\first_batch",
    [string]$RunName = "plate_ocr_demo",
    [int]$ImgSize = 640,
    [double]$ConfThres = 0.25,
    [double]$IouThres = 0.45,
    [double]$OcrMinScore = 0.75,
    [string]$Device = "0"
)

$ErrorActionPreference = "Stop"

$pythonExe = Join-Path $ProjectRoot "$EnvName\Scripts\python.exe"
$scriptPath = Join-Path $ProjectRoot "scripts\plate_pipeline.py"
$yolov5Dir = Join-Path $ProjectRoot "yolov5"
$projectDir = Join-Path $ProjectRoot "demo_output"

if (-not (Test-Path $pythonExe)) {
    throw "Python executable not found: $pythonExe"
}

if (-not (Test-Path $scriptPath)) {
    throw "plate_pipeline.py not found: $scriptPath"
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
    --ocr-min-score $OcrMinScore `
    --device $Device `
    --save-csv

if ($LASTEXITCODE -ne 0) {
    throw "plate_pipeline.py exited with code $LASTEXITCODE"
}

Write-Host "Plate OCR pipeline finished."
