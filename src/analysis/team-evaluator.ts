import { CoreRole, OptionalRole, ProjectTaskType, TeamRole, detectOptionalRoles, getRoleExpectation } from './team-model.js';

export interface TeamEvaluation {
  task_type: ProjectTaskType;
  score: number;
  required_roles: CoreRole[];
  optional_roles: OptionalRole[];
  present_roles: TeamRole[];
  missing_roles: CoreRole[];
  overused_roles: TeamRole[];
  issues: string[];
  recommendations: string[];
}

const ROLE_BOUNDARIES: Record<CoreRole, RegExp[]> = {
  product: [/Engineering Task Spec/i, /目标|用户场景|期望行为|成功指标|优先级/],
  engineer: [/系统理解|技术方案|代码修改|diff|patch|实现/],
  qa: [/QA|质量审查|边界|风险等级|测试|验证/],
  techlead: [/Tech Lead|执行建议|Go|No-Go|决策点|方案总结/],
};

export function evaluateTeamComposition(
  taskType: ProjectTaskType,
  prompt: string,
  response: string,
  detectedRoles: string[]
): TeamEvaluation {
  const expectation = getRoleExpectation(taskType);
  const optionalRoles = detectOptionalRoles(prompt, response);
  const presentCore = detectedRoles.filter((r): r is CoreRole =>
    ['product', 'engineer', 'qa', 'techlead'].includes(r)
  );
  const present = [...new Set<TeamRole>([...presentCore, ...optionalRoles])];

  const missing = expectation.required.filter(r => !presentCore.includes(r));
  const overused = findOverusedRoles(taskType, presentCore, response);
  const issues: string[] = [];
  const recommendations: string[] = [];

  for (const role of missing) {
    issues.push(`缺少 ${role} 角色参与`);
    recommendations.push(`为 ${role} 增加明确输出，覆盖该任务类型的必要职责`);
  }

  for (const role of overused) {
    issues.push(`${role} 角色可能承担了过多职责`);
    recommendations.push(`拆分 ${role} 的输出边界，避免替代其他角色做决策或审查`);
  }

  const optionalExpected = expectation.optional.filter(r => optionalRoles.includes(r)).length;
  const requiredScore = expectation.required.length > 0
    ? (expectation.required.length - missing.length) / expectation.required.length
    : 1;
  const optionalScore = expectation.optional.length > 0
    ? Math.min(1, optionalExpected / expectation.optional.length)
    : 1;
  const boundaryScore = overused.length === 0 ? 1 : Math.max(0, 1 - overused.length * 0.2);
  const score = round(0.65 * requiredScore + 0.15 * optionalScore + 0.20 * boundaryScore);

  if (score >= 0.8) {
    recommendations.push('当前角色组合基本合理，保持职责边界和交付闭环');
  }

  return {
    task_type: taskType,
    score,
    required_roles: expectation.required,
    optional_roles: expectation.optional,
    present_roles: present,
    missing_roles: missing,
    overused_roles: overused,
    issues,
    recommendations: [...new Set(recommendations)].slice(0, 6),
  };
}

function findOverusedRoles(taskType: ProjectTaskType, presentRoles: CoreRole[], response: string): TeamRole[] {
  const overused = new Set<TeamRole>();

  if (taskType === 'continuation' && presentRoles.length > 2) {
    overused.add('techlead');
  }

  for (const role of presentRoles) {
    const ownSignals = ROLE_BOUNDARIES[role].filter(p => p.test(response)).length;
    const otherSignals = Object.entries(ROLE_BOUNDARIES)
      .filter(([other]) => other !== role)
      .flatMap(([, patterns]) => patterns)
      .filter(p => p.test(response)).length;
    if (ownSignals === 0 && otherSignals >= 3) overused.add(role);
  }

  return Array.from(overused);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

