import { describe, expect, it } from 'vitest';
import { createMapMarkerContent } from '../src/components/map/GlobalMap.js';

describe('GlobalMap marker content', () => {
  it('renders dynamic marker labels as text instead of HTML', () => {
    const marker = createMapMarkerContent('amap-violation-dot', '<img src=x onerror=alert(1)>', 'unsafe');
    expect(marker.className).toBe('amap-violation-dot');
    expect(marker.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(marker.querySelector('img')).toBeNull();
  });
});
