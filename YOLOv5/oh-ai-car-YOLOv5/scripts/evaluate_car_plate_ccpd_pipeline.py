#!/usr/bin/env python
"""
Evaluate the full car-gated plate pipeline on CCPD images.

Outputs three metric groups:
1. Car gate metrics
2. Plate recognition metrics on images that passed the car gate
3. Overall end-to-end exact-match metrics
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


PROVINCES = ["皖", "沪", "津", "渝", "冀", "晋", "蒙", "辽", "吉", "黑", "苏", "浙", "京", "闽", "赣", "鲁", "豫", "鄂", "湘", "粤", "桂", "琼", "川", "贵", "云", "藏", "陕", "甘", "青", "宁", "新", "警", "学", "O"]
ALPHABETS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "O"]
ADS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate car gate + plate recognition pipeline on CCPD.")
    parser.add_argument("--results-json", type=Path, required=True, help="car_plate_results.json path.")
    parser.add_argument("--output-json", type=Path, required=True, help="Where to save metrics JSON.")
    parser.add_argument("--output-md", type=Path, help="Optional markdown summary path.")
    return parser.parse_args()


def decode_plate_from_name(image_path: str) -> str:
    parts = Path(image_path).stem.split("-")
    codes = [int(value) for value in parts[4].split("_")]
    return PROVINCES[codes[0]] + ALPHABETS[codes[1]] + "·" + "".join(ADS[index] for index in codes[2:])


def normalize_plate_text(text: str) -> str:
    return re.sub(r"[·.・\s]", "", text or "").upper()


def safe_divide(numerator: float, denominator: float) -> float | None:
    if denominator == 0:
        return None
    return numerator / denominator


def build_binary_metrics(tp: int, fp: int, fn: int, total: int) -> dict[str, Any]:
    precision = safe_divide(tp, tp + fp)
    recall = safe_divide(tp, tp + fn)
    f1 = None if precision is None or recall is None or (precision + recall) == 0 else 2 * precision * recall / (precision + recall)
    accuracy = safe_divide(tp, total)
    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "accuracy": accuracy,
        "precision": precision,
        "recall": recall,
        "f1": f1,
    }


def format_metric(value: float | None) -> str:
    if value is None:
        return "N/A"
    return f"{value:.4f}"


def build_markdown(summary: dict[str, Any]) -> str:
    car = summary["car_metrics"]
    plate = summary["plate_metrics"]
    overall = summary["overall_metrics"]

    lines = [
        "# ccpd_car_plate_pipeline_eval",
        "",
        "## Dataset",
        "",
        f"- image_count: `{summary['image_count']}`",
        f"- source_results: `{summary['results_json']}`",
        "",
        "## Car Gate",
        "",
        f"- TP: `{car['tp']}`",
        f"- FP: `{car['fp']}`",
        f"- FN: `{car['fn']}`",
        f"- Accuracy: `{format_metric(car['accuracy'])}`",
        f"- Precision: `{format_metric(car['precision'])}`",
        f"- Recall: `{format_metric(car['recall'])}`",
        f"- F1: `{format_metric(car['f1'])}`",
        f"- 漏检数: `{car['miss_count']}`",
        f"- 误检数: `{car['false_positive_count']}`",
        "",
        "## Plate Recognition",
        "",
        f"- entered_image_count: `{plate['entered_image_count']}`",
        f"- TP: `{plate['tp']}`",
        f"- FP: `{plate['fp']}`",
        f"- FN: `{plate['fn']}`",
        f"- Accuracy: `{format_metric(plate['accuracy'])}`",
        f"- Precision: `{format_metric(plate['precision'])}`",
        f"- Recall: `{format_metric(plate['recall'])}`",
        f"- F1: `{format_metric(plate['f1'])}`",
        f"- 漏检数: `{plate['miss_count']}`",
        f"- 误检数: `{plate['false_positive_count']}`",
        f"- wrong_text_count: `{plate['wrong_text_count']}`",
        f"- excluded_by_car_gate: `{plate['excluded_by_car_gate']}`",
        "",
        "## Overall",
        "",
        f"- TP: `{overall['tp']}`",
        f"- FP: `{overall['fp']}`",
        f"- FN: `{overall['fn']}`",
        f"- Accuracy: `{format_metric(overall['accuracy'])}`",
        f"- Precision: `{format_metric(overall['precision'])}`",
        f"- Recall: `{format_metric(overall['recall'])}`",
        f"- F1: `{format_metric(overall['f1'])}`",
        f"- 漏检数: `{overall['miss_count']}`",
        f"- 误检数: `{overall['false_positive_count']}`",
        f"- no_car_count: `{overall['no_car_count']}`",
        f"- no_plate_count: `{overall['no_plate_count']}`",
        f"- wrong_plate_count: `{overall['wrong_plate_count']}`",
        "",
        "## Notes",
        "",
        "- CCPD base1000 当前评估集全部都是正样本图像，因此汽车门控的 Precision 没有经过真实负样本压力测试。",
        "- 车牌识别指标中的 FP 表示“输出了车牌文本但与真值不一致”，FN 表示“没有正确识别出真值车牌”，因此错误识别会同时带来一次 FP 和一次 FN。",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    args = parse_args()
    payload = json.loads(args.results_json.read_text(encoding="utf-8"))
    image_results = payload.get("results", [])

    per_image: list[dict[str, Any]] = []
    for item in image_results:
        best_plate_result = item.get("best_plate_result") or {}
        predicted_plate = str(best_plate_result.get("plate_text", "") or "")
        normalized_gt = normalize_plate_text(decode_plate_from_name(item["image_path"]))
        normalized_pred = normalize_plate_text(predicted_plate)
        car_detected = bool(item.get("car_detected", False))
        exact_match = car_detected and normalized_pred != "" and normalized_gt == normalized_pred
        wrong_plate = car_detected and normalized_pred != "" and normalized_gt != normalized_pred
        no_plate = car_detected and normalized_pred == ""
        no_car = not car_detected

        per_image.append(
            {
                "image_path": str(item["image_path"]),
                "ground_truth_plate": decode_plate_from_name(item["image_path"]),
                "predicted_plate": predicted_plate,
                "car_detected": car_detected,
                "plate_detected": bool(item.get("plate_detected", False)),
                "ocr_confidence": best_plate_result.get("ocr_confidence"),
                "ocr_variant": best_plate_result.get("ocr_variant"),
                "exact_match": exact_match,
                "wrong_plate": wrong_plate,
                "no_plate": no_plate,
                "no_car": no_car,
                "status": (
                    "tp"
                    if exact_match
                    else "fn_no_car"
                    if no_car
                    else "fn_no_plate"
                    if no_plate
                    else "fp_wrong_plate"
                ),
            }
        )

    image_count = len(per_image)

    car_tp = sum(1 for item in per_image if item["car_detected"])
    car_fp = 0
    car_fn = image_count - car_tp
    car_metrics = build_binary_metrics(car_tp, car_fp, car_fn, image_count)
    car_metrics.update(
        {
            "miss_count": car_fn,
            "false_positive_count": car_fp,
        }
    )

    plate_scope = [item for item in per_image if item["car_detected"]]
    plate_entered = len(plate_scope)
    plate_tp = sum(1 for item in plate_scope if item["exact_match"])
    plate_fp = sum(1 for item in plate_scope if item["wrong_plate"])
    plate_fn = plate_entered - plate_tp
    plate_metrics = build_binary_metrics(plate_tp, plate_fp, plate_fn, plate_entered)
    plate_metrics.update(
        {
            "entered_image_count": plate_entered,
            "miss_count": sum(1 for item in plate_scope if item["no_plate"]),
            "false_positive_count": plate_fp,
            "wrong_text_count": plate_fp,
            "excluded_by_car_gate": image_count - plate_entered,
        }
    )

    overall_tp = sum(1 for item in per_image if item["exact_match"])
    overall_fp = sum(1 for item in per_image if item["wrong_plate"])
    overall_fn = image_count - overall_tp
    overall_metrics = build_binary_metrics(overall_tp, overall_fp, overall_fn, image_count)
    overall_metrics.update(
        {
            "miss_count": overall_fn,
            "false_positive_count": overall_fp,
            "no_car_count": sum(1 for item in per_image if item["no_car"]),
            "no_plate_count": sum(1 for item in per_image if item["no_plate"]),
            "wrong_plate_count": overall_fp,
        }
    )

    summary = {
        "results_json": str(args.results_json),
        "image_count": image_count,
        "car_metrics": car_metrics,
        "plate_metrics": plate_metrics,
        "overall_metrics": overall_metrics,
        "per_image": per_image,
    }

    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.output_md:
        args.output_md.parent.mkdir(parents=True, exist_ok=True)
        args.output_md.write_text(build_markdown(summary), encoding="utf-8")

    print(f"Saved evaluation json to: {args.output_json}")
    if args.output_md:
        print(f"Saved evaluation markdown to: {args.output_md}")
    print(
        "Overall: "
        f"Precision={format_metric(overall_metrics['precision'])}, "
        f"Recall={format_metric(overall_metrics['recall'])}, "
        f"F1={format_metric(overall_metrics['f1'])}"
    )


if __name__ == "__main__":
    main()
