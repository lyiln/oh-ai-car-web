import { ChangeEvent, DragEvent, useRef, useState } from "react"
import { FileVideo2, ImagePlus, LoaderCircle, UploadCloud } from "lucide-react"

import { cn } from "@/lib/utils"

type UploadZoneProps = {
  selectedFile: File | null
  running: boolean
  cameraMode: boolean
  onFileSelect: (file: File | null) => void
  onSubmit: () => void
  onToggleCameraMode: () => void
}

export function UploadZone({ selectedFile, running, cameraMode, onFileSelect, onSubmit, onToggleCameraMode }: UploadZoneProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0] ?? null
    onFileSelect(file)
  }

  const fileTypeLabel = selectedFile?.type.startsWith("video/") ? "视频文件" : "图片文件"

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFiles(event.target.files)
  }

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    setDragging(false)
    handleFiles(event.dataTransfer.files)
  }

  return (
    <section className="rounded-[30px] border border-white/12 bg-[#07101f]/80 p-6 shadow-[0_22px_80px_rgba(2,8,23,0.45)]">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-400/12 text-cyan-100">
          <UploadCloud className="h-5 w-5" />
        </span>
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">输入</p>
          <h3 className="text-lg font-semibold text-white">上传图片或视频</h3>
        </div>
      </div>

      <button
        type="button"
        aria-label="上传图片或视频"
        aria-busy={running}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "mt-5 flex min-h-64 w-full flex-col items-center justify-center rounded-[28px] border border-dashed px-6 py-8 text-center transition duration-200",
          dragging
            ? "border-cyan-300 bg-cyan-300/10 shadow-[0_0_0_1px_rgba(103,232,249,0.35)]"
            : "border-white/15 bg-white/[0.04] hover:border-cyan-300/60 hover:bg-cyan-300/[0.06]",
        )}
      >
        <div className="mb-4 flex items-center gap-3 text-cyan-100">
          <ImagePlus className="h-10 w-10" />
          <FileVideo2 className="h-10 w-10" />
        </div>
        <p className="text-base font-medium text-white">拖拽图片或视频到这里，或点击选择文件</p>
        <p className="mt-2 text-sm text-slate-400">支持单张图片识别、视频抽帧扫描，或切换到实时摄像头扫描</p>
        {selectedFile ? (
          <div className="mt-5 rounded-2xl border border-cyan-400/20 bg-cyan-400/8 px-4 py-3 text-left">
            <p className="text-sm text-cyan-50">{selectedFile.name}</p>
            <p className="mt-1 text-xs text-cyan-100/70">
              {fileTypeLabel} · {(selectedFile.size / 1024).toFixed(1)} KB
            </p>
          </div>
        ) : null}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/bmp,image/webp,video/mp4,video/avi,video/quicktime,video/webm,.mkv"
        className="hidden"
        onChange={handleInputChange}
      />

      <button
        type="button"
        onClick={onSubmit}
        disabled={!selectedFile || running}
        className={cn(
          "mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 text-sm font-medium transition",
          !selectedFile || running
            ? "cursor-not-allowed bg-slate-800 text-slate-500"
            : "bg-cyan-300 text-slate-950 shadow-[0_12px_30px_rgba(34,211,238,0.28)] hover:bg-cyan-200",
        )}
      >
        {running ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        {running ? "模型处理中..." : "开始扫描"}
      </button>

      <button
        type="button"
        onClick={onToggleCameraMode}
        className={cn(
          "mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border px-5 py-4 text-sm font-medium transition",
          cameraMode
            ? "border-emerald-300/40 bg-emerald-300/12 text-emerald-50 hover:bg-emerald-300/18"
            : "border-white/10 bg-white/[0.04] text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-300/[0.06]",
        )}
      >
        <FileVideo2 className="h-4 w-4" />
        {cameraMode ? "返回图片 / 视频上传" : "切换到实时摄像头扫描"}
      </button>
    </section>
  )
}
