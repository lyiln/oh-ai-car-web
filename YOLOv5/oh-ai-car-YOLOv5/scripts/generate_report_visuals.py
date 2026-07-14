#!/usr/bin/env python
"""
Generate report-ready visualization images from evaluation outputs.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


PROJECT_ROOT = Path(r"C:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection")
OUTPUT_DIR = PROJECT_ROOT / "demo_output" / "report_visuals"

FONT_CANDIDATES = [
    Path(r"C:\Windows\Fonts\msyh.ttc"),
    Path(r"C:\Windows\Fonts\simhei.ttf"),
    Path(r"C:\Windows\Fonts\arial.ttf"),
]

BG = (248, 250, 252)
CARD_BG = (255, 255, 255)
TITLE = (15, 23, 42)
TEXT = (51, 65, 85)
SUBTLE = (100, 116, 139)
BLUE = (37, 99, 235)
GREEN = (22, 163, 74)
ORANGE = (234, 88, 12)
RED = (220, 38, 38)
GRAY = (203, 213, 225)


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES:
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def ensure_output_dir() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def find_annotated_image(detector_dir: Path, image_path: str) -> Path:
    candidate = detector_dir / Path(image_path).name
    if candidate.exists():
        return candidate
    raise FileNotFoundError(f"Annotated image not found for {image_path}")


def draw_text_block(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], text: str, font: ImageFont.ImageFont, fill: tuple[int, int, int], line_gap: int = 4) -> None:
    x1, y1, x2, y2 = box
    words = []
    current = ""
    max_width = x2 - x1
    for char in text:
        trial = current + char
        if draw.textlength(trial, font=font) <= max_width or not current:
            current = trial
        else:
            words.append(current)
            current = char
    if current:
        words.append(current)
    y = y1
    for line in words:
        if y > y2:
            break
        draw.text((x1, y), line, font=font, fill=fill)
        y += font.size + line_gap


def render_case_grid(
    title: str,
    subtitle: str,
    cases: list[dict[str, Any]],
    detector_dir: Path,
    output_path: Path,
    tag_text: str,
    tag_color: tuple[int, int, int],
) -> None:
    canvas_w = 1800
    header_h = 170
    cols = 3
    card_w = 540
    card_h = 470
    gap_x = 40
    gap_y = 34
    rows = math.ceil(len(cases) / cols)
    canvas_h = header_h + rows * card_h + max(0, rows - 1) * gap_y + 60

    image = Image.new("RGB", (canvas_w, canvas_h), BG)
    draw = ImageDraw.Draw(image)
    title_font = load_font(46)
    subtitle_font = load_font(24)
    tag_font = load_font(22)
    caption_font = load_font(22)
    small_font = load_font(20)

    draw.text((70, 42), title, font=title_font, fill=TITLE)
    draw.text((70, 100), subtitle, font=subtitle_font, fill=SUBTLE)
    draw.rounded_rectangle((1540, 48, 1710, 92), radius=18, fill=tag_color)
    draw.text((1578, 58), tag_text, font=tag_font, fill=(255, 255, 255))

    start_x = 70
    start_y = header_h

    for index, case in enumerate(cases):
        row = index // cols
        col = index % cols
        x = start_x + col * (card_w + gap_x)
        y = start_y + row * (card_h + gap_y)
        draw.rounded_rectangle((x, y, x + card_w, y + card_h), radius=24, fill=CARD_BG, outline=(226, 232, 240), width=2)

        annotated_path = find_annotated_image(detector_dir, case["image_path"])
        annotated = Image.open(annotated_path).convert("RGB")
        max_img_w = card_w - 36
        max_img_h = 290
        annotated.thumbnail((max_img_w, max_img_h))
        img_x = x + (card_w - annotated.width) // 2
        img_y = y + 20
        image.paste(annotated, (img_x, img_y))

        line_y = y + 330
        gt = f"GT: {case['ground_truth']}"
        pred = f"Pred: {case['prediction']}"
        status = f"Status: {case['status']}"
        conf = f"OCR conf: {float(case['ocr_confidence']):.3f} | variant: {case['ocr_variant']}"
        exact_text = "Exact: Yes" if case["exact_match"] else "Exact: No"

        draw_text_block(draw, (x + 18, line_y, x + card_w - 18, line_y + 34), gt, caption_font, TITLE)
        draw_text_block(draw, (x + 18, line_y + 36, x + card_w - 18, line_y + 70), pred, caption_font, GREEN if case["exact_match"] else ORANGE)
        draw_text_block(draw, (x + 18, line_y + 82, x + card_w - 18, line_y + 110), status, small_font, TEXT)
        draw_text_block(draw, (x + 18, line_y + 112, x + card_w - 18, line_y + 170), conf, small_font, SUBTLE)
        draw.text((x + 18, y + card_h - 42), exact_text, font=small_font, fill=GREEN if case["exact_match"] else RED)

    image.save(output_path, quality=95)


def render_metrics_dashboard(output_path: Path) -> None:
    datasets = [
        ("常规集 A", load_json(PROJECT_ROOT / "demo_output" / "eval_val40_v3" / "evaluation_summary.json")["image_level"], load_json(PROJECT_ROOT / "demo_output" / "eval_val40_v4" / "evaluation_summary.json")["image_level"]),
        ("偏难集 A", load_json(PROJECT_ROOT / "demo_output" / "eval_hard20_v3" / "evaluation_summary.json")["image_level"], load_json(PROJECT_ROOT / "demo_output" / "eval_hard20_v4" / "evaluation_summary.json")["image_level"]),
        ("常规集 B", load_json(PROJECT_ROOT / "demo_output" / "eval_val40_b_baseline_v3" / "evaluation_summary.json")["image_level"], load_json(PROJECT_ROOT / "demo_output" / "eval_val40_b_v4" / "evaluation_summary.json")["image_level"]),
        ("偏难集 B", load_json(PROJECT_ROOT / "demo_output" / "eval_hard20_b_baseline_v3" / "evaluation_summary.json")["image_level"], load_json(PROJECT_ROOT / "demo_output" / "eval_hard20_b_v4" / "evaluation_summary.json")["image_level"]),
    ]

    image = Image.new("RGB", (1800, 980), BG)
    draw = ImageDraw.Draw(image)
    title_font = load_font(48)
    subtitle_font = load_font(24)
    card_title_font = load_font(28)
    stat_font = load_font(24)
    big_font = load_font(42)

    draw.text((70, 42), "车牌识别效果总览", font=title_font, fill=TITLE)
    draw.text((70, 102), "对比基线版本与当前 v4 版本在两批常规集/偏难集上的表现", font=subtitle_font, fill=SUBTLE)

    card_w = 390
    card_h = 340
    start_x = 70
    start_y = 180
    gap_x = 34
    gap_y = 34

    for idx, (name, baseline, v4) in enumerate(datasets):
        row = idx // 2
        col = idx % 2
        x = start_x + col * (card_w + gap_x)
        y = start_y + row * (card_h + gap_y)
        draw.rounded_rectangle((x, y, x + card_w, y + card_h), radius=28, fill=CARD_BG, outline=(226, 232, 240), width=2)
        draw.text((x + 24, y + 20), name, font=card_title_font, fill=TITLE)

        chart_x = x + 28
        chart_y = y + 90
        chart_w = 220
        chart_h = 180
        draw.line((chart_x, chart_y + chart_h, chart_x + chart_w, chart_y + chart_h), fill=GRAY, width=3)
        draw.line((chart_x, chart_y, chart_x, chart_y + chart_h), fill=GRAY, width=3)

        baseline_exact = float(baseline["exact_match_ratio"])
        v4_exact = float(v4["exact_match_ratio"])
        baseline_ready = float(baseline["ready_ratio"])
        v4_ready = float(v4["ready_ratio"])

        bar_w = 52
        baseline_h = int(chart_h * baseline_exact)
        v4_h = int(chart_h * v4_exact)
        bx = chart_x + 42
        vx = chart_x + 130
        draw.rounded_rectangle((bx, chart_y + chart_h - baseline_h, bx + bar_w, chart_y + chart_h), radius=16, fill=ORANGE)
        draw.rounded_rectangle((vx, chart_y + chart_h - v4_h, vx + bar_w, chart_y + chart_h), radius=16, fill=BLUE)
        draw.text((bx - 4, chart_y + chart_h + 10), "基线", font=stat_font, fill=TEXT)
        draw.text((vx + 6, chart_y + chart_h + 10), "v4", font=stat_font, fill=TEXT)
        draw.text((bx - 2, chart_y + chart_h - baseline_h - 38), f"{baseline_exact * 100:.0f}%", font=big_font, fill=ORANGE)
        draw.text((vx - 2, chart_y + chart_h - v4_h - 38), f"{v4_exact * 100:.0f}%", font=big_font, fill=BLUE)

        stat_x = x + 275
        draw.text((stat_x, y + 100), "Ready", font=stat_font, fill=SUBTLE)
        draw.text((stat_x, y + 132), f"{baseline_ready * 100:.1f}% -> {v4_ready * 100:.1f}%", font=stat_font, fill=TITLE)
        draw.text((stat_x, y + 184), "Exact", font=stat_font, fill=SUBTLE)
        draw.text((stat_x, y + 216), f"{baseline_exact * 100:.1f}% -> {v4_exact * 100:.1f}%", font=stat_font, fill=TITLE)

    summary_x = 930
    summary_y = 180
    draw.rounded_rectangle((summary_x, summary_y, 1730, 894), radius=30, fill=CARD_BG, outline=(226, 232, 240), width=2)
    draw.text((summary_x + 30, summary_y + 28), "汇报可直接使用的结论", font=load_font(30), fill=TITLE)
    bullets = [
        "1. 当前 v4 版本在两批常规集上都达到 90% exact match。",
        "2. 偏难集也明显提升，说明优化不是只适配单一批次。",
        "3. 主要收益来自 OCR 候选聚合投票与缺省份前缀恢复。",
        "4. 仍需关注的尾部问题：I/1、O/0、省份误判、极小目标。"
    ]
    bullet_font = load_font(26)
    for idx, bullet in enumerate(bullets):
        draw_text_block(draw, (summary_x + 32, summary_y + 94 + idx * 110, 1690, summary_y + 180 + idx * 110), bullet, bullet_font, TEXT, line_gap=8)

    image.save(output_path, quality=95)


def choose_cases(summary_path: Path, detector_dir: Path, mode: str, limit: int) -> list[dict[str, Any]]:
    summary = load_json(summary_path)
    details = summary["image_level_details"]
    if mode == "success":
        cases = [item for item in details if item["exact_match"]]
        cases.sort(key=lambda item: float(item["ocr_confidence"]), reverse=True)
    elif mode == "failure":
        cases = [item for item in details if not item["exact_match"] or item["status"] != "ready_for_whitelist_compare"]
        cases.sort(key=lambda item: (item["status"] == "ready_for_whitelist_compare", float(item["ocr_confidence"])))
    else:
        raise ValueError(f"Unknown mode: {mode}")
    return cases[:limit]


def build_failure_cases() -> list[dict[str, Any]]:
    configs = [
        (PROJECT_ROOT / "demo_output" / "eval_val40_b_v4" / "evaluation_summary.json", "常规集 B"),
        (PROJECT_ROOT / "demo_output" / "eval_hard20_b_v4" / "evaluation_summary.json", "偏难集 B"),
        (PROJECT_ROOT / "demo_output" / "eval_val40_v4" / "evaluation_summary.json", "常规集 A"),
        (PROJECT_ROOT / "demo_output" / "eval_hard20_v4" / "evaluation_summary.json", "偏难集 A"),
    ]
    cases: list[dict[str, Any]] = []
    for summary_path, tag in configs:
        summary = load_json(summary_path)
        for item in summary["image_level_details"]:
            if not item["exact_match"] or item["status"] != "ready_for_whitelist_compare":
                enriched = dict(item)
                enriched["dataset_tag"] = tag
                cases.append(enriched)
    cases.sort(key=lambda item: (item["status"] == "ready_for_whitelist_compare", float(item["ocr_confidence"])))
    return cases[:6]


def render_failure_grid(output_path: Path) -> None:
    cases = build_failure_cases()
    image = Image.new("RGB", (1800, 980), BG)
    draw = ImageDraw.Draw(image)
    title_font = load_font(46)
    subtitle_font = load_font(24)
    caption_font = load_font(22)
    small_font = load_font(20)

    draw.text((70, 42), "失败案例分析墙", font=title_font, fill=TITLE)
    draw.text((70, 102), "用于汇报时说明当前剩余问题主要集中在哪些字符和场景", font=subtitle_font, fill=SUBTLE)

    cols = 3
    card_w = 540
    card_h = 370
    gap_x = 40
    gap_y = 34
    start_x = 70
    start_y = 170

    detector_map = {
        "常规集 A": PROJECT_ROOT / "demo_output" / "eval_val40_v4" / "detector",
        "偏难集 A": PROJECT_ROOT / "demo_output" / "eval_hard20_v4" / "detector",
        "常规集 B": PROJECT_ROOT / "demo_output" / "eval_val40_b_v4" / "detector",
        "偏难集 B": PROJECT_ROOT / "demo_output" / "eval_hard20_b_v4" / "detector",
    }

    for index, case in enumerate(cases):
        row = index // cols
        col = index % cols
        x = start_x + col * (card_w + gap_x)
        y = start_y + row * (card_h + gap_y)
        draw.rounded_rectangle((x, y, x + card_w, y + card_h), radius=24, fill=CARD_BG, outline=(226, 232, 240), width=2)
        detector_dir = detector_map[case["dataset_tag"]]
        annotated = Image.open(find_annotated_image(detector_dir, case["image_path"])).convert("RGB")
        annotated.thumbnail((card_w - 36, 215))
        image.paste(annotated, (x + (card_w - annotated.width) // 2, y + 18))

        draw.rounded_rectangle((x + 18, y + 244, x + 160, y + 280), radius=16, fill=RED if case["status"] == "manual_review" else ORANGE)
        draw.text((x + 34, y + 252), case["dataset_tag"], font=small_font, fill=(255, 255, 255))
        draw_text_block(draw, (x + 18, y + 292, x + card_w - 18, y + 320), f"GT: {case['ground_truth']}", caption_font, TITLE)
        draw_text_block(draw, (x + 18, y + 324, x + card_w - 18, y + 352), f"Pred: {case['prediction']}", caption_font, RED)

    image.save(output_path, quality=95)


def main() -> None:
    ensure_output_dir()

    render_metrics_dashboard(OUTPUT_DIR / "report_metrics_dashboard.png")

    regular_cases = choose_cases(
        PROJECT_ROOT / "demo_output" / "eval_val40_b_v4" / "evaluation_summary.json",
        PROJECT_ROOT / "demo_output" / "eval_val40_b_v4" / "detector",
        mode="success",
        limit=6,
    )
    render_case_grid(
        title="常规集可视化样例墙",
        subtitle="新常规批次 val40_b 中的代表性成功样例，可直接用于 PPT 展示检测+识别效果",
        cases=regular_cases,
        detector_dir=PROJECT_ROOT / "demo_output" / "eval_val40_b_v4" / "detector",
        output_path=OUTPUT_DIR / "report_regular_showcase.png",
        tag_text="常规集",
        tag_color=BLUE,
    )

    hard_cases = choose_cases(
        PROJECT_ROOT / "demo_output" / "eval_hard20_b_v4" / "evaluation_summary.json",
        PROJECT_ROOT / "demo_output" / "eval_hard20_b_v4" / "detector",
        mode="success",
        limit=6,
    )
    render_case_grid(
        title="偏难集可视化样例墙",
        subtitle="新偏难批次 hard20_b 中的代表性成功样例，适合展示模型在斜牌/小目标上的表现",
        cases=hard_cases,
        detector_dir=PROJECT_ROOT / "demo_output" / "eval_hard20_b_v4" / "detector",
        output_path=OUTPUT_DIR / "report_hard_showcase.png",
        tag_text="偏难集",
        tag_color=ORANGE,
    )

    render_failure_grid(OUTPUT_DIR / "report_failure_cases.png")

    manifest = {
        "generated_files": [
            "report_metrics_dashboard.png",
            "report_regular_showcase.png",
            "report_hard_showcase.png",
            "report_failure_cases.png",
        ]
    }
    (OUTPUT_DIR / "report_visual_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Report visuals generated in: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
