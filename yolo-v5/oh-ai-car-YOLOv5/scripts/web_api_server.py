#!/usr/bin/env python
from __future__ import annotations

import json
import os
from pathlib import Path

import cv2
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from web_api_service import (
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    build_health_payload,
    build_infer_response,
    build_runtime_paths,
    cleanup_old_runs,
    copy_uploaded_input_to_run,
    create_request_dirs,
    ensure_runtime_root,
    env_python_path,
    file_to_public_url,
    save_upload_bytes,
    validate_upload_filename,
)
from web_runtime_inference import RuntimeConfig, WebInferenceRuntime


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RUNTIME_PATHS = build_runtime_paths(PROJECT_ROOT, env_python_path())
ensure_runtime_root(RUNTIME_PATHS.runtime_root)
PIPELINE_DEVICE = os.environ.get("PLATE_WEB_DEVICE", "0").strip()
INFERENCE_RUNTIME = WebInferenceRuntime(
    RUNTIME_PATHS,
    RuntimeConfig(
        device=PIPELINE_DEVICE,
        car_imgsz=int(os.environ.get("PLATE_WEB_CAR_IMGSZ", "512")),
        plate_imgsz=int(os.environ.get("PLATE_WEB_PLATE_IMGSZ", "512")),
    ),
)

app = FastAPI(title="车牌测试 Web API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/api/files", StaticFiles(directory=str(RUNTIME_PATHS.runtime_root)), name="runtime_files")


@app.get("/api/health")
def health() -> dict:
    payload = build_health_payload(RUNTIME_PATHS)
    payload["runtimeWarmStart"] = True
    payload["runtimeDevice"] = PIPELINE_DEVICE or "auto"
    return payload


def extract_video_frames(
    video_path: Path,
    output_dir: Path,
    sample_fps: float,
    max_frames: int,
) -> tuple[list[dict[str, object]], dict[str, object]]:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise ValueError("无法读取上传视频，请检查视频编码格式。")

    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration_sec = round(frame_count / fps, 3) if fps > 0 else 0.0
    effective_sample_fps = max(0.2, min(float(sample_fps), 5.0))
    frame_stride = max(int(round(fps / effective_sample_fps)), 1) if fps > 0 else 1

    frames: list[dict[str, object]] = []
    frame_index = 0
    sampled_count = 0
    output_dir.mkdir(parents=True, exist_ok=True)

    while sampled_count < max_frames:
        ok, frame = capture.read()
        if not ok:
            break
        if frame_index % frame_stride == 0:
            timestamp_sec = round(frame_index / fps, 3) if fps > 0 else round(sampled_count * (1.0 / effective_sample_fps), 3)
            frame_name = f"frame_{sampled_count + 1:04d}_{int(timestamp_sec * 1000):08d}ms.jpg"
            frame_path = output_dir / frame_name
            cv2.imwrite(str(frame_path), frame)
            frames.append(
                {
                    "sampleIndex": sampled_count + 1,
                    "frameIndex": frame_index,
                    "timestampSec": timestamp_sec,
                    "framePath": frame_path,
                }
            )
            sampled_count += 1
        frame_index += 1

    capture.release()
    return frames, {
        "fps": round(fps, 3),
        "frameCount": frame_count,
        "durationSec": duration_sec,
        "sampleFps": effective_sample_fps,
        "maxFrames": max_frames,
        "sampledFrameCount": len(frames),
        "frameStride": frame_stride,
    }


@app.post("/api/infer")
async def infer(image: UploadFile = File(...)) -> dict:
    health_payload = build_health_payload(RUNTIME_PATHS)
    if not health_payload["ok"]:
        raise HTTPException(status_code=500, detail=health_payload["message"])

    if not image.filename:
        raise HTTPException(status_code=400, detail="未收到图片文件名。")

    try:
        filename = validate_upload_filename(
            image.filename,
            allowed_extensions=IMAGE_EXTENSIONS,
            error_message="仅支持 jpg、jpeg、png、bmp、webp 格式图片。",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    request_dirs = create_request_dirs(RUNTIME_PATHS.runtime_root)
    run_root = request_dirs["run_root"]
    content = await image.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传图片为空。")

    saved_image = save_upload_bytes(request_dirs["upload_dir"], filename, content)

    try:
        payload = INFERENCE_RUNTIME.run(saved_image, run_root)
        copy_uploaded_input_to_run(saved_image, request_dirs["display_input_dir"])
        response = build_infer_response(RUNTIME_PATHS.runtime_root, run_root, payload)
        cleanup_old_runs(RUNTIME_PATHS.runtime_root)
        return response
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/infer-video")
async def infer_video(
    video: UploadFile = File(...),
    sample_fps: float = Form(1.0),
    max_frames: int = Form(20),
) -> dict:
    health_payload = build_health_payload(RUNTIME_PATHS)
    if not health_payload["ok"]:
        raise HTTPException(status_code=500, detail=health_payload["message"])

    if not video.filename:
        raise HTTPException(status_code=400, detail="未收到视频文件名。")

    try:
        filename = validate_upload_filename(
            video.filename,
            allowed_extensions=VIDEO_EXTENSIONS,
            error_message="仅支持 mp4、avi、mov、mkv、webm 格式视频。",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    bounded_sample_fps = max(0.2, min(float(sample_fps), 5.0))
    bounded_max_frames = max(1, min(int(max_frames), 60))

    request_dirs = create_request_dirs(RUNTIME_PATHS.runtime_root)
    run_root = request_dirs["run_root"]
    content = await video.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传视频为空。")

    saved_video = save_upload_bytes(request_dirs["upload_dir"], filename, content)
    copied_video = copy_uploaded_input_to_run(saved_video, request_dirs["display_input_dir"])
    extracted_dir = request_dirs["staging_root"] / "extracted_frames"

    try:
        extracted_frames, video_meta = extract_video_frames(
            saved_video,
            extracted_dir,
            sample_fps=bounded_sample_fps,
            max_frames=bounded_max_frames,
        )
        if not extracted_frames:
            raise ValueError("视频中没有成功抽取到可处理的帧。")

        matched_frames: list[dict[str, object]] = []
        scanned_frames: list[dict[str, object]] = []
        aggregate_total_sec = 0.0

        for frame_info in extracted_frames:
            frame_path = Path(str(frame_info["framePath"]))
            frame_run_root = run_root / "frames" / f"frame_{int(frame_info['sampleIndex']):04d}"
            payload = INFERENCE_RUNTIME.run(frame_path, frame_run_root)
            frame_response = build_infer_response(RUNTIME_PATHS.runtime_root, frame_run_root, payload)
            frame_response["sampleIndex"] = int(frame_info["sampleIndex"])
            frame_response["frameIndex"] = int(frame_info["frameIndex"])
            frame_response["timestampSec"] = float(frame_info["timestampSec"])
            scanned_frames.append(frame_response)
            aggregate_total_sec += float(frame_response.get("stageTimings", {}).get("total_pipeline_sec", 0.0) or 0.0)
            if frame_response["carDetected"] and frame_response["plateDetected"]:
                matched_frames.append(frame_response)

        response = {
            "ok": True,
            "videoName": filename,
            "uploadedVideoUrl": file_to_public_url(RUNTIME_PATHS.runtime_root, copied_video),
            "summary": (
                f"视频共抽取 {video_meta['sampledFrameCount']} 帧，"
                f"命中车辆+车牌帧 {len(matched_frames)} 帧。"
            ),
            "sampling": video_meta,
            "matchedFrameCount": len(matched_frames),
            "matchedFrames": matched_frames,
            "scannedFrames": len(scanned_frames),
            "aggregateTimings": {
                "totalPipelineSec": round(aggregate_total_sec, 6),
                "avgPipelineSec": round(aggregate_total_sec / max(len(scanned_frames), 1), 6),
            },
            "rawResultPath": str(run_root / "video_scan_results.json"),
        }
        (run_root / "video_scan_results.json").write_text(
            json.dumps(response, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        cleanup_old_runs(RUNTIME_PATHS.runtime_root)
        return response
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "web_api_server:app",
        host="127.0.0.1",
        port=8010,
        reload=False,
        app_dir=str(Path(__file__).resolve().parent),
    )
