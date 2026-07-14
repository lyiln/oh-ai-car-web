import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import { Clapperboard, Film, ScanSearch, TimerReset, Trophy } from "lucide-react"

import { StatusChip } from "@/components/StatusChip"
import { cn } from "@/lib/utils"
import type { VideoInferResponse } from "@/types/inference"
import { formatConfidence, formatSeconds, normalizePlateText } from "@/utils/format"

type VideoScanPanelProps = {
  result: VideoInferResponse | null
}

export function VideoScanPanel({ result }: VideoScanPanelProps) {
  const [activeFrameKey, setActiveFrameKey] = useState<string | null>(null)

  useEffect(() => {
    if (!result?.matchedFrames.length) {
      setActiveFrameKey(null)
      return
    }
    setActiveFrameKey(`${result.matchedFrames[0].sampleIndex}-${result.matchedFrames[0].frameIndex}`)
  }, [result])

  const activeFrame = useMemo(() => {
    if (!result?.matchedFrames.length) {
      return null
    }
    return result.matchedFrames.find((frame) => `${frame.sampleIndex}-${frame.frameIndex}` === activeFrameKey) ?? result.matchedFrames[0]
  }, [activeFrameKey, result])

  return (
    <section className="space-y-6">
      <article className="rounded-[30px] border border-white/12 bg-white/[0.06] p-6 shadow-[0_22px_80px_rgba(2,8,23,0.45)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">视频扫描</p>
            <h3 className="text-lg font-semibold text-white">视频扫描总览</h3>
          </div>
          <StatusChip
            label={result ? `命中 ${result.matchedFrameCount} 帧` : "等待扫描"}
            tone={result && result.matchedFrameCount > 0 ? "success" : "neutral"}
          />
        </div>

        {result ? (
          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <div className="overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/50">
              {result.uploadedVideoUrl ? (
                <video
                  src={result.uploadedVideoUrl}
                  controls
                  preload="metadata"
                  className="h-[280px] w-full bg-slate-950 object-contain"
                />
              ) : (
                <div className="flex h-[280px] items-center justify-center bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),rgba(2,8,23,0))] text-sm text-slate-400">
                  当前结果未提供原始视频预览
                </div>
              )}

              <div className="border-t border-white/10 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip label={`${result.sampling.frameCount} 原始帧`} tone="neutral" />
                  <StatusChip label={`${result.sampling.sampledFrameCount} 抽样帧`} tone="neutral" />
                  <StatusChip label={`${result.matchedFrameCount} 命中帧`} tone={result.matchedFrameCount > 0 ? "success" : "neutral"} />
                </div>
                <p className="mt-3 text-sm text-slate-300">
                  视频文件：<span className="font-medium text-white">{result.videoName}</span>
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  扫描摘要：{result.summary}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <MetricCard icon={<Film className="h-4 w-4" />} title="抽帧数" value={`${result.sampling.sampledFrameCount} 帧`} />
                <MetricCard icon={<Trophy className="h-4 w-4" />} title="命中帧" value={`${result.matchedFrameCount} 帧`} />
                <MetricCard
                  icon={<TimerReset className="h-4 w-4" />}
                  title="平均单帧耗时"
                  value={formatSeconds(result.aggregateTimings.avgPipelineSec)}
                />
                <MetricCard
                  icon={<ScanSearch className="h-4 w-4" />}
                  title="总扫描耗时"
                  value={formatSeconds(result.aggregateTimings.totalPipelineSec)}
                />
              </div>

              <div className="rounded-[24px] border border-white/10 bg-slate-950/40 p-4">
                <div className="flex items-center gap-2 text-cyan-100">
                  <Clapperboard className="h-4 w-4" />
                  <p className="text-xs uppercase tracking-[0.22em] text-cyan-200/70">抽帧策略</p>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <DetailItem label="原始 FPS" value={`${result.sampling.fps.toFixed(2)}`} />
                  <DetailItem label="采样 FPS" value={`${result.sampling.sampleFps.toFixed(2)}`} />
                  <DetailItem label="视频时长" value={formatSeconds(result.sampling.durationSec)} />
                  <DetailItem label="帧步长" value={`${result.sampling.frameStride}`} />
                  <DetailItem label="最大扫描帧数" value={`${result.sampling.maxFrames}`} />
                  <DetailItem label="本次实际扫描" value={`${result.scannedFrames}`} />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-[24px] border border-white/10 bg-slate-950/40 p-5 text-sm text-slate-400">
            上传视频后，这里会展示原始视频预览、抽帧统计、命中帧数量和扫描耗时。
          </div>
        )}
      </article>

      <article className="rounded-[30px] border border-white/12 bg-white/[0.06] p-6 shadow-[0_22px_80px_rgba(2,8,23,0.45)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">命中帧列表</p>
            <h3 className="text-lg font-semibold text-white">车辆与车牌同时命中的帧</h3>
          </div>
          <StatusChip
            label={activeFrame ? `当前查看第 ${activeFrame.sampleIndex} 个采样帧` : result?.matchedFrames.length ? "可复核" : "暂无命中"}
            tone={result?.matchedFrames.length ? "success" : "neutral"}
          />
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
          {result?.matchedFrames.length ? (
            <>
              <div className="space-y-3">
                {result.matchedFrames.map((frame) => {
                  const frameKey = `${frame.sampleIndex}-${frame.frameIndex}`
                  const isActive = activeFrameKey === frameKey

                  return (
                    <button
                      key={frameKey}
                      type="button"
                      onClick={() => setActiveFrameKey(frameKey)}
                      className={cn(
                        "w-full rounded-[22px] border p-4 text-left transition",
                        isActive
                          ? "border-cyan-300/40 bg-cyan-300/10 shadow-[0_0_0_1px_rgba(103,232,249,0.18)]"
                          : "border-white/10 bg-slate-950/40 hover:border-cyan-300/30 hover:bg-white/[0.05]",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white">第 {frame.sampleIndex} 个采样帧</p>
                          <p className="mt-1 text-xs text-slate-400">
                            帧号 {frame.frameIndex} · 时间点 {frame.timestampSec.toFixed(2)} s
                          </p>
                        </div>
                        <StatusChip
                          label={normalizePlateText(frame.bestPlateResult?.plate_text) || "未识别"}
                          tone={frame.bestPlateResult?.plate_text ? "success" : "warn"}
                        />
                      </div>

                      <div className="mt-4 grid gap-2 text-sm text-slate-300 sm:grid-cols-3">
                        <QuickStat label="OCR" value={formatConfidence(frame.bestPlateResult?.ocr_confidence)} />
                        <QuickStat label="车辆数" value={`${frame.carDetectionCount}`} />
                        <QuickStat label="耗时" value={formatSeconds(frame.stageTimings?.total_pipeline_sec)} />
                      </div>
                    </button>
                  )
                })}
              </div>

              <article className="rounded-[24px] border border-white/10 bg-slate-950/40 p-4">
                {activeFrame ? (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">当前复核帧</p>
                        <p className="mt-1 text-xs text-slate-400">
                          第 {activeFrame.sampleIndex} 个采样帧 · 帧号 {activeFrame.frameIndex} · {activeFrame.timestampSec.toFixed(2)} s
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <StatusChip label={normalizePlateText(activeFrame.bestPlateResult?.plate_text) || "未识别到车牌"} tone={activeFrame.bestPlateResult?.plate_text ? "success" : "warn"} />
                        <StatusChip label={activeFrame.carDetected ? "已过车辆门控" : "未过车辆门控"} tone={activeFrame.carDetected ? "success" : "danger"} />
                      </div>
                    </div>

                    <div className="mt-4 overflow-hidden rounded-[18px] border border-white/10 bg-slate-900/70">
                      {activeFrame.imageUrls.primaryCarVisualUrl || activeFrame.imageUrls.uploadedImageUrl ? (
                        <img
                          src={activeFrame.imageUrls.primaryCarVisualUrl || activeFrame.imageUrls.uploadedImageUrl || undefined}
                          alt={`视频命中帧 ${activeFrame.sampleIndex}`}
                          className="h-[360px] w-full object-contain"
                        />
                      ) : (
                        <div className="flex h-[360px] items-center justify-center text-sm text-slate-500">该帧暂无可视化图</div>
                      )}
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      <DetailItem label="车牌号" value={normalizePlateText(activeFrame.bestPlateResult?.plate_text) || "未识别到"} />
                      <DetailItem label="OCR 置信度" value={formatConfidence(activeFrame.bestPlateResult?.ocr_confidence)} />
                      <DetailItem label="流程耗时" value={formatSeconds(activeFrame.stageTimings?.total_pipeline_sec)} />
                      <DetailItem label="车牌检测耗时" value={formatSeconds(activeFrame.stageTimings?.plate_detection_sec)} />
                      <DetailItem label="OCR 耗时" value={formatSeconds(activeFrame.stageTimings?.ocr_sec)} />
                      <DetailItem label="主体车置信度" value={formatConfidence(activeFrame.primaryCar?.confidence)} />
                    </div>

                    {(activeFrame.imageUrls.primaryCarCropUrl || activeFrame.imageUrls.plateCropUrl) ? (
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <ImagePreviewCard
                          title="主体车 ROI"
                          src={activeFrame.imageUrls.primaryCarCropUrl}
                          alt={`主体车 ROI ${activeFrame.sampleIndex}`}
                          emptyText="暂无主体车 ROI"
                        />
                        <ImagePreviewCard
                          title="车牌裁剪图"
                          src={activeFrame.imageUrls.plateCropUrl}
                          alt={`车牌裁剪图 ${activeFrame.sampleIndex}`}
                          emptyText="暂无车牌裁剪图"
                        />
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="flex min-h-[360px] items-center justify-center text-sm text-slate-500">
                    请选择左侧命中帧查看详情
                  </div>
                )}
              </article>
            </>
          ) : (
            <div className="rounded-[24px] border border-white/10 bg-slate-950/40 p-5 text-sm text-slate-400 xl:col-span-2">
              扫描完成后，只有同时检测到车辆和车牌的帧会出现在这里。
            </div>
          )}
        </div>
      </article>
    </section>
  )
}

type MetricCardProps = {
  icon: ReactNode
  title: string
  value: string
}

function MetricCard({ icon, title, value }: MetricCardProps) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-slate-950/40 p-4">
      <div className="flex items-center gap-2 text-cyan-100">
        {icon}
        <p className="text-xs uppercase tracking-[0.22em] text-cyan-200/70">{title}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
    </div>
  )
}

type DetailItemProps = {
  label: string
  value: string
}

function DetailItem({ label, value }: DetailItemProps) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-slate-900/60 p-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 break-all text-sm text-slate-100">{value}</p>
    </div>
  )
}

type QuickStatProps = {
  label: string
  value: string
}

function QuickStat({ label, value }: QuickStatProps) {
  return (
    <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm text-slate-100">{value}</p>
    </div>
  )
}

type ImagePreviewCardProps = {
  title: string
  src: string | null | undefined
  alt: string
  emptyText: string
}

function ImagePreviewCard({ title, src, alt, emptyText }: ImagePreviewCardProps) {
  return (
    <div className="overflow-hidden rounded-[20px] border border-white/10 bg-slate-900/60">
      <div className="border-b border-white/10 px-4 py-3">
        <p className="text-sm font-medium text-white">{title}</p>
      </div>
      {src ? (
        <img src={src} alt={alt} className="h-52 w-full object-contain" />
      ) : (
        <div className="flex h-52 items-center justify-center text-sm text-slate-500">{emptyText}</div>
      )}
    </div>
  )
}
