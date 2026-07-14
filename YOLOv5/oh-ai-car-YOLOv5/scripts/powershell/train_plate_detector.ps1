param(
    [string]$ProjectRoot = "C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection",
    [string]$EnvName = "vision_env",
    [string]$Weights = "C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\weights\yolov5n.pt",
    [string]$DataYaml = "C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\configs\plate_ccpd.yaml",
    [int]$ImgSize = 640,
    [int]$BatchSize = 4,
    [int]$Epochs = 20,
    [string]$Device = "0",
    [string]$RunName = "plate_ccpd_gpu_v1",
    [int]$Workers = 2
)

$ErrorActionPreference = "Stop"
$env:YOLOv5_AUTOINSTALL = "False"

$pythonExe = Join-Path $ProjectRoot "$EnvName\Scripts\python.exe"
$trainScript = Join-Path $ProjectRoot "yolov5\train.py"
$projectDir = Join-Path $ProjectRoot "runs\train"

if (-not (Test-Path $pythonExe)) {
    throw "Python executable not found: $pythonExe"
}

if (-not (Test-Path $trainScript)) {
    throw "train.py not found: $trainScript"
}

$cudaAvailable = & $pythonExe -c "import torch; print(torch.cuda.is_available())"
if ($Device -ne "cpu" -and $cudaAvailable.Trim().ToLower() -ne "true") {
    throw "CUDA is not available in $EnvName. Please run setup_vision_env.ps1 first or switch -Device cpu."
}

& $pythonExe $trainScript `
    --img $ImgSize `
    --batch $BatchSize `
    --epochs $Epochs `
    --data $DataYaml `
    --weights $Weights `
    --device $Device `
    --workers $Workers `
    --project $projectDir `
    --name $RunName

Write-Host "Training finished."
