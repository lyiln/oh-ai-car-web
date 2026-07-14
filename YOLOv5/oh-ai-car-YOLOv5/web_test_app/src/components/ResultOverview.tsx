import type { ReactNode } from "react"
import { Car, ScanLine, ShieldCheck } from "lucide-react"

import { StatusChip } from "@/components/StatusChip"
import { formatConfidence, describePipelineStatus, getStatusTone, normalizePlateText } from "@/utils/format"
import type { InferResponse } from "@/types/inference"

type ResultOverviewProps = {
  result: InferResponse | null
}

export function ResultOverview({ result }: ResultOverviewProps) {
  return (
    <section className="grid gap-4 xl:grid-cols-3">
      <ResultCard
        icon={<Car className="h-5 w-5" />}
        eyebrow="车辆识别"
        title={result?.carDetected ? "检测到车辆" : "未检测到车辆"}
        tone={result ? (result.carDetected ? "success" : "danger") : "neutral"}
        metrics={[
          { label: "车辆数量", value: result ? String(result.carDetectionCount) : "--" },
          {
            label: "主体车置信度",
            value: formatConfidence(result?.primaryCar?.confidence),
          },
          {
            label: "主体车框",
            value: result?.primaryCar?.bbox ? `[${result.primaryCar.bbox.join(", ")}]` : "--",
          },
        ]}
      />
      <ResultCard
        icon={<ScanLine className="h-5 w-5" />}
        eyebrow="车牌识别"
        title={normalizePlateText(result?.bestPlateResult?.plate_text) || "暂无车牌结果"}
        tone={result ? (normalizePlateText(result.bestPlateResult?.plate_text) ? "success" : "warn") : "neutral"}
        metrics={[
          { label: "检测数量", value: result ? String(result.plateDetectionCount) : "--" },
          { label: "OCR 置信度", value: formatConfidence(result?.bestPlateResult?.ocr_confidence) },
        ]}
      />
      <ResultCard
        icon={<ShieldCheck className="h-5 w-5" />}
        eyebrow="总体状态"
        title={result ? describePipelineStatus(result.status) : "等待识别"}
        tone={result ? getStatusTone(result.status) : "neutral"}
        metrics={[
          { label: "状态码", value: result?.status ?? "--" },
          { label: "摘要", value: result?.summary ?? "上传图片后开始识别" },
        ]}
      />
    </section>
  )
}

type ResultCardProps = {
  eyebrow: string
  title: string
  tone: "success" | "warn" | "danger" | "neutral"
  icon: ReactNode
  metrics: Array<{ label: string; value: string }>
}

function ResultCard({ eyebrow, title, tone, icon, metrics }: ResultCardProps) {
  return (
    <article className="rounded-[28px] border border-white/12 bg-white/[0.06] p-5 shadow-[0_20px_60px_rgba(2,8,23,0.35)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 text-cyan-100">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-300/12">
            {icon}
          </span>
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">{eyebrow}</p>
            <h3 className="mt-1 text-base font-semibold text-white">{title}</h3>
          </div>
        </div>
        <StatusChip label={eyebrow} tone={tone} />
      </div>
      <div className="mt-4 grid gap-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-white/8 bg-slate-950/35 p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{metric.label}</p>
            <p className="mt-2 break-all text-sm text-slate-100">{metric.value}</p>
          </div>
        ))}
      </div>
    </article>
  )
}
