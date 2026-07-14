import { cn } from "@/lib/utils"

type StatusChipProps = {
  label: string
  tone?: "success" | "warn" | "danger" | "neutral"
}

const toneClassMap: Record<NonNullable<StatusChipProps["tone"]>, string> = {
  success: "border-emerald-400/35 bg-emerald-400/10 text-emerald-100",
  warn: "border-amber-400/35 bg-amber-400/10 text-amber-100",
  danger: "border-rose-400/35 bg-rose-400/10 text-rose-100",
  neutral: "border-white/15 bg-white/8 text-slate-100",
}

export function StatusChip({ label, tone = "neutral" }: StatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium tracking-[0.18em]",
        toneClassMap[tone],
      )}
    >
      {label}
    </span>
  )
}
