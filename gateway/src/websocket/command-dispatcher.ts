import {
  DIRECTIONS, encodeButton, encodePhoto, encodeRocker, encodeStartRecording, encodeStopRecording, encodeTracking, encodeWheelSpeeds,
  isPort, isSpeed, type ConnectionConfig,
} from '@oh-ai-car-web/shared';
import { CarTcpClient } from '../tcp/car-tcp-client.js';

export class CommandError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CommandError('INVALID_MESSAGE', 'Message must be an object');
  return value as Record<string, unknown>;
}

export interface ParsedCommand {
  requestId: string;
  command: string;
  payload: unknown;
}

export function parseCommand(raw: unknown): ParsedCommand {
  const envelope = object(raw);
  if (envelope.type !== 'command' || typeof envelope.requestId !== 'string' || typeof envelope.command !== 'string') {
    throw new CommandError('INVALID_MESSAGE', 'Expected a command envelope with requestId');
  }
  return { requestId: envelope.requestId, command: envelope.command, payload: envelope.payload };
}

export function parseConnectionConfig(payload: unknown): ConnectionConfig {
  const value = object(payload);
  if (typeof value.host !== 'string' || !value.host.trim() || !isPort(value.tcpPort) || !isPort(value.videoPort)) {
    throw new CommandError('INVALID_CONFIG', 'host, tcpPort, and videoPort are required');
  }
  return { host: value.host.trim(), tcpPort: value.tcpPort, videoPort: value.videoPort, timeoutMs: 3000 };
}

export function parseProbeConfig(payload: unknown): { host: string; tcpPort: number; timeoutMs: number } {
  const value = object(payload);
  if (typeof value.host !== 'string' || !value.host.trim() || !isPort(value.tcpPort)) {
    throw new CommandError('INVALID_CONFIG', 'host and tcpPort are required for probe');
  }
  const timeoutMs = typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs)
    ? Math.min(10_000, Math.max(200, Math.round(value.timeoutMs)))
    : 2000;
  return { host: value.host.trim(), tcpPort: value.tcpPort, timeoutMs };
}

function speeds(payload: unknown, keys: string[]): number[] {
  const value = object(payload);
  const result = keys.map((key) => value[key]);
  if (!result.every(isSpeed)) throw new CommandError('INVALID_PAYLOAD', 'Speed values must be between -100 and 100');
  return result as number[];
}

export async function dispatch(client: CarTcpClient, envelope: ParsedCommand): Promise<{ requestId: string; encoded?: string }> {
  const { requestId, payload } = envelope;
  if (!client.isConnected) {
    throw new CommandError('NOT_CONNECTED', 'TCP socket is not connected');
  }

  let encoded: string;
  switch (envelope.command) {
    case 'button': {
      const direction = object(payload).direction;
      if (typeof direction !== 'string' || !DIRECTIONS.includes(direction as typeof DIRECTIONS[number])) throw new CommandError('INVALID_PAYLOAD', 'Unknown button direction');
      encoded = encodeButton(direction as typeof DIRECTIONS[number]);
      break;
    }
    case 'rocker': {
      const [x, y] = speeds(payload, ['x', 'y']);
      encoded = encodeRocker(x, y);
      break;
    }
    case 'wheelSpeeds': {
      const [l1, l2, r1, r2] = speeds(payload, ['l1', 'l2', 'r1', 'r2']);
      encoded = encodeWheelSpeeds(l1, l2, r1, r2);
      break;
    }
    case 'photo': encoded = encodePhoto(); break;
    case 'startRecording': encoded = encodeStartRecording(); break;
    case 'stopRecording': encoded = encodeStopRecording(); break;
    case 'tracking': {
      const enabled = object(payload).enabled;
      if (typeof enabled !== 'boolean') throw new CommandError('INVALID_PAYLOAD', 'tracking.enabled must be boolean');
      encoded = encodeTracking(enabled);
      break;
    }
    case 'connect':
    case 'disconnect':
    case 'probe':
    case 'leaseRefresh':
      throw new CommandError('INVALID_LIFECYCLE', 'Connection lifecycle is managed by the control server');
    default: throw new CommandError('UNSUPPORTED_COMMAND', 'Only documented high-level commands are accepted');
  }
  await client.write(encoded);
  return { requestId, encoded };
}

export const stopCommand: ParsedCommand = { requestId: 'disconnect-stop', command: 'button', payload: { direction: 'Stop' } };
