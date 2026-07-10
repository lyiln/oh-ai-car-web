export const DEFAULT_CONNECTION_CONFIG = {
  host: '192.168.1.11',
  tcpPort: 6000,
  videoPort: 6500,
} as const;

export interface ConnectionConfig {
  host: string;
  tcpPort: number;
  videoPort: number;
  timeoutMs?: number;
}

export const DIRECTIONS = ['Stop', 'Front', 'After', 'Left', 'Right', 'LeftRotate', 'RightRotate', 'Brake'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export type ControlCommand =
  | { command: 'connect'; payload: ConnectionConfig }
  | { command: 'disconnect'; payload: Record<string, never> }
  | { command: 'button'; payload: { direction: Direction } }
  | { command: 'rocker'; payload: { x: number; y: number } }
  | { command: 'wheelSpeeds'; payload: { l1: number; l2: number; r1: number; r2: number } }
  | { command: 'photo' | 'startRecording' | 'stopRecording'; payload: Record<string, never> }
  | { command: 'tracking'; payload: { enabled: boolean } };

export type CommandEnvelope = { type: 'command'; requestId: string } & ControlCommand;
export interface ResultEnvelope { type: 'result'; requestId: string; ok: true; encoded?: string }
export interface ErrorEnvelope { type: 'error'; requestId: string; code: string; message: string }
export interface StateEnvelope {
  type: 'state';
  connected: boolean;
  target: ConnectionConfig | null;
  lastError?: string | null;
}
export type GatewayEnvelope = ResultEnvelope | ErrorEnvelope | StateEnvelope;

export function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

export function isSpeed(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -100 && value <= 100;
}
