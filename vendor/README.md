# Vendor: oh-ai-car-YOLOv5

This directory holds the external YOLOv5 license-plate project (not vendored in Git).

## Clone (after accepting GitHub invitation)

```bash
git clone https://github.com/JMshepherd227/oh-ai-car-YOLOv5.git oh-ai-car-YOLOv5
```

Or from repo root:

```bash
python scripts/setup-yolo-plate.py
```

Expected layout after clone:

```text
vendor/oh-ai-car-YOLOv5/
  weights/best.pt          # trained plate detector (or similar)
  platform_hook.py         # optional; exports create_detector()
  detect.py                # optional Ultralytics entry
```

See [docs/integration/yolo-plate-recognition.md](../docs/integration/yolo-plate-recognition.md).
