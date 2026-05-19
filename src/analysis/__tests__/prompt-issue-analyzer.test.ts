import { describe, it, expect } from 'vitest';
import { analyzePromptIssues } from '../prompt-issue-analyzer.js';

describe('analyzePromptIssues', () => {
  it('returns complete analysis structure', () => {
    const result = analyzePromptIssues('实现用户登录功能');

    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('issues');
    expect(result).toHaveProperty('rewrite_suggestion');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('identifies missing goal', () => {
    const result = analyzePromptIssues('登录按钮的样式');

    expect(result.issues.some(i => i.category === '目标')).toBe(true);
  });

  it('identifies missing acceptance criteria', () => {
    const result = analyzePromptIssues('实现用户登录功能');

    expect(result.issues.some(i => i.category === '验收')).toBe(true);
  });

  it('identifies unclear boundaries', () => {
    const result = analyzePromptIssues('实现登录功能');

    expect(result.issues.some(i => i.category === '边界')).toBe(true);
  });

  it('identifies missing priority', () => {
    const result = analyzePromptIssues('实现登录功能');

    expect(result.issues.some(i => i.category === '优先级')).toBe(true);
  });

  it('detects task splitting needed for long prompts', () => {
    const longPrompt = '需要完成以下任务：1. 实现登录。2. 添加注册。3. 实现密码重置。4. 添加OAuth。5. 实现权限管理。';
    const result = analyzePromptIssues(longPrompt);

    expect(result.issues.some(i => i.category === '拆分')).toBe(true);
  });

  it('scores well-structured prompts highly', () => {
    const goodPrompt = '目标：实现用户登录。范围：只做邮箱登录。验收标准：用户可以成功登录并获得token。优先级：P0。约束：不使用session。';
    const result = analyzePromptIssues(goodPrompt);

    expect(result.score).toBeGreaterThan(0.5);
    expect(result.issues.length).toBeLessThan(3);
  });

  it('each issue has required fields', () => {
    const result = analyzePromptIssues('随便写点什么');

    for (const issue of result.issues) {
      expect(issue).toHaveProperty('category');
      expect(issue).toHaveProperty('severity');
      expect(issue).toHaveProperty('issue');
      expect(issue).toHaveProperty('suggestion');
      expect(['high', 'medium', 'low']).toContain(issue.severity);
    }
  });

  it('provides rewrite suggestion', () => {
    const result = analyzePromptIssues('实现登录');

    expect(result.rewrite_suggestion.length).toBeGreaterThan(0);
  });
});
