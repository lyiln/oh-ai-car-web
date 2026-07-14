import { useMemo, useState } from "react"
import { Crop, ImageIcon, LocateFixed, ScanSearch, SquareDashedBottomCode, Target } from "lucide-react"

import { cn } from "@/lib/utils"
import type { InferResponse } from "@/types/inference"

type ImageStageProps = {
  previewUrl: string | null
  result: InferResponse | null
}

type StageKey = "preview" | "car" | "primary" | "primaryCrop" | "plate" | "crop"

export function ImageStage({ previewUrl, result }: ImageStageProps) {
  const tabs = useMemo(() => {
    return [
      { key: "preview" as StageKey, label: "原图", url: previewUrl || result?.imageUrls.uploadedImageUrl, icon: ImageIcon },
      { key: "car" as StageKey, label: "车辆检测", url: result?.imageUrls.carVisualUrl, icon: LocateFixed },
      { key: "primary" as StageKey, label: "主体车框", url: result?.imageUrls.primaryCarVisualUrl, icon: Target },
      { key: "primaryCrop" as StageKey, label: "主体车ROI", url: result?.imageUrls.primaryCarCropUrl, icon: Crop },
      { key: "plate" as StageKey, label: "车牌检测", url: result?.imageUrls.plateVisualUrl, icon: ScanSearch },
      { key: "crop" as StageKey, label: "车牌裁剪", url: result?.imageUrls.plateCropUrl, icon: SquareDashedBottomCode },
    ].filter((item) => Boolean(item.url))
  }, [previewUrl, result])

  const [activeTab, setActiveTab] = useState<StageKey>("preview")
  const currentTab = tabs.find((item) => item.key === activeTab) ?? tabs[0]

  return (
    <section className="rounded-[30px] border border-white/12 bg-[#081224]/80 p-6 shadow-[0_22px_80px_rgba(2,8,23,0.45)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">图像舞台</p>
          <h3 className="text-lg font-semibold text-white">上传预览与检测结果</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const active = currentTab?.key === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs transition",
                  active
                    ? "border-cyan-300/60 bg-cyan-300/12 text-cyan-50"
                    : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-cyan-300/40 hover:text-white",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-[26px] border border-white/10 bg-slate-950/60">
        {currentTab?.url ? (
          <img src={currentTab.url} alt={currentTab.label} className="h-[420px] w-full object-contain" />
        ) : (
          <div className="flex h-[420px] items-center justify-center text-center text-sm text-slate-400">
            请先上传图片并执行识别，结果图会显示在这里。
          </div>
        )}
      </div>
    </section>
  )
}
