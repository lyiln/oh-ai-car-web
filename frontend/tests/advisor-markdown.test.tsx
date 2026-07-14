import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdvisorMarkdown } from '../src/components/ai/AdvisorMarkdown.js';
import { clampPoint } from '../src/hooks/useFloatingPosition.js';

describe('AdvisorMarkdown', () => {
  it('renders bold text and a GFM table', () => {
    const markdown = `当前白名单共有 **2 辆**车：

| 序号 | 车牌 | 车主 |
|------|------|------|
| 1 | 京A12345 | 李华 |
| 2 | 皖A12345 | 测试 |
`;
    render(<AdvisorMarkdown content={markdown} />);
    expect(screen.getByText('2 辆').tagName).toBe('STRONG');
    expect(document.querySelector('table')).toBeTruthy();
    expect(screen.getByText('京A12345')).toBeTruthy();
    expect(screen.getByText('车主')).toBeTruthy();
  });
});

describe('clampPoint', () => {
  it('keeps the floating widget inside the viewport', () => {
    const clamped = clampPoint(
      { x: 2000, y: -40 },
      { width: 64, height: 64 },
      { width: 800, height: 600 },
    );
    expect(clamped.x).toBe(800 - 64 - 8);
    expect(clamped.y).toBe(8);
  });
});
