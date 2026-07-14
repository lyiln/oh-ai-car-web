param(
    [string]$ProjectRoot = "C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection",
    [string]$EnvName = "vision_env"
)

$ErrorActionPreference = "Stop"

$envPath = Join-Path $ProjectRoot $EnvName
$yolov5Path = Join-Path $ProjectRoot "yolov5"
$detectScript = Join-Path $yolov5Path "detect.py"

Write-Host "Project root: $ProjectRoot"
Write-Host "Virtual env : $envPath"

if (-not (Test-Path $ProjectRoot)) {
    throw "Project root not found: $ProjectRoot"
}

if (-not (Test-Path $envPath)) {
    python -m venv --system-site-packages $envPath
}

$pythonExe = Join-Path $envPath "Scripts\python.exe"
$pipExe = Join-Path $envPath "Scripts\pip.exe"

& $pythonExe -m pip install --upgrade pip
& $pipExe install --upgrade --force-reinstall --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu128

if (-not (Test-Path $yolov5Path)) {
    git clone https://github.com/ultralytics/yolov5.git $yolov5Path
}

if (-not (Test-Path $detectScript)) {
    throw "yolov5 directory exists but detect.py is missing. Please delete '$yolov5Path' and rerun this script, or manually download ultralytics/yolov5 into that folder."
}

& $pipExe install -r (Join-Path $yolov5Path "requirements.txt")
& $pythonExe -c "import torch; print('torch=', torch.__version__); print('cuda_available=', torch.cuda.is_available()); print('cuda_version=', torch.version.cuda)"
& $pythonExe $detectScript --help

Write-Host "Environment setup finished."
