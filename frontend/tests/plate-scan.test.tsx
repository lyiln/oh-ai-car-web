import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PlateScanPanel } from '../src/components/plate/PlateScanPanel.js';
import { normalizePlateText, rewriteInferImageUrls } from '../src/services/plateClient.js';
import type { InferResponse } from '../src/types/plateInference.js';

vi.mock('../src/services/plateClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/plateClient.js')>();
  return {
    ...actual,
    fetchPlateHealth: vi.fn(async () => ({
      ok: true,
      pythonReady: true,
      yolov5Ready: true,
      carWeightsReady: true,
      plateWeightsReady: true,
      pipelineReady: true,
      pythonPath: 'python',
      carWeightsPath: 'car.pt',
      plateWeightsPath: 'plate.pt',
      message: 'ok',
      runtimeDevice: 'cpu',
    })),
    fetchVideoSnapshot: vi.fn(),
    inferPlateImage: vi.fn(),
  };
});

describe('plateClient helpers', () => {
  it('normalizes Chinese plate text', () => {
    expect(normalizePlateText('皖A·12345')).toBe('皖A12345');
  });

  it('rewrites plate API asset URLs through /plate-api', () => {
    const result = rewriteInferImageUrls({
      ok: true,
      imageName: 'a.jpg',
      summary: '',
      carDetected: true,
      carDetectionCount: 1,
      carDetections: [],
      primaryCar: null,
      plateDetected: true,
      plateDetectionCount: 1,
      bestPlateResult: { plate_text: '皖A12345', ocr_confidence: 0.9 },
      status: 'plate_found',
      imageUrls: {
        plateVisualUrl: '/api/files/runs/x/plate.jpg',
        uploadedImageUrl: null,
      },
      rawResultPath: '',
    } satisfies InferResponse);
    expect(result.imageUrls.plateVisualUrl).toBe('/plate-api/api/files/runs/x/plate.jpg');
  });
});

describe('PlateScanPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables scan actions when control is disabled', async () => {
    render(<PlateScanPanel host="10.82.66.179" videoPort={6500} disabled />);
    expect(await screen.findByText(/YOLO 就绪/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '识别当前帧' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '开始定时扫描' })).toBeDisabled();
  });
});
