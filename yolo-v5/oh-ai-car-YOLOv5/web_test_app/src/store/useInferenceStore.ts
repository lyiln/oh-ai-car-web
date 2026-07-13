import { create } from "zustand"

import type { HealthResponse, HistoryEntry, InferResponse, VideoInferResponse } from "@/types/inference"
import { normalizePlateText } from "@/utils/format"

function buildHistoryEntry(entry: HistoryEntry): HistoryEntry {
  return entry
}

type InferenceStore = {
  health: HealthResponse | null
  checkingHealth: boolean
  selectedFile: File | null
  previewUrl: string | null
  result: InferResponse | null
  videoResult: VideoInferResponse | null
  history: HistoryEntry[]
  running: boolean
  errorMessage: string | null
  setHealth: (health: HealthResponse | null) => void
  setCheckingHealth: (checking: boolean) => void
  setSelectedFile: (file: File | null) => void
  setPreviewUrl: (previewUrl: string | null) => void
  setResult: (result: InferResponse | null) => void
  setVideoResult: (result: VideoInferResponse | null) => void
  appendImageHistory: (result: InferResponse) => void
  appendVideoHistory: (result: VideoInferResponse) => void
  appendCameraHistory: (result: InferResponse, frameNumber: number) => void
  setRunning: (running: boolean) => void
  setErrorMessage: (message: string | null) => void
}

export const useInferenceStore = create<InferenceStore>((set) => ({
  health: null,
  checkingHealth: true,
  selectedFile: null,
  previewUrl: null,
  result: null,
  videoResult: null,
  history: [],
  running: false,
  errorMessage: null,
  setHealth: (health) => set({ health }),
  setCheckingHealth: (checkingHealth) => set({ checkingHealth }),
  setSelectedFile: (selectedFile) => set({ selectedFile }),
  setPreviewUrl: (previewUrl) => set({ previewUrl }),
  setResult: (result) => set({ result }),
  setVideoResult: (videoResult) => set({ videoResult }),
  setRunning: (running) => set({ running }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),
  appendImageHistory: (result) =>
    set((state) => ({
      history: [
        buildHistoryEntry({
          id: crypto.randomUUID(),
          sourceName: result.imageName,
          summary: result.summary,
          status: result.status,
          carDetected: result.carDetected,
          plateDetected: result.plateDetected,
          plateText: normalizePlateText(result.bestPlateResult?.plate_text),
          mode: "image",
          createdAt: new Date().toISOString(),
        }),
        ...state.history,
      ].slice(0, 8),
    })),
  appendVideoHistory: (result) =>
    set((state) => ({
      history: [
        buildHistoryEntry({
          id: crypto.randomUUID(),
          sourceName: result.videoName,
          summary: result.summary,
          status: result.matchedFrameCount > 0 ? "plate_found" : "car_found_but_no_plate",
          carDetected: result.matchedFrameCount > 0,
          plateDetected: result.matchedFrameCount > 0,
          plateText: normalizePlateText(result.matchedFrames[0]?.bestPlateResult?.plate_text),
          mode: "video",
          createdAt: new Date().toISOString(),
        }),
        ...state.history,
      ].slice(0, 8),
    })),
  appendCameraHistory: (result, frameNumber) =>
    set((state) => ({
      history: [
        buildHistoryEntry({
          id: crypto.randomUUID(),
          sourceName: `camera_frame_${frameNumber.toString().padStart(4, "0")}.jpg`,
          summary: result.summary,
          status: result.status,
          carDetected: result.carDetected,
          plateDetected: result.plateDetected,
          plateText: normalizePlateText(result.bestPlateResult?.plate_text),
          mode: "camera",
          createdAt: new Date().toISOString(),
        }),
        ...state.history,
      ].slice(0, 8),
    })),
}))
