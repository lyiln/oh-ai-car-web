#!/usr/bin/env python
"""
Run PaddleOCR on plate crop images and export structured OCR results.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
from pathlib import Path
from typing import TYPE_CHECKING
from typing import Any

import cv2
import numpy as np

if TYPE_CHECKING:
    from paddleocr import PaddleOCR


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
PROVINCE_CHARS = "京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼"
AREA_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
SERIAL_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"
NEW_ENERGY_LETTER_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"
STANDARD_PLATE_PATTERN = re.compile(
    rf"^[{PROVINCE_CHARS}][{AREA_CODE_CHARS}][{SERIAL_CHARS}]{{5}}$"
)
NEW_ENERGY_SMALL_PATTERN = re.compile(
    rf"^[{PROVINCE_CHARS}][{AREA_CODE_CHARS}][{NEW_ENERGY_LETTER_CHARS}][0-9]{{5}}$"
)
NEW_ENERGY_LARGE_PATTERN = re.compile(
    rf"^[{PROVINCE_CHARS}][{AREA_CODE_CHARS}][0-9]{{5}}[{NEW_ENERGY_LETTER_CHARS}]$"
)
PLATE_PATTERNS = (
    STANDARD_PLATE_PATTERN,
    NEW_ENERGY_SMALL_PATTERN,
    NEW_ENERGY_LARGE_PATTERN,
)
ENABLE_PROVINCE_INFERENCE = False
OCR_VARIANT_PRESETS: dict[str, tuple[str, ...]] = {
    "fast": ("original", "upscaled"),
    "full": ("original", "uniform_padded", "left_padded", "upscaled", "enhanced", "sharpened"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Recognize Chinese plate text with PaddleOCR.")
    parser.add_argument("--source", type=Path, required=True, help="Input crop image path or directory.")
    parser.add_argument("--project", type=Path, default=Path("runs") / "plate_ocr", help="Output project directory.")
    parser.add_argument("--name", type=str, default="predict", help="Run name under project directory.")
    parser.add_argument("--lang", type=str, default="ch", help="PaddleOCR language setting.")
    parser.add_argument("--min-score", type=float, default=0.50, help="Minimum OCR confidence for pass status.")
    parser.add_argument("--save-csv", action="store_true", help="Export CSV in addition to JSON.")
    return parser.parse_args()


def iter_input_images(source: Path) -> list[Path]:
    if source.is_file():
        return [source]
    return sorted([p for p in source.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS])


def _configure_paddle_ocr_runtime() -> dict[str, Any]:
    device = os.environ.get("PLATE_WEB_DEVICE", os.environ.get("YOLO_DEVICE", "cpu")).strip().lower()
    is_windows_cpu = os.name == "nt" and device in {"", "cpu"}
    options: dict[str, Any] = {}
    if is_windows_cpu:
        # PaddleOCR 3.x on Windows CPU can crash in the PIR -> oneDNN path.
        os.environ.setdefault("FLAGS_enable_pir_api", "0")
        os.environ.setdefault("FLAGS_use_mkldnn", "0")
        os.environ.setdefault("FLAGS_use_onednn", "0")
        os.environ.setdefault("PADDLE_USE_ONEDNN", "0")
        options["enable_mkldnn"] = False
    return options


def build_ocr_model(lang: str) -> "PaddleOCR":
    paddlex_lock_dir = Path.home() / ".paddlex" / "locks" / "official_models"
    paddlex_lock_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    options = _configure_paddle_ocr_runtime()
    options["lang"] = lang
    from paddleocr import PaddleOCR  # noqa: PLC0415

    return PaddleOCR(**options)


def normalize_plate_text(text: str) -> str:
    cleaned = re.sub(r"\s+", "", text).upper()
    return cleaned.replace("-", "")


def canonicalize_plate_text(text: str) -> str:
    compact = re.sub(r"[·.・]", "", text)
    if len(compact) >= 2 and re.match(r"^[\u4e00-\u9fa5][A-Z]", compact):
        suffix = compact[2:].replace("O", "0").replace("I", "1")
        return compact[:2] + "·" + suffix
    return text


def compact_plate_text(text: str) -> str:
    return re.sub(r"[·.・]", "", text)


def is_valid_plate_text(text: str) -> bool:
    compact = compact_plate_text(text)
    return any(pattern.match(compact) for pattern in PLATE_PATTERNS)


def infer_missing_province_text(text: str) -> str | None:
    if not ENABLE_PROVINCE_INFERENCE:
        return None
    compact = compact_plate_text(text)
    if len(compact) != 6:
        return None
    if compact[0] not in AREA_CODE_CHARS or any(ch not in SERIAL_CHARS for ch in compact[1:]):
        return None
    return None


def build_ocr_variants(image: np.ndarray, preset: str = "full") -> list[tuple[str, np.ndarray]]:
    h, w = image.shape[:2]
    pad_x = max(12, int(round(w * 0.18)))
    pad_y = max(8, int(round(h * 0.18)))
    left_biased = cv2.copyMakeBorder(
        image,
        pad_y,
        pad_y,
        pad_x * 2,
        pad_x,
        borderType=cv2.BORDER_REPLICATE,
    )
    uniform_padded = cv2.copyMakeBorder(
        image,
        pad_y,
        pad_y,
        pad_x,
        pad_x,
        borderType=cv2.BORDER_REPLICATE,
    )
    upscaled = cv2.resize(left_biased, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(upscaled, cv2.COLOR_BGR2GRAY)
    enhanced_gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    enhanced_bgr = cv2.cvtColor(enhanced_gray, cv2.COLOR_GRAY2BGR)
    sharpened = cv2.filter2D(
        enhanced_bgr,
        -1,
        np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], dtype=np.float32),
    )

    all_variants = [
        ("original", image),
        ("uniform_padded", uniform_padded),
        ("left_padded", left_biased),
        ("upscaled", upscaled),
        ("enhanced", enhanced_bgr),
        ("sharpened", sharpened),
    ]
    allowed_variants = OCR_VARIANT_PRESETS.get(preset, OCR_VARIANT_PRESETS["full"])
    return [item for item in all_variants if item[0] in allowed_variants]


def collect_candidates(raw_result: Any) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    stack = [raw_result]

    while stack:
        item = stack.pop()
        if isinstance(item, dict):
            texts = item.get("rec_texts")
            scores = item.get("rec_scores")
            if isinstance(texts, list) and isinstance(scores, list):
                for text, score in zip(texts, scores):
                    candidates.append(
                        {
                            "text": canonicalize_plate_text(normalize_plate_text(str(text))),
                            "score": float(score),
                        }
                    )
            stack.extend(item.values())
            continue
        if isinstance(item, list):
            if (
                len(item) == 2
                and isinstance(item[1], (list, tuple))
                and len(item[1]) >= 2
                and isinstance(item[1][0], str)
            ):
                text = canonicalize_plate_text(normalize_plate_text(item[1][0]))
                try:
                    score = float(item[1][1])
                except Exception:  # noqa: BLE001
                    score = 0.0
                candidates.append({"text": text, "score": score})
            else:
                stack.extend(item)
    return candidates


def score_candidate(candidate: dict[str, Any]) -> tuple[int, float, int]:
    text = candidate["text"]
    valid = is_valid_plate_text(text)
    compact = compact_plate_text(text)
    looks_close = bool(re.match(r"^[A-Z][A-Z0-9]{4,6}$", compact))
    return (
        2 if valid else (1 if looks_close else 0),
        float(candidate["score"]),
        len(compact),
    )


def expand_candidate_pool(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    expanded: list[dict[str, Any]] = []
    for candidate in candidates:
        enriched = dict(candidate)
        enriched["inferred"] = False
        expanded.append(enriched)

        inferred_text = infer_missing_province_text(candidate["text"])
        if inferred_text:
            inferred_candidate = dict(candidate)
            inferred_candidate["text"] = inferred_text
            inferred_candidate["score"] = max(0.0, float(candidate["score"]) - 0.03)
            inferred_candidate["inferred"] = True
            expanded.append(inferred_candidate)
    return expanded


def choose_best_candidate(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    if not candidates:
        return {"text": "", "score": 0.0, "variant": "none", "inferred": False, "support_count": 0}

    grouped: dict[str, dict[str, Any]] = {}
    for candidate in expand_candidate_pool(candidates):
        text = candidate["text"]
        bucket = grouped.setdefault(
            text,
            {
                "text": text,
                "score_sum": 0.0,
                "max_score": 0.0,
                "support_variants": set(),
                "best_variant": candidate.get("variant", "none"),
                "inferred": bool(candidate.get("inferred", False)),
            },
        )
        bucket["score_sum"] += float(candidate["score"])
        bucket["max_score"] = max(bucket["max_score"], float(candidate["score"]))
        bucket["support_variants"].add(candidate.get("variant", "none"))
        if float(candidate["score"]) >= bucket["max_score"]:
            bucket["best_variant"] = candidate.get("variant", "none")
            bucket["inferred"] = bool(candidate.get("inferred", False))

    aggregated = []
    for bucket in grouped.values():
        compact = compact_plate_text(bucket["text"])
        valid = is_valid_plate_text(bucket["text"])
        looks_close = bool(re.match(r"^[A-Z][A-Z0-9]{4,6}$", compact))
        support_count = len(bucket["support_variants"])
        aggregated.append(
            {
                "text": bucket["text"],
                "score": round(bucket["max_score"], 6),
                "score_sum": bucket["score_sum"],
                "variant": bucket["best_variant"],
                "support_count": support_count,
                "inferred": bucket["inferred"],
                "valid_rank": 2 if valid else (1 if looks_close else 0),
                "compact_len": len(compact),
            }
        )

    return max(
        aggregated,
        key=lambda item: (
            item["valid_rank"],
            item["support_count"],
            item["score_sum"],
            item["score"],
            item["compact_len"],
        ),
    )


def run_ocr_on_image(ocr_model: PaddleOCR, image_input: Any) -> Any:
    if hasattr(ocr_model, "predict"):
        return ocr_model.predict(image_input)
    return ocr_model.ocr(image_input, cls=False)


def recognize_plate_image(
    ocr_model: PaddleOCR,
    image_path: Path,
    min_score: float,
    variant_preset: str = "full",
) -> dict[str, Any]:
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"Image is unreadable: {image_path}")

    candidates: list[dict[str, Any]] = []
    for variant_name, variant_image in build_ocr_variants(image, preset=variant_preset):
        raw_result = run_ocr_on_image(ocr_model, variant_image)
        for candidate in collect_candidates(raw_result):
            candidate["variant"] = variant_name
            candidates.append(candidate)

    best = choose_best_candidate(candidates)
    plate_text = best["text"]
    score = round(float(best["score"]), 6)
    is_valid = is_valid_plate_text(plate_text)
    status = "ocr_pass" if score >= min_score and is_valid else "manual_review"

    return {
        "crop_path": str(image_path),
        "plate_text": plate_text,
        "ocr_confidence": score,
        "is_valid_plate": is_valid,
        "status": status,
        "raw_candidate_count": len(candidates),
        "ocr_variant": best["variant"],
        "ocr_profile": variant_preset,
        "candidate_support_count": best.get("support_count", 0),
        "used_inferred_prefix": bool(best.get("inferred", False)),
    }


def write_json(results: list[dict[str, Any]], output_path: Path) -> None:
    output_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


def write_csv(results: list[dict[str, Any]], output_path: Path) -> None:
    with output_path.open("w", newline="", encoding="utf-8-sig") as csv_file:
        writer = csv.DictWriter(
            csv_file,
            fieldnames=[
                "crop_path",
                "plate_text",
                "ocr_confidence",
                "is_valid_plate",
                "status",
                "raw_candidate_count",
                "ocr_variant",
                "candidate_support_count",
                "used_inferred_prefix",
            ],
        )
        writer.writeheader()
        writer.writerows(results)


def main() -> None:
    args = parse_args()
    save_dir = args.project / args.name
    save_dir.mkdir(parents=True, exist_ok=True)

    images = iter_input_images(args.source)
    if not images:
        raise FileNotFoundError(f"No images found under source: {args.source}")

    ocr_model = build_ocr_model(args.lang)
    results = [recognize_plate_image(ocr_model, image_path, args.min_score) for image_path in images]

    json_path = save_dir / "ocr_results.json"
    write_json(results, json_path)
    if args.save_csv:
        write_csv(results, save_dir / "ocr_results.csv")

    pass_count = sum(1 for item in results if item["status"] == "ocr_pass")
    print(f"OCR finished, results saved to: {save_dir}")
    print(f"JSON result file: {json_path}")
    print(f"Input image count: {len(images)}")
    print(f"OCR pass count  : {pass_count}")


if __name__ == "__main__":
    main()
