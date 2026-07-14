import { describe, expect, it } from "vitest"

import { describePipelineStatus, formatConfidence, formatSeconds, getStatusTone, normalizePlateText } from "@/utils/format"

describe("format utilities", () => {
  it("formats confidence as percent", () => {
    expect(formatConfidence(0.908)).toBe("90.8%")
  })

  it("returns N/A for missing confidence", () => {
    expect(formatConfidence(null)).toBe("N/A")
  })

  it("formats stage timings as seconds", () => {
    expect(formatSeconds(12.345)).toBe("12.35 s")
  })

  it("maps pipeline status to readable text", () => {
    expect(describePipelineStatus("plate_found")).toBe("识别成功")
    expect(getStatusTone("no_car_detected")).toBe("danger")
  })

  it("normalizes plate text whitespace", () => {
    expect(normalizePlateText("\n 皖A·12345 \t")).toBe("皖A·12345")
  })
})
