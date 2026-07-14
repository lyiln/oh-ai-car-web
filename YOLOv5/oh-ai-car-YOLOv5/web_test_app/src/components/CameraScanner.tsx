import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Camera, CameraOff, LoaderCircle, ScanLine, TimerReset } from "lucide-react"

import { StatusChip } from "@/components/StatusChip"
import { cn } from "@/lib/utils"
import type { CameraMatchedFrame, InferResponse } from "@/types/inference"
import { formatSeconds, normalizePlateText } from "@/utils/format"

type CameraScannerProps = {
  onLatestResult: (result: InferResponse | null) => void
  onMatchedFrame: (result: InferResponse, frameNumber: number) => void
  onSessionChange: (summary: CaptureSummary) => void
  onError: (message: string | null) => void
}

export type CaptureSummary = {
  framesScanned: number
  matchedCountTotal: number
  matchedFrames: CameraMatchedFrame[]
  latestResult: InferResponse | null
  scanning: boolean
  cameraReady: boolean
  lastLatencySec: number | null
  cameraStatusText: string
  deviceLabel: string
  videoResolution: string
  trackResolution: string
  latestFramePreviewUrl: string | null
  latestFrameBrightness: number | null
}

const DEFAULT_INTERVAL_SEC = 2
const VIDEO_READY_TIMEOUT_MS = 8000

async function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error("摄像头已连接，但浏览器没有收到有效视频画面。"))
    }, VIDEO_READY_TIMEOUT_MS)

    const handleReady = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup()
        resolve()
      }
    }

    const handleError = () => {
      cleanup()
      reject(new Error("摄像头视频流初始化失败。"))
    }

    const cleanup = () => {
      window.clearTimeout(timeoutId)
      video.removeEventListener("loadedmetadata", handleReady)
      video.removeEventListener("loadeddata", handleReady)
      video.removeEventListener("canplay", handleReady)
      video.removeEventListener("error", handleError)
    }

    video.addEventListener("loadedmetadata", handleReady)
    video.addEventListener("loadeddata", handleReady)
    video.addEventListener("canplay", handleReady)
    video.addEventListener("error", handleError)
  })
}

export function CameraScanner({ onLatestResult, onMatchedFrame, onSessionChange, onError }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const processingRef = useRef(false)

  const [cameraReady, setCameraReady] = useState(false)
  const [startingCamera, setStartingCamera] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [cameraStatusText, setCameraStatusText] = useState("摄像头未开启")
  const [deviceLabel, setDeviceLabel] = useState("--")
  const [videoResolution, setVideoResolution] = useState("--")
  const [trackResolution, setTrackResolution] = useState("--")
  const [framesScanned, setFramesScanned] = useState(0)
  const [matchedCountTotal, setMatchedCountTotal] = useState(0)
  const [lastLatencySec, setLastLatencySec] = useState<number | null>(null)
  const [latestFramePreviewUrl, setLatestFramePreviewUrl] = useState<string | null>(null)
  const [latestFrameBrightness, setLatestFrameBrightness] = useState<number | null>(null)
  const [matchedFrames, setMatchedFrames] = useState<CameraMatchedFrame[]>([])
  const [latestResult, setLatestResult] = useState<InferResponse | null>(null)

  const captureSummary = useMemo<CaptureSummary>(
    () => ({
      framesScanned,
      matchedCountTotal,
      matchedFrames,
      latestResult,
      scanning,
      cameraReady,
      lastLatencySec,
      cameraStatusText,
      deviceLabel,
      videoResolution,
      trackResolution,
      latestFramePreviewUrl,
      latestFrameBrightness,
    }),
    [
      cameraReady,
      cameraStatusText,
      deviceLabel,
      framesScanned,
      lastLatencySec,
      latestFrameBrightness,
      latestFramePreviewUrl,
      latestResult,
      matchedCountTotal,
      matchedFrames,
      scanning,
      trackResolution,
      videoResolution,
    ],
  )

  useEffect(() => {
    onSessionChange(captureSummary)
  }, [captureSummary, onSessionChange])

  const stopCamera = useCallback(() => {
    setScanning(false)
    processingRef.current = false
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setCameraReady(false)
    setCameraStatusText("摄像头未开启")
    setDeviceLabel("--")
    setVideoResolution("--")
    setTrackResolution("--")
    setLatestFramePreviewUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous)
      }
      return null
    })
    setLatestFrameBrightness(null)
  }, [])

  useEffect(() => {
    return () => stopCamera()
  }, [stopCamera])

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      onError("当前浏览器不支持摄像头采集。")
      return
    }

    setStartingCamera(true)
    setCameraStatusText("正在请求摄像头权限...")
    onError(null)
    try {
      const preferredConstraints = { video: { facingMode: { ideal: "environment" } }, audio: false }
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia(preferredConstraints)
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      }

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setCameraStatusText("摄像头已连接，等待画面...")
        await waitForVideoReady(videoRef.current)
        setVideoResolution(`${videoRef.current.videoWidth} x ${videoRef.current.videoHeight}`)
      }
      setCameraReady(true)
      const track = stream.getVideoTracks()[0]
      const trackLabel = track?.label?.trim()
      const settings = track?.getSettings()
      if (settings?.width && settings?.height) {
        setTrackResolution(`${settings.width} x ${settings.height}${settings.frameRate ? ` @ ${Math.round(settings.frameRate)}fps` : ""}`)
      }
      setDeviceLabel(trackLabel || "--")
      setCameraStatusText(trackLabel ? `画面已就绪：${trackLabel}` : "画面已就绪")
    } catch (error) {
      stopCamera()
      onError(error instanceof Error ? `无法打开摄像头：${error.message}` : "无法打开摄像头。")
    } finally {
      setStartingCamera(false)
    }
  }, [onError])

  const sendCurrentFrame = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || processingRef.current) {
      return
    }
    if (videoRef.current.videoWidth <= 0 || videoRef.current.videoHeight <= 0) {
      return
    }

    processingRef.current = true
    const startedAt = performance.now()
    try {
      const canvas = canvasRef.current
      canvas.width = videoRef.current.videoWidth
      canvas.height = videoRef.current.videoHeight
      const context = canvas.getContext("2d")
      if (!context) {
        throw new Error("无法创建摄像头画布上下文。")
      }

      context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height)
      setVideoResolution(`${videoRef.current.videoWidth} x ${videoRef.current.videoHeight}`)
      const sampleSize = Math.min(64, canvas.width, canvas.height)
      const brightnessCanvas = document.createElement("canvas")
      brightnessCanvas.width = sampleSize
      brightnessCanvas.height = sampleSize
      const brightnessContext = brightnessCanvas.getContext("2d")
      if (brightnessContext) {
        brightnessContext.drawImage(videoRef.current, 0, 0, sampleSize, sampleSize)
        const imageData = brightnessContext.getImageData(0, 0, sampleSize, sampleSize).data
        let brightnessSum = 0
        for (let index = 0; index < imageData.length; index += 4) {
          brightnessSum += (imageData[index] + imageData[index + 1] + imageData[index + 2]) / 3
        }
        const pixelCount = imageData.length / 4
        setLatestFrameBrightness(pixelCount > 0 ? brightnessSum / pixelCount : null)
      }

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => {
            if (value) {
              resolve(value)
              return
            }
            reject(new Error("摄像头帧导出失败。"))
          },
          "image/jpeg",
          0.92,
        )
      })
      setLatestFramePreviewUrl((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous)
        }
        return URL.createObjectURL(blob)
      })

      const frameNumber = framesScanned + 1
      const file = new File([blob], `camera_frame_${frameNumber.toString().padStart(4, "0")}.jpg`, { type: "image/jpeg" })
      const formData = new FormData()
      formData.append("image", file)

      const response = await fetch("/api/infer", {
        method: "POST",
        body: formData,
      })
      const payload = (await response.json()) as InferResponse | { detail?: string }
      if (!response.ok) {
        throw new Error("detail" in payload && payload.detail ? payload.detail : "摄像头帧识别失败。")
      }

      const result = payload as InferResponse
      setFramesScanned(frameNumber)
      setLatestResult(result)
      onLatestResult(result)
      const latencySec = (performance.now() - startedAt) / 1000
      setLastLatencySec(latencySec)

      if (result.carDetected && result.plateDetected) {
        setMatchedCountTotal((value) => value + 1)
        const matchedFrame: CameraMatchedFrame = {
          ...result,
          id: crypto.randomUUID(),
          frameNumber,
          capturedAt: new Date().toISOString(),
        }
        setMatchedFrames((state) => [matchedFrame, ...state].slice(0, 8))
        onMatchedFrame(result, frameNumber)
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "摄像头帧识别失败。")
      setScanning(false)
    } finally {
      processingRef.current = false
    }
  }, [framesScanned, onError, onLatestResult, onMatchedFrame])

  useEffect(() => {
    if (!cameraReady || !scanning) {
      return
    }

    let cancelled = false
    let timerId: number | null = null

    const loop = async () => {
      if (cancelled) {
        return
      }
      await sendCurrentFrame()
      if (cancelled) {
        return
      }
      timerId = window.setTimeout(loop, DEFAULT_INTERVAL_SEC * 1000)
    }

    void loop()

    return () => {
      cancelled = true
      if (timerId != null) {
        window.clearTimeout(timerId)
      }
    }
  }, [cameraReady, scanning, sendCurrentFrame])

  return (
    <section className="rounded-[30px] border border-white/12 bg-[#081224]/80 p-6 shadow-[0_22px_80px_rgba(2,8,23,0.45)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">实时摄像头</p>
          <h3 className="text-lg font-semibold text-white">摄像头命中帧扫描</h3>
          <p className="mt-1 text-sm text-slate-400">{cameraStatusText}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusChip label={captureSummary.cameraReady ? "摄像头已连接" : "摄像头未开启"} tone={captureSummary.cameraReady ? "success" : "neutral"} />
          <StatusChip label={captureSummary.scanning ? "实时扫描中" : "待机"} tone={captureSummary.scanning ? "success" : "neutral"} />
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-[26px] border border-white/10 bg-slate-950/60">
        <video ref={videoRef} muted playsInline className={cn("h-[420px] w-full object-contain", !cameraReady && "hidden")} />
        {!cameraReady ? (
          <div className="flex h-[420px] flex-col items-center justify-center gap-3 text-center text-sm text-slate-400">
            <Camera className="h-10 w-10 text-cyan-100/80" />
            <p>点击下方按钮打开摄像头，系统会定时抓帧并筛选符合条件的结果。</p>
          </div>
        ) : null}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <MetricBlock label="已扫描帧数" value={`${captureSummary.framesScanned}`} />
        <MetricBlock label="命中帧数" value={`${captureSummary.matchedFrames.length}`} />
        <MetricBlock label="抓帧间隔" value={`${DEFAULT_INTERVAL_SEC}s`} />
        <MetricBlock label="最近单帧耗时" value={formatSeconds(captureSummary.lastLatencySec)} />
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <MetricBlock label="设备名" value={captureSummary.deviceLabel} />
        <MetricBlock label="视频分辨率" value={captureSummary.videoResolution} />
        <MetricBlock label="轨道参数" value={captureSummary.trackResolution} />
        <MetricBlock
          label="帧平均亮度"
          value={captureSummary.latestFrameBrightness != null ? `${captureSummary.latestFrameBrightness.toFixed(1)} / 255` : "--"}
        />
      </div>

      <div className="mt-5 rounded-[24px] border border-white/10 bg-slate-950/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-200/70">最近抓帧缩略图</p>
            <p className="text-sm text-slate-400">这里显示送进后端识别的真实摄像头帧。</p>
          </div>
          <StatusChip
            label={captureSummary.latestFrameBrightness != null && captureSummary.latestFrameBrightness < 20 ? "画面几乎全黑" : "已抓到画面"}
            tone={captureSummary.latestFramePreviewUrl ? "success" : "neutral"}
          />
        </div>
        <div className="mt-4 overflow-hidden rounded-[18px] border border-white/10 bg-slate-900/70">
          {captureSummary.latestFramePreviewUrl ? (
            <img src={captureSummary.latestFramePreviewUrl} alt="latest-camera-frame" className="h-56 w-full object-contain" />
          ) : (
            <div className="flex h-56 items-center justify-center text-sm text-slate-500">开始实时扫描后，这里会显示最新抓取的一帧。</div>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void startCamera()}
          disabled={cameraReady || startingCamera}
          className={cn(
            "inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-medium transition",
            cameraReady || startingCamera
              ? "cursor-not-allowed bg-slate-800 text-slate-500"
              : "bg-cyan-300 text-slate-950 hover:bg-cyan-200",
          )}
        >
          {startingCamera ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {startingCamera ? "正在打开摄像头..." : "打开摄像头"}
        </button>

        <button
          type="button"
          onClick={() => setScanning((value) => !value)}
          disabled={!cameraReady}
          className={cn(
            "inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-medium transition",
            !cameraReady
              ? "cursor-not-allowed bg-slate-800 text-slate-500"
              : scanning
                ? "bg-amber-300 text-slate-950 hover:bg-amber-200"
                : "bg-emerald-300 text-slate-950 hover:bg-emerald-200",
          )}
        >
          {scanning ? <TimerReset className="h-4 w-4" /> : <ScanLine className="h-4 w-4" />}
          {scanning ? "停止扫描" : "开始实时扫描"}
        </button>

        <button
          type="button"
          onClick={stopCamera}
          disabled={!cameraReady && !startingCamera}
          className={cn(
            "inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-medium transition",
            !cameraReady && !startingCamera
              ? "cursor-not-allowed bg-slate-800 text-slate-500"
              : "bg-slate-700 text-white hover:bg-slate-600",
          )}
        >
          <CameraOff className="h-4 w-4" />
          关闭摄像头
        </button>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-200/70">命中帧</p>
            <p className="text-sm text-slate-400">这里只保留最近命中的 8 帧，统计会持续累计。</p>
          </div>
          <StatusChip label={captureSummary.matchedCountTotal ? `累计命中 ${captureSummary.matchedCountTotal} 帧` : "暂无命中"} tone={captureSummary.matchedCountTotal ? "success" : "neutral"} />
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {captureSummary.matchedFrames.length ? (
            captureSummary.matchedFrames.map((frame) => (
              <article key={frame.id} className="rounded-[24px] border border-white/10 bg-slate-950/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">第 {frame.frameNumber} 帧命中</p>
                    <p className="mt-1 text-xs text-slate-400">{new Date(frame.capturedAt).toLocaleTimeString()}</p>
                  </div>
                  <StatusChip label={normalizePlateText(frame.bestPlateResult?.plate_text) || "未识别"} tone="success" />
                </div>
                <div className="mt-4 overflow-hidden rounded-[18px] border border-white/10 bg-slate-900/70">
                  {frame.imageUrls.primaryCarVisualUrl || frame.imageUrls.uploadedImageUrl ? (
                    <img
                      src={frame.imageUrls.primaryCarVisualUrl || frame.imageUrls.uploadedImageUrl || undefined}
                      alt={`camera-hit-${frame.frameNumber}`}
                      className="h-56 w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-56 items-center justify-center text-sm text-slate-500">暂无可视化图片</div>
                  )}
                </div>
                <div className="mt-4 grid gap-2 text-sm text-slate-300">
                  <p>车牌号：{normalizePlateText(frame.bestPlateResult?.plate_text) || "未识别到"}</p>
                  <p>流程耗时：{formatSeconds(frame.stageTimings?.total_pipeline_sec)}</p>
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-[24px] border border-white/10 bg-slate-950/40 p-5 text-sm text-slate-400">
              打开摄像头并开始扫描后，命中帧会实时追加到这里。
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

type MetricBlockProps = {
  label: string
  value: string
}

function MetricBlock({ label, value }: MetricBlockProps) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-slate-950/40 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  )
}
