import type { HealthResponse, InferResponse, VideoInferResponse } from '../types/plateInference.js';

const PLATE_API_BASE = '/plate-api';
const GATEWAY_API_BASE = '/gateway-api';

async function readJsonOrText<T>(response: Response): Promise<{ json?: T; text: string }> {
  const text = await response.text().catch(() => '');
  if (!text) return { text: '' };
  try {
    return { json: JSON.parse(text) as T, text };
  } catch {
    return { text };
  }
}

function rewritePlateAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('/api/')) return `${PLATE_API_BASE}${url}`;
  return url;
}

export function rewriteInferImageUrls(result: InferResponse): InferResponse {
  return {
    ...result,
    imageUrls: {
      uploadedImageUrl: rewritePlateAssetUrl(result.imageUrls.uploadedImageUrl),
      carVisualUrl: rewritePlateAssetUrl(result.imageUrls.carVisualUrl),
      primaryCarVisualUrl: rewritePlateAssetUrl(result.imageUrls.primaryCarVisualUrl),
      primaryCarCropUrl: rewritePlateAssetUrl(result.imageUrls.primaryCarCropUrl),
      plateVisualUrl: rewritePlateAssetUrl(result.imageUrls.plateVisualUrl),
      plateCropUrl: rewritePlateAssetUrl(result.imageUrls.plateCropUrl),
    },
  };
}

export function rewriteVideoInferResult(result: VideoInferResponse): VideoInferResponse {
  return {
    ...result,
    uploadedVideoUrl: rewritePlateAssetUrl(result.uploadedVideoUrl),
    matchedFrames: result.matchedFrames.map((frame) => ({
      ...frame,
      imageUrls: rewriteInferImageUrls(frame).imageUrls,
    })),
  };
}

export async function fetchPlateHealth(): Promise<HealthResponse> {
  const response = await fetch(`${PLATE_API_BASE}/api/health`);
  if (!response.ok) {
    throw new Error(`Plate API health failed (${response.status}). Is web_api_server running on :8010?`);
  }
  const payload = await readJsonOrText<HealthResponse>(response);
  if (!payload.json) {
    throw new Error('Plate API health returned a non-JSON response');
  }
  return payload.json;
}

export async function fetchVideoSnapshot(host: string, videoPort: number): Promise<Blob> {
  const params = new URLSearchParams({ host, port: String(videoPort) });
  const response = await fetch(`${GATEWAY_API_BASE}/api/video/snapshot?${params}`);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `Video snapshot failed (${response.status})`);
  }
  return response.blob();
}

export async function inferPlateImage(image: Blob, filename = 'frame.jpg'): Promise<InferResponse> {
  const formData = new FormData();
  formData.append('image', image, filename);
  const response = await fetch(`${PLATE_API_BASE}/api/infer`, {
    method: 'POST',
    body: formData,
  });
  const payload = await readJsonOrText<InferResponse | { detail?: string }>(response);
  if (!response.ok) {
    const detail =
      payload.json && 'detail' in payload.json
        ? payload.json.detail
        : payload.text.trim();
    throw new Error(detail || `Plate infer failed (${response.status})`);
  }
  if (!payload.json) {
    throw new Error(`Plate infer returned a non-JSON response (${response.status})`);
  }
  return rewriteInferImageUrls(payload.json as InferResponse);
}

export async function inferPlateVideo(
  video: Blob,
  filename = 'video.mp4',
  options?: { sampleFps?: number; maxFrames?: number },
): Promise<VideoInferResponse> {
  const formData = new FormData();
  formData.append('video', video, filename);
  formData.append('sample_fps', String(options?.sampleFps ?? 1));
  formData.append('max_frames', String(options?.maxFrames ?? 20));

  const response = await fetch(`${PLATE_API_BASE}/api/infer-video`, {
    method: 'POST',
    body: formData,
  });
  const payload = await readJsonOrText<VideoInferResponse | { detail?: string }>(response);
  if (!response.ok) {
    const detail =
      payload.json && 'detail' in payload.json
        ? payload.json.detail
        : payload.text.trim();
    throw new Error(detail || `Plate video infer failed (${response.status})`);
  }
  if (!payload.json) {
    throw new Error(`Plate video infer returned a non-JSON response (${response.status})`);
  }
  return rewriteVideoInferResult(payload.json as VideoInferResponse);
}

export function normalizePlateText(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/[\s·・.-]/g, '').toUpperCase();
}
