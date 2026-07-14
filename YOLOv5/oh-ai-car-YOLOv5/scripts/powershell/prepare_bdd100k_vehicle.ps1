param(
    [string]$ProjectRoot = "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection",
    [string]$EnvName = "vision_env",
    [string]$DatasetRoot = "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\datasets\bdd100k",
    [switch]$IncludeTrainClass,
    [int]$MaxImagesPerSplit = 0
)

$ErrorActionPreference = "Stop"

$pythonExe = Join-Path $ProjectRoot "$EnvName\Scripts\python.exe"
$scriptPath = Join-Path $ProjectRoot "scripts\bdd100k_to_yolo_vehicle.py"

if (-not (Test-Path $pythonExe)) {
    throw "Python executable not found: $pythonExe"
}

if (-not (Test-Path $scriptPath)) {
    throw "bdd100k_to_yolo_vehicle.py not found: $scriptPath"
}

if (-not (Test-Path (Join-Path $DatasetRoot "images\100k\train"))) {
    throw "BDD100K train images directory not found: $(Join-Path $DatasetRoot 'images\100k\train')"
}

if (-not (Test-Path (Join-Path $DatasetRoot "images\100k\val"))) {
    throw "BDD100K val images directory not found: $(Join-Path $DatasetRoot 'images\100k\val')"
}

$labelCandidates = @(
    (Join-Path $DatasetRoot "labels\det_20\det_train.json"),
    (Join-Path $DatasetRoot "labels\bdd100k_labels_images_train.json")
)

$foundTrainLabel = $false
foreach ($candidate in $labelCandidates) {
    if (Test-Path $candidate) {
        $foundTrainLabel = $true
        break
    }
}

if (-not $foundTrainLabel) {
    throw "Could not find BDD100K detection label json under $DatasetRoot"
}

$args = @(
    $scriptPath,
    "--dataset-root", $DatasetRoot,
    "--max-images-per-split", $MaxImagesPerSplit
)

if ($IncludeTrainClass) {
    $args += "--include-train-class"
}

& $pythonExe @args

if ($LASTEXITCODE -ne 0) {
    throw "bdd100k_to_yolo_vehicle.py exited with code $LASTEXITCODE"
}

Write-Host "BDD100K vehicle labels are ready."
