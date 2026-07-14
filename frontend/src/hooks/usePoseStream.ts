import { useCallback, useEffect, useRef, useState } from 'react';
import type { PosePoint } from '../services/api.js';
import * as deviceClient from '../services/deviceClient.js';
import { liveUrl } from '../services/responseClient.js';

export interface LivePose {
  x: number;
  y: number;
  yaw: number;
  occurredAt: string;
}

const MAX_TRAIL = 2000;
const SEED_TRAIL = 80;

function stampMs(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// 订阅 /patrol/live 的 map 坐标位姿（frame:'map' 的 pose_update），
// 维护最新位姿与累积轨迹；初次加载时用 pose-track 回填历史轨迹。
export function usePoseStream(vehicleId: string | null | undefined): {
  pose: LivePose | null;
  trail: LivePose[];
  connected: boolean;
  clearTrail: () => void;
  seedPose: (next: Omit<LivePose, 'occurredAt'> & { occurredAt?: string }) => void;
} {
  const [pose, setPose] = useState<LivePose | null>(null);
  const [trail, setTrail] = useState<LivePose[]>([]);
  const [connected, setConnected] = useState(false);
  const trailRef = useRef<LivePose[]>([]);
  const poseRef = useRef<LivePose | null>(null);

  const applyPose = useCallback((next: LivePose, options?: { resetTrail?: boolean }) => {
    poseRef.current = next;
    setPose(next);
    if (options?.resetTrail) {
      trailRef.current = [next];
      setTrail(trailRef.current);
      return;
    }
    const nextTrail = [...trailRef.current, next].slice(-MAX_TRAIL);
    trailRef.current = nextTrail;
    setTrail(nextTrail);
  }, []);

  const clearTrail = useCallback(() => {
    trailRef.current = poseRef.current ? [poseRef.current] : [];
    setTrail(trailRef.current);
  }, []);

  const seedPose = useCallback(
    (input: Omit<LivePose, 'occurredAt'> & { occurredAt?: string }) => {
      applyPose(
        {
          x: input.x,
          y: input.y,
          yaw: input.yaw,
          occurredAt: input.occurredAt ?? new Date().toISOString(),
        },
        { resetTrail: true },
      );
    },
    [applyPose],
  );

  useEffect(() => {
    trailRef.current = [];
    poseRef.current = null;
    setTrail([]);
    setPose(null);
    setConnected(false);
    if (!vehicleId) return undefined;

    let cancelled = false;

    void deviceClient.poseTrack(vehicleId, { limit: SEED_TRAIL }).then((points: PosePoint[]) => {
      if (cancelled || !points.length) return;
      const seed = points.map((point) => ({
        x: point.x,
        y: point.y,
        yaw: point.yaw,
        occurredAt: point.occurredAt,
      }));
      trailRef.current = seed.slice(-SEED_TRAIL);
      setTrail(trailRef.current);
      const latest = seed[seed.length - 1] ?? null;
      poseRef.current = latest;
      setPose(latest);
    });

    const socket = new WebSocket(liveUrl());
    socket.addEventListener('open', () => {
      setConnected(true);
      socket.send(JSON.stringify({ type: 'subscribe', vehicleId }));
    });
    socket.addEventListener('close', () => setConnected(false));
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as {
          type?: string;
          frame?: string;
          x?: number;
          y?: number;
          yaw?: number;
          occurredAt?: string;
        };
        if (message.type !== 'pose_update' || message.frame !== 'map') return;
        if (typeof message.x !== 'number' || typeof message.y !== 'number' || typeof message.yaw !== 'number') return;
        const next: LivePose = {
          x: message.x,
          y: message.y,
          yaw: message.yaw,
          occurredAt: message.occurredAt ?? new Date().toISOString(),
        };
        const current = poseRef.current;
        if (current && stampMs(current.occurredAt) > stampMs(next.occurredAt)) return;
        applyPose(next);
      } catch {
        /* ignore non-JSON frames */
      }
    });

    // HTTP 兜底：WebSocket 丢包/代理未推送时，仍可每秒拉最新位姿。
    const poll = window.setInterval(() => {
      void deviceClient
        .poseTrack(vehicleId, { limit: 1 })
        .then((points: PosePoint[]) => {
          if (cancelled || !points.length) return;
          const point = points[points.length - 1];
          if (!point) return;
          const next: LivePose = {
            x: point.x,
            y: point.y,
            yaw: point.yaw,
            occurredAt: point.occurredAt,
          };
          const current = poseRef.current;
          if (current && stampMs(current.occurredAt) >= stampMs(next.occurredAt)) return;
          applyPose(next);
        })
        .catch(() => undefined);
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      socket.close();
    };
  }, [vehicleId, applyPose]);

  return { pose, trail, connected, clearTrail, seedPose };
}
