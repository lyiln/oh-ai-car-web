import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { HealthBanner } from "@/components/HealthBanner"

describe("HealthBanner", () => {
  it("renders ready state labels", () => {
    render(
      <HealthBanner
        checking={false}
        health={{
          ok: true,
          pythonReady: true,
          yolov5Ready: true,
          carWeightsReady: true,
          plateWeightsReady: true,
          pipelineReady: true,
          pythonPath: "python.exe",
          carWeightsPath: "car.pt",
          plateWeightsPath: "plate.pt",
          message: "模型与运行环境已就绪",
        }}
      />,
    )

    expect(screen.getByText("本地推理环境检查")).toBeInTheDocument()
    expect(screen.getByText("后端就绪")).toBeInTheDocument()
    expect(screen.getByText("车辆权重")).toBeInTheDocument()
  })
})
