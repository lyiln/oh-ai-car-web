// 室内 SLAM 栅格地图坐标变换。
//
// SLAM 地图（map.pgm + map.yaml）使用局部米制坐标系，与栅格图片的像素坐标
// 通过 map.yaml 的 resolution（米/像素）与 origin（地图左下角在世界坐标中的位置）
// 建立关系。图片像素原点在左上角、y 轴向下，而世界 y 轴向上，因此需要翻转。

export interface FloorMapMeta {
  name?: string;
  mapVersion: string;
  /** 米 / 像素 */
  resolution: number;
  /** 地图原点（图片左下角）在世界坐标中的 x（米） */
  originX: number;
  /** 地图原点（图片左下角）在世界坐标中的 y（米） */
  originY: number;
  /** 地图原点朝向（弧度），当前渲染未使用，保留以对齐 Nav2 */
  originYaw?: number;
  imageWidth: number;
  imageHeight: number;
  imageUrl: string | null;
}

export interface WorldPoint {
  x: number;
  y: number;
}

export interface PixelPoint {
  px: number;
  py: number;
}

export function hasBasemap(meta: FloorMapMeta | null | undefined): meta is FloorMapMeta {
  return Boolean(
    meta &&
      meta.imageUrl &&
      Number.isFinite(meta.resolution) &&
      meta.resolution > 0 &&
      meta.imageWidth > 0 &&
      meta.imageHeight > 0,
  );
}

/** 世界坐标（米）转图片像素坐标（左上角为原点，y 向下）。 */
export function worldToPixel(meta: FloorMapMeta, x: number, y: number): PixelPoint {
  const px = (x - meta.originX) / meta.resolution;
  const py = meta.imageHeight - (y - meta.originY) / meta.resolution;
  return { px, py };
}

/** 图片像素坐标转世界坐标（米）。 */
export function pixelToWorld(meta: FloorMapMeta, px: number, py: number): WorldPoint {
  const x = px * meta.resolution + meta.originX;
  const y = (meta.imageHeight - py) * meta.resolution + meta.originY;
  return { x, y };
}

/** 计算把整幅底图放进给定容器宽度时的显示缩放比例（像素 -> 屏幕）。 */
export function fitScale(meta: FloorMapMeta, containerWidth: number): number {
  if (!meta.imageWidth) return 1;
  return containerWidth / meta.imageWidth;
}
