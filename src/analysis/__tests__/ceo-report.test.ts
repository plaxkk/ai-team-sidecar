import { describe, it, expect } from 'vitest';
import { generateCeoReport } from '../ceo-report.js';
import { RoleEvaluation } from '../role-evaluator.js';

describe('generateCeoReport', () => {
  const makeEvaluations = (scores: Record<string, number> = {}): RoleEvaluation[] => {
    const defaults: Record<string, number> = { product: 0.7, engineer: 0.65, creative_review: 0.5, qa: 0.6, techlead: 0.55 };
    const merged = { ...defaults, ...scores };
    return Object.entries(merged).map(([role, score]) => ({
      role: role as any,
      score,
      details: {},
      deficiencies: score < 0.5 ? [`${role} execution is weak`] : [],
    }));
  };

  it('returns complete CEO report structure', () => {
    const result = generateCeoReport(makeEvaluations());

    expect(result).toHaveProperty('team_health');
    expect(result).toHaveProperty('role_scores');
    expect(result).toHaveProperty('top_issues');
    expect(result).toHaveProperty('weakest_role');
    expect(result).toHaveProperty('trend');
    expect(result).toHaveProperty('prompt_quality');
    expect(result).toHaveProperty('delivery_quality');
  });

  it('computes team health as weighted average', () => {
    const result = generateCeoReport(makeEvaluations({ product: 0.8, engineer: 0.8, creative_review: 0.8, qa: 0.8, techlead: 0.8 }));

    expect(result.team_health).toBeGreaterThan(0.7);
  });

  it('identifies weakest role', () => {
    const result = generateCeoReport(makeEvaluations({ qa: 0.2 }));

    expect(result.weakest_role).toBe('qa');
  });

  it('detects improving trend', () => {
    const result = generateCeoReport(makeEvaluations(), { previousTeamHealth: 0.3 });

    expect(result.trend).toBe('improving');
  });

  it('detects declining trend', () => {
    const result = generateCeoReport(makeEvaluations({ product: 0.1, engineer: 0.1, creative_review: 0.1, qa: 0.1, techlead: 0.1 }), { previousTeamHealth: 0.9 });

    expect(result.trend).toBe('declining');
  });

  it('detects stable trend', () => {
    const result = generateCeoReport(makeEvaluations({ product: 0.55, engineer: 0.55, creative_review: 0.55, qa: 0.55, techlead: 0.55 }), { previousTeamHealth: 0.55 });

    // Verify team_health matches previousTeamHealth
    expect(result.team_health).toBe(0.55);
    expect(result.trend).toBe('stable');
  });

  it('collects top issues from deficiencies', () => {
    const evals = makeEvaluations({ qa: 0.1 });
    const result = generateCeoReport(evals);

    expect(result.top_issues.length).toBeGreaterThan(0);
  });

  it('returns role_scores for all 5 roles', () => {
    const result = generateCeoReport(makeEvaluations());

    expect(result.role_scores).toHaveProperty('product');
    expect(result.role_scores).toHaveProperty('engineer');
    expect(result.role_scores).toHaveProperty('creative_review');
    expect(result.role_scores).toHaveProperty('qa');
    expect(result.role_scores).toHaveProperty('techlead');
  });

  it('handles empty evaluations', () => {
    const result = generateCeoReport([]);

    expect(result.team_health).toBe(0);
    expect(result.weakest_role).toBe('none');
  });
});
