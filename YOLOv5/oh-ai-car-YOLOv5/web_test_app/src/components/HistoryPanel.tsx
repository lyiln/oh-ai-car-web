import { Clock3, FileScan } from "lucide-react"

import { StatusChip } from "@/components/StatusChip"
import type { HistoryEntry } from "@/types/inference"
import { formatDateTime, describePipelineStatus, getStatusTone, normalizePlateText } from "@/utils/format"

type HistoryPanelProps = {
  history: HistoryEntry[]
}

export function HistoryPanel({ history }: HistoryPanelProps) {
  return (
    <section className="rounded-[30px] border border-white/12 bg-[#07101f]/80 p-6 shadow-[0_22px_80px_rgba(2,8,23,0.45)]">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-400/12 text-cyan-100">
          <Clock3 className="h-5 w-5" />
        </span>
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">历史记录</p>
          <h3 className="text-lg font-semibold text-white">最近测试结果</h3>
        </div>
      </div>

      <div className="mt-5 max-h-[420px] space-y-3 overflow-y-auto pr-1">
        {history.length === 0 ? (
          <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-400">
            这里会显示最近几次图片测试摘要，方便你快速对比不同样本的识别情况。
          </div>
        ) : (
          history.map((item) => (
            <article key={item.id} className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-cyan-100">
                    <FileScan className="h-4 w-4 shrink-0" />
                    <p className="truncate text-sm font-medium text-white">{item.sourceName}</p>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    {formatDateTime(item.createdAt)} · {item.mode === "camera" ? "摄像头" : item.mode === "video" ? "视频" : "图片"}
                  </p>
                </div>
                <StatusChip label={describePipelineStatus(item.status)} tone={getStatusTone(item.status)} />
              </div>
              <div className="mt-3 grid gap-2 text-sm text-slate-300">
                <p>车牌号：{normalizePlateText(item.plateText) || "未识别到"}</p>
                <p>{item.summary}</p>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  )
}
