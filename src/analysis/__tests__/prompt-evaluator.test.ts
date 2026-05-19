import { describe, it, expect } from 'vitest';
import { evaluatePrompt } from '../prompt-evaluator.js';

describe('evaluatePrompt', () => {
  it('returns complete evaluation structure', () => {
    const result = evaluatePrompt('实现 src/auth/login.ts 中的用户登录功能，使用 JWT 认证');

    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('details');
    expect(result).toHaveProperty('deficiencies');
    expect(result).toHaveProperty('suggestions');
    expect(result).toHaveProperty('explainability');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('scores a specific prompt well', () => {
    const result = evaluatePrompt(
      '请在 src/auth/login.ts 文件中实现用户登录函数，使用 JWT 认证方式。目标：用户可以通过邮箱和密码登录。约束：不能使用 session。'
    );

    expect(result.score).toBeGreaterThan(0.3);
    expect(result.details['明确性']).toBeGreaterThan(0);
    expect(result.details['完整性']).toBeGreaterThan(0);
  });

  it('penalizes vague prompts', () => {
    const result = evaluatePrompt('搞一下登录');

    expect(result.score).toBeLessThan(0.6);
    expect(result.deficiencies.length).toBeGreaterThan(0);
  });

  it('penalizes empty input', () => {
    const result = evaluatePrompt('');

    expect(result.score).toBeLessThan(0.3);
    expect(result.deficiencies.length).toBeGreaterThan(2);
  });

  it('gives specificity points for file references', () => {
    const withFiles = evaluatePrompt('修改 src/app.ts 中的路由配置');
    const withoutFiles = evaluatePrompt('修改路由配置');

    expect(withFiles.details['明确性']).toBeGreaterThan(withoutFiles.details['明确性']);
  });

  it('gives completeness points for goal + scope + constraints', () => {
    const complete = evaluatePrompt('目标：实现登录。范围：只做邮箱登录。约束：不用第三方库。');
    const incomplete = evaluatePrompt('登录功能');

    expect(complete.details['完整性']).toBeGreaterThan(incomplete.details['完整性']);
  });

  it('includes explainability with dimensions', () => {
    const result = evaluatePrompt('实现功能');

    expect(result.explainability).toHaveProperty('formula');
    expect(result.explainability).toHaveProperty('confidence');
    expect(result.explainability).toHaveProperty('dimensions');
    expect(Object.keys(result.explainability.dimensions).length).toBe(4);
  });

  it('provides actionable suggestions', () => {
    const result = evaluatePrompt('搞一下');

    expect(result.suggestions.length).toBeGreaterThan(0);
  });
});
