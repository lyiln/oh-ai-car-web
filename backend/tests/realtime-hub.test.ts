import { describe, expect, it } from 'vitest';
import { RealtimeHub } from '../src/app.js';

describe('RealtimeHub patrol isolation', () => {
  it('delivers patrol events only to the matching vehicle subscription', () => {
    const hub = new RealtimeHub();
    const vehicleA: string[] = []; const vehicleB: string[] = [];
    hub.subscribePatrol({ send: (value) => vehicleA.push(value) }, 'vehicle-a');
    hub.subscribePatrol({ send: (value) => vehicleB.push(value) }, 'vehicle-b');
    hub.publishPatrol({ type: 'violation_alert', vehicleId: 'vehicle-a', plate: 'A12345' });
    expect(vehicleA).toHaveLength(1);
    expect(vehicleB).toHaveLength(0);
  });
});
