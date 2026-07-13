# dataset_note.md

## 数据集选择

- 主数据集：`CCPD2019`
- 第一轮使用子集：`CCPD-Base`
- 当前任务类别：`plate`

## CCPD 文件名规则速记

CCPD 文件名通常包含多个 `-` 分段，其中第 3 段是检测框坐标：

```text
...-左上角x&y_右下角x&y-...
```

示例：

```text
025-95_113-154&383_386&473-...
```

其中：

- `154&383` 是左上角
- `386&473` 是右下角

## 当前抽样记录

- 原始图片目录：
- 训练样本数量：
- 验证样本数量：
- 随机种子：
- 是否发现损坏图片：
- 抽样清单文件：`split_summary.json`
- 错误日志文件：`conversion_errors.txt`

## 标签格式

YOLO 标签格式：

```text
class_id x_center y_center width height
```

本项目只有一个类别，因此 `class_id` 固定为 `0`。

## 推荐执行命令

```powershell
& "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\scripts\powershell\prepare_ccpd_small.ps1"
```
