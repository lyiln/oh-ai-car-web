# download_reference.md

## 推荐主仓库

- YOLOv5 主框架：`https://github.com/ultralytics/yolov5`
- CCPD 官方仓库：`https://github.com/detectRecog/CCPD`
- LPDet 参考仓库：`https://github.com/zjykzj/LPDet`
- BDD100K 官方数据入口：`https://bdd-data.berkeley.edu/`
- BDD100K 数据格式说明：`https://github.com/ucbdrive/bdd100k/blob/master/doc/format.md`
- UA-DETRAC 官方入口：`https://detrac-db.rit.albany.edu/Detection`

## 当前确认到的信息

- `CCPD` 官方仓库 README 说明：2019 版更新后数据量超过 30 万张，`CCPD-Base` 用于训练和验证，划分文件在 `split/` 目录下。
- `LPDet` 仓库说明：其实现基于 `ultralytics/yolov5 v7.0`，并提供了 `ccpd2yolo.py` 作为参考转换思路。
- `BDD100K` 当前更适合作为车辆检测的大型主数据集，至少需要下载：
  - `100K Images`
  - `Detection 2020 Labels`
- `BDD100K` 的检测标注是 `box2d` JSON 格式，当前仓库已新增 `scripts/bdd100k_to_yolo_vehicle.py` 用于转换为 YOLO 标签。
- `UA-DETRAC` 更适合作为固定监控视角的车辆数据补充集，不作为当前第一主线。

## BDD100K 建议放置位置

```text
c:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\datasets\bdd100k
```

目标目录结构建议为：

```text
bdd100k/
├─ images/
│  └─ 100k/
│     ├─ train/
│     └─ val/
└─ labels/
   └─ det_20/
      ├─ det_train.json
      └─ det_val.json
```

## Windows 下建议下载顺序

1. 先下载或获取 `ultralytics/yolov5`
2. 再下载 `CCPD2019`
3. 第一轮只准备 `CCPD-Base`
4. 将 `CCPD-Base` 放到：

```text
c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\datasets\CCPD-Base
```

## 网络不稳定时的建议

- 如果 `git clone` 失败，优先改用浏览器打开仓库页面后下载 zip。
- 解压后请将文件夹重命名为：

```text
yolov5
```

- 最终放置到：

```text
c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\yolov5
```

## CCPD 官方 README 里提到的下载入口

- `CCPD2019`：Google Drive / 百度网盘
- `CCPD-Green`：Google Drive / 百度网盘

如果你在大陆网络下操作，通常优先尝试百度网盘入口更稳。

## 大型车辆数据集下一步入口

下载完 `BDD100K` 后，建议直接运行：

```powershell
& "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\scripts\powershell\prepare_bdd100k_vehicle.ps1"
```

再启动训练：

```powershell
& "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\scripts\powershell\train_car_detector_bdd100k.ps1"
```
