import {
  DIRECTIONS, encodeButton, encodePhoto, encodeRocker, encodeStartRecording, encodeStopRecording, encodeTracking, encodeWheelSpeeds,
  isPort, isSpeed, type CommandEnvelope, type ConnectionConfig,
} from '@oh-ai-car-web/shared';
import type { CarTcpClient } from '../tcp/car-tcp-client.js';

export class CommandError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CommandError('INVALID_MESSAGE', 'Message must be an object');
  return value as Record<string, unknown>;
}

function config(payload: unknown): ConnectionConfig {
  const value = object(payload);
  if (typeof value.host !== 'string' || !value.host.trim() || !isPort(value.tcpPort) || !isPort(value.videoPort)) {
    throw new CommandError('INVALID_CONFIG', 'host, tcpPort, and videoPort are required');
  }
  return { host: value.host.trim(), tcpPort: value.tcpPort, videoPort: value.videoPort, timeoutMs: 3000 };
}

function speeds(payload: unknown, keys: string[]): number[] {
  const value = object(payload);
  const result = keys.map((key) => value[key]);
  if (!result.every(isSpeed)) throw new CommandError('INVALID_PAYLOAD', 'Speed values must be between -100 and 100');
  return result as number[];
}

export async function dispatch(client: CarTcpClient, raw: unknown): Promise<{ requestId: string; encoded?: string }> {
  const envelope = object(raw);
  if (envelope.type !== 'command' || typeof envelope.requestId !== 'string' || typeof envelope.command !== 'string') {
    throw new CommandError('INVALID_MESSAGE', 'Expected a command envelope with requestId');
  }
  const requestId = envelope.requestId;
  const payload = envelope.payload;
  if (envelope.command === 'connect') {
    await client.connect(config(payload));
    return { requestId };
  }
  if (envelope.command === 'disconnect') {
    client.disconnect();
    return { requestId };
  }
  if (!client.isConnected) throw new CommandError('NOT_CONNECTED', 'TCP socket is not connected');

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
    default: throw new CommandError('UNSUPPORTED_COMMAND', 'Only documented high-level commands are accepted');
  }
  await client.write(encoded);
  return { requestId, encoded };
}

export const stopCommand: CommandEnvelope = { type: 'command', requestId: 'disconnect-stop', command: 'button', payload: { direction: 'Stop' } };
