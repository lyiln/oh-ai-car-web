#!/usr/bin/env python3
"""Start the local YOLO plate FastAPI server on :8010 for Console plate scan."""
from __future__ import annotations

import os
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
YOLO_ROOT = ROOT / "yolo-v5" / "oh-ai-car-YOLOv5"
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
    return 0


def main() -> int:
    if not SERVER.is_file():
        print(f"Missing {SERVER}. Place oh-ai-car-YOLOv5 under yolo-v5/ first.", file=sys.stderr)
        return 1

    if _preflight() != 0:
        return 1

    _shim_pathlib_local()
    os.chdir(YOLO_ROOT)
    sys.path.insert(0, str(SCRIPTS))
    os.environ.setdefault("PLATE_WEB_DEVICE", os.environ.get("YOLO_DEVICE", "cpu"))

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
