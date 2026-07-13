import type { ReactNode } from "react"
import { Film, TimerReset, Trophy } from "lucide-react"

import { StatusChip } from "@/components/StatusChip"
import type { VideoInferResponse } from "@/types/inference"
import { formatSeconds, normalizePlateText } from "@/utils/format"

type VideoScanPanelProps = {
  result: VideoInferResponse | null
}

export function VideoScanPanel({ result }: VideoScanPanelProps) {
  return (
    <section className="space-y-6">
      <article className="rounded-[30px] border border-white/12 bg-white/[0.06] p-6 shadow-[0_22px_80px_rgba(2,8,23,0.45)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">视频扫描</p>
            <h3 className="text-lg font-semibold text-white">抽帧命中摘要</h3>
          </div>
          <StatusChip
            label={result ? `命中 ${result.matchedFrameCount} 帧` : "等待扫描"}
            tone={result && result.matchedFrameCount > 0 ? "success" : "neutral"}
          />
        </div>

        {result ? (
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <MetricCard icon={<Film className="h-4 w-4" />} title="抽帧数" value={`${result.sampling.sampledFrameCount} 帧`} />
            <MetricCard icon={<Trophy className="h-4 w-4" />} title="命中帧" value={`${result.matchedFrameCount} 帧`} />
            <MetricCard
              icon={<TimerReset className="h-4 w-4" />}
              title="平均单帧耗时"
              value={formatSeconds(result.aggregateTimings.avgPipelineSec)}
            />
          </div>
        ) : (
          <div className="mt-5 rounded-[24px] border border-white/10 bg-slate-950/40 p-5 text-sm text-slate-400">
            上传视频后，这里会展示抽帧统计、命中帧数量和平均扫描耗时。
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
            label={result?.matchedFrames.length ? "可复核" : "暂无命中"}
            tone={result?.matchedFrames.length ? "success" : "neutral"}
          />
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {result?.matchedFrames.length ? (
            result.matchedFrames.map((frame) => (
              <article key={`${frame.sampleIndex}-${frame.frameIndex}`} className="rounded-[24px] border border-white/10 bg-slate-950/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">第 {frame.sampleIndex} 个采样帧</p>
                    <p className="mt-1 text-xs text-slate-400">
                      帧号 {frame.frameIndex} · 时间点 {frame.timestampSec.toFixed(2)} s
                    </p>
                  </div>
                  <StatusChip label={normalizePlateText(frame.bestPlateResult?.plate_text) || "未识别"} tone="success" />
                </div>

                <div className="mt-4 overflow-hidden rounded-[18px] border border-white/10 bg-slate-900/70">
                  {frame.imageUrls.primaryCarVisualUrl || frame.imageUrls.uploadedImageUrl ? (
                    <img
                      src={frame.imageUrls.primaryCarVisualUrl || frame.imageUrls.uploadedImageUrl || undefined}
                      alt={`视频命中帧 ${frame.sampleIndex}`}
                      className="h-64 w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-64 items-center justify-center text-sm text-slate-500">该帧暂无可视化图</div>
                  )}
                </div>

                <div className="mt-4 grid gap-2 text-sm text-slate-300">
                  <p>车牌号：{normalizePlateText(frame.bestPlateResult?.plate_text) || "未识别到"}</p>
                  <p>OCR 置信度：{frame.bestPlateResult?.ocr_confidence != null ? `${(frame.bestPlateResult.ocr_confidence * 100).toFixed(1)}%` : "N/A"}</p>
                  <p>流程耗时：{formatSeconds(frame.stageTimings?.total_pipeline_sec)}</p>
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-[24px] border border-white/10 bg-slate-950/40 p-5 text-sm text-slate-400">
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
