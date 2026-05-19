// User prompt quality evaluator
// Assesses whether the user's task description is clear, specific, and actionable

export interface PromptEvaluation {
  score: number; // 0-1 weighted composite
  details: Record<string, number>;
  deficiencies: string[];
  suggestions: string[]; // actionable suggestions for the user
  explainability: QualityExplainability;
}

export interface QualityExplainability {
  formula: string;
  confidence: number;
  qualitative_summary: string;
  dimensions: Record<string, DimensionExplanation>;
}

export interface DimensionExplanation {
  score: number;
  weight: number;
  signals: string[];
  missing: string[];
  rationale: string;
  recommendation: string;
}

export function evaluatePrompt(prompt: string): PromptEvaluation {
  const details: Record<string, number> = {};
  const deficiencies: string[] = [];
  const suggestions: string[] = [];
  const dimensions: Record<string, DimensionExplanation> = {};

  const text = (prompt || '').trim();

  // 1. Specificity (30%) — mentions concrete files, functions, modules
  const fileRefs = text.match(/(?:src\/|\.\/|\b\w+\.(?:ts|tsx|js|jsx|py|go|rs|java|json|md|sql)\b)/gi) || [];
  const funcRefs = text.match(/(?:函数|function|method|类|class|组件|component)\s+[`'"]?\w+[`'"]?/gi) || [];
  const moduleRefs = text.match(/(?:模块|module|页面|page|路由|route|表|table)\s+[`'"]?\w+[`'"]?/gi) || [];
  const specificityParts = [fileRefs.length > 0, funcRefs.length > 0, moduleRefs.length > 0].filter(Boolean).length;
  const specificity = specificityParts / 3;
  details['明确性'] = Math.round(specificity * 100) / 100;
  dimensions['明确性'] = {
    score: details['明确性'],
    weight: 0.30,
    signals: [
      fileRefs.length > 0 ? `文件引用 ${fileRefs.slice(0, 3).join(', ')}` : '',
      funcRefs.length > 0 ? '提到函数/类/组件' : '',
      moduleRefs.length > 0 ? '提到模块/页面/路由/表' : '',
    ].filter(Boolean),
    missing: [
      fileRefs.length === 0 ? '缺少具体文件' : '',
      funcRefs.length === 0 ? '缺少函数/类/组件对象' : '',
      moduleRefs.length === 0 ? '缺少模块/页面/路由范围' : '',
    ].filter(Boolean),
    rationale: '明确性衡量 CEO/Product 是否把问题定位到可执行对象，降低 RD 探索成本。',
    recommendation: '补充具体文件、模块、页面、API 或组件名称；没有路径时至少说明业务对象。',
  };
  if (specificity < 0.5) {
    deficiencies.push('缺少具体文件/函数引用');
    suggestions.push('请指定具体文件或模块');
  }

  // 2. Completeness (25%) — contains goal, scope, constraints
  const hasGoal = /(?:目标|目的|goal|objective|期望|expected|要.*实现|要.*完成|想.*做)/i.test(text);
  const hasScope = /(?:范围|scope|涉及|包括|修改|添加|删除|创建|实现|修复)/i.test(text);
  const hasConstraints = /(?:限制|约束|constraint|条件|前提|必须|不能|注意|别|不要)/i.test(text);
  const completenessParts = [hasGoal, hasScope, hasConstraints].filter(Boolean).length;
  let completeness = completenessParts / 3;
  // Founder Brief alignment signal boosts completeness
  const hasBriefAlignment = /founder\s*brief|创始人简报|目标用户.*痛点|P0.*范围|不做什么.*成功指标/i.test(text);
  if (hasBriefAlignment) completeness = Math.min(1, completeness + 0.05);
  details['完整性'] = Math.round(completeness * 100) / 100;
  dimensions['完整性'] = {
    score: details['完整性'],
    weight: 0.25,
    signals: [
      hasGoal ? '包含目标/期望结果' : '',
      hasScope ? '包含范围/改动动作' : '',
      hasConstraints ? '包含约束/限制/注意事项' : '',
    ].filter(Boolean),
    missing: [
      !hasGoal ? '缺少目标或完成标准' : '',
      !hasScope ? '缺少范围边界' : '',
      !hasConstraints ? '缺少约束条件' : '',
    ].filter(Boolean),
    rationale: '完整性衡量需求是否具备目标、范围和约束，决定项目能否少返工。',
    recommendation: '用 What / Scope / Constraints / Success Metric 四行补齐输入。',
  };
  if (!hasGoal) {
    deficiencies.push('缺少目标说明');
    suggestions.push('请说明期望的结果是什么');
  }
  if (!hasConstraints) {
    deficiencies.push('缺少约束条件');
    suggestions.push('请说明技术/时间限制');
  }

  // 3. Actionability (25%) — clear verb + clear object
  const clearVerbs = /(?:实现|修复|添加|设计|创建|构建|重构|更新|删除|优化|部署|测试|验证|调整)/i.test(text);
  const vagueVerbs = /(?:弄|搞|弄一下|搞一下|看看|处理一下|弄好|搞定)/i.test(text);
  const hasObject = /(?:\w{3,}功能|\w{3,}模块|\w{3,}页面|\w{3,}接口|\w{3,}组件)/i.test(text);
  let actionability = 0;
  if (clearVerbs && hasObject) actionability = 1;
  else if (clearVerbs || hasObject) actionability = 0.5;
  else actionability = 0;
  if (vagueVerbs) actionability = Math.max(0, actionability - 0.3);
  details['可执行性'] = Math.round(actionability * 100) / 100;
  dimensions['可执行性'] = {
    score: details['可执行性'],
    weight: 0.25,
    signals: [
      clearVerbs ? '包含明确动作词' : '',
      hasObject ? '包含明确操作对象' : '',
    ].filter(Boolean),
    missing: [
      !clearVerbs ? '缺少明确动作词' : '',
      !hasObject ? '缺少操作对象' : '',
      vagueVerbs ? '存在模糊动作词' : '',
    ].filter(Boolean),
    rationale: '可执行性衡量输入能否直接转为任务，不需要 AI 先猜测要做什么。',
    recommendation: '使用“实现/修复/添加/删除/验证 + 具体对象 + 期望结果”的句式。',
  };
  if (vagueVerbs) {
    deficiencies.push('只有模糊动词（"弄一下"/"搞一下"）');
    suggestions.push('请使用明确的动作词（如实现、修复、添加、设计）');
  }
  if (!hasObject) {
    deficiencies.push('缺少明确的操作对象');
    suggestions.push('请指明要修改或实现的具体内容');
  }

  // 4. Context (20%) — provides code snippets, error info, background
  const hasCodeSnippet = /```|(?:代码|snippet|示例|example)/i.test(text);
  const hasErrorInfo = /(?:错误|error|exception|报错|trace|stack|fail)/i.test(text);
  const hasBackground = /(?:背景|context|之前|目前|现在|因为|由于)/i.test(text);
  const contextParts = [hasCodeSnippet, hasErrorInfo, hasBackground].filter(Boolean).length;
  const context = contextParts / 3;
  details['上下文'] = Math.round(context * 100) / 100;
  dimensions['上下文'] = {
    score: details['上下文'],
    weight: 0.20,
    signals: [
      hasCodeSnippet ? '包含代码/示例' : '',
      hasErrorInfo ? '包含错误/失败信息' : '',
      hasBackground ? '包含背景/现状说明' : '',
    ].filter(Boolean),
    missing: [
      !hasCodeSnippet ? '缺少代码或示例' : '',
      !hasErrorInfo ? '缺少错误或失败证据' : '',
      !hasBackground ? '缺少背景说明' : '',
    ].filter(Boolean),
    rationale: '上下文衡量 AI 是否有足够信息做低成本判断，避免重复探索。',
    recommendation: '补充现状、复现步骤、错误信息、关键代码片段或历史决策。',
  };
  if (context < 0.3) {
    deficiencies.push('缺少背景信息');
    suggestions.push('请提供相关代码或错误信息');
  }

  const score =
    0.30 * details['明确性'] +
    0.25 * details['完整性'] +
    0.25 * details['可执行性'] +
    0.20 * details['上下文'];

  return {
    score: Math.round(score * 100) / 100,
    details,
    deficiencies,
    suggestions,
    explainability: {
      formula: '30% 明确性 + 25% 完整性 + 25% 可执行性 + 20% 上下文',
      confidence: promptConfidence(text, deficiencies.length),
      qualitative_summary: summarizePrompt(score, deficiencies),
      dimensions,
    },
  };
}

function promptConfidence(text: string, deficiencyCount: number): number {
  const lengthScore = text.length > 30 ? 1 : text.length > 10 ? 0.7 : 0.4;
  const penalty = Math.min(0.4, deficiencyCount * 0.08);
  return Math.round(Math.max(0.3, lengthScore - penalty) * 100) / 100;
}

function summarizePrompt(score: number, deficiencies: string[]): string {
  if (score >= 0.8) return '输入已经接近可直接执行，主要风险在细节验收而不是需求理解。';
  if (score >= 0.6) return '输入具备基本方向，但仍需要补齐对象、约束或上下文以降低返工。';
  return `输入尚不足以科学管理项目，优先修复：${deficiencies.slice(0, 3).join('、') || '目标、范围和上下文'}`;
}
