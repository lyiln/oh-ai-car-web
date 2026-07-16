import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchPlateHealth,
  fetchVideoSnapshot,
  inferCarGate,
  inferPlateImage,
  inferPlateOnlyImage,
  inferPlateVideo,
  normalizePlateText,
} from '../../services/plateClient.js';
import * as opsClient from '../../services/opsClient.js';
import * as mapClient from '../../services/mapClient.js';
import type {
  HealthResponse,
  InferResponse,
  PlateHit,
  VideoInferResponse,
  VideoMatchedFrame,
} from '../../types/plateInference.js';

const DEFAULT_INTERVAL_SEC = 2;
const DEFAULT_VIDEO_SAMPLE_FPS = 1;
const DEFAULT_VIDEO_MAX_FRAMES = 20;

type PlateScanPanelProps = {
  host: string;
  videoPort: number;
  vehicleId?: string | null;
  disabled: boolean;
};

type PlatePanelTab = 'live' | 'carVideo' | 'image' | 'video' | 'camera';

type CameraHit = PlateHit & {
  frameNumber: number;
};

const TAB_LABELS: Record<PlatePanelTab, string> = {
  live: '实时快照',
  carVideo: '小车视频',
  image: '本地图片',
  video: '本地视频',
  camera: '浏览器摄像头',
};

export function PlateScanPanel({ host, videoPort, vehicleId = null, disabled }: PlateScanPanelProps) {
  const processingRef = useRef(false);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraProcessingRef = useRef(false);
  const displayVideoRef = useRef<HTMLVideoElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const autoSubmittedRef = useRef(new Map<string, number>());

  const [tab, setTab] = useState<PlatePanelTab>('live');
  const manualSubmission = tab === 'image' || tab === 'video';
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
  const [activeLiveHitId, setActiveLiveHitId] = useState<string | null>(null);
  const [displayReady, setDisplayReady] = useState(false);
  const [displayStarting, setDisplayStarting] = useState(false);
  const [displayStatus, setDisplayStatus] = useState('未启用屏幕捕获回退');
  const [displayScanning, setDisplayScanning] = useState(false);
  const [displayBusy, setDisplayBusy] = useState(false);
  const [displayError, setDisplayError] = useState<string | null>(null);
  const [displayLatest, setDisplayLatest] = useState<InferResponse | null>(null);
  const [displayFrameUrl, setDisplayFrameUrl] = useState<string | null>(null);
  const [displayFramesScanned, setDisplayFramesScanned] = useState(0);
  const [displayLastLatencySec, setDisplayLastLatencySec] = useState<number | null>(null);
  const [displayHits, setDisplayHits] = useState<CameraHit[]>([]);
  const [activeDisplayHitId, setActiveDisplayHitId] = useState<string | null>(null);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageResult, setImageResult] = useState<InferResponse | null>(null);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoLocalUrl, setVideoLocalUrl] = useState<string | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoResult, setVideoResult] = useState<VideoInferResponse | null>(null);
  const [videoSampleFps, setVideoSampleFps] = useState(DEFAULT_VIDEO_SAMPLE_FPS);
  const [videoMaxFrames, setVideoMaxFrames] = useState(DEFAULT_VIDEO_MAX_FRAMES);
  const [activeVideoFrameKey, setActiveVideoFrameKey] = useState<string | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraScanning, setCameraScanning] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraStatus, setCameraStatus] = useState('摄像头未开启');
  const [cameraLatest, setCameraLatest] = useState<InferResponse | null>(null);
  const [cameraFrameUrl, setCameraFrameUrl] = useState<string | null>(null);
  const [cameraFramesScanned, setCameraFramesScanned] = useState(0);
  const [cameraVehicleFrames, setCameraVehicleFrames] = useState(0);
  const [cameraLastLatencySec, setCameraLastLatencySec] = useState<number | null>(null);
  const [cameraHits, setCameraHits] = useState<CameraHit[]>([]);
  const [activeCameraHitId, setActiveCameraHitId] = useState<string | null>(null);

  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState<{
    id: string;
    plate: string;
    evidenceUrl?: string | null;
    eventId?: string;
    noParkingLabel?: string;
  } | null>(null);
  const [noParkingHint, setNoParkingHint] = useState<string>('位姿未刷新');

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
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
      if (videoLocalUrl) URL.revokeObjectURL(videoLocalUrl);
      if (cameraFrameUrl) URL.revokeObjectURL(cameraFrameUrl);
      if (displayFrameUrl) URL.revokeObjectURL(displayFrameUrl);
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      displayStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [previewUrl, imagePreviewUrl, videoLocalUrl, cameraFrameUrl, displayFrameUrl]);

  const activeLiveHit = useMemo(
    () => hits.find((item) => item.id === activeLiveHitId) ?? hits[0] ?? null,
    [activeLiveHitId, hits],
  );
  const activeCameraHit = useMemo(
    () => cameraHits.find((item) => item.id === activeCameraHitId) ?? cameraHits[0] ?? null,
    [activeCameraHitId, cameraHits],
  );
  const activeDisplayHit = useMemo(
    () => displayHits.find((item) => item.id === activeDisplayHitId) ?? displayHits[0] ?? null,
    [activeDisplayHitId, displayHits],
  );
  const activeVideoFrame = useMemo<VideoMatchedFrame | null>(() => {
    if (!videoResult?.matchedFrames.length) return null;
    return (
      videoResult.matchedFrames.find(
        (frame) => `${frame.sampleIndex}-${frame.frameIndex}` === activeVideoFrameKey,
      ) ?? videoResult.matchedFrames[0]
    );
  }, [activeVideoFrameKey, videoResult]);

  useEffect(() => {
    if (!vehicleId) {
      setNoParkingHint('未选车');
      return undefined;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const check = await mapClient.checkFloorNoParking(vehicleId);
        if (cancelled) return;
        if (!check.pose) {
          setNoParkingHint('无近 10s 位姿（请先跑 pose 代理）');
          return;
        }
        const poseText = `x=${check.pose.x.toFixed(2)} y=${check.pose.y.toFixed(2)}`;
        if (check.inNoParking) {
          setNoParkingHint(`禁停区：是（${check.zone?.name ?? '未命名'}）· ${poseText}`);
        } else {
          setNoParkingHint(`禁停区：否 · ${poseText}`);
        }
      } catch {
        if (!cancelled) setNoParkingHint('禁停判定暂不可用');
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [vehicleId]);

  const violationCandidate = useMemo(() => {
    if (tab === 'live') {
      const result = activeLiveHit ?? latest;
      const plate = normalizePlateText(result?.bestPlateResult?.plate_text);
      if (!result || !plate) return null;
      return {
        plate,
        confidence: result.bestPlateResult?.ocr_confidence ?? null,
        imageUrl: pickEvidenceImageUrl(result, previewUrl),
      };
    }
    if (tab === 'image') {
      const plate = normalizePlateText(imageResult?.bestPlateResult?.plate_text);
      if (!imageResult || !plate) return null;
      return {
        plate,
        confidence: imageResult.bestPlateResult?.ocr_confidence ?? null,
        imageUrl: pickEvidenceImageUrl(imageResult, imagePreviewUrl),
      };
    }
    if (tab === 'video') {
      const plate = normalizePlateText(activeVideoFrame?.bestPlateResult?.plate_text);
      if (!activeVideoFrame || !plate) return null;
      return {
        plate,
        confidence: activeVideoFrame.bestPlateResult?.ocr_confidence ?? null,
        imageUrl: pickEvidenceImageUrl(activeVideoFrame, null),
      };
    }
    if (tab === 'carVideo') {
      const result = activeDisplayHit ?? displayLatest;
      const plate = normalizePlateText(result?.bestPlateResult?.plate_text);
      if (!result || !plate) return null;
      return {
        plate,
        confidence: result.bestPlateResult?.ocr_confidence ?? null,
        imageUrl: pickEvidenceImageUrl(result, displayFrameUrl),
      };
    }
    const result = activeCameraHit ?? cameraLatest;
    const plate = normalizePlateText(result?.bestPlateResult?.plate_text);
    if (!result || !plate) return null;
    return {
      plate,
      confidence: result.bestPlateResult?.ocr_confidence ?? null,
      imageUrl: pickEvidenceImageUrl(result, cameraFrameUrl),
    };
  }, [
    tab,
    activeLiveHit,
    latest,
    previewUrl,
    imageResult,
    imagePreviewUrl,
    activeVideoFrame,
    activeDisplayHit,
    displayLatest,
    displayFrameUrl,
    activeCameraHit,
    cameraLatest,
    cameraFrameUrl,
  ]);

  const submitToViolations = useCallback(async () => {
    if (!vehicleId) {
      setSubmitError('请先在设备列表选择车辆。');
      return;
    }
    if (!violationCandidate?.imageUrl) {
      setSubmitError('当前没有可上传的识别结果图，请先完成识别。');
      return;
    }
    setSubmitBusy(true);
    setSubmitError(null);
    setSubmitOk(null);
    try {
      const jpegBase64 = await imageUrlToJpegBase64(violationCandidate.imageUrl);
      const created = await opsClient.createViolationFromConsoleScan({
        vehicleId,
        plate: violationCandidate.plate,
        confidence: violationCandidate.confidence,
        jpegBase64,
        waypoint: '控制台手动识别',
      });
      const np = created.noParking;
      const noParkingLabel = np?.inNoParking
        ? `禁停区命中：${np.zone?.name ?? '是'}`
        : np?.reason === 'no_recent_pose'
          ? '未判禁停（无近时位姿）'
          : '不在禁停区';
      if (!created.recorded || !created.violation) {
        setSubmitError(created.message ?? (created.reason === 'pending_review' ? '已进入待人工审核，暂未生成违规' : '识别结果无需记录违规'));
      } else setSubmitOk({
        id: created.violation.id,
        plate: created.violation.plate,
        evidenceUrl: created.violation.evidenceUrl,
        eventId: created.review?.eventId,
        noParkingLabel: created.deduplicated ? `已去重 · ${noParkingLabel}` : noParkingLabel,
      });
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : '添加到违规车辆失败');
    } finally {
      setSubmitBusy(false);
    }
  }, [vehicleId, violationCandidate]);

  const autoSubmitRecognition = useCallback(async (result: InferResponse, blob: Blob, source: string) => {
    const plate = normalizePlateText(result.bestPlateResult?.plate_text);
    if (!vehicleId || !plate || !result.plateDetected) return;
    const now = Date.now();
    const previous = autoSubmittedRef.current.get(plate) ?? 0;
    if (now - previous < 10_000) return;
    autoSubmittedRef.current.set(plate, now);
    try {
      const created = await opsClient.createViolationFromConsoleScan({
        vehicleId,
        plate,
        confidence: result.bestPlateResult?.ocr_confidence ?? null,
        jpegBase64: await blobToBase64(blob),
        waypoint: source,
      });
      if (created.recorded && created.violation) {
        setSubmitError(null);
        setSubmitOk({
          id: created.violation.id,
          plate: created.violation.plate,
          evidenceUrl: created.violation.evidenceUrl,
          eventId: created.review?.eventId,
          noParkingLabel: created.deduplicated ? '自动识别：已去重' : '自动识别：已记录',
        });
      } else {
        setSubmitOk(null);
        setSubmitError(created.message ?? (created.reason === 'pending_review' ? '自动识别：已进入待审核' : '自动识别：白名单正常'));
      }
    } catch (reason) {
      setSubmitError(reason instanceof Error ? `自动提交失败：${reason.message}` : '自动提交失败');
    }
  }, [vehicleId]);

  useEffect(() => {
    if (!hits.length) {
      setActiveLiveHitId(null);
      return;
    }
    setActiveLiveHitId((current) => current ?? hits[0].id);
  }, [hits]);

  useEffect(() => {
    if (!cameraHits.length) {
      setActiveCameraHitId(null);
      return;
    }
    setActiveCameraHitId((current) => current ?? cameraHits[0].id);
  }, [cameraHits]);

  useEffect(() => {
    if (!displayHits.length) {
      setActiveDisplayHitId(null);
      return;
    }
    setActiveDisplayHitId((current) => current ?? displayHits[0].id);
  }, [displayHits]);

  useEffect(() => {
    if (!videoResult?.matchedFrames.length) {
      setActiveVideoFrameKey(null);
      return;
    }
    const first = videoResult.matchedFrames[0];
    setActiveVideoFrameKey(`${first.sampleIndex}-${first.frameIndex}`);
  }, [videoResult]);

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
      return;
    }
    const next = URL.createObjectURL(imageFile);
    setImagePreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return next;
    });
  }, [imageFile]);

  useEffect(() => {
    if (!videoFile) {
      setVideoLocalUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
      return;
    }
    const next = URL.createObjectURL(videoFile);
    setVideoLocalUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return next;
    });
  }, [videoFile]);

  const handleImageInfer = useCallback(async () => {
    if (!imageFile) {
      setImageError('请先选择一张图片。');
      return;
    }
    setImageBusy(true);
    setImageError(null);
    try {
      const result = await inferPlateImage(imageFile, imageFile.name);
      setImageResult(result);
    } catch (reason) {
      setImageError(reason instanceof Error ? reason.message : '图片识别失败');
    } finally {
      setImageBusy(false);
    }
  }, [imageFile]);

  const handleVideoInfer = useCallback(async () => {
    if (!videoFile) {
      setVideoError('请先选择一个视频。');
      return;
    }
    setVideoBusy(true);
    setVideoError(null);
    try {
      const result = await inferPlateVideo(videoFile, videoFile.name, {
        sampleFps: videoSampleFps,
        maxFrames: videoMaxFrames,
      });
      setVideoResult(result);
    } catch (reason) {
      setVideoError(reason instanceof Error ? reason.message : '视频识别失败');
    } finally {
      setVideoBusy(false);
    }
  }, [videoFile, videoMaxFrames, videoSampleFps]);

  const stopDisplayCapture = useCallback(() => {
    setDisplayScanning(false);
    displayStreamRef.current?.getTracks().forEach((track) => track.stop());
    displayStreamRef.current = null;
    if (displayVideoRef.current) {
      displayVideoRef.current.srcObject = null;
    }
    setDisplayReady(false);
    setDisplayStatus('未启用屏幕捕获回退');
  }, []);

  const startDisplayCapture = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('当前浏览器不支持屏幕捕获回退。');
      setDisplayError('当前浏览器不支持小车视频捕获。');
      return;
    }
    setDisplayStarting(true);
    setError(null);
    setDisplayError(null);
    setDisplayStatus('正在请求屏幕/标签页捕获权限...');
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      displayStreamRef.current = stream;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopDisplayCapture();
      });
      if (displayVideoRef.current) {
        displayVideoRef.current.srcObject = stream;
        await displayVideoRef.current.play();
      }
      setDisplayReady(true);
      setDisplayStatus('小车视频捕获已启用');
    } catch (reason) {
      stopDisplayCapture();
      const message = reason instanceof Error ? reason.message : '无法打开屏幕捕获';
      setError(message);
      setDisplayError(message);
    } finally {
      setDisplayStarting(false);
    }
  }, [stopDisplayCapture]);

  const captureDisplayFrame = useCallback(async (): Promise<Blob> => {
    const video = displayVideoRef.current;
    const canvas = displayCanvasRef.current;
    if (!video || !canvas || video.videoWidth <= 0 || video.videoHeight <= 0) {
      throw new Error('屏幕捕获尚未准备好，请先打开屏幕捕获并让视频区域可见。');
    }
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('无法创建屏幕捕获画布上下文。');
    }

    const previewFrame = document.querySelector<HTMLIFrameElement>('.video-panel iframe[title="小车视频预览"]');
    const rect = previewFrame?.getBoundingClientRect();
    const canCropToPreview = Boolean(
      rect
      && rect.width >= 32
      && rect.height >= 32
      && rect.bottom > 0
      && rect.right > 0
      && rect.top < window.innerHeight
      && rect.left < window.innerWidth,
    );

    if (canCropToPreview && rect) {
      const clippedLeft = Math.max(0, Math.min(rect.left, window.innerWidth));
      const clippedTop = Math.max(0, Math.min(rect.top, window.innerHeight));
      const clippedRight = Math.max(clippedLeft + 1, Math.min(rect.right, window.innerWidth));
      const clippedBottom = Math.max(clippedTop + 1, Math.min(rect.bottom, window.innerHeight));
      const cssWidth = clippedRight - clippedLeft;
      const cssHeight = clippedBottom - clippedTop;
      const scaleX = video.videoWidth / Math.max(window.innerWidth, 1);
      const scaleY = video.videoHeight / Math.max(window.innerHeight, 1);
      const sourceX = Math.max(0, Math.floor(clippedLeft * scaleX));
      const sourceY = Math.max(0, Math.floor(clippedTop * scaleY));
      const sourceWidth = Math.max(1, Math.min(video.videoWidth - sourceX, Math.floor(cssWidth * scaleX)));
      const sourceHeight = Math.max(1, Math.min(video.videoHeight - sourceY, Math.floor(cssHeight * scaleY)));
      canvas.width = sourceWidth;
      canvas.height = sourceHeight;
      context.drawImage(
        video,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    } else {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error('屏幕捕获帧导出失败。'));
      }, 'image/jpeg', 0.92);
    });
  }, []);

  const runGateThenInfer = useCallback(async (
    blob: Blob,
    filename: string,
  ): Promise<{ result: InferResponse | null }> => {
    const gate = await inferCarGate(blob, filename);
    if (!gate.carDetected) {
      return { result: null };
    }
    const result = await inferPlateImage(blob, filename);
    return { result };
  }, []);

  const scanDisplayFrame = useCallback(async () => {
    if (!displayReady || displayBusy) return;
    setDisplayBusy(true);
    setDisplayError(null);
    const startedAt = performance.now();
    try {
      const blob = await captureDisplayFrame();
      const nextFrameNumber = displayFramesScanned + 1;
      const result = await inferPlateOnlyImage(blob, `car_video_${Date.now()}.jpg`);
      setDisplayStatus(result.plateDetected ? '已检测到车牌并输出结果' : '当前帧未识别到有效车牌');
      setDisplayFrameUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(blob);
      });
      setDisplayLatest(result);
      setDisplayFramesScanned(nextFrameNumber);
      setDisplayLastLatencySec((performance.now() - startedAt) / 1000);
      if (result.plateDetected) {
        setDisplayHits((previous) => [
          {
            ...result,
            id: crypto.randomUUID(),
            capturedAt: new Date().toISOString(),
            frameNumber: nextFrameNumber,
          },
          ...previous,
        ].slice(0, 10));
        void autoSubmitRecognition(result, blob, '小车视频自动识别');
      }
    } catch (reason) {
      setDisplayError(reason instanceof Error ? reason.message : '小车视频扫描失败');
      setDisplayScanning(false);
    } finally {
      setDisplayBusy(false);
    }
  }, [autoSubmitRecognition, captureDisplayFrame, displayBusy, displayFramesScanned, displayReady]);

  const runOnce = useCallback(async () => {
    if (disabled || processingRef.current) return;
    processingRef.current = true;
    setBusy(true);
    setError(null);
    const startedAt = performance.now();
    try {
      let blob: Blob;
      try {
        blob = await fetchVideoSnapshot(host, videoPort);
      } catch (reason) {
        if (!displayReady) throw reason;
        blob = await captureDisplayFrame();
        setDisplayStatus('已使用屏幕捕获回退完成本次抓帧');
      }
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
        setHits((prev) => [hit, ...prev].slice(0, 10));
        void autoSubmitRecognition(result, blob, '实时快照自动识别');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '识别失败');
      setScanning(false);
    } finally {
      processingRef.current = false;
      setBusy(false);
    }
  }, [autoSubmitRecognition, captureDisplayFrame, disabled, displayReady, host, videoPort]);

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

  useEffect(() => {
    if (!displayReady || !displayScanning) return;
    let cancelled = false;
    let timerId: number | null = null;
    const loop = async () => {
      if (cancelled) return;
      await scanDisplayFrame();
      if (cancelled) return;
      timerId = window.setTimeout(loop, DEFAULT_INTERVAL_SEC * 1000);
    };
    void loop();
    return () => {
      cancelled = true;
      if (timerId != null) window.clearTimeout(timerId);
    };
  }, [displayReady, displayScanning, scanDisplayFrame]);

  const stopBrowserCamera = useCallback(() => {
    setCameraScanning(false);
    cameraProcessingRef.current = false;
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
    setCameraReady(false);
    setCameraStatus('摄像头未开启');
  }, []);

  const startBrowserCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('当前浏览器不支持摄像头采集。');
      return;
    }
    setCameraStarting(true);
    setCameraError(null);
    setCameraStatus('正在请求摄像头权限...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        await cameraVideoRef.current.play();
      }
      setCameraReady(true);
      setCameraStatus(stream.getVideoTracks()[0]?.label || '摄像头已连接');
    } catch (reason) {
      stopBrowserCamera();
      setCameraError(reason instanceof Error ? reason.message : '无法打开摄像头');
    } finally {
      setCameraStarting(false);
    }
  }, [stopBrowserCamera]);

  const scanBrowserCameraFrame = useCallback(async () => {
    if (!cameraVideoRef.current || !cameraCanvasRef.current || cameraProcessingRef.current) {
      return;
    }
    if (cameraVideoRef.current.videoWidth <= 0 || cameraVideoRef.current.videoHeight <= 0) {
      return;
    }

    cameraProcessingRef.current = true;
    setCameraBusy(true);
    setCameraError(null);
    const startedAt = performance.now();
    try {
      const video = cameraVideoRef.current;
      const canvas = cameraCanvasRef.current;
      const nextFrameNumber = cameraFramesScanned + 1;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('无法创建摄像头画布上下文。');
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => {
          if (value) {
            resolve(value);
            return;
          }
          reject(new Error('摄像头帧导出失败。'));
        }, 'image/jpeg', 0.92);
      });
      const { result } = await runGateThenInfer(blob, `camera_${Date.now()}.jpg`);
      if (!result) {
        setCameraLatest(null);
        setCameraStatus('最近一帧未检测到车辆，已跳过完整识别');
        setCameraFramesScanned(nextFrameNumber);
        setCameraLastLatencySec((performance.now() - startedAt) / 1000);
        return;
      }
      setCameraVehicleFrames((count) => count + 1);
      setCameraStatus('已检测到车辆，正在按完整车牌流程识别');
      setCameraFrameUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(blob);
      });
      setCameraLatest(result);
      setCameraFramesScanned(nextFrameNumber);
      setCameraLastLatencySec((performance.now() - startedAt) / 1000);
      if (result?.carDetected && result.plateDetected) {
        setCameraHits((previous) => [
          {
            ...result,
            id: crypto.randomUUID(),
            capturedAt: new Date().toISOString(),
            frameNumber: nextFrameNumber,
          },
          ...previous,
        ].slice(0, 10));
        void autoSubmitRecognition(result, blob, '浏览器摄像头自动识别');
      }
    } catch (reason) {
      setCameraError(reason instanceof Error ? reason.message : '浏览器摄像头识别失败');
      setCameraScanning(false);
    } finally {
      cameraProcessingRef.current = false;
      setCameraBusy(false);
    }
  }, [autoSubmitRecognition, cameraFramesScanned, runGateThenInfer]);

  useEffect(() => {
    if (!cameraReady || !cameraScanning) return;
    let cancelled = false;
    let timerId: number | null = null;
    const loop = async () => {
      if (cancelled) return;
      await scanBrowserCameraFrame();
      if (cancelled) return;
      timerId = window.setTimeout(loop, DEFAULT_INTERVAL_SEC * 1000);
    };
    void loop();
    return () => {
      cancelled = true;
      if (timerId != null) window.clearTimeout(timerId);
    };
  }, [cameraReady, cameraScanning, scanBrowserCameraFrame]);

  const liveVisualUrl =
    latest?.imageUrls.primaryCarVisualUrl
    ?? latest?.imageUrls.plateVisualUrl
    ?? latest?.imageUrls.uploadedImageUrl
    ?? previewUrl;

  return (
    <section className="panel plate-scan-panel">
      <div className="panel-heading">
        <div>
          <h2>车牌识别工作台</h2>
          <p className="muted">
            {health?.ok ? `YOLO 就绪 (${health.runtimeDevice ?? 'auto'})` : (healthError ?? '检测 YOLO…')}
          </p>
        </div>
        <button type="button" className="secondary" onClick={() => void refreshHealth()}>
          刷新健康检查
        </button>
      </div>

      <p className="notice" style={{ marginTop: 0 }}>
        禁停 / 坐标（约 2s 刷新）：{noParkingHint}
      </p>

      {!health?.ok && (
        <p className="notice">
          YOLO 服务未启动。运行 <code>npm run dev:plate-api</code> 后刷新。
        </p>
      )}

      {manualSubmission ? (
        <div className="plate-scan-actions plate-violation-test-bar">
          <button
            type="button"
            className="secondary"
            disabled={submitBusy || !violationCandidate || !vehicleId}
            onClick={() => void submitToViolations()}
          >
            {submitBusy ? '上传中…' : '添加到违规车辆'}
          </button>
          <p className="muted">
            {!vehicleId
              ? '请先在上方选择小车。'
              : violationCandidate
              ? `将提交 ${violationCandidate.plate} 与当前证据；后端会按白名单、置信度和禁停位置决定正常、待审核或违规。`
              : '识别出有效车牌后可手动提交。'}
          </p>
        </div>
      ) : (
        <p className="muted">实时来源识别到有效车牌和证据后会自动提交；重复帧由后端统一去重。</p>
      )}
      {submitError && <p className="error-text">{submitError}</p>}
      {submitOk && (
        <p className="notice">
          已写入：{submitOk.plate}
          {submitOk.noParkingLabel ? ` · ${submitOk.noParkingLabel}` : ''}
          {' · '}
          <Link to="/reviews">去审核队列</Link>
          {' · '}
          <Link to="/violations">违规列表</Link>
          {submitOk.evidenceUrl ? ` · 证据 ${submitOk.evidenceUrl}` : ''}
        </p>
      )}

      <div className="plate-scan-tabs" role="tablist" aria-label="车牌识别模式">
        {(Object.keys(TAB_LABELS) as PlatePanelTab[]).map((key) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'plate-tab-active' : 'secondary'}
            onClick={() => setTab(key)}
          >
            {TAB_LABELS[key]}
          </button>
        ))}
      </div>

      {tab === 'live' && (
        <div className="plate-tab-section">
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
            <button type="button" className="secondary" disabled={displayReady || displayStarting} onClick={() => void startDisplayCapture()}>
              {displayStarting ? '授权中…' : '打开屏幕捕获回退'}
            </button>
            <button type="button" className="secondary" disabled={!displayReady} onClick={stopDisplayCapture}>
              关闭屏幕捕获
            </button>
          </div>

          <p className="muted">
            {displayStatus}
            {' · '}
            当 `:6500` 不支持程序化抓帧时，可开启屏幕捕获，选择当前浏览器标签页或包含视频的窗口，再点击“识别当前帧”。
          </p>

          <StatGrid
            items={[
              ['已扫描', String(framesScanned)],
              ['命中', String(hits.length)],
              ['间隔', `${DEFAULT_INTERVAL_SEC}s`],
              ['耗时', lastLatencySec != null ? `${lastLatencySec.toFixed(2)}s` : '—'],
            ]}
          />

          {error && <p className="error-text">{error}</p>}
          <video ref={displayVideoRef} className="plate-video-hidden" muted playsInline />
          <canvas ref={displayCanvasRef} className="plate-hidden-canvas" />

          <div className="plate-summary-grid">
            <article className="plate-visual-card">
              <h3>当前识别结果</h3>
              {liveVisualUrl ? (
                <img className="plate-scan-preview" src={liveVisualUrl} alt="plate-live-visual" />
              ) : (
                <EmptyBlock text="点击“识别当前帧”后，这里会显示当前快照与识别结果。" />
              )}
              {latest && (
                <div className="plate-detail-list">
                  <DetailRow label="车牌文本" value={normalizePlateText(latest.bestPlateResult?.plate_text) || '未识别'} />
                  <DetailRow label="流程状态" value={latest.status} />
                  <DetailRow label="车辆门控" value={latest.carDetected ? '已通过' : '未通过'} />
                  <DetailRow label="OCR 置信度" value={formatRatio(latest.bestPlateResult?.ocr_confidence)} />
                </div>
              )}
            </article>

            <article className="plate-hit-card">
              <h3>命中帧复核</h3>
              {hits.length ? (
                <div className="plate-hit-layout">
                  <div className="plate-hit-list">
                    {hits.map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        className={activeLiveHit?.id === hit.id ? 'plate-hit-item-active' : 'plate-hit-item'}
                        onClick={() => setActiveLiveHitId(hit.id)}
                      >
                        <strong>{normalizePlateText(hit.bestPlateResult?.plate_text) || '未识别'}</strong>
                        <small>{new Date(hit.capturedAt).toLocaleTimeString()}</small>
                      </button>
                    ))}
                  </div>
                  <FrameReviewDetail result={activeLiveHit} />
                </div>
              ) : (
                <EmptyBlock text="只有“检测到车辆且识别出有效车牌文本”的结果会进入命中列表。" />
              )}
            </article>
          </div>
        </div>
      )}

      {tab === 'carVideo' && (
        <div className="plate-tab-section">
          <div className="plate-scan-actions">
            <button type="button" disabled={displayReady || displayStarting} onClick={() => void startDisplayCapture()}>
              {displayStarting ? '授权中…' : '打开小车视频捕获'}
            </button>
            <button
              type="button"
              className={displayScanning ? 'danger' : 'secondary'}
              disabled={!displayReady || !health?.ok}
              onClick={() => setDisplayScanning((value) => !value)}
            >
              {displayScanning ? '停止扫描' : '开始实时扫描'}
            </button>
            <button type="button" className="secondary" disabled={!displayReady || displayBusy} onClick={() => void scanDisplayFrame()}>
              {displayBusy ? '识别中…' : '识别当前视频帧'}
            </button>
            <button type="button" className="secondary" disabled={!displayReady} onClick={stopDisplayCapture}>
              关闭视频捕获
            </button>
          </div>

          <p className="muted">
            {displayStatus}
            {' · '}
            请选择当前浏览器标签页或包含“视频预览”的窗口。授权一次后，系统会对抓到的帧直接做车牌检测与 OCR，不再执行车辆预检。
          </p>

          <StatGrid
            items={[
              ['状态', displayReady ? '已连接视频捕获' : '未连接'],
              ['已扫描', String(displayFramesScanned)],
              ['命中', String(displayHits.length)],
              ['耗时', displayLastLatencySec != null ? `${displayLastLatencySec.toFixed(2)}s` : '—'],
            ]}
          />

          {displayError && <p className="error-text">{displayError}</p>}

          <div className="plate-summary-grid">
            <article className="plate-visual-card">
              <h3>小车视频抓帧</h3>
              <video ref={displayVideoRef} className="plate-video-hidden" muted playsInline />
              {!displayFrameUrl && (
                <EmptyBlock text="打开小车视频捕获后，保持控制台里的“视频预览”区域可见，系统会从你选中的标签页/窗口持续抓帧并送入 YOLO 流程。" />
              )}
              <canvas ref={displayCanvasRef} className="plate-hidden-canvas" />
              {displayFrameUrl && (
                <>
                  <h4>最近抓帧</h4>
                  <img className="plate-scan-preview" src={displayFrameUrl} alt="car-video-frame" />
                </>
              )}
            </article>

            <article className="plate-hit-card">
              <h3>视频命中结果</h3>
              {displayBusy && <p className="muted">正在处理当前抓帧…</p>}
              {displayHits.length ? (
                <div className="plate-hit-layout">
                  <div className="plate-hit-list">
                    {displayHits.map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        className={activeDisplayHit?.id === hit.id ? 'plate-hit-item-active' : 'plate-hit-item'}
                        onClick={() => setActiveDisplayHitId(hit.id)}
                      >
                        <strong>{normalizePlateText(hit.bestPlateResult?.plate_text) || '未识别'}</strong>
                        <small>第 {hit.frameNumber} 帧</small>
                      </button>
                    ))}
                  </div>
                  <FrameReviewDetail result={activeDisplayHit ?? displayLatest} hideVehicleGate />
                </div>
              ) : (
                <EmptyBlock text="只有识别出有效车牌文本的视频帧才会留在这里。" />
              )}
            </article>
          </div>
        </div>
      )}

      {tab === 'image' && (
        <div className="plate-tab-section">
          <div className="plate-upload-toolbar">
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                setImageError(null);
                setImageResult(null);
                setImageFile(event.target.files?.[0] ?? null);
              }}
            />
            <button type="button" disabled={!health?.ok || imageBusy} onClick={() => void handleImageInfer()}>
              {imageBusy ? '识别中…' : '识别图片'}
            </button>
          </div>
          {imageError && <p className="error-text">{imageError}</p>}
          <div className="plate-summary-grid">
            <article className="plate-visual-card">
              <h3>原始图片</h3>
              {imagePreviewUrl ? (
                <img className="plate-scan-preview" src={imagePreviewUrl} alt="plate-upload-preview" />
              ) : (
                <EmptyBlock text="选择图片后，这里会显示原始预览。" />
              )}
            </article>
            <article className="plate-hit-card">
              <h3>识别结果</h3>
              {imageResult ? (
                <FrameReviewDetail result={imageResult} />
              ) : (
                <EmptyBlock text="识别完成后，这里会展示主体车可视化、ROI 与车牌裁剪图。" />
              )}
            </article>
          </div>
        </div>
      )}

      {tab === 'video' && (
        <div className="plate-tab-section">
          <div className="plate-upload-toolbar plate-upload-toolbar-wide">
            <input
              type="file"
              accept="video/*"
              onChange={(event) => {
                setVideoError(null);
                setVideoResult(null);
                setVideoFile(event.target.files?.[0] ?? null);
              }}
            />
            <label>
              抽帧 FPS
              <input
                type="number"
                min="0.2"
                max="5"
                step="0.2"
                value={videoSampleFps}
                onChange={(event) => setVideoSampleFps(Number(event.target.value) || DEFAULT_VIDEO_SAMPLE_FPS)}
              />
            </label>
            <label>
              最大帧数
              <input
                type="number"
                min="1"
                max="60"
                step="1"
                value={videoMaxFrames}
                onChange={(event) => setVideoMaxFrames(Number(event.target.value) || DEFAULT_VIDEO_MAX_FRAMES)}
              />
            </label>
            <button type="button" disabled={!health?.ok || videoBusy} onClick={() => void handleVideoInfer()}>
              {videoBusy ? '扫描中…' : '开始视频扫描'}
            </button>
          </div>
          {videoError && <p className="error-text">{videoError}</p>}

          <div className="plate-summary-grid">
            <article className="plate-visual-card">
              <h3>原始视频预览</h3>
              {videoResult?.uploadedVideoUrl || videoLocalUrl ? (
                <video
                  className="plate-scan-video"
                  src={videoResult?.uploadedVideoUrl ?? videoLocalUrl ?? undefined}
                  controls
                  preload="metadata"
                />
              ) : (
                <EmptyBlock text="选择视频后，这里会显示原始视频预览。" />
              )}
              {videoResult && (
                <>
                  <StatGrid
                    items={[
                      ['原始帧', String(videoResult.sampling.frameCount)],
                      ['抽样帧', String(videoResult.sampling.sampledFrameCount)],
                      ['命中帧', String(videoResult.matchedFrameCount)],
                      ['总耗时', `${videoResult.aggregateTimings.totalPipelineSec.toFixed(2)}s`],
                    ]}
                  />
                  <div className="plate-detail-list">
                    <DetailRow label="视频摘要" value={videoResult.summary} />
                    <DetailRow label="采样 FPS" value={videoResult.sampling.sampleFps.toFixed(2)} />
                    <DetailRow label="帧步长" value={String(videoResult.sampling.frameStride)} />
                    <DetailRow label="OCR 尝试帧数" value={String(videoResult.frameGateStats?.ocrAttemptFrameCount ?? 0)} />
                  </div>
                </>
              )}
            </article>

            <article className="plate-hit-card">
              <h3>命中帧列表与详情</h3>
              {videoResult?.matchedFrames.length ? (
                <div className="plate-hit-layout">
                  <div className="plate-hit-list">
                    {videoResult.matchedFrames.map((frame) => {
                      const key = `${frame.sampleIndex}-${frame.frameIndex}`;
                      return (
                        <button
                          key={key}
                          type="button"
                          className={activeVideoFrameKey === key ? 'plate-hit-item-active' : 'plate-hit-item'}
                          onClick={() => setActiveVideoFrameKey(key)}
                        >
                          <strong>{normalizePlateText(frame.bestPlateResult?.plate_text) || '未识别'}</strong>
                          <small>#{frame.sampleIndex} · {frame.timestampSec.toFixed(2)}s</small>
                        </button>
                      );
                    })}
                  </div>
                  <FrameReviewDetail
                    result={activeVideoFrame}
                    meta={[
                      ['原始帧号', String(activeVideoFrame?.frameIndex ?? '—')],
                      ['采样序号', String(activeVideoFrame?.sampleIndex ?? '—')],
                      ['命中时间点', activeVideoFrame ? `${activeVideoFrame.timestampSec.toFixed(2)}s` : '—'],
                    ]}
                  />
                </div>
              ) : (
                <EmptyBlock text="视频结果只会保留“车辆存在且识别出有效大陆车牌文本”的命中帧。" />
              )}
            </article>
          </div>
        </div>
      )}

      {tab === 'camera' && (
        <div className="plate-tab-section">
          <div className="plate-scan-actions">
            <button type="button" disabled={cameraReady || cameraStarting} onClick={() => void startBrowserCamera()}>
              {cameraStarting ? '打开中…' : '打开摄像头'}
            </button>
            <button
              type="button"
              className={cameraScanning ? 'danger' : 'secondary'}
              disabled={!cameraReady || !health?.ok}
              onClick={() => setCameraScanning((value) => !value)}
            >
              {cameraScanning ? '停止扫描' : '开始实时扫描'}
            </button>
            <button type="button" className="secondary" disabled={!cameraReady} onClick={stopBrowserCamera}>
              关闭摄像头
            </button>
          </div>

          <StatGrid
            items={[
              ['状态', cameraStatus],
              ['已扫描', String(cameraFramesScanned)],
              ['见车', String(cameraVehicleFrames)],
              ['命中', String(cameraHits.length)],
              ['耗时', cameraLastLatencySec != null ? `${cameraLastLatencySec.toFixed(2)}s` : '—'],
            ]}
          />

          {cameraError && <p className="error-text">{cameraError}</p>}

          <div className="plate-summary-grid">
            <article className="plate-visual-card">
              <h3>浏览器摄像头画面</h3>
              <video
                ref={cameraVideoRef}
                className={`plate-scan-video ${cameraReady ? '' : 'plate-video-hidden'}`}
                muted
                playsInline
              />
              {!cameraReady && <EmptyBlock text="打开浏览器摄像头后，系统会定时抓帧并送入 YOLO 流程。" />}
              <canvas ref={cameraCanvasRef} className="plate-hidden-canvas" />
              {cameraFrameUrl && (
                <>
                  <h4>最近抓帧</h4>
                  <img className="plate-scan-preview" src={cameraFrameUrl} alt="browser-camera-frame" />
                </>
              )}
            </article>

            <article className="plate-hit-card">
              <h3>摄像头命中结果</h3>
              {cameraBusy && <p className="muted">正在处理当前抓帧…</p>}
              {cameraHits.length ? (
                <div className="plate-hit-layout">
                  <div className="plate-hit-list">
                    {cameraHits.map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        className={activeCameraHit?.id === hit.id ? 'plate-hit-item-active' : 'plate-hit-item'}
                        onClick={() => setActiveCameraHitId(hit.id)}
                      >
                        <strong>{normalizePlateText(hit.bestPlateResult?.plate_text) || '未识别'}</strong>
                        <small>第 {hit.frameNumber} 帧</small>
                      </button>
                    ))}
                  </div>
                  <FrameReviewDetail result={activeCameraHit ?? cameraLatest} />
                </div>
              ) : (
                <EmptyBlock text="只有通过车辆门控且输出有效大陆车牌文本的抓帧才会留在这里。" />
              )}
            </article>
          </div>
        </div>
      )}
    </section>
  );
}

function StatGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="plate-scan-metrics">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="plate-detail-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return <div className="plate-empty-block">{text}</div>;
}

function formatRatio(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function pickEvidenceImageUrl(
  result: InferResponse | VideoMatchedFrame | PlateHit | CameraHit,
  fallback: string | null,
): string | null {
  return (
    result.imageUrls.plateVisualUrl
    || result.imageUrls.primaryCarVisualUrl
    || result.imageUrls.uploadedImageUrl
    || result.imageUrls.plateCropUrl
    || result.imageUrls.primaryCarCropUrl
    || fallback
  );
}

async function imageUrlToJpegBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`读取识别结果图失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  if (blob.type === 'image/jpeg' || /\.jpe?g($|\?)/i.test(url)) {
    return blobToBase64(blob);
  }
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法转换识别结果图为 JPEG');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const jpegBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error('JPEG 编码失败'));
    }, 'image/jpeg', 0.92);
  });
  return blobToBase64(jpegBlob);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      const comma = value.indexOf(',');
      resolve(comma >= 0 ? value.slice(comma + 1) : value);
    };
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

function FrameReviewDetail({
  result,
  meta,
  hideVehicleGate = false,
}: {
  result: InferResponse | VideoMatchedFrame | PlateHit | CameraHit | null;
  meta?: Array<[string, string]>;
  hideVehicleGate?: boolean;
}) {
  if (!result) {
    return <EmptyBlock text="选择左侧命中项后，这里会展示详情、主体车 ROI 和车牌裁剪图。" />;
  }

  return (
    <div className="plate-review-detail">
      {result.imageUrls.primaryCarVisualUrl || result.imageUrls.uploadedImageUrl ? (
        <img
          className="plate-scan-preview"
          src={result.imageUrls.primaryCarVisualUrl || result.imageUrls.uploadedImageUrl || undefined}
          alt="plate-hit-detail"
        />
      ) : null}

      <div className="plate-detail-list">
        {meta?.map(([label, value]) => <DetailRow key={label} label={label} value={value} />)}
        <DetailRow label="车牌文本" value={normalizePlateText(result.bestPlateResult?.plate_text) || '未识别'} />
        <DetailRow label="OCR 置信度" value={formatRatio(result.bestPlateResult?.ocr_confidence)} />
        <DetailRow label="主体车置信度" value={formatRatio(result.primaryCar?.confidence)} />
        <DetailRow label="流程状态" value={result.status} />
        {!hideVehicleGate && <DetailRow label="车辆门控" value={result.carDetected ? '已通过' : '未通过'} />}
        <DetailRow
          label="门控后车牌候选数"
          value={String(result.stageTimings?.gated_plate_candidate_count ?? 0)}
        />
        <DetailRow
          label="OCR 尝试次数"
          value={String(result.stageTimings?.ocr_attempt_count ?? 0)}
        />
        <DetailRow
          label="总耗时"
          value={result.stageTimings?.total_pipeline_sec != null ? `${result.stageTimings.total_pipeline_sec.toFixed(2)}s` : '—'}
        />
      </div>

      <div className="plate-image-pair">
        <figure>
          <figcaption>主体车 ROI</figcaption>
          {result.imageUrls.primaryCarCropUrl ? (
            <img className="plate-small-preview" src={result.imageUrls.primaryCarCropUrl} alt="primary-car-roi" />
          ) : (
            <EmptyBlock text="暂无主体车 ROI" />
          )}
        </figure>
        <figure>
          <figcaption>车牌裁剪图</figcaption>
          {result.imageUrls.plateCropUrl ? (
            <img className="plate-small-preview" src={result.imageUrls.plateCropUrl} alt="plate-crop" />
          ) : (
            <EmptyBlock text="暂无车牌裁剪图" />
          )}
        </figure>
      </div>
    </div>
  );
}
