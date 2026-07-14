/** Types for local YOLO FastAPI plate inference (:8010). */

export type HealthResponse = {
  ok: boolean;
  pythonReady: boolean;
  yolov5Ready: boolean;
  carWeightsReady: boolean;
  plateWeightsReady: boolean;
  pipelineReady: boolean;
  pythonPath: string;
  carWeightsPath: string;
  plateWeightsPath: string;
  message: string;
  runtimeWarmStart?: boolean;
  runtimeDevice?: string;
};

export type CarDetection = {
  class_name?: string;
  class_id?: number;
  confidence: number;
  bbox: [number, number, number, number];
};

export type PrimaryCarResult = {
  class_name?: string;
  confidence: number;
  bbox: [number, number, number, number];
  crop_bbox?: [number, number, number, number];
  bbox_area_ratio?: number;
  center_score?: number;
  primary_score?: number;
  visual_path?: string;
  crop_path?: string;
};

export type BestPlateResult = {
  plate_text: string;
  ocr_confidence: number | null;
  det_confidence?: number;
  crop_path?: string;
  status?: string;
};

export type ImageUrls = {
  uploadedImageUrl?: string | null;
  carVisualUrl?: string | null;
  primaryCarVisualUrl?: string | null;
  primaryCarCropUrl?: string | null;
  plateVisualUrl?: string | null;
  plateCropUrl?: string | null;
};

export type StageTimings = {
  car_detection_sec?: number;
  gated_source_prepare_sec?: number;
  plate_pipeline_sec?: number;
  plate_detection_sec?: number;
  plate_gate_sec?: number;
  crop_save_total_sec?: number;
  ocr_sec?: number;
  ocr_stage_total_sec?: number;
  total_pipeline_sec?: number;
  raw_plate_detection_count?: number;
  gated_plate_candidate_count?: number;
  ocr_attempt_count?: number;
};

export type InferResponse = {
  ok: boolean;
  imageName: string;
  summary: string;
  carDetected: boolean;
  carDetectionCount: number;
  carDetections: CarDetection[];
  primaryCar: PrimaryCarResult | null;
  plateDetected: boolean;
  plateDetectionCount: number;
  bestPlateResult: BestPlateResult | null;
  status: string;
  stageTimings?: StageTimings;
  imageUrls: ImageUrls;
  rawResultPath: string;
};

export type GateResponse = {
  ok: boolean;
  imageName: string;
  summary: string;
  carDetected: boolean;
  carDetectionCount: number;
  carDetections: CarDetection[];
  primaryCar: PrimaryCarResult | null;
  status: string;
  stageTimings?: StageTimings;
  imageUrls: ImageUrls;
  rawResultPath: string;
};

export type PlateHit = InferResponse & {
  id: string;
  capturedAt: string;
};

export type VideoMatchedFrame = InferResponse & {
  sampleIndex: number;
  frameIndex: number;
  timestampSec: number;
};

export type VideoInferResponse = {
  ok: boolean;
  videoName: string;
  uploadedVideoUrl?: string | null;
  summary: string;
  sampling: {
    fps: number;
    frameCount: number;
    durationSec: number;
    sampleFps: number;
    maxFrames: number;
    sampledFrameCount: number;
    frameStride: number;
  };
  matchedFrameCount: number;
  matchedFrames: VideoMatchedFrame[];
  scannedFrames: number;
  aggregateTimings: {
    totalPipelineSec: number;
    avgPipelineSec: number;
  };
  frameGateStats?: {
    carPositiveFrameCount: number;
    gatedPlateFrameCount: number;
    ocrAttemptFrameCount: number;
  };
  rawResultPath: string;
};
