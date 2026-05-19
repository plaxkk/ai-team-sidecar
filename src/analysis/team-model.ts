export type CoreRole = 'product' | 'engineer' | 'creative_review' | 'qa' | 'techlead';
export type OptionalRole = 'growth' | 'ops' | 'domain_expert';
export type TeamRole = CoreRole | OptionalRole;

export type ProjectTaskType =
  | 'feature'
  | 'bugfix'
  | 'deploy'
  | 'operation'
  | 'planning'
  | 'role_planning'
  | 'review'
  | 'continuation'
  | 'task';

export interface RoleExpectation {
  required: CoreRole[];
  optional: OptionalRole[];
  rationale: string;
}

const TASK_RULES: Record<ProjectTaskType, RoleExpectation> = {
  feature: {
    required: ['product', 'engineer', 'creative_review', 'qa', 'techlead'],
    optional: [],
    rationale: 'Feature work needs a spec, creative review, implementation plan, validation, and delivery decision.',
  },
  bugfix: {
    required: ['engineer', 'qa', 'techlead'],
    optional: [],
    rationale: 'Bugfix work should prioritize diagnosis, regression validation, and a ship decision.',
  },
  deploy: {
    required: ['engineer', 'qa', 'techlead'],
    optional: ['ops'],
    rationale: 'Deployment needs execution steps, verification, rollback risk, and a final decision.',
  },
  operation: {
    required: ['product', 'techlead'],
    optional: ['growth', 'ops', 'domain_expert'],
    rationale: 'Operation work needs goals, execution ownership, and domain context.',
  },
  planning: {
    required: ['product', 'creative_review', 'techlead'],
    optional: ['domain_expert'],
    rationale: 'Planning work needs a clear scope, creative alternatives, assumptions, and decision points.',
  },
  role_planning: {
    required: ['product', 'techlead'],
    optional: ['growth', 'ops', 'domain_expert'],
    rationale: 'Role design needs responsibility boundaries and gaps across the startup team.',
  },
  review: {
    required: ['qa', 'techlead'],
    optional: [],
    rationale: 'Review work needs independent findings and a decision summary.',
  },
  continuation: {
    required: ['techlead'],
    optional: [],
    rationale: 'Continuation turns should summarize state and next action without forcing a full team ceremony.',
  },
  task: {
    required: ['product', 'engineer', 'creative_review', 'qa', 'techlead'],
    optional: [],
    rationale: 'General delivery work defaults to the full core team with creative review.',
  },
};

export function detectProjectTaskType(prompt: string): ProjectTaskType {
  const text = (prompt || '').trim().toLowerCase();
  if (!text) return 'task';
  if (/^(继续|好的|可以|没问题|ok|yes|go ahead|proceed|sure|done|完成|继续做)/i.test(text)) {
    return 'continuation';
  }
  if (/bug|错误|报错|修复|问题|broken|debug|fix/i.test(text)) return 'bugfix';
  if (/部署|上线|发版|发布到|vercel|deploy|release|ship/i.test(text)) return 'deploy';
  if (/运营|增长|growth|目标管理|运营手册|落地|阶段目标/i.test(text)) return 'operation';
  if (/角色|职责|分工|团队|成员|互补|岗位|role/i.test(text)) return 'role_planning';
  if (/复盘|审查|review|验收|检查|评审/i.test(text)) return 'review';
  if (/规划|计划|规范|流程|roadmap|plan|strategy/i.test(text)) return 'planning';
  if (/新增|添加|实现|创建|构建|功能|feature|add|create|implement|build/i.test(text)) return 'feature';
  return 'task';
}

export function getRoleExpectation(taskType: ProjectTaskType): RoleExpectation {
  return TASK_RULES[taskType] || TASK_RULES.task;
}

export function detectOptionalRoles(prompt: string, response: string): OptionalRole[] {
  const text = `${prompt}\n${response}`.toLowerCase();
  const roles: OptionalRole[] = [];
  if (/运营|落地|手册|流程|ops|runbook|执行/.test(text)) roles.push('ops');
  if (/增长|拉新|留存|转化|growth|运营目标|指标|北极星/.test(text)) roles.push('growth');
  if (/领域专家|专业人士|旅游玩家|国外游客|国内|海外|domain|expert/.test(text)) roles.push('domain_expert');
  return roles;
}
