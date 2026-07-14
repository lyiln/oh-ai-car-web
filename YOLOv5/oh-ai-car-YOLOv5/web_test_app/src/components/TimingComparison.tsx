import type { ReactNode } from "react"
import { Gauge, ScanSearch, TimerReset, Waypoints } from "lucide-react"

import { StatusChip } from "@/components/StatusChip"
import type { InferResponse } from "@/types/inference"
import { formatSeconds } from "@/utils/format"

type TimingComparisonProps = {
  result: InferResponse | null
}

export function TimingComparison({ result }: TimingComparisonProps) {
  const timings = result?.stageTimings

  return (
    <section className="rounded-[30px] border border-white/12 bg-white/[0.06] p-6 shadow-[0_22px_80px_rgba(2,8,23,0.45)]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">耗时对比</p>
          <h3 className="text-lg font-semibold text-white">主体车模式阶段耗时</h3>
        </div>
        <StatusChip label={result ? "主体车 ROI 已启用" : "等待识别"} tone={result ? "success" : "neutral"} />
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <TimingCard
          icon={<Waypoints className="h-4 w-4" />}
          title="汽车检测"
          value={formatSeconds(timings?.car_detection_sec)}
          detail="整张图先筛出车辆，再选主体车。"
        />
        <TimingCard
          icon={<ScanSearch className="h-4 w-4" />}
          title="车牌检测"
          value={formatSeconds(timings?.plate_detection_sec)}
          detail="只在主体车 ROI 内执行车牌检测。"
        />
        <TimingCard
          icon={<TimerReset className="h-4 w-4" />}
          title="OCR 识别"
          value={formatSeconds(timings?.ocr_sec)}
          detail="只对主体车里的候选车牌做 OCR。"
        />
        <TimingCard
          icon={<Gauge className="h-4 w-4" />}
          title="总耗时"
          value={formatSeconds(timings?.total_pipeline_sec)}
          detail="包含流程调度、裁剪与文件落盘。"
        />
      </div>
    </section>
  )
}

type TimingCardProps = {
  icon: ReactNode
  title: string
  value: string
  detail: string
}

function TimingCard({ icon, title, value, detail }: TimingCardProps) {
  return (
    <article className="rounded-[24px] border border-white/10 bg-slate-950/40 p-4">
      <div className="flex items-center gap-2 text-cyan-100">
        {icon}
        <p className="text-xs uppercase tracking-[0.22em] text-cyan-200/70">{title}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p>
    </article>
  )
}
