#!/usr/bin/env python3
"""Start the local YOLO plate FastAPI server on :8010 for Console plate scan."""
from __future__ import annotations

import os
import re
import shutil
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _repo_candidates() -> list[Path]:
    env_path = os.environ.get("YOLO_REPO_PATH", "").strip()
    candidates = [
        Path(env_path) if env_path else None,
        ROOT / "yolo-v5" / "oh-ai-car-YOLOv5",
        ROOT / "vendor" / "oh-ai-car-YOLOv5",
        ROOT.parents[1] / "YOLOv5" / "oh-ai-car-YOLOv5",
    ]
    unique: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        if candidate is None:
            continue
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def _resolve_repo_root() -> Path:
    for candidate in _repo_candidates():
        if (candidate / "scripts" / "web_api_server.py").is_file():
            return candidate
    return _repo_candidates()[0]


YOLO_ROOT = _resolve_repo_root()
SCRIPTS = YOLO_ROOT / "scripts"
SERVER = SCRIPTS / "web_api_server.py"


def _shim_pathlib_local() -> None:
    """Allow loading checkpoints pickled on Python 3.13+ (pathlib._local) under 3.9–3.12."""
    if "pathlib._local" in sys.modules:
        return
    import pathlib

    mod = types.ModuleType("pathlib._local")
    for name in (
        "Path",
        "PurePath",
        "PurePosixPath",
        "PureWindowsPath",
        "PosixPath",
        "WindowsPath",
    ):
        if hasattr(pathlib, name):
            setattr(mod, name, getattr(pathlib, name))
    sys.modules["pathlib._local"] = mod


def _preflight() -> int:
    missing: list[str] = []
    for module, hint in (
        ("uvicorn", "pip install fastapi uvicorn"),
        ("fastapi", "pip install fastapi uvicorn"),
        ("cv2", "pip install opencv-python"),
        ("torch", "install PyTorch for your platform"),
        (
            "ultralytics",
            "pip install ultralytics  (if pip proxy fails, download .whl from mirror: "
            "pip install path\\to\\ultralytics-*.whl --no-deps --no-index)",
        ),
    ):
        try:
            __import__(module if module != "cv2" else "cv2")
        except ImportError:
            missing.append(f"  - {module}: {hint}")
    if missing:
        print("Missing dependencies for plate web API:", file=sys.stderr)
        print("\n".join(missing), file=sys.stderr)
        return 1
    try:
        import paddle  # noqa: PLC0415

        version = getattr(paddle, "__version__", "0.0.0")
        match = re.match(r"^(\d+)\.(\d+)\.(\d+)", version)
        if match:
            parsed = tuple(int(part) for part in match.groups())
            if parsed < (3, 3, 1):
                print(
                    "Incompatible paddlepaddle version for current PaddleOCR runtime. "
                    f"Detected {version}, require >= 3.3.1. Run: python -m pip install --upgrade paddlepaddle",
                    file=sys.stderr,
                )
                return 1
    except ImportError:
        pass
    return 0


def _ensure_legacy_plate_weights() -> None:
    explicit = os.environ.get("YOLO_PLATE_WEIGHTS", "").strip()
    if explicit:
        return

    modern_candidates = [
        YOLO_ROOT / "weights" / "best_plate_detector_v2.pt",
        YOLO_ROOT / "weights" / "best_plate_detector.pt",
    ]
    legacy_target = YOLO_ROOT / "runs" / "train" / "plate_ccpd_gpu_v3_continue" / "weights" / "best.pt"
    if legacy_target.is_file():
        return

    source = next((path for path in modern_candidates if path.is_file()), None)
    if source is None:
        return

    legacy_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, legacy_target)
    print(f"Prepared legacy plate weights: {legacy_target}", flush=True)


def _configure_windows_cpu_paddle_runtime() -> None:
    device = os.environ.get("PLATE_WEB_DEVICE", os.environ.get("YOLO_DEVICE", "cpu")).strip().lower()
    if os.name != "nt" or device not in {"", "cpu"}:
        return

    # PaddleOCR 3.x on Windows CPU can crash in the PIR -> oneDNN path.
    os.environ.setdefault("FLAGS_enable_pir_api", "0")
    os.environ.setdefault("FLAGS_use_mkldnn", "0")
    os.environ.setdefault("FLAGS_use_onednn", "0")
    os.environ.setdefault("PADDLE_USE_ONEDNN", "0")


def main() -> int:
    if not SERVER.is_file():
        tried = "\n".join(f"  - {candidate}" for candidate in _repo_candidates())
        print(
            f"Missing {SERVER}. Configure YOLO_REPO_PATH or place oh-ai-car-YOLOv5 in one of:\n{tried}",
            file=sys.stderr,
        )
        return 1

    if _preflight() != 0:
        return 1

    _shim_pathlib_local()
    _ensure_legacy_plate_weights()
    os.environ.setdefault("YOLO_REPO_PATH", str(YOLO_ROOT))
    os.chdir(YOLO_ROOT)
    sys.path.insert(0, str(SCRIPTS))
    os.environ.setdefault("PLATE_WEB_DEVICE", os.environ.get("YOLO_DEVICE", "cpu"))
    _configure_windows_cpu_paddle_runtime()

    print(f"Using YOLO repo: {YOLO_ROOT}", flush=True)
    print("Loading YOLO models + OCR (first start may take a minute)…", flush=True)
    try:
        from web_api_server import app  # noqa: PLC0415
    except ModuleNotFoundError as exc:
        print(f"Import failed: {exc}", file=sys.stderr)
        print(
            "Install missing packages manually. If `pip install` hits "
            "`check_hostname requires server_hostname`, your pip proxy is broken — "
            "download wheels from https://pypi.tuna.tsinghua.edu.cn/simple/ and "
            "install with: pip install <wheel> --no-deps --no-index",
            file=sys.stderr,
        )
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to start plate web API: {exc}", file=sys.stderr)
        return 1

    host = os.environ.get("PLATE_WEB_HOST", "127.0.0.1")
    port = int(os.environ.get("PLATE_WEB_PORT", "8010"))
    import uvicorn

    print(f"Plate web API http://{host}:{port}/api/health", flush=True)
    uvicorn.run(app, host=host, port=port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
