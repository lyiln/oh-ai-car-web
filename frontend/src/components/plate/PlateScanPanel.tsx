import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchPlateHealth,
  fetchVideoSnapshot,
  inferPlateImage,
  normalizePlateText,
} from '../../services/plateClient.js';
import type { HealthResponse, InferResponse, PlateHit } from '../../types/plateInference.js';

const DEFAULT_INTERVAL_SEC = 2;

type PlateScanPanelProps = {
  host: string;
  videoPort: number;
  disabled: boolean;
};

export function PlateScanPanel({ host, videoPort, disabled }: PlateScanPanelProps) {
  const processingRef = useRef(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<InferResponse | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [lastLatencySec, setLastLatencySec] = useState<number | null>(null);
  const [hits, setHits] = useState<PlateHit[]>([]);
  const [framesScanned, setFramesScanned] = useState(0);

  const refreshHealth = useCallback(async () => {
    try {
      const payload = await fetchPlateHealth();
      setHealth(payload);
      setHealthError(null);
    } catch (reason) {
      setHealth(null);
      setHealthError(reason instanceof Error ? reason.message : 'Plate API unavailable');
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
    const timer = window.setInterval(() => void refreshHealth(), 15_000);
    return () => window.clearInterval(timer);
  }, [refreshHealth]);

  useEffect(() => {
    if (disabled) setScanning(false);
  }, [disabled]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const runOnce = useCallback(async () => {
    if (disabled || processingRef.current) return;
    processingRef.current = true;
    setBusy(true);
    setError(null);
    const startedAt = performance.now();
    try {
      const blob = await fetchVideoSnapshot(host, videoPort);
      setPreviewUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(blob);
      });
      const result = await inferPlateImage(blob, `snapshot_${Date.now()}.jpg`);
      setLatest(result);
      setFramesScanned((count) => count + 1);
      setLastLatencySec((performance.now() - startedAt) / 1000);
      if (result.carDetected && result.plateDetected) {
        const hit: PlateHit = {
          ...result,
          id: crypto.randomUUID(),
          capturedAt: new Date().toISOString(),
        };
        setHits((prev) => [hit, ...prev].slice(0, 8));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '识别失败');
      setScanning(false);
    } finally {
      processingRef.current = false;
      setBusy(false);
    }
  }, [disabled, host, videoPort]);

  useEffect(() => {
    if (!scanning || disabled) return;
    let cancelled = false;
    let timerId: number | null = null;
    const loop = async () => {
      if (cancelled) return;
      await runOnce();
      if (cancelled) return;
      timerId = window.setTimeout(loop, DEFAULT_INTERVAL_SEC * 1000);
    };
    void loop();
    return () => {
      cancelled = true;
      if (timerId != null) window.clearTimeout(timerId);
    };
  }, [scanning, disabled, runOnce]);

  const plateText = normalizePlateText(latest?.bestPlateResult?.plate_text);
  const ocrConf = latest?.bestPlateResult?.ocr_confidence;
  const visualUrl =
    latest?.imageUrls.primaryCarVisualUrl
    ?? latest?.imageUrls.plateVisualUrl
    ?? latest?.imageUrls.uploadedImageUrl
    ?? previewUrl;

  return (
    <section className="panel plate-scan-panel">
      <div className="panel-heading">
        <h3>车牌识别</h3>
        <span className="muted">
          {health?.ok ? `YOLO 就绪 (${health.runtimeDevice ?? 'auto'})` : (healthError ?? '检测 YOLO…')}
        </span>
      </div>

      {!health?.ok && (
        <p className="notice">
          请先在本机启动 YOLO 推理服务（:8010）：
          <code>python scripts/start-plate-web-api.py</code>
        </p>
      )}

      <div className="plate-scan-actions">
        <button type="button" disabled={disabled || busy || !health?.ok} onClick={() => void runOnce()}>
          {busy ? '识别中…' : '识别当前帧'}
        </button>
        <button
          type="button"
          className={scanning ? 'danger' : 'secondary'}
          disabled={disabled || !health?.ok}
          onClick={() => setScanning((value) => !value)}
        >
          {scanning ? '停止扫描' : '开始定时扫描'}
        </button>
        <button type="button" className="secondary" onClick={() => void refreshHealth()}>
          刷新健康检查
        </button>
      </div>

      <dl className="plate-scan-metrics">
        <div><dt>已扫描</dt><dd>{framesScanned}</dd></div>
        <div><dt>命中</dt><dd>{hits.length}</dd></div>
        <div><dt>间隔</dt><dd>{DEFAULT_INTERVAL_SEC}s</dd></div>
        <div><dt>耗时</dt><dd>{lastLatencySec != null ? `${lastLatencySec.toFixed(2)}s` : '—'}</dd></div>
      </dl>

      {error && <p className="error-text">{error}</p>}

      {latest && (
        <div className="plate-scan-result">
          <p>
            <strong>车牌：</strong>
            {plateText || '未识别'}
            {ocrConf != null ? `（OCR ${(ocrConf * 100).toFixed(0)}%）` : ''}
          </p>
          <p className="muted">
            车辆 {latest.carDetected ? '✓' : '✗'} · 车牌框 {latest.plateDetected ? '✓' : '✗'} · {latest.status}
          </p>
          {visualUrl && (
            <img className="plate-scan-preview" src={visualUrl} alt="plate-infer-visual" />
          )}
        </div>
      )}

      {hits.length > 0 && (
        <div className="plate-scan-hits">
          <h4>最近命中</h4>
          <ul>
            {hits.map((hit) => (
              <li key={hit.id}>
                <span>{normalizePlateText(hit.bestPlateResult?.plate_text) || '—'}</span>
                <small>{new Date(hit.capturedAt).toLocaleTimeString()}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
