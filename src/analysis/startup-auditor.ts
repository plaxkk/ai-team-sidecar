import { ProjectManagementReport } from './project-report.js';

export interface StartupAuditReport {
  total_score: number;
  dimension_scores: {
    rule_compliance: number;
    dialogue_quality: number;
    startup_excellence: number;
  };
  highlights: string[];
  anti_patterns: string[];
  rule_feedback: {
    current_weakness: string;
    suggested_md_patch: string;
  };
}

interface AuditTurn {
  session_id: string;
  turn_number: number;
  user_prompt: string;
  assistant_response: string;
  response_duration_ms?: number | null;
}

interface AuditEpisode {
  flow_score: number;
  handoff_score: number;
  req_score: number;
  prompt_score: number;
  delivery_score: number;
  overall_score: number;
  violations?: string;
}

interface AuditInput {
  rulesText: string;
  turns: AuditTurn[];
  episodes: AuditEpisode[];
  roleScores: Record<string, number>;
  projectReport: ProjectManagementReport;
  deployCount?: number;
}

export function auditStartupProject(input: AuditInput): StartupAuditReport {
  const text = input.turns.map(turn => `${turn.user_prompt}\n${turn.assistant_response}`).join('\n\n');
  const assistantText = input.turns.map(turn => turn.assistant_response || '').join('\n\n');
  const rulesText = input.rulesText || '';
  const projectReport = input.projectReport;
  const expectedRoles = detectExpectedRoles(rulesText);
  const presentRoles = new Set(Object.entries(input.roleScores).filter(([, score]) => score > 0.05).map(([role]) => role));
  const missingRoles = expectedRoles.filter(role => !presentRoles.has(role));
  const violationCount = input.episodes.reduce((sum, episode) => sum + safeJsonParse<string[]>(episode.violations || '[]', []).length, 0);
  const qaHasConcreteCases = /测试用例|test case|case\s*#|\|\s*场景\s*\||正常路径|异常路径|边界/.test(assistantText);
  const hasTaskSpec = /Engineering Task Spec|目标（?What|Pain Point|Expected Behavior|成功指标|Success Metric/i.test(assistantText);
  const hasTechLead = /Tech Lead|TECH LEAD|技术负责人|决策|是否建议执行|风险等级/i.test(assistantText);
  const hasValidation = /npm run build|tsc|测试|验证|pass|通过|部署|vercel/i.test(assistantText);
  const hasMvpLanguage = /MVP|最小|最小化|能跑|快速|闭环|P0|P1|痛点|首单|转化|上线|ship/i.test(text);
  const overEngineeringHits = countMatches(text, /微服务|kubernetes|k8s|复杂架构|重构整个|大规模重写|引入.*框架|抽象层|平台化|中台|完整交易闭环/gi);
  const repeatedPromptCount = countRepeatedPrompts(input.turns);
  const emptyResponseCount = input.turns.filter(turn => !(turn.assistant_response || '').trim()).length;
  const avgFlow = avg(input.episodes.map(episode => episode.flow_score), 0.5);
  const avgHandoff = avg(input.episodes.map(episode => episode.handoff_score), 0.5);
  const avgReq = avg(input.episodes.map(episode => episode.req_score), 0.5);
  const avgDelivery = avg(input.episodes.map(episode => episode.delivery_score), 0.5);

  const ruleCompliance = clampScore(
    100
    - missingRoles.length * 12
    - (hasTaskSpec ? 0 : 14)
    - (hasTechLead ? 0 : 10)
    - (qaHasConcreteCases ? 0 : 12)
    - Math.min(18, violationCount * 3)
    - Math.round((1 - avgFlow) * 18)
  );

  const dialogueQuality = clampScore(
    100
    - Math.round((1 - avgHandoff) * 24)
    - Math.round((1 - avgReq) * 22)
    - Math.round((1 - avgDelivery) * 16)
    - Math.min(12, repeatedPromptCount * 3)
    - Math.min(16, emptyResponseCount * 4)
  );

  // Deploy data bonus: actual deploys boost validation signal
  const deployBonus = (input.deployCount && input.deployCount > 0) ? 8 : 0;

  const startupExcellence = clampScore(
    100
    - Math.round((1 - (projectReport.efficiency_score || 0.5)) * 24)
    - Math.round((1 - (projectReport.output_quality_score || 0.5)) * 24)
    - Math.round((1 - (projectReport.input_quality_score || 0.5)) * 18)
    - (hasMvpLanguage ? 0 : 10)
    - (hasValidation ? 0 : 10)
    - Math.min(18, overEngineeringHits * 4)
    + deployBonus
  );

  const highlights = deriveHighlights({
    ruleCompliance,
    dialogueQuality,
    startupExcellence,
    roleScores: input.roleScores,
    hasMvpLanguage,
    hasValidation,
    qaHasConcreteCases,
    projectReport,
  });

  const antiPatterns = deriveAntiPatterns({
    missingRoles,
    hasTaskSpec,
    hasTechLead,
    qaHasConcreteCases,
    hasValidation,
    overEngineeringHits,
    repeatedPromptCount,
    emptyResponseCount,
    projectReport,
  });

  const ruleFeedback = deriveRuleFeedback({
    qaHasConcreteCases,
    hasTaskSpec,
    hasTechLead,
    overEngineeringHits,
    startupExcellence,
  });

  return {
    total_score: clampScore(Math.round(ruleCompliance * 0.30 + dialogueQuality * 0.25 + startupExcellence * 0.45)),
    dimension_scores: {
      rule_compliance: ruleCompliance,
      dialogue_quality: dialogueQuality,
      startup_excellence: startupExcellence,
    },
    highlights: highlights.slice(0, 5),
    anti_patterns: antiPatterns.slice(0, 6),
    rule_feedback: ruleFeedback,
  };
}

function detectExpectedRoles(rulesText: string): string[] {
  const roles = new Set<string>(['engineer']);
  if (/Product|产品|CPO|需求/.test(rulesText)) roles.add('product');
  if (/QA|测试|质量/.test(rulesText)) roles.add('qa');
  if (/Tech Lead|TECH LEAD|技术负责人|决策/.test(rulesText)) roles.add('techlead');
  return Array.from(roles);
}

function deriveHighlights(input: {
  ruleCompliance: number;
  dialogueQuality: number;
  startupExcellence: number;
  roleScores: Record<string, number>;
  hasMvpLanguage: boolean;
  hasValidation: boolean;
  qaHasConcreteCases: boolean;
  projectReport: ProjectManagementReport;
}): string[] {
  const highlights: string[] = [];
  const strongestRole = Object.entries(input.roleScores).sort((a, b) => b[1] - a[1])[0];
  if (strongestRole && strongestRole[1] >= 0.6) highlights.push(`${roleName(strongestRole[0])} 执行相对稳定，是当前虚拟团队最可复用的能力。`);
  if (input.hasMvpLanguage) highlights.push('对话中持续出现 MVP、最小改动、快速闭环等早期公司正确约束。');
  if (input.hasValidation) highlights.push('交付过程中包含构建、测试或部署验证信号，具备基本闭环意识。');
  if (input.qaHasConcreteCases) highlights.push('QA 输出包含测试场景或边界条件，不是纯口头 Pass。');
  if ((input.projectReport.output_quality_score || 0) >= 0.7) highlights.push('交付质量指标较高，说明结果总结和可验收性较好。');
  if (input.dialogueQuality >= 80) highlights.push('需求、实现、验证之间的上下文传递较连续，信息损耗较低。');
  if (highlights.length === 0) highlights.push('当前流程已经能形成可分析的项目样本，为后续规则迭代提供了数据基础。');
  return highlights;
}

function deriveAntiPatterns(input: {
  missingRoles: string[];
  hasTaskSpec: boolean;
  hasTechLead: boolean;
  qaHasConcreteCases: boolean;
  hasValidation: boolean;
  overEngineeringHits: number;
  repeatedPromptCount: number;
  emptyResponseCount: number;
  projectReport: ProjectManagementReport;
}): string[] {
  const antiPatterns: string[] = [];
  if (input.missingRoles.length > 0) antiPatterns.push(`规则要求的角色没有完整出现：${input.missingRoles.map(roleName).join('、')}。`);
  if (!input.hasTaskSpec) antiPatterns.push('Product 没有稳定输出 Engineering Task Spec，需求到工程任务的转译容易丢信息。');
  if (!input.qaHasConcreteCases) antiPatterns.push('QA 缺少具体测试用例或边界路径，容易变成形式化 Pass。');
  if (!input.hasTechLead) antiPatterns.push('Tech Lead 汇总和 go/no-go 决策信号不足，用户难以判断是否继续投入。');
  if (!input.hasValidation) antiPatterns.push('缺少明确的构建、测试或部署验证证据，闭环质量不足。');
  if (input.overEngineeringHits > 0) antiPatterns.push('出现过度设计信号，需警惕偏离极致 MVP。');
  if (input.repeatedPromptCount > 0) antiPatterns.push('存在重复或近似重复输入，说明上下文承接或任务收口不够干净。');
  if (input.emptyResponseCount > 0) antiPatterns.push('存在空响应样本，会污染质量与效率评估。');
  for (const risk of input.projectReport.top_risks || []) antiPatterns.push(risk);
  return unique(antiPatterns);
}

function deriveRuleFeedback(input: {
  qaHasConcreteCases: boolean;
  hasTaskSpec: boolean;
  hasTechLead: boolean;
  overEngineeringHits: number;
  startupExcellence: number;
}): StartupAuditReport['rule_feedback'] {
  if (!input.qaHasConcreteCases) {
    return {
      current_weakness: '当前规则虽然要求 QA 独立输出风险，但没有硬性约束测试用例格式，导致 QA 容易停留在泛泛风险描述。',
      suggested_md_patch: "在《项目规则.md》的 QA 职责下增加：'QA 必须以 Markdown 表格输出至少 3 个测试用例，覆盖正常路径、异常路径和边界路径；每个用例必须包含前置条件、操作步骤、预期结果、风险等级。未给出测试用例时不得宣布通过。'",
    };
  }
  if (!input.hasTaskSpec) {
    return {
      current_weakness: '当前规则没有把 Product 的任务转译设置为进入研发前的硬门禁，导致自然语言需求可能直接进入实现。',
      suggested_md_patch: "在《项目规则.md》的 Product 阶段增加：'除 Type A 微小修复外，任何需求进入 Engineer 前必须先输出 Engineering Task Spec，包含目标、用户场景、痛点、期望行为、约束、成功指标和优先级。'",
    };
  }
  if (!input.hasTechLead) {
    return {
      current_weakness: '当前规则对 Tech Lead 的最终决策输出约束不够强，容易缺少 go/no-go 判断。',
      suggested_md_patch: "在《项目规则.md》的 Tech Lead 阶段增加：'最终汇总必须包含 go/no-go、剩余风险、验证证据和下一步最小动作；没有验证证据时只能给出 No-Go 或 Conditional-Go。'",
    };
  }
  if (input.overEngineeringHits > 0 || input.startupExcellence < 75) {
    return {
      current_weakness: '当前规则强调 MVP，但缺少防止过度设计的可执行红线。',
      suggested_md_patch: "在《项目规则.md》的 MVP 原则下增加：'任何新增框架、跨模块重构、平台化抽象、复杂状态机或新基础设施都必须先证明它能在 1 个迭代内提高 P0 转化或降低明确线上风险，否则默认拒绝。'",
    };
  }
  return {
    current_weakness: '当前规则具备基本流程约束，但缺少持续审计后的量化阈值。',
    suggested_md_patch: "在《项目规则.md》末尾增加：'每轮交付后 AiTeam 必须输出 rule_compliance、dialogue_quality、startup_excellence 三项评分；任一低于 70 分时，下一轮必须先修复对应流程问题再继续开发。'",
  };
}

function countRepeatedPrompts(turns: AuditTurn[]): number {
  const seen = new Set<string>();
  let repeated = 0;
  for (const turn of turns) {
    const normalized = (turn.user_prompt || '').replace(/\s+/g, '').slice(0, 80);
    if (!normalized) continue;
    if (seen.has(normalized)) repeated++;
    seen.add(normalized);
  }
  return repeated;
}

function countMatches(text: string, regex: RegExp): number {
  return Array.from(text.matchAll(regex)).length;
}

function avg(values: number[], fallback = 0): number {
  const usable = values.filter(value => Number.isFinite(value));
  if (usable.length === 0) return fallback;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function roleName(role: string): string {
  const names: Record<string, string> = {
    product: 'Product',
    engineer: 'Engineer',
    qa: 'QA',
    techlead: 'Tech Lead',
  };
  return names[role] || role;
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
