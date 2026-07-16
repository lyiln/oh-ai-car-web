import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { PlateScanPanel } from '../src/components/plate/PlateScanPanel.js';
import {
  fetchVideoSnapshot,
  inferPlateImage,
  normalizePlateText,
  rewriteInferImageUrls,
  rewriteVideoInferResult,
} from '../src/services/plateClient.js';
import * as opsClient from '../src/services/opsClient.js';
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
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    cleanup();
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
    expect(screen.queryByRole('button', { name: '添加到违规车辆' })).not.toBeInTheDocument();
    expect(screen.getByText(/实时来源识别到有效车牌和证据后会自动提交/)).toBeInTheDocument();
  });

  it('keeps manual violation submission only for local files', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PlateScanPanel host="10.82.66.179" videoPort={6500} vehicleId="veh-1" disabled={false} />
      </MemoryRouter>,
    );
    await screen.findByText(/YOLO 就绪/);
    expect(screen.queryByRole('button', { name: '添加到违规车辆' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '本地图片' }));
    expect(screen.getByRole('button', { name: '添加到违规车辆' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '本地视频' }));
    expect(screen.getByRole('button', { name: '添加到违规车辆' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '浏览器摄像头' }));
    expect(screen.queryByRole('button', { name: '添加到违规车辆' })).not.toBeInTheDocument();
  });

  it('automatically submits a valid live recognition result', async () => {
    const user = userEvent.setup();
    const result = {
      ok: true,
      imageName: 'snapshot.jpg',
      summary: '识别成功',
      carDetected: true,
      carDetectionCount: 1,
      carDetections: [],
      primaryCar: null,
      plateDetected: true,
      plateDetectionCount: 1,
      bestPlateResult: { plate_text: '京A12345', ocr_confidence: 0.96 },
      status: 'plate_found',
      imageUrls: { uploadedImageUrl: null },
      rawResultPath: '',
    } satisfies InferResponse;
    vi.mocked(fetchVideoSnapshot).mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
    vi.mocked(inferPlateImage).mockResolvedValue(result);
    vi.mocked(opsClient.createViolationFromConsoleScan).mockResolvedValue({
      recorded: true,
      deduplicated: false,
      reason: 'violation_recorded',
      violation: {
        id: 'violation-1',
        plate: '京A12345',
        evidenceUrl: '/api/evidence/one.jpg',
        deviceId: 'veh-1',
        waypoint: '实时自动识别',
        status: 'pending',
        type: 'no_parking',
        zoneName: '东门',
      },
      review: { id: 'review-1', eventId: 'event-1' },
    });
    render(
      <MemoryRouter>
        <PlateScanPanel host="10.82.66.179" videoPort={6500} vehicleId="veh-1" disabled={false} />
      </MemoryRouter>,
    );
    await screen.findByText(/YOLO 就绪/);

    await user.click(screen.getByRole('button', { name: '识别当前帧' }));

    await vi.waitFor(() => expect(opsClient.createViolationFromConsoleScan).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicleId: 'veh-1',
        plate: '京A12345',
        confidence: 0.96,
        waypoint: '实时快照自动识别',
      }),
    ));
    expect(await screen.findByText(/自动识别：已记录/)).toBeInTheDocument();
  });
});
