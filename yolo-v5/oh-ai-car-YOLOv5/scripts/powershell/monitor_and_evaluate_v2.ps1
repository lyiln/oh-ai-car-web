param(
    [string]$ProjectRoot = "C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection",
    [string]$EnvName = "vision_env",
    [string]$RunName = "plate_ccpd_gpu_v2_s_800_200",
    [string]$TrainingWeights = "C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\runs\train\plate_ccpd_gpu_v2_s_800_200\weights\best.pt",
    [string]$PublishedWeights = "C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\weights\best_plate_detector_v2.pt",
    [string]$ValSource = "C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\demo_input\val_batch_40",
    [string]$HardSource = "C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\demo_input\hard_batch_20",
    [string]$ValEvalName = "eval_val40_v2_after_train",
    [string]$HardEvalName = "eval_hard20_v2_after_train",
    [int]$PollSeconds = 30
)

$ErrorActionPreference = "Stop"

$pythonExe = Join-Path $ProjectRoot "$EnvName\Scripts\python.exe"
$runPipelineScript = Join-Path $ProjectRoot "scripts\powershell\run_plate_pipeline.ps1"
$evalScript = Join-Path $ProjectRoot "scripts\evaluate_ccpd_pipeline.py"

if (-not (Test-Path $pythonExe)) {
    throw "Python executable not found: $pythonExe"
}

if (-not (Test-Path $runPipelineScript)) {
    throw "Pipeline runner not found: $runPipelineScript"
}

if (-not (Test-Path $evalScript)) {
    throw "Evaluation script not found: $evalScript"
}

Write-Host "Waiting for training process to finish: $RunName"
while ($true) {
    $running = Get-CimInstance Win32_Process | Where-Object {
        $_.Name -match "python" -and
        $_.CommandLine -match "train.py" -and
        $_.CommandLine -match [regex]::Escape($RunName)
    }

    if (-not $running) {
        break
    }

    Write-Host "Training still running. Active process count: $($running.Count)"
    Start-Sleep -Seconds $PollSeconds
}

if (-not (Test-Path $TrainingWeights)) {
    throw "Training best weight not found: $TrainingWeights"
}

Copy-Item $TrainingWeights $PublishedWeights -Force
Write-Host "Published new best weight to: $PublishedWeights"

& $runPipelineScript -Weights $PublishedWeights -Source $ValSource -RunName $ValEvalName
& $pythonExe $evalScript `
    --results-json (Join-Path $ProjectRoot "demo_output\$ValEvalName\pipeline_results.json") `
    --summary-json (Join-Path $ProjectRoot "demo_output\$ValEvalName\evaluation_summary.json")

& $runPipelineScript -Weights $PublishedWeights -Source $HardSource -RunName $HardEvalName
& $pythonExe $evalScript `
    --results-json (Join-Path $ProjectRoot "demo_output\$HardEvalName\pipeline_results.json") `
    --summary-json (Join-Path $ProjectRoot "demo_output\$HardEvalName\evaluation_summary.json")

Write-Host "Automatic post-training evaluation finished."
