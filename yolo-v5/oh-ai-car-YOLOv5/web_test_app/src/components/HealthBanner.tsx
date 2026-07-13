import { Cpu, ShieldCheck, TriangleAlert } from "lucide-react"

import { StatusChip } from "@/components/StatusChip"
import type { HealthResponse } from "@/types/inference"

type HealthBannerProps = {
  health: HealthResponse | null
  checking: boolean
}

export function HealthBanner({ health, checking }: HealthBannerProps) {
  const ok = health?.ok ?? false

  return (
    <section className="rounded-[28px] border border-white/12 bg-white/[0.06] p-5 shadow-[0_24px_80px_rgba(2,8,23,0.45)] backdrop-blur-xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-400/12 text-cyan-100">
              <Cpu className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-cyan-200/70">模型状态面板</p>
              <h2 className="text-lg font-semibold text-white">本地推理环境检查</h2>
            </div>
          </div>
          <p className="max-w-2xl text-sm text-slate-300">
            {checking ? "正在检查 Python、YOLOv5 和模型权重状态..." : health?.message ?? "尚未获取后端状态"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {checking ? <StatusChip label="检查中" tone="neutral" /> : null}
          {!checking && health ? (
            <StatusChip label={ok ? "后端就绪" : "后端异常"} tone={ok ? "success" : "danger"} />
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <HealthItem label="Python 环境" ready={health?.pythonReady ?? false} />
        <HealthItem label="YOLOv5 目录" ready={health?.yolov5Ready ?? false} />
        <HealthItem label="车辆权重" ready={health?.carWeightsReady ?? false} />
        <HealthItem label="车牌权重" ready={health?.plateWeightsReady ?? false} />
        <HealthItem label="总控脚本" ready={health?.pipelineReady ?? false} />
      </div>
    </section>
  )
}

type HealthItemProps = {
  label: string
  ready: boolean
}

function HealthItem({ label, ready }: HealthItemProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-200">{label}</p>
        {ready ? (
          <ShieldCheck className="h-4 w-4 text-emerald-300" />
        ) : (
          <TriangleAlert className="h-4 w-4 text-amber-300" />
        )}
      </div>
      <p className="mt-2 text-xs text-slate-400">{ready ? "可用" : "未准备好"}</p>
    </div>
  )
}
