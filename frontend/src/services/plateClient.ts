import type { HealthResponse, InferResponse } from '../types/plateInference.js';

const PLATE_API_BASE = '/plate-api';
const GATEWAY_API_BASE = '/gateway-api';

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

export async function fetchPlateHealth(): Promise<HealthResponse> {
  const response = await fetch(`${PLATE_API_BASE}/api/health`);
  if (!response.ok) {
    throw new Error(`Plate API health failed (${response.status}). Is web_api_server running on :8010?`);
  }
  return (await response.json()) as HealthResponse;
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
  const payload = (await response.json()) as InferResponse | { detail?: string };
  if (!response.ok) {
    const detail = 'detail' in payload ? payload.detail : undefined;
    throw new Error(detail || `Plate infer failed (${response.status})`);
  }
  return rewriteInferImageUrls(payload as InferResponse);
}

export function normalizePlateText(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/[\s·・.-]/g, '').toUpperCase();
}
