import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { pixelToWorld, worldToPixel, type FloorMapMeta, type WorldPoint } from '../../lib/floormap.js';
import type { LivePose } from '../../hooks/usePoseStream.js';

export interface FloorMapDestination {
  id: string;
  displayName: string;
  x: number;
  y: number;
}

export interface FloorMapGoal {
  x: number;
  y: number;
  yaw?: number;
  status?: string;
}

export interface FloorMapInitialPose {
  x: number;
  y: number;
  yaw: number;
}

export interface FloorMapZoneOverlay {
  id: string;
  name: string;
  ring: WorldPoint[];
  active?: boolean;
}

interface Props {
  meta: FloorMapMeta;
  destinations?: FloorMapDestination[];
  pose?: LivePose | null;
  trail?: LivePose[];
  pendingPoints?: WorldPoint[];
  goal?: FloorMapGoal | null;
  initialPose?: FloorMapInitialPose | null;
  zones?: FloorMapZoneOverlay[];
  draftZone?: WorldPoint[];
  /** 标点 / 前往 / 禁停区顶点：单击 */
  clickable?: boolean;
  onMapClick?: (world: WorldPoint) => void;
  onMapDoubleClick?: (world: WorldPoint) => void;
  /** 设初始位：按下定位、拖拽朝向、松开提交（对齐 RViz 2D Pose Estimate） */
  poseEstimate?: boolean;
  onPoseEstimate?: (pose: FloorMapInitialPose) => void;
}

export function FloorMap({
  meta,
  destinations = [],
  pose = null,
  trail = [],
  pendingPoints = [],
  goal = null,
  initialPose = null,
  zones = [],
  draftZone = [],
  clickable = false,
  onMapClick,
  onMapDoubleClick,
  poseEstimate = false,
  onPoseEstimate,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [displayWidth, setDisplayWidth] = useState(0);
  const [dragPose, setDragPose] = useState<FloorMapInitialPose | null>(null);
  const dragOriginRef = useRef<WorldPoint | null>(null);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const update = () => setDisplayWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!meta.imageUrl) {
      imageRef.current = null;
      setImageReady(false);
      return undefined;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      setImageReady(true);
    };
    image.onerror = () => {
      if (cancelled) return;
      imageRef.current = null;
      setImageReady(false);
    };
    image.src = meta.imageUrl;
    return () => {
      cancelled = true;
    };
  }, [meta.imageUrl]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || displayWidth <= 0 || meta.imageWidth <= 0) return;
    const scale = displayWidth / meta.imageWidth;
    const displayHeight = meta.imageHeight * scale;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(displayWidth * dpr);
    canvas.height = Math.round(displayHeight * dpr);
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    if (imageRef.current) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(imageRef.current, 0, 0, displayWidth, displayHeight);
    } else {
      ctx.fillStyle = '#eef1fb';
      ctx.fillRect(0, 0, displayWidth, displayHeight);
    }

    const toScreen = (x: number, y: number) => {
      const { px, py } = worldToPixel(meta, x, y);
      return { sx: px * scale, sy: py * scale };
    };

    // 禁停多边形（已保存 + 正在绘制）
    const paintZone = (ring: WorldPoint[], fill: string, stroke: string, label?: string) => {
      if (ring.length < 2) return;
      ctx.beginPath();
      ring.forEach((point, index) => {
        const { sx, sy } = toScreen(point.x, point.y);
        if (index === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      if (ring.length >= 3) ctx.closePath();
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      if (ring.length >= 3) ctx.fill();
      ctx.stroke();
      if (label && ring.length > 0) {
        const cx = ring.reduce((sum, p) => sum + p.x, 0) / ring.length;
        const cy = ring.reduce((sum, p) => sum + p.y, 0) / ring.length;
        const { sx, sy } = toScreen(cx, cy);
        ctx.fillStyle = stroke;
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, sx, sy);
      }
    };
    for (const zone of zones) {
      if (zone.active === false) continue;
      paintZone(zone.ring, 'rgba(220, 38, 38, 0.18)', '#dc2626', zone.name);
    }
    if (draftZone.length) {
      paintZone(draftZone, 'rgba(234, 88, 12, 0.2)', '#ea580c', '绘制中');
      for (const point of draftZone) {
        const { sx, sy } = toScreen(point.x, point.y);
        ctx.fillStyle = '#ea580c';
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const destination of destinations) {
      const { sx, sy } = toScreen(destination.x, destination.y);
      ctx.fillStyle = '#7c3aed';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 7);
      ctx.lineTo(sx + 7, sy);
      ctx.lineTo(sx, sy + 7);
      ctx.lineTo(sx - 7, sy);
      ctx.closePath();
      ctx.fill();
    }

    if (trail.length > 1) {
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      trail.forEach((point, index) => {
        const { sx, sy } = toScreen(point.x, point.y);
        if (index === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
    }

    if (pendingPoints.length > 0) {
      ctx.strokeStyle = 'rgba(217, 119, 6, 0.9)';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      pendingPoints.forEach((point, index) => {
        const { sx, sy } = toScreen(point.x, point.y);
        if (index === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      pendingPoints.forEach((point, index) => {
        const { sx, sy } = toScreen(point.x, point.y);
        ctx.fillStyle = '#d97706';
        ctx.beginPath();
        ctx.arc(sx, sy, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(index + 1), sx, sy);
      });
    }

    // 单点前往目标（对齐 2D Goal Pose）
    if (goal) {
      const { sx, sy } = toScreen(goal.x, goal.y);
      ctx.strokeStyle = '#ea580c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - 12, sy);
      ctx.lineTo(sx + 12, sy);
      ctx.moveTo(sx, sy - 12);
      ctx.lineTo(sx, sy + 12);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.stroke();
      if (typeof goal.yaw === 'number') {
        const hx = sx + Math.cos(goal.yaw) * 18;
        const hy = sy - Math.sin(goal.yaw) * 18;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(hx, hy);
        ctx.stroke();
      }
    }

    // 网页下发的初始位姿 / 拖拽预览（对齐 2D Pose Estimate）
    const poseMarker = dragPose ?? initialPose;
    if (poseMarker) {
      const { sx, sy } = toScreen(poseMarker.x, poseMarker.y);
      const cos = Math.cos(poseMarker.yaw);
      const sin = Math.sin(poseMarker.yaw);
      const tipX = sx + cos * 22;
      const tipY = sy - sin * 22;
      ctx.strokeStyle = dragPose ? '#1d4ed8' : '#2563eb';
      ctx.fillStyle = dragPose ? 'rgba(37, 99, 235, 0.4)' : 'rgba(37, 99, 235, 0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      // 箭头头
      const ah = 8;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - cos * ah + sin * ah * 0.6, tipY + sin * ah + cos * ah * 0.6);
      ctx.lineTo(tipX - cos * ah - sin * ah * 0.6, tipY + sin * ah - cos * ah * 0.6);
      ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
      ctx.fillStyle = '#2563eb';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('初', sx, sy);
    }

    // 动态车标：三角车身 + 朝向（世界 +y 向上 → 屏幕 y 取反）
    if (pose) {
      const { sx, sy } = toScreen(pose.x, pose.y);
      const yaw = pose.yaw;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const nose = 16;
      const side = 9;
      const toLocal = (lx: number, ly: number) => ({
        x: sx + lx * cos - ly * sin,
        y: sy - (lx * sin + ly * cos),
      });
      const tip = toLocal(nose, 0);
      const left = toLocal(-side * 0.6, -side);
      const right = toLocal(-side * 0.6, side);
      ctx.fillStyle = 'rgba(220, 38, 38, 0.95)';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [meta, destinations, pose, trail, pendingPoints, goal, initialPose, dragPose, displayWidth, imageReady, zones, draftZone]);

  useEffect(() => {
    draw();
  }, [draw]);

  const eventToWorld = (event: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>): WorldPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas || meta.imageWidth <= 0) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / meta.imageWidth;
    const px = (event.clientX - rect.left) / scale;
    const py = (event.clientY - rect.top) / scale;
    return pixelToWorld(meta, px, py);
  };

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (poseEstimate) return; // 设位用拖拽，避免单击误提交
    if (!clickable || !onMapClick) return;
    const world = eventToWorld(event);
    if (world) onMapClick(world);
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (poseEstimate || !onMapDoubleClick) return;
    event.preventDefault();
    const world = eventToWorld(event);
    if (world) onMapDoubleClick(world);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!poseEstimate || !onPoseEstimate) return;
    const world = eventToWorld(event);
    if (!world) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOriginRef.current = world;
    setDragPose({ x: world.x, y: world.y, yaw: 0 });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!poseEstimate || !dragOriginRef.current) return;
    const world = eventToWorld(event);
    if (!world) return;
    const origin = dragOriginRef.current;
    const dx = world.x - origin.x;
    const dy = world.y - origin.y;
    const yaw = Math.hypot(dx, dy) < 1e-4 ? 0 : Math.atan2(dy, dx);
    setDragPose({ x: origin.x, y: origin.y, yaw });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!poseEstimate || !onPoseEstimate || !dragOriginRef.current) return;
    const origin = dragOriginRef.current;
    const world = eventToWorld(event);
    dragOriginRef.current = null;
    setDragPose(null);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    // 必须拖出朝向：单击（yaw≈0）常导致 AMCL 朝向错误 → Nav2 恢复行为原地转圈。
    if (!world) return;
    const dx = world.x - origin.x;
    const dy = world.y - origin.y;
    const dragMeters = Math.hypot(dx, dy);
    if (dragMeters < 0.25) {
      window.dispatchEvent(
        new CustomEvent('floormap-pose-estimate-rejected', {
          detail: { reason: '请按住拖出至少约 0.25m 的朝向箭头，再松开（不要只点一下）' },
        }),
      );
      return;
    }
    onPoseEstimate({ x: origin.x, y: origin.y, yaw: Math.atan2(dy, dx) });
  };

  return (
    <div ref={containerRef} className="floor-map-canvas-wrap">
      <canvas
        ref={canvasRef}
        className="floor-map-canvas"
        style={{ cursor: clickable || poseEstimate ? 'crosshair' : 'default', touchAction: poseEstimate ? 'none' : undefined }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          dragOriginRef.current = null;
          setDragPose(null);
        }}
      />
      {!meta.imageUrl && <p className="muted floor-map-empty">尚未上传楼道底图，请在下方上传 map.pgm 转出的 PNG 与 map.yaml 参数。</p>}
    </div>
  );
}
