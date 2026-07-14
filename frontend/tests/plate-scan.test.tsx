import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PlateScanPanel } from '../src/components/plate/PlateScanPanel.js';
import { normalizePlateText, rewriteInferImageUrls, rewriteVideoInferResult } from '../src/services/plateClient.js';
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

vi.mock('../src/services/opsClient.js', () => ({
  createViolationFromConsoleScan: vi.fn(),
}));

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

  it('rewrites nested video frame asset URLs through /plate-api', () => {
    const result = rewriteVideoInferResult({
      ok: true,
      videoName: 'demo.mp4',
      uploadedVideoUrl: '/api/files/runs/x/demo.mp4',
      summary: 'ok',
      sampling: {
        fps: 25,
        frameCount: 250,
        durationSec: 10,
        sampleFps: 1,
        maxFrames: 20,
        sampledFrameCount: 10,
        frameStride: 25,
      },
      matchedFrameCount: 1,
      matchedFrames: [{
        ok: true,
        imageName: 'frame.jpg',
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
          primaryCarVisualUrl: '/api/files/runs/x/primary.jpg',
          uploadedImageUrl: null,
        },
        rawResultPath: '',
        sampleIndex: 1,
        frameIndex: 24,
        timestampSec: 0.96,
      }],
      scannedFrames: 10,
      aggregateTimings: {
        totalPipelineSec: 4.2,
        avgPipelineSec: 0.42,
      },
      rawResultPath: 'video.json',
    });
    expect(result.uploadedVideoUrl).toBe('/plate-api/api/files/runs/x/demo.mp4');
    expect(result.matchedFrames[0].imageUrls.primaryCarVisualUrl).toBe('/plate-api/api/files/runs/x/primary.jpg');
  });
});

describe('PlateScanPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables scan actions when control is disabled', async () => {
    render(
      <MemoryRouter>
        <PlateScanPanel host="10.82.66.179" videoPort={6500} vehicleId="veh-1" disabled />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/YOLO 就绪/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '识别当前帧' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '开始定时扫描' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '添加到违规车辆（测试）' })).toBeDisabled();
  });
});
