# 成员 D 下一步执行清单

## 一句话定位

成员 D 当前的核心任务，不再是继续扩展训练分支，而是把已经完成的车牌检测能力，推进成可演示、可对接的 `检测 -> OCR -> 结果输出` 最小闭环。

## 结合中期答辩与项目文档后的任务收束

当前最重要的 4 件事：

1. 保住已经完成的检测能力  
   - 已完成 `YOLOv5 + CCPD` 单类别车牌检测训练与验证
   - 已有正式权重 `weights/best_plate_detector.pt`

2. 接入 `PaddleOCR`，完成 `plate_recognizer`  
   - 目标：单张车牌小图可输出车牌文本、置信度、格式校验结果

3. 打通 `检测 -> OCR -> JSON/CSV 输出`  
   - 目标：输入图片后，输出检测框、车牌文本、置信度、结果图、结构化结果

4. 与成员 A 对齐接口  
   - 目标：明确字段、置信度门槛、人工复核条件

## 建议优先级

### P0：本轮必须完成

- [x] 车牌检测模型训练完成
- [x] 首批 GPU 检测结果图产出
- [x] 安装 `PaddleOCR`
- [x] 新建 `scripts/plate_recognizer.py`
- [x] 新建 `scripts/plate_pipeline.py`
- [x] 补充 `docs/interface_note.md`

### P1：下一步紧接着做

- [ ] 用真实样例跑通 OCR，筛出成功样例和失败样例
- [ ] 补一版 `plate_detector_usage.md` 的 OCR 使用方式
- [ ] 形成“成员 A 可直接调用”的输入输出示例
- [ ] 设计并验证“连拍 3 帧取最优”的择优规则

### P2：具备实车条件后再做

- [ ] Astra RGB 图像采集
- [ ] ROS2 节点化封装
- [ ] 接入 `scheduler` 到点触发
- [ ] 与白名单、报告模块联调

## 当前已落地脚本

- 检测脚本：`scripts/plate_detector.py`
- OCR 脚本：`scripts/plate_recognizer.py`
- 串联脚本：`scripts/plate_pipeline.py`
- 一键入口：`scripts/powershell/run_plate_pipeline.ps1`

## 当前阶段验收口径

只要我们能稳定展示下面这条链路，成员 D 在答辩里的工作就算成型：

`输入图片 -> 输出车牌框 -> 裁剪车牌 -> OCR 识别文本 -> 输出 JSON/CSV -> 说明后续可接成员 A`
