import { describe, it, expect } from 'vitest';
import { parseFounderBrief, validateFounderBrief, scoreFounderBrief, BRIEF_FIELDS } from '../founder-brief.js';

describe('parseFounderBrief', () => {
  it('returns null for non-brief prompts', () => {
    expect(parseFounderBrief('实现登录功能')).toBeNull();
    expect(parseFounderBrief('')).toBeNull();
  });

  it('detects Founder Brief marker in Chinese', () => {
    const result = parseFounderBrief('## 创始人简报\n目标用户：开发者\n痛点：没有工具');
    expect(result).not.toBeNull();
    expect(result!.target_user).toBe('开发者');
    expect(result!.pain_point).toBe('没有工具');
  });

  it('detects Founder Brief marker in English', () => {
    const result = parseFounderBrief('## Founder Brief\ntarget user: developers\npain point: no tools');
    expect(result).not.toBeNull();
    expect(result!.target_user).toBe('developers');
    expect(result!.pain_point).toBe('no tools');
  });

  it('extracts all fields', () => {
    const text = `
## 创始人简报
目标用户：独立开发者
痛点：缺少 AI 辅助编程工具
P0 范围：只做代码审查功能
不做什么：不做部署功能
成功指标：代码审查准确率>90%
验证方式：用户手动验证审查结果
截止日期：2026年6月30日
`;
    const result = parseFounderBrief(text)!;
    expect(result.target_user).toBe('独立开发者');
    expect(result.pain_point).toBe('缺少 AI 辅助编程工具');
    expect(result.p0_scope).toBe('只做代码审查功能');
    expect(result.not_doing).toBe('不做部署功能');
    expect(result.success_metric).toBe('代码审查准确率>90%');
    expect(result.validation_method).toBe('用户手动验证审查结果');
    expect(result.deadline).toBe('2026年6月30日');
  });

  it('handles partial fields', () => {
    const result = parseFounderBrief('## 创始人简报\n目标用户：开发者\nP0 范围：登录功能');
    expect(result).not.toBeNull();
    expect(result!.target_user).toBe('开发者');
    expect(result!.p0_scope).toBe('登录功能');
    expect(result!.pain_point).toBe('');
  });
});

describe('validateFounderBrief', () => {
  it('validates complete brief', () => {
    const brief = {
      target_user: '独立开发者',
      pain_point: '缺少 AI 辅助编程工具',
      p0_scope: '只做代码审查功能',
      not_doing: '不做部署功能',
      success_metric: '代码审查准确率>90%',
      validation_method: '用户手动验证审查结果',
      deadline: '2026年6月30日',
    };
    const result = validateFounderBrief(brief);

    expect(result.is_valid).toBe(true);
    expect(result.completeness).toBe(1);
    expect(result.missing_fields).toHaveLength(0);
  });

  it('identifies missing fields', () => {
    const brief = {
      target_user: '',
      pain_point: '',
      p0_scope: '',
      not_doing: '',
      success_metric: '',
      validation_method: '',
      deadline: '',
    };
    const result = validateFounderBrief(brief);

    expect(result.is_valid).toBe(false);
    expect(result.completeness).toBe(0);
    expect(result.missing_fields.length).toBe(7);
  });

  it('detects placeholder values', () => {
    const brief = {
      target_user: '（填写）',
      pain_point: '(fill)',
      p0_scope: 'some scope',
      not_doing: '',
      success_metric: '',
      validation_method: '',
      deadline: '',
    };
    const result = validateFounderBrief(brief);

    expect(result.missing_fields.length).toBeGreaterThan(4);
  });

  it('provides quality suggestions for vague content', () => {
    const brief = {
      target_user: '所有',
      pain_point: '不好用',
      p0_scope: '所有功能',
      not_doing: '无',
      success_metric: '好用',
      validation_method: '试试看',
      deadline: '尽快',
    };
    const result = validateFounderBrief(brief);

    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions.some(s => /宽泛/.test(s))).toBe(true);
  });
});

describe('scoreFounderBrief', () => {
  it('scores complete specific brief highly', () => {
    const brief = {
      target_user: '独立开发者，使用 Claude Code 进行日常编程',
      pain_point: '缺少实时代码质量反馈工具',
      p0_scope: '只做 TypeScript 项目的代码审查',
      not_doing: '不做 Python 支持，不做 IDE 插件',
      success_metric: '代码审查准确率>90%',
      validation_method: '用户手动验证审查结果',
      deadline: '2026年6月30日',
    };
    const result = scoreFounderBrief(brief);

    expect(result.score).toBeGreaterThan(0.5);
    expect(result.completeness).toBe(1);
  });

  it('scores empty brief poorly', () => {
    const brief = {
      target_user: '',
      pain_point: '',
      p0_scope: '',
      not_doing: '',
      success_metric: '',
      validation_method: '',
      deadline: '',
    };
    const result = scoreFounderBrief(brief);

    expect(result.score).toBeLessThan(0.3);
    expect(result.completeness).toBe(0);
  });
});

describe('BRIEF_FIELDS', () => {
  it('has 7 fields', () => {
    expect(BRIEF_FIELDS).toHaveLength(7);
  });
});
