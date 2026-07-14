#!/usr/bin/env python
"""
Evaluate pipeline JSON results against CCPD filename ground truth.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


PROVINCES = ["皖", "沪", "津", "渝", "冀", "晋", "蒙", "辽", "吉", "黑", "苏", "浙", "京", "闽", "赣", "鲁", "豫", "鄂", "湘", "粤", "桂", "琼", "川", "贵", "云", "藏", "陕", "甘", "青", "宁", "新", "警", "学", "O"]
ALPHABETS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "O"]
ADS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate CCPD OCR pipeline outputs.")
    parser.add_argument("--results-json", type=Path, required=True, help="pipeline_results.json path.")
    parser.add_argument("--summary-json", type=Path, help="Optional path to save evaluation summary JSON.")
    return parser.parse_args()


def decode_plate_from_name(image_path: str) -> str:
    parts = Path(image_path).stem.split("-")
    codes = [int(value) for value in parts[4].split("_")]
    return PROVINCES[codes[0]] + ALPHABETS[codes[1]] + "·" + "".join(ADS[index] for index in codes[2:])


def normalize_plate_text(text: str) -> str:
    return re.sub(r"[·.・\s]", "", text).upper()


def compute_summary(results: list[dict]) -> dict:
    exact_match = 0
    ready_count = 0
    details: list[dict] = []
    by_image: dict[str, list[dict]] = {}
    for item in results:
        gt = decode_plate_from_name(item["image_path"])
        pred = item.get("plate_text", "")
        is_exact = normalize_plate_text(gt) == normalize_plate_text(pred)
        if is_exact:
            exact_match += 1
        if item.get("status") == "ready_for_whitelist_compare":
            ready_count += 1
        detail = {
            "image_path": item["image_path"],
            "ground_truth": gt,
            "prediction": pred,
            "ocr_confidence": item.get("ocr_confidence"),
            "ocr_variant": item.get("ocr_variant"),
            "status": item.get("status"),
            "exact_match": is_exact,
        }
        details.append(detail)
        by_image.setdefault(item["image_path"], []).append(detail)

    total = len(results)
    unique_total = len(by_image)
    image_ready_count = 0
    image_exact_match_count = 0
    image_level_details: list[dict] = []
    for image_path, entries in by_image.items():
        best_entry = max(
            entries,
            key=lambda item: (
                int(item["exact_match"]),
                int(item["status"] == "ready_for_whitelist_compare"),
                float(item["ocr_confidence"] or 0.0),
            ),
        )
        image_ready_count += int(best_entry["status"] == "ready_for_whitelist_compare")
        image_exact_match_count += int(best_entry["exact_match"])
        image_level_details.append(best_entry)

    return {
        "record_level": {
            "total": total,
            "ready_count": ready_count,
            "ready_ratio": round(ready_count / total, 4) if total else 0.0,
            "exact_match_count": exact_match,
            "exact_match_ratio": round(exact_match / total, 4) if total else 0.0,
        },
        "image_level": {
            "total": unique_total,
            "ready_count": image_ready_count,
            "ready_ratio": round(image_ready_count / unique_total, 4) if unique_total else 0.0,
            "exact_match_count": image_exact_match_count,
            "exact_match_ratio": round(image_exact_match_count / unique_total, 4) if unique_total else 0.0,
        },
        "details": details,
        "image_level_details": image_level_details,
    }


def main() -> None:
    args = parse_args()
    results = json.loads(args.results_json.read_text(encoding="utf-8"))
    summary = compute_summary(results)
    if args.summary_json:
        args.summary_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Evaluated results: {args.results_json}")
    record_level = summary["record_level"]
    image_level = summary["image_level"]
    print(f"Record level total: {record_level['total']}")
    print(f"Record level ready-for-compare: {record_level['ready_count']} ({record_level['ready_ratio']:.2%})")
    print(f"Record level exact match: {record_level['exact_match_count']} ({record_level['exact_match_ratio']:.2%})")
    print(f"Image level total: {image_level['total']}")
    print(f"Image level ready-for-compare: {image_level['ready_count']} ({image_level['ready_ratio']:.2%})")
    print(f"Image level exact match: {image_level['exact_match_count']} ({image_level['exact_match_ratio']:.2%})")


if __name__ == "__main__":
    main()
