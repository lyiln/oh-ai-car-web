param(
    [string]$ProjectRoot = "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection",
    [string]$EnvName = "vision_env",
    [string]$Weights = "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\weights\yolov5s.pt",
    [string]$DataYaml = "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\configs\car_bdd100k_mini_vehicle.yaml",
    [int]$ImgSize = 640,
    [int]$BatchSize = 4,
    [int]$Epochs = 10,
    [string]$Device = "0",
    [string]$RunName = "car_bdd100k_mini_v1",
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

if (-not (Test-Path $DataYaml)) {
    throw "Data yaml not found: $DataYaml"
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

if ($LASTEXITCODE -ne 0) {
    throw "train.py exited with code $LASTEXITCODE"
}

Write-Host "BDD100K mini training finished."
