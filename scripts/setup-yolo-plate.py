#!/usr/bin/env python3
"""Clone oh-ai-car-YOLOv5 into the repository and install platform_hook.py for edge-agent."""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "YOLOv5" / "oh-ai-car-YOLOv5"
LEGACY_BUNDLED_TARGET = ROOT / "yolo-v5" / "oh-ai-car-YOLOv5"
LEGACY_TARGET = ROOT / "vendor" / "oh-ai-car-YOLOv5"
REPO = "https://github.com/JMshepherd227/oh-ai-car-YOLOv5.git"
HOOK_EXAMPLE = ROOT / "edge-agent" / "platform_hook.example.py"


def _ensure_hook(repo: Path) -> None:
    hook = repo / "platform_hook.py"
    if hook.exists():
        print(f"platform_hook.py already present: {hook}")
        return
    if not HOOK_EXAMPLE.is_file():
        print(f"Missing example hook: {HOOK_EXAMPLE}")
        return
    shutil.copy2(HOOK_EXAMPLE, hook)
    print(f"Installed platform_hook.py from {HOOK_EXAMPLE.name}")


def main() -> int:
    if TARGET.exists() and any(TARGET.iterdir()):
        print(f"Already present: {TARGET}")
        _ensure_hook(TARGET)
        return 0
    if LEGACY_BUNDLED_TARGET.exists() and any(LEGACY_BUNDLED_TARGET.iterdir()):
        print(f"Using legacy path: {LEGACY_BUNDLED_TARGET}")
        _ensure_hook(LEGACY_BUNDLED_TARGET)
        return 0
    if LEGACY_TARGET.exists() and any(LEGACY_TARGET.iterdir()):
        print(f"Using legacy path: {LEGACY_TARGET}")
        _ensure_hook(LEGACY_TARGET)
        return 0

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    print(f"Cloning {REPO} -> {TARGET}")
    print("If this fails with 'Repository not found', open the GitHub invitation and accept it first:")
    print("  https://github.com/JMshepherd227/oh-ai-car-YOLOv5/invitations")
    try:
        subprocess.run(["git", "clone", "--depth", "1", REPO, str(TARGET)], check=True)
    except subprocess.CalledProcessError:
        return 1
    _ensure_hook(TARGET)
    print("Done. Install Jetson deps: pip install -r edge-agent/requirements-plate.txt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
