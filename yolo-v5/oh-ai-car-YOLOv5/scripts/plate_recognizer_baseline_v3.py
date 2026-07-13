#!/usr/bin/env python
"""
Baseline PaddleOCR recognizer before v4 candidate aggregation changes.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from paddleocr import PaddleOCR


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
PLATE_PATTERNS = (
    re.compile(r"^[\u4e00-\u9fa5][A-Z][A-Z0-9]{5}$"),
    re.compile(r"^[\u4e00-\u9fa5][A-Z][A-Z0-9]{6}$"),
)


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


def build_ocr_model(lang: str) -> PaddleOCR:
    paddlex_lock_dir = Path.home() / ".paddlex" / "locks" / "official_models"
    paddlex_lock_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    return PaddleOCR(lang=lang)


def normalize_plate_text(text: str) -> str:
    cleaned = re.sub(r"\s+", "", text).upper()
    return cleaned.replace("-", "")


def canonicalize_plate_text(text: str) -> str:
    compact = re.sub(r"[·.・]", "", text)
    if len(compact) >= 2 and re.match(r"^[\u4e00-\u9fa5][A-Z]", compact):
        suffix = compact[2:].replace("O", "0").replace("I", "1")
        return compact[:2] + "·" + suffix
    return text


def is_valid_plate_text(text: str) -> bool:
    compact = re.sub(r"[·.・]", "", text)
    return any(pattern.match(compact) for pattern in PLATE_PATTERNS)


def build_ocr_variants(image: np.ndarray) -> list[tuple[str, np.ndarray]]:
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

    return [
        ("original", image),
        ("uniform_padded", uniform_padded),
        ("left_padded", left_biased),
        ("upscaled", upscaled),
        ("enhanced", enhanced_bgr),
        ("sharpened", sharpened),
    ]


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
                except Exception:
                    score = 0.0
                candidates.append({"text": text, "score": score})
            else:
                stack.extend(item)
    return candidates


def score_candidate(candidate: dict[str, Any]) -> tuple[int, float, int]:
    text = candidate["text"]
    valid = is_valid_plate_text(text)
    compact = re.sub(r"[·.・]", "", text)
    looks_close = bool(re.match(r"^[A-Z][A-Z0-9]{4,6}$", compact))
    return (
        2 if valid else (1 if looks_close else 0),
        float(candidate["score"]),
        len(compact),
    )


def run_ocr_on_image(ocr_model: PaddleOCR, image_input: Any) -> Any:
    if hasattr(ocr_model, "predict"):
        return ocr_model.predict(image_input)
    return ocr_model.ocr(image_input, cls=False)


def recognize_plate_image(ocr_model: PaddleOCR, image_path: Path, min_score: float) -> dict[str, Any]:
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"Image is unreadable: {image_path}")

    candidates: list[dict[str, Any]] = []
    for variant_name, variant_image in build_ocr_variants(image):
        raw_result = run_ocr_on_image(ocr_model, variant_image)
        for candidate in collect_candidates(raw_result):
            candidate["variant"] = variant_name
            candidates.append(candidate)

    best = max(
        candidates,
        key=score_candidate,
        default={"text": "", "score": 0.0, "variant": "none"},
    )
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
