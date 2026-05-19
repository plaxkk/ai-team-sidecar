// CEO-level diagnostic report generator
import Database from 'better-sqlite3';
import { RoleEvaluation } from './role-evaluator.js';

export interface CeoReport {
  team_health: number;
  role_scores: {
    product: number;
    engineer: number;
    creative_review: number;
    qa: number;
    techlead: number;
  };
  top_issues: {
    role: string;
    deficiency: string;
    frequency: number;
    recommendation: string;
  }[];
  weakest_role: string;
  trend: 'improving' | 'stable' | 'declining';
  prompt_quality: number;
  delivery_quality: number;
  user_suggestions: string[];
  prompt_details: Record<string, number>;
  delivery_details: Record<string, number>;
  prompt_explainability?: Record<string, any>;
  delivery_explainability?: Record<string, any>;
}

interface RoleEvalRow {
  role: string;
  score: number;
  deficiencies: string;
}

// Mapping from prompt deficiency pattern → user suggestion
const PROMPT_SUGGESTIONS: { pattern: RegExp; suggestion: string }[] = [
  { pattern: /缺少具体文件\/函数引用/, suggestion: '在 prompt 中明确指定涉及的文件、函数或模块名' },
  { pattern: /缺少目标说明/, suggestion: '在 prompt 中说明期望的结果和完成标准' },
  { pattern: /缺少约束条件/, suggestion: '在 prompt 中说明技术限制、时间限制或其他约束' },
  { pattern: /只有模糊动词/, suggestion: '使用明确的动作词（实现/修复/添加/设计）而非模糊表达' },
  { pattern: /缺少背景信息/, suggestion: '提供相关代码片段、错误信息或背景说明' },
  { pattern: /缺少明确的操作对象/, suggestion: '指明要修改或实现的具体功能/模块/组件' },
];

// Mapping from deficiency pattern → CEO recommendation
const DEFICIENCY_RECOMMENDATIONS: Record<string, { pattern: RegExp; recommendation: string }[]> = {
  product: [
    { pattern: /Spec缺少.*字段/, recommendation: '建议在 CLAUDE.md 中加粗/强调该字段，并作为必填项列出' },
    { pattern: /未确认用户提到的实体/, recommendation: '建议添加规则："Product 段落必须回显用户需求中的关键实体/功能名"' },
    { pattern: /未标注优先级/, recommendation: '建议添加强制规则："每个任务必须标注 P0/P1/P2 优先级"' },
    { pattern: /未识别需求歧义/, recommendation: '建议添加规则："必须列出至少 1 个不确定点或假设"' },
  ],
  engineer: [
    { pattern: /缺少系统理解说明|缺少技术方案说明|直接给出代码/, recommendation: '建议强化规则："ENGINEER 必须先给出系统理解 + 技术方案，再写代码"' },
    { pattern: /未提供方案对比/, recommendation: '建议要求 ENGINEER "至少提供 2 个方案并给出推荐"' },
    { pattern: /未提供代码修改/, recommendation: '建议强化规则："所有技术方案必须附带代码示例或 diff"' },
    { pattern: /改动范围过大|改动范围较大/, recommendation: '建议添加限制："单次改动原则上不超过 5 个文件，超出需特别说明"' },
    { pattern: /代码实现未覆盖 Product Spec/, recommendation: '建议添加检查清单："实现前对照 Spec 逐项确认覆盖度"' },
  ],
  qa: [
    { pattern: /QA段落为占位内容|QA段落过短/, recommendation: '建议添加规则："QA 必须至少列出 3 个检查项，不得出现"无需审查""' },
    { pattern: /未标注风险等级/, recommendation: '建议添加规则："每条 QA 意见必须标注 高/中/低 风险等级"' },
    { pattern: /未发现任何具体问题/, recommendation: '建议添加规则："QA 必须指出至少 1 个潜在问题或风险"' },
    { pattern: /未列出边界情况/, recommendation: '建议要求 QA "列出至少 2 个边界情况或 edge cases"' },
  ],
  techlead: [
    { pattern: /缺少明确的执行建议/, recommendation: '建议添加规则："Tech Lead 必须给出 是否执行 的明确建议"' },
    { pattern: /未传达QA风险/, recommendation: '建议添加规则："Tech Lead 总结必须包含 QA 风险摘要"' },
    { pattern: /未列出需要用户确认的决策点/, recommendation: '建议添加规则："Tech Lead 必须列出需要用户确认的决策点"' },
    { pattern: /未有效综合各角色信息/, recommendation: '建议强化 Tech Lead 总结模板，要求显式引用 Product/Engineer/QA 的结论' },
    { pattern: /Tech Lead 段落过短/, recommendation: '建议设定 Tech Lead 段落最小长度要求（如 200 字符）' },
  ],
  creative_review: [
    { pattern: /未提供多个备选方案/, recommendation: '建议添加规则："Creative Review 必须提供至少 2 个备选方案"' },
    { pattern: /缺少反面意见/, recommendation: '建议添加规则："Creative Review 必须包含反面意见或魔鬼代言人分析"' },
    { pattern: /缺少用户证据/, recommendation: '建议添加规则："Creative Review 必须引用用户证据（访谈、调研、数据）"' },
    { pattern: /缺少商业价值分析/, recommendation: '建议添加规则："Creative Review 必须评估商业价值（转化、收入、留存）"' },
  ],
};

export function generateCeoReport(
  evaluations: RoleEvaluation[],
  options?: {
    promptQuality?: number;
    deliveryQuality?: number;
    promptDeficiencies?: string[];
    promptDetails?: Record<string, number>;
    deliveryDetails?: Record<string, number>;
    promptExplainability?: Record<string, any>;
    deliveryExplainability?: Record<string, any>;
    previousTeamHealth?: number | null;
  }
): CeoReport {
  // Role scores: average of all evaluations for each role
  const roleScores: CeoReport['role_scores'] = { product: 0, engineer: 0, creative_review: 0, qa: 0, techlead: 0 };
  const roleCounts: Record<string, number> = { product: 0, engineer: 0, creative_review: 0, qa: 0, techlead: 0 };

  for (const ev of evaluations) {
    roleScores[ev.role] += ev.score;
    roleCounts[ev.role]++;
  }

  for (const role of Object.keys(roleScores) as Array<keyof typeof roleScores>) {
    roleScores[role] = roleCounts[role] > 0
      ? Math.round((roleScores[role] / roleCounts[role]) * 100) / 100
      : 0;
  }

  // Team health: weighted average of role scores (5 roles)
  const weights = { product: 0.25, engineer: 0.25, creative_review: 0.10, qa: 0.20, techlead: 0.20 };
  const teamHealth =
    weights.product * roleScores.product +
    weights.engineer * roleScores.engineer +
    weights.creative_review * roleScores.creative_review +
    weights.qa * roleScores.qa +
    weights.techlead * roleScores.techlead;

  // Weakest role
  const entries = Object.entries(roleScores) as [string, number][];
  const weakest = entries.reduce((a, b) => (a[1] < b[1] ? a : b));
  const weakest_role = weakest[1] === 0 ? 'none' : weakest[0];

  // Top issues: count deficiency frequencies, map to recommendations
  const deficiencyCounts: Record<string, { role: string; count: number }> = {};
  for (const ev of evaluations) {
    for (const def of ev.deficiencies) {
      const key = `${ev.role}::${def}`;
      if (!deficiencyCounts[key]) deficiencyCounts[key] = { role: ev.role, count: 0 };
      deficiencyCounts[key].count++;
    }
  }

  const topIssues = Object.entries(deficiencyCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([key, data]) => {
      const deficiency = key.split('::').slice(1).join('::');
      return {
        role: data.role,
        deficiency,
        frequency: data.count,
        recommendation: findRecommendation(data.role, deficiency),
      };
    });

  // Prompt + delivery quality
  const prompt_quality = options?.promptQuality ?? 0;
  const delivery_quality = options?.deliveryQuality ?? 0;
  const roundedTeamHealth = Math.round(teamHealth * 100) / 100;
  const previousTeamHealth = options?.previousTeamHealth;

  let trend: CeoReport['trend'] = 'stable';
  if (typeof previousTeamHealth === 'number') {
    if (roundedTeamHealth - previousTeamHealth >= 0.05) trend = 'improving';
    else if (previousTeamHealth - roundedTeamHealth >= 0.05) trend = 'declining';
  }

  // User suggestions from prompt deficiencies
  const user_suggestions = deriveUserSuggestions(options?.promptDeficiencies || []);

  return {
    team_health: roundedTeamHealth,
    role_scores: roleScores,
    top_issues: topIssues,
    weakest_role,
    trend,
    prompt_quality: Math.round(prompt_quality * 100) / 100,
    delivery_quality: Math.round(delivery_quality * 100) / 100,
    user_suggestions,
    prompt_details: options?.promptDetails || {},
    delivery_details: options?.deliveryDetails || {},
    prompt_explainability: options?.promptExplainability || {},
    delivery_explainability: options?.deliveryExplainability || {},
  };
}

export function generateCeoReportFromDb(db: Database.Database, sessionId: string): CeoReport {
  const rows = db.prepare(
    'SELECT role, score, deficiencies FROM role_evaluations WHERE session_id = ?'
  ).all(sessionId) as Array<{ role: string; score: number; deficiencies: string }>;

  const evaluations: RoleEvaluation[] = rows.map(r => ({
    role: r.role as any,
    score: r.score,
    details: {},
    deficiencies: safeJsonParse(r.deficiencies, []),
  }));

  // Fetch prompt/delivery scores from episodes
  const epRows = db.prepare(
    'SELECT prompt_score, delivery_score FROM episodes WHERE session_id = ?'
  ).all(sessionId) as Array<{ prompt_score: number; delivery_score: number }>;

  let promptQuality = 0;
  let deliveryQuality = 0;
  if (epRows.length > 0) {
    promptQuality = epRows.reduce((s, r) => s + r.prompt_score, 0) / epRows.length;
    deliveryQuality = epRows.reduce((s, r) => s + r.delivery_score, 0) / epRows.length;
  }

  return generateCeoReport(evaluations, {
    promptQuality,
    deliveryQuality,
    promptDeficiencies: [], // deficiencies not stored per-episode; derived at runtime
  });
}

function findRecommendation(role: string, deficiency: string): string {
  const maps = DEFICIENCY_RECOMMENDATIONS[role];
  if (!maps) return '建议复盘该角色的 CLAUDE.md 指令';

  for (const { pattern, recommendation } of maps) {
    if (pattern.test(deficiency)) return recommendation;
  }

  return '建议复盘该角色的 CLAUDE.md 指令';
}

function deriveUserSuggestions(deficiencies: string[]): string[] {
  const suggestions = new Set<string>();
  for (const def of deficiencies) {
    for (const { pattern, suggestion } of PROMPT_SUGGESTIONS) {
      if (pattern.test(def)) suggestions.add(suggestion);
    }
  }
  return Array.from(suggestions);
}

function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
