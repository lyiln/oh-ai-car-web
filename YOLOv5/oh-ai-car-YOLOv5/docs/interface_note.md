# interface_note.md

## 成员 D 当前对外输出

当前建议成员 A 调度模块接入以下字段：

- `image_path`：输入图片路径
- `bbox`：检测框坐标，格式为 `[x1, y1, x2, y2]`
- `det_confidence`：检测置信度
- `crop_path`：裁剪出的车牌小图路径
- `plate_text`：OCR 识别结果
- `ocr_confidence`：OCR 置信度
- `is_valid_plate`：是否满足中国车牌基础格式校验
- `status`：当前建议取值为 `ready_for_whitelist_compare` 或 `manual_review`

## 推荐判定规则

- 当 `ocr_confidence >= 0.75` 且 `is_valid_plate = true` 时：
  - `status = ready_for_whitelist_compare`
- 其他情况：
  - `status = manual_review`

## JSON 示例

```json
[
  {
    "image_path": "demo_input/test.jpg",
    "bbox": [154, 383, 386, 473],
    "det_confidence": 0.923451,
    "crop_path": "demo_output/plate_ocr_demo/plate_crops/test_plate_01.jpg",
    "plate_text": "粤B12345",
    "ocr_confidence": 0.962311,
    "is_valid_plate": true,
    "status": "ready_for_whitelist_compare"
  }
]
```

## 与成员 A 的接口建议

- 成员 A 的 `scheduler` 到点后向成员 D 传入图片路径或图像帧
- 成员 D 返回结构化 JSON 列表
- 成员 A 根据 `status` 决定是否进入白名单比对
- `manual_review` 记录仍需保留原图、裁剪图和识别文本，便于报告展示

## 后续预留

- 下一步可补充“连拍 3 帧取最优”策略
- 后续可增加 `task_id`、`waypoint_id`、`capture_time` 字段，直接适配巡检任务流
