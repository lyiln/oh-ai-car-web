#!/usr/bin/env python
"""
Evaluate vehicle gate predictions against a small binary has-car ground truth set.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate car gate precision/recall/F1 on a small labeled set.")
    parser.add_argument("--ground-truth", type=Path, required=True, help="CSV file with image_path and has_car columns.")
    parser.add_argument(
        "--prediction-json",
        type=Path,
        required=True,
        help="Combined car_plate_results.json produced by car_plate_pipeline.py.",
    )
    parser.add_argument("--output-json", type=Path, required=True, help="Where to save the metrics JSON.")
    parser.add_argument("--output-md", type=Path, help="Optional markdown summary output.")
    return parser.parse_args()


def load_ground_truth(csv_path: Path) -> list[dict[str, Any]]:
    with csv_path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        rows = []
        for row in reader:
            rows.append(
                {
                    "image_path": row["image_path"],
                    "has_car": row["has_car"].strip() in {"1", "true", "True", "yes", "YES"},
                    "label_note": row.get("label_note", ""),
                }
            )
    return rows


def load_predictions(json_path: Path) -> dict[str, bool]:
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and "results" in payload:
        results = payload.get("results", [])
        return {str(item["image_path"]): bool(item.get("car_detected", False)) for item in results}

    if isinstance(payload, list):
        prediction_map: dict[str, bool] = {}
        for item in payload:
            image_path = str(item["image_path"])
            prediction_map[image_path] = True
        return prediction_map

    raise ValueError(f"Unsupported prediction json format: {json_path}")


def safe_divide(numerator: float, denominator: float) -> float | None:
    if denominator == 0:
        return None
    return numerator / denominator


def build_markdown(metrics: dict[str, Any]) -> str:
    precision = metrics["precision"]
    recall = metrics["recall"]
    f1 = metrics["f1"]

    def fmt(value: float | None) -> str:
        if value is None:
            return "N/A"
        return f"{value:.4f}"

    lines = [
        "# car_eval_small_report",
        "",
        "## Summary",
        "",
        f"- image_count: `{metrics['image_count']}`",
        f"- positive_count: `{metrics['positive_count']}`",
        f"- negative_count: `{metrics['negative_count']}`",
        f"- TP: `{metrics['tp']}`",
        f"- TN: `{metrics['tn']}`",
        f"- FP: `{metrics['fp']}`",
        f"- FN: `{metrics['fn']}`",
        f"- Accuracy: `{fmt(metrics['accuracy'])}`",
        f"- Precision: `{fmt(precision)}`",
        f"- Recall: `{fmt(recall)}`",
        f"- F1: `{fmt(f1)}`",
        "",
        "## Error Lists",
        "",
        f"- false_negatives: `{len(metrics['false_negatives'])}`",
        f"- false_positives: `{len(metrics['false_positives'])}`",
        "",
        "## Notes",
        "",
        f"- {metrics['note']}",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    args = parse_args()
    ground_truth_rows = load_ground_truth(args.ground_truth)
    prediction_map = load_predictions(args.prediction_json)

    tp = tn = fp = fn = 0
    false_negatives: list[str] = []
    false_positives: list[str] = []
    per_image: list[dict[str, Any]] = []

    for row in ground_truth_rows:
        image_path = row["image_path"]
        gt_has_car = bool(row["has_car"])
        pred_has_car = bool(prediction_map.get(image_path, False))

        if gt_has_car and pred_has_car:
            tp += 1
        elif gt_has_car and not pred_has_car:
            fn += 1
            false_negatives.append(image_path)
        elif not gt_has_car and pred_has_car:
            fp += 1
            false_positives.append(image_path)
        else:
            tn += 1

        per_image.append(
            {
                "image_path": image_path,
                "ground_truth_has_car": gt_has_car,
                "predicted_has_car": pred_has_car,
                "label_note": row["label_note"],
                "status": (
                    "tp"
                    if gt_has_car and pred_has_car
                    else "fn"
                    if gt_has_car
                    else "fp"
                    if pred_has_car
                    else "tn"
                ),
            }
        )

    precision = safe_divide(tp, tp + fp)
    recall = safe_divide(tp, tp + fn)
    f1 = None if precision is None or recall is None or (precision + recall) == 0 else 2 * precision * recall / (precision + recall)
    accuracy = safe_divide(tp + tn, len(ground_truth_rows))

    positive_count = sum(1 for row in ground_truth_rows if row["has_car"])
    negative_count = len(ground_truth_rows) - positive_count
    note = (
        "This mini set contains only positive samples from CCPD-style plate images, "
        "so precision is not yet stress-tested by no-car negatives."
        if negative_count == 0
        else "This mini set contains both positive and negative samples. Negative samples are plate-crop images and are suitable for quick gate testing, but they are still easier than real road no-car frames."
    )

    metrics = {
        "ground_truth_file": str(args.ground_truth),
        "prediction_json": str(args.prediction_json),
        "image_count": len(ground_truth_rows),
        "positive_count": positive_count,
        "negative_count": negative_count,
        "tp": tp,
        "tn": tn,
        "fp": fp,
        "fn": fn,
        "accuracy": accuracy,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "false_negatives": false_negatives,
        "false_positives": false_positives,
        "per_image": per_image,
        "note": note,
    }

    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.output_md:
        args.output_md.parent.mkdir(parents=True, exist_ok=True)
        args.output_md.write_text(build_markdown(metrics), encoding="utf-8")

    print(f"Saved metrics json to: {args.output_json}")
    if args.output_md:
        print(f"Saved markdown summary to: {args.output_md}")
    print(f"TP={tp}, TN={tn}, FP={fp}, FN={fn}")
    print(f"Accuracy={accuracy if accuracy is not None else 'N/A'}")
    print(f"Precision={precision if precision is not None else 'N/A'}")
    print(f"Recall={recall if recall is not None else 'N/A'}")
    print(f"F1={f1 if f1 is not None else 'N/A'}")


if __name__ == "__main__":
    main()
