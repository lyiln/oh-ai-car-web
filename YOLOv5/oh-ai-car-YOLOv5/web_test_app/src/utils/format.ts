export function formatConfidence(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A"
  }
  return `${(value * 100).toFixed(1)}%`
}

export function formatSeconds(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A"
  }
  return `${value.toFixed(2)} s`
}

export function normalizePlateText(value: string | null | undefined): string {
  if (!value) {
    return ""
  }
  return value.replace(/\s+/g, "")
}

export function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function describePipelineStatus(status: string): string {
  switch (status) {
    case "plate_found":
      return "识别成功"
    case "car_found_but_no_plate":
      return "检测到车辆，但未识别到有效车牌"
    case "no_car_detected":
      return "未检测到车辆，未进入车牌识别"
    default:
      return "状态未知"
  }
}

export function getStatusTone(status: string): "success" | "warn" | "danger" | "neutral" {
  switch (status) {
    case "plate_found":
      return "success"
    case "car_found_but_no_plate":
      return "warn"
    case "no_car_detected":
      return "danger"
    default:
      return "neutral"
  }
}
