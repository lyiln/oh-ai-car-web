# 当前模型可视化结果与分析

## 结果位置

- 检测结果图目录：`demo_output/plate_ocr_demo/detector`
- 车牌裁剪图目录：`demo_output/plate_ocr_demo/plate_crops`
- 检测 + OCR 结构化结果：`demo_output/plate_ocr_demo/pipeline_results.json`
- 检测 + OCR 表格结果：`demo_output/plate_ocr_demo/pipeline_results.csv`

## 当前批次结果概况

- 输入图片数：`10`
- 检测框数：`10`
- 可进入白名单比对：`4`
- 待人工复核：`6`

## 可展示的成功样例

### 样例 1

- 结果图：[007270...jpg](file:///c:/Users/jfkyx/Desktop/YOLOv5/member_d_plate_detection/demo_output/plate_ocr_demo/detector/00727011494253-90_89-267&449_418&503-408&494_277&496_276&452_407&450-0_0_19_29_33_26_30-112-25.jpg)
- 裁剪图：[007270..._plate_01.jpg](file:///c:/Users/jfkyx/Desktop/YOLOv5/member_d_plate_detection/demo_output/plate_ocr_demo/plate_crops/00727011494253-90_89-267&449_418&503-408&494_277&496_276&452_407&450-0_0_19_29_33_26_30-112-25_plate_01.jpg)
- 识别结果：`皖A·V5926`
- 检测置信度：`0.827987`
- OCR 置信度：`0.988269`
- 状态：`ready_for_whitelist_compare`

### 样例 2

- 结果图：[012056...jpg](file:///c:/Users/jfkyx/Desktop/YOLOv5/member_d_plate_detection/demo_output/plate_ocr_demo/detector/0120569923372-90_92-247&422_451&483-444&473_255&475_256&425_445&422-0_0_13_22_26_26_26-91-41.jpg)
- 裁剪图：[012056..._plate_01.jpg](file:///c:/Users/jfkyx/Desktop/YOLOv5/member_d_plate_detection/demo_output/plate_ocr_demo/plate_crops/0120569923372-90_92-247&422_451&483-444&473_255&475_256&425_445&422-0_0_13_22_26_26_26-91-41_plate_01.jpg)
- 识别结果：`皖A·PY227`
- 检测置信度：`0.902488`
- OCR 置信度：`0.935967`
- 状态：`ready_for_whitelist_compare`

### 样例 3

- 结果图：[012212...jpg](file:///c:/Users/jfkyx/Desktop/YOLOv5/member_d_plate_detection/demo_output/plate_ocr_demo/detector/0122126436781-90_91-241&457_457&525-450&509_248&509_249&459_452&459-0_0_32_20_27_26_32-89-28.jpg)
- 裁剪图：[012212..._plate_01.jpg](file:///c:/Users/jfkyx/Desktop/YOLOv5/member_d_plate_detection/demo_output/plate_ocr_demo/plate_crops/0122126436781-90_91-241&457_457&525-450&509_248&509_249&459_452&459-0_0_32_20_27_26_32-89-28_plate_01.jpg)
- 识别结果：`皖A·8W328`
- 检测置信度：`0.915429`
- OCR 置信度：`0.998429`
- 状态：`ready_for_whitelist_compare`

### 样例 4

- 结果图：[012625...jpg](file:///c:/Users/jfkyx/Desktop/YOLOv5/member_d_plate_detection/demo_output/plate_ocr_demo/detector/0126257183908-90_86-271&567_481&634-462&633_279&630_277&576_459&579-0_0_16_19_24_25_24-158-33.jpg)
- 裁剪图：[012625..._plate_01.jpg](file:///c:/Users/jfkyx/Desktop/YOLOv5/member_d_plate_detection/demo_output/plate_ocr_demo/plate_crops/0126257183908-90_86-271&567_481&634-462&633_279&630_277&576_459&579-0_0_16_19_24_25_24-158-33_plate_01.jpg)
- 识别结果：`皖A·SVOIC`
- 检测置信度：`0.913087`
- OCR 置信度：`0.916765`
- 状态：`ready_for_whitelist_compare`
- 说明：格式校验已通过，但字符内容疑似仍有误读，适合作为“可过阈值但仍需业务复核”的边界样例

## 待人工复核样例

### 样例 1

- 结果图：[009228...jpg](file:///c:/Users/jfkyx/Desktop/YOLOv5/member_d_plate_detection/demo_output/plate_ocr_demo/detector/00922892720307-90_82-254&388_438&459-420&448_262&449_256&402_414&402-0_0_3_25_6_32_30-160-25.jpg)
- 裁剪图：[009228..._plate_01.jpg](file:///c:/Users/jfkyx/Desktop/YOLOv5/member_d_plate_detection/demo_output/plate_ocr_demo/plate_crops/00922892720307-90_82-254&388_438&459-420&448_262&449_256&402_414&402-0_0_3_25_6_32_30-160-25_plate_01.jpg)
- 识别结果：`A·D1G86`
- 状态：`manual_review`
- 说明：省份汉字未识别出来，说明 OCR 对左侧首字符较敏感

### 样例 2

- 结果图：[010371...jpg](file:///c:/Users/jfkyx/Desktop/YOLOv5/member_d_plate_detection/demo_output/plate_ocr_demo/detector/0103711685824-90_87-283&525_442&599-436&587_296&586_294&526_434&527-0_0_8_31_27_30_24-88-14.jpg)
- 裁剪图：[010371..._plate_01.jpg](file:///c:/Users/jfkyx/Desktop/YOLOv5/member_d_plate_detection/demo_output/plate_ocr_demo/plate_crops/0103711685824-90_87-283&525_442&599-436&587_296&586_294&526_434&527-0_0_8_31_27_30_24-88-14_plate_01.jpg)
- 识别结果：`AJ7360`
- 状态：`manual_review`
- 说明：车牌存在倾斜和透视变化，OCR 丢失前缀字符

### 样例 3

- 结果图：[012352...jpg](file:///c:/Users/jfkyx/Desktop/YOLOv5/member_d_plate_detection/demo_output/plate_ocr_demo/detector/012352729885-90_84-332&321_527&399-521&386_345&384_340&329_517&331-0_0_12_12_25_25_30-79-24.jpg)
- 裁剪图：[012352..._plate_01.jpg](file:///c:/Users/jfkyx/Desktop/YOLOv5/member_d_plate_detection/demo_output/plate_ocr_demo/plate_crops/012352729885-90_84-332&321_527&399-521&386_345&384_340&329_517&331-0_0_12_12_25_25_30-79-24_plate_01.jpg)
- 识别结果：`ANNI`
- 状态：`manual_review`
- 说明：该样例字符损失较多，说明远距离/小目标对 OCR 影响仍然明显

## 当前模型表现分析

### 1. 检测模块表现

- 本批 `10/10` 图片都成功框出车牌
- 当前 `YOLOv5 + CCPD` 的单类别车牌检测已经达到“可展示、可继续联调”的状态
- 从结果图看，框位置总体稳定，没有明显的大偏框和漏框

### 2. OCR 模块表现

- 当前 `PaddleOCR` 已成功接入，说明链路层面已经打通
- 在 `10` 条结果中，有 `4` 条可以直接进入后续白名单比对
- 剩余 `6` 条多数不是“完全识别失败”，而是“接近正确，但缺失省份汉字或前缀字符”

### 3. 主要误差来源

- 车牌左侧汉字区域较小，容易漏掉
- 斜牌、远牌、小牌对 OCR 影响明显
- 当前直接对检测框裁剪后 OCR，尚未做透视矫正和多帧择优

### 4. 对答辩最适合的表述

- 可以明确说：当前阶段已完成 `车牌检测 -> 车牌裁剪 -> OCR 识别 -> 结构化结果输出` 的最小闭环
- 可以明确说：检测模块稳定，OCR 已具备可用性，但在斜牌、小目标和前缀字符识别上仍需继续优化
- 可以明确说：下一步将通过“连拍 3 帧取最优 + 车牌透视矫正 + 接入成员 A 调度接口”继续提升可用性
