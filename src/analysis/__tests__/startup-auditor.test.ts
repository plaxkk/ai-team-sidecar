import { describe, it, expect } from 'vitest';
import { auditStartupProject } from '../startup-auditor.js';

describe('auditStartupProject', () => {
  const makeInput = (overrides: Record<string, any> = {}) => ({
    rulesText: 'Product\nEngineer\nQA\nTech Lead',
    turns: [
      {
        session_id: 'test-session',
        turn_number: 1,
        user_prompt: '实现用户登录功能',
        assistant_response: `
## Product
### Engineering Task Spec
**目标**：实现用户登录
**用户场景**：用户需要登录系统
**当前问题**：无登录功能
**期望行为**：用户可以登录
**优先级**：P0
**限制条件**：使用JWT
**成功指标**：用户可以成功登录

## ENGINEER
### 系统理解
当前系统使用 Express + JWT
### 技术方案
方案A：JWT token
方案B：Session cookie
推荐方案A
### 代码修改
\`\`\`typescript
app.post('/login', handler)
\`\`\`

## QA
### 检查项
1. [高] 密码安全性
2. [中] Token 过期处理
3. [低] 日志记录
### 边界情况
- 空密码
- 超长密码

## Tech Lead
### 方案总结
基于 Product Spec 和 Engineer 方案...
### QA 风险摘要
- [高] 密码安全性
### 执行建议
**Go**
`,
        response_duration_ms: 5000,
      },
    ],
    episodes: [
      {
        flow_score: 0.8,
        handoff_score: 0.7,
        req_score: 0.9,
        prompt_score: 0.8,
        delivery_score: 0.7,
        overall_score: 0.75,
        violations: '[]',
      },
    ],
    roleScores: { product: 0.8, engineer: 0.75, qa: 0.7, techlead: 0.65 },
    projectReport: {
      overall_score: 0.7,
      input_quality_score: 0.8,
      output_quality_score: 0.7,
      efficiency_score: 0.6,
      top_risks: [],
    } as any,
    ...overrides,
  });

  it('returns a complete audit report structure', () => {
    const result = auditStartupProject(makeInput());

    expect(result).toHaveProperty('total_score');
    expect(result).toHaveProperty('dimension_scores');
    expect(result).toHaveProperty('highlights');
    expect(result).toHaveProperty('anti_patterns');
    expect(result).toHaveProperty('rule_feedback');
    expect(result.total_score).toBeGreaterThanOrEqual(0);
    expect(result.total_score).toBeLessThanOrEqual(100);
    expect(result.dimension_scores.rule_compliance).toBeGreaterThanOrEqual(0);
    expect(result.dimension_scores.dialogue_quality).toBeGreaterThanOrEqual(0);
    expect(result.dimension_scores.startup_excellence).toBeGreaterThanOrEqual(0);
  });

  it('scores high with all roles present and good metrics', () => {
    const result = auditStartupProject(makeInput());

    expect(result.total_score).toBeGreaterThan(50);
    expect(result.dimension_scores.rule_compliance).toBeGreaterThan(50);
  });

  it('penalizes missing roles', () => {
    const result = auditStartupProject(makeInput({
      roleScores: { engineer: 0.5 },
    }));

    expect(result.dimension_scores.rule_compliance).toBeLessThan(80);
    expect(result.anti_patterns.length).toBeGreaterThan(0);
  });

  it('penalizes low episode scores', () => {
    const result = auditStartupProject(makeInput({
      episodes: [
        { flow_score: 0.1, handoff_score: 0.1, req_score: 0.1, prompt_score: 0.1, delivery_score: 0.1, overall_score: 0.1, violations: '["Missing role step"]' },
      ],
    }));

    expect(result.dimension_scores.dialogue_quality).toBeLessThan(70);
  });

  it('penalizes over-engineering signals', () => {
    const result = auditStartupProject(makeInput({
      turns: [
        {
          session_id: 'test-session',
          turn_number: 1,
          user_prompt: '实现用户登录',
          assistant_response: '我们需要引入微服务架构和 Kubernetes 集群来处理登录功能。这是一个复杂架构，需要大规模重写现有代码。我们将引入新框架来处理。',
          response_duration_ms: 5000,
        },
      ],
    }));

    expect(result.anti_patterns.some(p => /过度设计/.test(p))).toBe(true);
  });

  it('returns at least one highlight', () => {
    const result = auditStartupProject(makeInput());

    expect(result.highlights.length).toBeGreaterThan(0);
  });

  it('generates rule feedback', () => {
    const result = auditStartupProject(makeInput());

    expect(result.rule_feedback).toHaveProperty('current_weakness');
    expect(result.rule_feedback).toHaveProperty('suggested_md_patch');
    expect(result.rule_feedback.current_weakness.length).toBeGreaterThan(0);
  });

  it('handles empty turns gracefully', () => {
    const result = auditStartupProject({
      rulesText: '',
      turns: [],
      episodes: [],
      roleScores: {},
      projectReport: {
        overall_score: 0,
        input_quality_score: 0,
        output_quality_score: 0,
        efficiency_score: 0,
        top_risks: [],
      } as any,
    });

    expect(result.total_score).toBeGreaterThanOrEqual(0);
    expect(result.highlights.length).toBeGreaterThan(0);
  });
});
