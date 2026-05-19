import { describe, it, expect } from 'vitest';
import { trackFlow } from '../flow-tracker.js';

describe('trackFlow', () => {
  const makeDetection = (overrides: Record<string, any> = {}) => ({
    has_product: true,
    has_engineer: true,
    has_creative_review: true,
    has_qa: true,
    has_techlead: true,
    sections: [
      { role: 'product', content: 'A'.repeat(200), start: 0 },
      { role: 'engineer', content: 'B'.repeat(200), start: 200 },
      { role: 'creative_review', content: 'C'.repeat(200), start: 400 },
      { role: 'qa', content: 'D'.repeat(200), start: 600 },
      { role: 'techlead', content: 'E'.repeat(200), start: 800 },
    ],
    ...overrides,
  });

  it('returns a complete flow result', () => {
    const result = trackFlow(makeDetection(), 'test response');

    expect(result).toHaveProperty('flow_score');
    expect(result).toHaveProperty('handoff_score');
    expect(result).toHaveProperty('violations');
    expect(result).toHaveProperty('step_order');
    expect(result).toHaveProperty('step_depths');
    expect(result.flow_score).toBeGreaterThanOrEqual(0);
    expect(result.flow_score).toBeLessThanOrEqual(1);
  });

  it('scores perfect flow with all 5 roles in order', () => {
    const result = trackFlow(makeDetection({
      has_creative_review: true,
      sections: [
        { role: 'product', content: 'A'.repeat(200), start: 0 },
        { role: 'engineer', content: 'B'.repeat(200), start: 200 },
        { role: 'creative_review', content: 'C'.repeat(200), start: 400 },
        { role: 'qa', content: 'D'.repeat(200), start: 600 },
        { role: 'techlead', content: 'E'.repeat(200), start: 800 },
      ],
    }), 'response');

    expect(result.flow_score).toBeGreaterThan(0.7);
    expect(result.violations).toHaveLength(0);
    expect(result.step_order).toEqual(['product', 'engineer', 'creative_review', 'qa', 'techlead']);
  });

  it('penalizes missing roles', () => {
    const result = trackFlow(makeDetection({
      has_qa: false,
      sections: [
        { role: 'product', content: 'A'.repeat(200), start: 0 },
        { role: 'engineer', content: 'B'.repeat(200), start: 200 },
        { role: 'techlead', content: 'D'.repeat(200), start: 400 },
      ],
    }), 'response');

    expect(result.flow_score).toBeLessThan(0.9);
    expect(result.violations.some(v => /Missing/.test(v))).toBe(true);
  });

  it('penalizes shallow sections', () => {
    const result = trackFlow(makeDetection({
      sections: [
        { role: 'product', content: 'short', start: 0 },
        { role: 'engineer', content: 'B'.repeat(200), start: 10 },
        { role: 'qa', content: 'C'.repeat(200), start: 210 },
        { role: 'techlead', content: 'D'.repeat(200), start: 410 },
      ],
    }), 'response');

    expect(result.violations.some(v => /Shallow/.test(v))).toBe(true);
  });

  it('penalizes prohibited behaviors', () => {
    const result = trackFlow(makeDetection(), '跳过QA测试步骤，直接修改代码');

    expect(result.violations.some(v => /Prohibited/.test(v))).toBe(true);
    expect(result.flow_score).toBeLessThan(1);
  });

  it('handles empty detection gracefully', () => {
    const result = trackFlow({
      has_product: false,
      has_engineer: false,
      has_qa: false,
      has_techlead: false,
      sections: [],
    }, 'response');

    expect(result.flow_score).toBeLessThan(0.3);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});
