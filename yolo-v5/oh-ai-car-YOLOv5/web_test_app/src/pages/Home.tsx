import type { ReactNode } from "react"
import { useCallback, useEffect, useState } from "react"
import { DatabaseZap, Radar, Workflow } from "lucide-react"

import { CameraScanner, type CaptureSummary } from "@/components/CameraScanner"
import { HealthBanner } from "@/components/HealthBanner"
import { HistoryPanel } from "@/components/HistoryPanel"
import { ImageStage } from "@/components/ImageStage"
import { ResultOverview } from "@/components/ResultOverview"
import { StatusChip } from "@/components/StatusChip"
import { TimingComparison } from "@/components/TimingComparison"
import { UploadZone } from "@/components/UploadZone"
import { VideoScanPanel } from "@/components/VideoScanPanel"
import { useImagePreview } from "@/hooks/useImagePreview"
import { useInferenceStore } from "@/store/useInferenceStore"
import type { HealthResponse, InferResponse, VideoInferResponse } from "@/types/inference"
import { formatConfidence, formatSeconds, normalizePlateText } from "@/utils/format"

export default function Home() {
  const [cameraMode, setCameraMode] = useState(false)
  const [cameraSummary, setCameraSummary] = useState<CaptureSummary>({
    framesScanned: 0,
    matchedCountTotal: 0,
    matchedFrames: [],
    latestResult: null,
    scanning: false,
    cameraReady: false,
    lastLatencySec: null,
    cameraStatusText: "摄像头未开启",
    deviceLabel: "--",
    videoResolution: "--",
    trackResolution: "--",
    latestFramePreviewUrl: null,
    latestFrameBrightness: null,
  })

  const {
    health,
    checkingHealth,
    selectedFile,
    previewUrl,
    result,
    videoResult,
    history,
    running,
    errorMessage,
    setHealth,
    setCheckingHealth,
    setSelectedFile,
    setPreviewUrl,
    setResult,
    setVideoResult,
    appendImageHistory,
    appendVideoHistory,
    appendCameraHistory,
    setRunning,
    setErrorMessage,
  } = useInferenceStore()

  useImagePreview(selectedFile, setPreviewUrl)

  const fetchHealth = useCallback(async () => {
    setCheckingHealth(true)
    try {
      const response = await fetch("/api/health")
      const data = (await response.json()) as HealthResponse
      setHealth(data)
    } catch {
      setHealth(null)
      setErrorMessage("无法连接后端接口，请确认 FastAPI 服务已经启动。")
    } finally {
      setCheckingHealth(false)
    }
  }, [setCheckingHealth, setErrorMessage, setHealth])

  useEffect(() => {
    void fetchHealth()
  }, [fetchHealth])

  const handleInfer = useCallback(async () => {
    if (!selectedFile) {
      setErrorMessage("请先选择图片或视频。")
      return
    }

    const isVideo = selectedFile.type.startsWith("video/") || /\.(mp4|avi|mov|mkv|webm)$/i.test(selectedFile.name)
    setRunning(true)
    setErrorMessage(null)
    setResult(null)
    setVideoResult(null)
    setCameraMode(false)

    const formData = new FormData()
    formData.append(isVideo ? "video" : "image", selectedFile)
    if (isVideo) {
      formData.append("sample_fps", "1")
      formData.append("max_frames", "20")
    }

    try {
      const response = await fetch(isVideo ? "/api/infer-video" : "/api/infer", {
        method: "POST",
        body: formData,
      })
      const data = (await response.json()) as InferResponse | VideoInferResponse | { detail?: string }
      if (!response.ok) {
        throw new Error("detail" in data && data.detail ? data.detail : "识别失败，请检查后端日志。")
      }

      if (isVideo) {
        setVideoResult(data as VideoInferResponse)
        appendVideoHistory(data as VideoInferResponse)
      } else {
        setResult(data as InferResponse)
        appendImageHistory(data as InferResponse)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "识别失败，请稍后重试。")
    } finally {
      setRunning(false)
    }
  }, [appendImageHistory, appendVideoHistory, selectedFile, setErrorMessage, setResult, setRunning, setVideoResult])

  const handleCameraSessionChange = useCallback((summary: CaptureSummary) => {
    setCameraSummary(summary)
  }, [])

  const handleCameraMatch = useCallback((matchedResult: InferResponse, frameNumber: number) => {
    setResult(matchedResult)
    setVideoResult(null)
    appendCameraHistory(matchedResult, frameNumber)
  }, [appendCameraHistory, setResult, setVideoResult])

  const activeResult = cameraMode ? cameraSummary.latestResult : result

  const primaryPlateText = cameraMode
    ? normalizePlateText(cameraSummary.matchedFrames[0]?.bestPlateResult?.plate_text) || normalizePlateText(cameraSummary.latestResult?.bestPlateResult?.plate_text) || "--"
    : videoResult
    ? normalizePlateText(videoResult.matchedFrames[0]?.bestPlateResult?.plate_text) || "--"
    : normalizePlateText(result?.bestPlateResult?.plate_text) || "--"
  const primaryStatus = cameraMode
    ? cameraSummary.scanning
      ? `实时扫描 ${cameraSummary.framesScanned} 帧`
      : cameraSummary.cameraReady
        ? "摄像头已连接"
        : "等待开启摄像头"
    : videoResult ? `${videoResult.matchedFrameCount} 帧命中` : result?.status || "等待识别"
  const topCarMetric = cameraMode
    ? String(cameraSummary.matchedCountTotal)
    : videoResult ? String(videoResult.matchedFrameCount) : result ? String(result.carDetectionCount) : "--"

  return (
    <main className="mx-auto min-h-screen max-w-[1560px] px-4 py-6 md:px-8 md:py-8">
      <header className="relative overflow-hidden rounded-[34px] border border-white/12 bg-[linear-gradient(145deg,rgba(6,17,34,0.96),rgba(10,28,52,0.78))] p-6 shadow-[0_26px_120px_rgba(2,8,23,0.5)] md:p-8">
        <div className="absolute inset-y-0 right-0 w-[42%] bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.16),rgba(15,23,42,0))]" />
        <div className="relative z-10 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusChip label="车辆门控" tone="neutral" />
              <StatusChip label="车牌检测" tone="neutral" />
              <StatusChip label="OCR识别" tone="neutral" />
              <StatusChip label="视频抽帧" tone="neutral" />
              <StatusChip label="实时摄像头" tone="neutral" />
            </div>
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.35em] text-cyan-200/70">YOLOv5 PLATE TEST CONSOLE</p>
              <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-white md:text-5xl">
                本地图片 / 视频扫描测试台
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-slate-300 md:text-base">
                上传图片时，系统执行单张识别；上传视频时，系统会自动抽帧；切换到摄像头模式后，系统会持续抓取实时画面并筛出同时存在车辆和车牌的命中帧。
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <TopMetric icon={<Radar className="h-4 w-4" />} title="命中统计" value={topCarMetric} />
            <TopMetric icon={<DatabaseZap className="h-4 w-4" />} title="车牌结果" value={primaryPlateText} />
            <TopMetric icon={<Workflow className="h-4 w-4" />} title="当前状态" value={primaryStatus} />
          </div>
        </div>
      </header>

      <div className="mt-6">
        <HealthBanner health={health} checking={checkingHealth} />
      </div>

      {errorMessage ? (
        <div className="mt-6 rounded-[24px] border border-rose-400/25 bg-rose-400/10 px-5 py-4 text-sm text-rose-100">
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)_360px]">
        <UploadZone
          selectedFile={selectedFile}
          running={running}
          cameraMode={cameraMode}
          onFileSelect={setSelectedFile}
          onSubmit={handleInfer}
          onToggleCameraMode={() => {
            setCameraMode((value) => !value)
            setErrorMessage(null)
            setVideoResult(null)
          }}
        />
        {cameraMode ? (
          <CameraScanner
            onLatestResult={setResult}
            onMatchedFrame={handleCameraMatch}
            onSessionChange={handleCameraSessionChange}
            onError={setErrorMessage}
          />
        ) : videoResult ? <VideoScanPanel result={videoResult} /> : <ImageStage previewUrl={previewUrl} result={result} />}
        <HistoryPanel history={history} />
      </div>

      {cameraMode ? (
        <>
          <section className="mt-6 rounded-[30px] border border-white/12 bg-white/[0.06] p-6 shadow-[0_22px_80px_rgba(2,8,23,0.45)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">摄像头摘要</p>
                <h3 className="text-lg font-semibold text-white">实时命中统计</h3>
              </div>
              <StatusChip
                label={cameraSummary.matchedCountTotal > 0 ? `已命中 ${cameraSummary.matchedCountTotal} 帧` : "暂无命中帧"}
                tone={cameraSummary.matchedCountTotal > 0 ? "success" : "neutral"}
              />
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-4">
              <InfoItem label="已扫描帧数" value={`${cameraSummary.framesScanned}`} />
              <InfoItem label="命中帧数" value={`${cameraSummary.matchedCountTotal}`} />
              <InfoItem label="最近单帧耗时" value={formatSeconds(cameraSummary.lastLatencySec)} />
              <InfoItem label="最近命中车牌" value={normalizePlateText(cameraSummary.matchedFrames[0]?.bestPlateResult?.plate_text) || "--"} />
            </div>
          </section>

          <div className="mt-6">
            <ResultOverview result={activeResult} />
          </div>

          <div className="mt-6">
            <TimingComparison result={activeResult} />
          </div>
        </>
      ) : videoResult ? (
        <section className="mt-6 rounded-[30px] border border-white/12 bg-white/[0.06] p-6 shadow-[0_22px_80px_rgba(2,8,23,0.45)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">视频摘要</p>
              <h3 className="text-lg font-semibold text-white">扫描统计</h3>
            </div>
            <StatusChip label={videoResult.matchedFrameCount > 0 ? "已找到命中帧" : "未找到命中帧"} tone={videoResult.matchedFrameCount > 0 ? "success" : "neutral"} />
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <InfoItem label="视频文件" value={videoResult.videoName} />
            <InfoItem label="抽帧摘要" value={videoResult.summary} />
            <InfoItem label="平均单帧耗时" value={formatSeconds(videoResult.aggregateTimings.avgPipelineSec)} />
          </div>
        </section>
      ) : (
        <>
          <div className="mt-6">
            <ResultOverview result={activeResult} />
          </div>

          <div className="mt-6">
            <TimingComparison result={activeResult} />
          </div>

          <section className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <article className="rounded-[30px] border border-white/12 bg-white/[0.06] p-6 shadow-[0_22px_80px_rgba(2,8,23,0.45)]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">结构化输出</p>
                  <h3 className="text-lg font-semibold text-white">车辆检测详情</h3>
                </div>
                <StatusChip label={activeResult?.carDetected ? "已检测到车辆" : "等待结果"} tone={activeResult?.carDetected ? "success" : "neutral"} />
              </div>
              <div className="mt-5 grid gap-3">
                {activeResult?.primaryCar ? (
                  <div className="rounded-[22px] border border-cyan-300/25 bg-cyan-300/10 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-medium text-white">主体车</p>
                      <p className="text-sm text-cyan-100">置信度 {formatConfidence(activeResult.primaryCar.confidence)}</p>
                    </div>
                    <p className="mt-2 text-xs text-slate-300">主体框: [{activeResult.primaryCar.bbox.join(", ")}]</p>
                    <p className="mt-1 text-xs text-slate-400">ROI框: [{activeResult.primaryCar.crop_bbox?.join(", ") || "--"}]</p>
                  </div>
                ) : null}
                {activeResult?.carDetections?.length ? (
                  activeResult.carDetections.map((item, index) => (
                    <div key={`${item.confidence}-${index}`} className="rounded-[22px] border border-white/10 bg-slate-950/40 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-medium text-white">{item.class_name || "vehicle"}</p>
                        <p className="text-sm text-cyan-100">置信度 {`${(item.confidence * 100).toFixed(1)}%`}</p>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">BBox: [{item.bbox.join(", ")}]</p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[22px] border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-400">
                    还没有车辆检测结果。上传图片后，这里会展示车辆类别、置信度和检测框坐标。
                  </div>
                )}
              </div>
            </article>

            <article className="rounded-[30px] border border-white/12 bg-white/[0.06] p-6 shadow-[0_22px_80px_rgba(2,8,23,0.45)]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">关键结果</p>
                  <h3 className="text-lg font-semibold text-white">车牌与运行路径</h3>
                </div>
                <StatusChip label={activeResult?.bestPlateResult?.plate_text ? "已输出车牌" : "等待结果"} tone={activeResult?.bestPlateResult?.plate_text ? "success" : "neutral"} />
              </div>
              <div className="mt-5 space-y-3">
                <InfoItem label="车牌号码" value={normalizePlateText(activeResult?.bestPlateResult?.plate_text) || "未识别到"} />
                <InfoItem label="OCR 置信度" value={activeResult?.bestPlateResult?.ocr_confidence != null ? `${(activeResult.bestPlateResult.ocr_confidence * 100).toFixed(1)}%` : "N/A"} />
                <InfoItem label="车牌检测耗时" value={formatSeconds(activeResult?.stageTimings?.plate_detection_sec)} />
                <InfoItem label="OCR耗时" value={formatSeconds(activeResult?.stageTimings?.ocr_sec)} />
                <InfoItem label="原始结果路径" value={activeResult?.rawResultPath || "--"} />
                <InfoItem label="流程摘要" value={activeResult?.summary || "上传图片后开始识别"} />
              </div>
            </article>
          </section>
        </>
      )}
    </main>
  )
}

type TopMetricProps = {
  icon: ReactNode
  title: string
  value: string
}

function TopMetric({ icon, title, value }: TopMetricProps) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.05] px-4 py-4 backdrop-blur-md">
      <div className="flex items-center gap-2 text-cyan-100">
        {icon}
        <span className="text-xs uppercase tracking-[0.22em] text-cyan-200/70">{title}</span>
      </div>
      <p className="mt-3 break-all text-lg font-semibold text-white">{value}</p>
    </div>
  )
}

type InfoItemProps = {
  label: string
  value: string
}

function InfoItem({ label, value }: InfoItemProps) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-slate-950/40 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 break-all text-sm text-slate-100">{value}</p>
    </div>
  )
}
