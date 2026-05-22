import { ProjectManagementReport } from './project-report.js';
import { StartupAuditReport } from './startup-auditor.js';

export interface ProjectOrganizationInput {
  project_path: string;
  project_name: string;
  session_count: number;
  total_turns: number;
  total_episodes: number;
  last_activity: number;
  management_report: ProjectManagementReport;
  resource_report: any;
  startup_audit: StartupAuditReport;
}

export interface OrganizationAuditReport {
  generated_at: number;
  company_score: number;
  founder_operating_score: number;
  portfolio_health: number;
  capital_efficiency: number;
  execution_velocity: number;
  focus_score: number;
  dora_score: number;
  company_layer: Record<string, any>;
  ceo_layer: Record<string, any>;
  project_layer: Array<Record<string, any>>;
  role_layer: Array<Record<string, any>>;
  sidecar_findings: {
    highlights: string[];
    anti_patterns: string[];
    root_causes: string[];
    recommended_interventions: string[];
  };
  rule_feedback_queue: Array<Record<string, any>>;
}

export function buildOrganizationAudit(projects: ProjectOrganizationInput[], doraScore?: number): OrganizationAuditReport {
  const portfolioHealth = pct(avg(projects.map(project => project.management_report.overall_score)));
  const founderOperatingScore = scoreFounderOperating(projects);
  const capitalEfficiency = scoreCapitalEfficiency(projects);
  const executionVelocity = scoreExecutionVelocity(projects);
  const focusScore = scoreFocus(projects);
  const dora = doraScore ?? 0;
  const companyScore = clamp(Math.round(
    portfolioHealth * 0.25 +
    founderOperatingScore * 0.20 +
    executionVelocity * 0.20 +
    capitalEfficiency * 0.15 +
    focusScore * 0.10 +
    dora * 0.10
  ));

  const projectLayer = projects.map(project => buildProjectLayer(project));
  const roleLayer = buildRoleLayer(projects);
  const allAntiPatterns = projects.flatMap(project => project.startup_audit.anti_patterns || []);
  const allHighlights = projects.flatMap(project => project.startup_audit.highlights || []);
  const rootCauses = deriveRootCauses(projects, allAntiPatterns);
  const recommendedInterventions = deriveCompanyInterventions(projects, {
    founderOperatingScore,
    portfolioHealth,
    capitalEfficiency,
    executionVelocity,
    focusScore,
  });

  return {
    generated_at: Date.now(),
    company_score: companyScore,
    founder_operating_score: founderOperatingScore,
    portfolio_health: portfolioHealth,
    capital_efficiency: capitalEfficiency,
    execution_velocity: executionVelocity,
    focus_score: focusScore,
    dora_score: dora,
    company_layer: {
      structure: 'Start-up Company -> CEO/Founder -> Project Groups -> Project Roles -> AiTeam Audit -> Rule Feedback Flywheel',
      project_count: projects.length,
      total_sessions: sum(projects.map(project => project.session_count)),
      total_episodes: sum(projects.map(project => project.total_episodes)),
      total_turns: sum(projects.map(project => project.total_turns)),
      total_counted_tokens: sum(projects.map(project => Number(project.resource_report?.totals?.counted_tokens || 0))),
      operating_model: projects.length <= 1 ? 'single-product focus' : projects.length <= 3 ? 'small portfolio' : 'fragmented portfolio risk',
    },
    ceo_layer: {
      role: 'CEO/Founder at the keyboard',
      decision_quality: pct(avg(projects.map(project => project.startup_audit.dimension_scores.rule_compliance / 100))),
      input_quality: pct(avg(projects.map(project => project.management_report.input_quality_score))),
      follow_through: pct(avg(projects.map(project => project.management_report.output_quality_score))),
      context_discipline: focusScore,
      leverage_ratio: capitalEfficiency,
      feedback: deriveFounderFeedback(projects),
    },
    project_layer: projectLayer,
    role_layer: roleLayer,
    sidecar_findings: {
      highlights: topFrequent(allHighlights, 5),
      anti_patterns: topFrequent(allAntiPatterns, 8),
      root_causes: rootCauses,
      recommended_interventions: recommendedInterventions,
    },
    rule_feedback_queue: projects.map(project => ({
      project_path: project.project_path,
      target_file: suggestRuleTargetFile(project.startup_audit.rule_feedback.suggested_md_patch),
      current_weakness: project.startup_audit.rule_feedback.current_weakness,
      suggested_md_patch: project.startup_audit.rule_feedback.suggested_md_patch,
      status: 'proposed',
    })),
  };
}

function buildProjectLayer(project: ProjectOrganizationInput): Record<string, any> {
  const report = project.management_report;
  const resource = project.resource_report || {};
  const audit = project.startup_audit;
  const resourceTotals = resource.totals || {};
  const validationStrength = clamp(Math.round((report.output_quality_score || 0) * 70 + (audit.dimension_scores.startup_excellence || 0) * 0.30));
  const mvpDiscipline = clamp(audit.dimension_scores.startup_excellence);
  const operatingScore = clamp(Math.round(
    pct(report.overall_score) * 0.35 +
    audit.total_score * 0.35 +
    scoreProjectTokenEfficiency(project) * 0.30
  ));

  return {
    project_path: project.project_path,
    project_name: project.project_name,
    stage: inferProjectStage(project),
    operating_score: operatingScore,
    problem_sharpness: pct(report.input_quality_score),
    mvp_discipline: mvpDiscipline,
    execution_velocity: scoreSingleProjectVelocity(project),
    validation_strength: validationStrength,
    commercial_closure: scoreCommercialClosure(project),
    capital_efficiency: scoreProjectTokenEfficiency(project),
    sessions: project.session_count,
    episodes: project.total_episodes,
    turns: project.total_turns,
    counted_tokens: Number(resourceTotals.counted_tokens || 0),
    biggest_bottleneck: inferBottleneck(project),
    next_smallest_action: deriveNextSmallestActions(project).slice(0, 3),
  };
}

function buildRoleLayer(projects: ProjectOrganizationInput[]): Array<Record<string, any>> {
  const roles = new Map<string, { score: number[]; tokens: number; evaluations: number; projects: Set<string>; antiPatterns: string[] }>();

  for (const project of projects) {
    for (const role of project.resource_report?.role_effort || []) {
      const key = role.role || 'unknown';
      if (!roles.has(key)) roles.set(key, { score: [], tokens: 0, evaluations: 0, projects: new Set(), antiPatterns: [] });
      const acc = roles.get(key)!;
      acc.score.push(Number(role.avg_score || 0));
      acc.tokens += Number(role.counted_tokens || 0);
      acc.evaluations += Number(role.evaluations || 0);
      acc.projects.add(project.project_path);
    }
  }

  const totalTokens = sum(Array.from(roles.values()).map(role => role.tokens));
  return Array.from(roles.entries())
    .map(([role, value]) => {
      const qualityScore = pct(avg(value.score));
      const tokenShare = totalTokens ? value.tokens / totalTokens : 0;
      const leverageScore = clamp(Math.round(qualityScore - tokenShare * 25 + Math.min(15, value.evaluations)));
      return {
        role,
        quality_score: qualityScore,
        efficiency_score: clamp(Math.round(100 - tokenShare * 100 + qualityScore * 0.25)),
        leverage_score: leverageScore,
        token_share: round(tokenShare),
        counted_tokens: value.tokens,
        evaluations: value.evaluations,
        project_count: value.projects.size,
        anti_patterns: roleAntiPatterns(role, qualityScore, tokenShare),
        next_rule_patch: roleRulePatch(role, qualityScore),
      };
    })
    .sort((a, b) => b.counted_tokens - a.counted_tokens);
}

function scoreFounderOperating(projects: ProjectOrganizationInput[]): number {
  if (projects.length === 0) return 0;
  const inputQuality = pct(avg(projects.map(project => project.management_report.input_quality_score)));
  const ruleCompliance = avg(projects.map(project => project.startup_audit.dimension_scores.rule_compliance));
  const outputQuality = pct(avg(projects.map(project => project.management_report.output_quality_score)));
  const focus = scoreFocus(projects);
  return clamp(Math.round(inputQuality * 0.30 + ruleCompliance * 0.25 + outputQuality * 0.25 + focus * 0.20));
}

function scoreCapitalEfficiency(projects: ProjectOrganizationInput[]): number {
  if (projects.length === 0) return 0;
  return clamp(Math.round(avg(projects.map(scoreProjectTokenEfficiency))));
}

function scoreExecutionVelocity(projects: ProjectOrganizationInput[]): number {
  if (projects.length === 0) return 0;
  return clamp(Math.round(avg(projects.map(scoreSingleProjectVelocity))));
}

function scoreFocus(projects: ProjectOrganizationInput[]): number {
  if (projects.length === 0) return 0;
  const activeProjects = projects.filter(project => Date.now() - Number(project.last_activity || 0) < 14 * 24 * 60 * 60 * 1000).length;
  const fragmentationPenalty = Math.max(0, activeProjects - 2) * 10;
  const repeatedRiskPenalty = Math.min(20, topFrequent(projects.flatMap(project => project.startup_audit.anti_patterns || []), 3).length * 4);
  return clamp(100 - fragmentationPenalty - repeatedRiskPenalty);
}

function scoreProjectTokenEfficiency(project: ProjectOrganizationInput): number {
  const tokens = Number(project.resource_report?.totals?.counted_tokens || 0);
  const outputQuality = pct(project.management_report.output_quality_score || 0);
  const episodes = Math.max(1, project.total_episodes || 1);
  const tokensPerEpisode = tokens / episodes;
  const tokenPenalty = Math.min(45, Math.log10(Math.max(10, tokensPerEpisode)) * 9);
  return clamp(Math.round(outputQuality + 35 - tokenPenalty));
}

function scoreSingleProjectVelocity(project: ProjectOrganizationInput): number {
  const efficiency = pct(project.management_report.efficiency_score || 0);
  const episodes = project.total_episodes || 0;
  const turnsPerEpisode = episodes ? project.total_turns / episodes : project.total_turns;
  const turnPenalty = Math.min(25, Math.max(0, turnsPerEpisode - 4) * 3);
  return clamp(Math.round(efficiency + Math.min(15, episodes) - turnPenalty));
}

function scoreCommercialClosure(project: ProjectOrganizationInput): number {
  const haystack = JSON.stringify(project.management_report).toLowerCase();
  const hits = ['revenue', 'pricing', 'conversion', 'lead', 'custom trip', '付费', '首单', '转化', '获客', '留存', '商业化']
    .filter(term => haystack.includes(term.toLowerCase())).length;
  return clamp(35 + hits * 12 + pct(project.management_report.output_quality_score || 0) * 0.25);
}

function inferProjectStage(project: ProjectOrganizationInput): string {
  const stages = project.resource_report?.lifecycle_stages || [];
  const topStage = stages[0]?.stage;
  if (topStage) return topStage;
  if ((project.management_report.output_quality_score || 0) > 0.65) return 'Validate';
  if ((project.total_episodes || 0) <= 2) return 'Discover';
  return 'Build';
}

function inferBottleneck(project: ProjectOrganizationInput): string {
  const report = project.management_report;
  const audit = project.startup_audit;
  const candidates = [
    ['CEO/Input', pct(report.input_quality_score)],
    ['Project Process', pct(report.process_health_score)],
    ['Output/Validation', pct(report.output_quality_score)],
    ['Rule Compliance', audit.dimension_scores.rule_compliance],
    ['Dialogue Quality', audit.dimension_scores.dialogue_quality],
    ['Startup Excellence', audit.dimension_scores.startup_excellence],
  ] as Array<[string, number]>;
  return candidates.sort((a, b) => a[1] - b[1])[0][0];
}

function deriveNextSmallestActions(project: ProjectOrganizationInput): string[] {
  const actions: string[] = [];
  const report = project.management_report;
  if ((report.input_quality_score || 0) < 0.6) actions.push('下一轮先补 P0 目标、验收标准、约束和成功指标，再进入 RD。');
  if ((report.output_quality_score || 0) < 0.6) actions.push('补一条可验证交付闭环：build/test/deploy 证据 + go/no-go 结论。');
  if (project.startup_audit.dimension_scores.startup_excellence < 70) actions.push('砍掉非 P0 范围，只保留一个能产生用户价值或商业验证的最小动作。');
  if (actions.length === 0) actions.push('保持当前节奏，下一轮只推进一个可上线、可验证、可复盘的小闭环。');
  return actions;
}

function deriveFounderFeedback(projects: ProjectOrganizationInput[]): string[] {
  const feedback: string[] = [];
  if (scoreFocus(projects) < 75) feedback.push('减少并行项目和反复切换，把接下来 1-2 个会话集中在最高商业价值项目。');
  if (pct(avg(projects.map(project => project.management_report.input_quality_score))) < 60) feedback.push('每次需求先写清 P0、目标用户、痛点、验收标准和不做什么。');
  if (scoreCapitalEfficiency(projects) < 60) feedback.push('为高 token 会话设置停止条件：超过阈值必须先总结决策，再继续执行。');
  if (feedback.length === 0) feedback.push('保持 CEO 输入质量和收口节奏，把 AiTeam 规则反馈作为每轮迭代的门禁。');
  return feedback;
}

function deriveRootCauses(projects: ProjectOrganizationInput[], antiPatterns: string[]): string[] {
  const roots: string[] = [];
  if (antiPatterns.some(item => /验收|优先级|边界|Input|需求/.test(item))) roots.push('CEO/Product 输入规格不足，导致 RD 和 QA 后续只能补猜测。');
  if (antiPatterns.some(item => /QA|测试用例|Pass/.test(item))) roots.push('QA 缺少可执行输出门禁，质量审查容易形式化。');
  if (antiPatterns.some(item => /过度设计|MVP|复杂/.test(item))) roots.push('MVP 红线不够硬，技术方案容易被完整性诱惑拉大。');
  if (projects.some(project => scoreProjectTokenEfficiency(project) < 55)) roots.push('资源消耗和产出质量没有形成强绑定，高 token 会话缺少阶段性停止点。');
  if (roots.length === 0) roots.push('当前主要问题不是单点角色失职，而是缺少把审计结果写回规则的持续机制。');
  return roots;
}

function deriveCompanyInterventions(projects: ProjectOrganizationInput[], scores: Record<string, number>): string[] {
  const interventions: string[] = [];
  if (scores.founderOperatingScore < 70) interventions.push('建立 CEO 输入门禁：没有 P0、验收标准、范围边界的需求不得进入项目组。');
  if (scores.capitalEfficiency < 65) interventions.push('建立资源门禁：Top token 会话必须输出决策摘要、剩余风险和继续/停止理由。');
  if (scores.executionVelocity < 65) interventions.push('建立执行门禁：每轮只允许一个最小可验证动作，完成验证后再扩范围。');
  if (scores.focusScore < 75) interventions.push('建立组合门禁：同一周期最多 1 个主项目 + 1 个旁路项目，避免创业早期注意力稀释。');
  if (projects.some(project => project.startup_audit.rule_feedback)) interventions.push('把 AiTeam 建议进入 Rule Feedback Queue，人工接受后写回项目 md 规则。');
  return interventions.slice(0, 6);
}

function roleAntiPatterns(role: string, qualityScore: number, tokenShare: number): string[] {
  const patterns: string[] = [];
  if (qualityScore < 60) patterns.push(`${role} 质量分偏低，需要补职责输出格式和验收门禁。`);
  if (tokenShare > 0.45 && qualityScore < 75) patterns.push(`${role} 消耗占比高但质量没有同步领先，存在低杠杆风险。`);
  return patterns;
}

function roleRulePatch(role: string, qualityScore: number): string {
  if (qualityScore >= 70) return '';
  if (role === 'qa') return "在 QA 职责下增加：'QA 必须输出至少 3 条测试用例，覆盖正常、异常、边界路径，并给出风险等级。'";
  if (role === 'product') return "在 Product 职责下增加：'需求进入 RD 前必须包含 P0 目标、目标用户、痛点、验收标准、约束和不做事项。'";
  if (role === 'engineer') return "在 RD 职责下增加：'优先局部最小改动；任何新增框架或重构必须证明能直接提升 P0 指标。'";
  if (role === 'techlead') return "在 Tech Lead 职责下增加：'每轮必须给出 go/no-go、验证证据、剩余风险和下一步最小动作。'";
  return '';
}

function suggestRuleTargetFile(patch: string): string {
  if (/QA|测试/.test(patch)) return 'CLAUDE.md';
  if (/Product|需求|CEO/.test(patch)) return 'docs/ITERATION-PROCESS.md';
  if (/MVP|框架|重构|P0/.test(patch)) return 'docs/MVP-CHECKLIST.md';
  return '项目规则.md';
}

function topFrequent(items: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const item of items.filter(Boolean)) counts.set(item, (counts.get(item) || 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([item]) => item);
}

function avg(values: number[]): number {
  const usable = values.filter(Number.isFinite);
  if (usable.length === 0) return 0;
  return sum(usable) / usable.length;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function pct(value: number): number {
  return clamp(Math.round((value || 0) * 100));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
