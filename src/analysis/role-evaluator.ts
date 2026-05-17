// Per-role evaluation: Product, Engineer, QA, Tech Lead
export type Role = 'product' | 'engineer' | 'qa' | 'techlead';

export interface RoleEvaluation {
  role: Role;
  score: number;           // 0-1 weighted composite
  details: Record<string, number>; // sub-dimension scores
  deficiencies: string[];  // actionable deficiency descriptions
}

// ─── Product Role ───

const PRODUCT_SPEC_FIELDS = [
  { zh: '目标', en: 'objective', alias: ['goal', '目的'] },
  { zh: '用户场景', en: 'user scenario', alias: ['scenario', '场景'] },
  { zh: '当前问题', en: 'current problem', alias: ['problem', 'issue', '问题'] },
  { zh: '期望行为', en: 'expected behavior', alias: ['expected', 'behavior', '期望'] },
  { zh: '优先级', en: 'priority', alias: ['priorit', 'p0', 'p1', 'p2'] },
  { zh: '限制条件', en: 'constraints', alias: ['constraint', '限制', '约束'] },
  { zh: '成功指标', en: 'success criteria', alias: ['success', 'criteria', '指标', '衡量'] },
];

function evaluateProduct(userPrompt: string, response: string): RoleEvaluation {
  const details: Record<string, number> = {};
  const deficiencies: string[] = [];

  const productSection = extractRoleSection(response, 'product');

  // 1. Spec completeness (35%)
  const specContent = productSection || response;
  const missingFields: string[] = [];
  let fieldsFound = 0;
  for (const field of PRODUCT_SPEC_FIELDS) {
    const found = [field.zh, field.en, ...field.alias].some(k =>
      specContent.toLowerCase().includes(k.toLowerCase())
    );
    if (found) fieldsFound++;
    else missingFields.push(field.zh);
  }
  const specCompleteness = fieldsFound / PRODUCT_SPEC_FIELDS.length;
  details['Spec完整性'] = Math.round(specCompleteness * 100) / 100;
  for (const m of missingFields) {
    deficiencies.push(`Spec缺少"${m}"字段`);
  }

  // 2. Entity confirmation (25%)
  const entities = extractEntities(userPrompt);
  const confirmed = entities.filter(e => productSection.toLowerCase().includes(e.toLowerCase()));
  const entityConfirmation = entities.length > 0 ? confirmed.length / entities.length : 0.5;
  details['需求忠实度'] = Math.round(entityConfirmation * 100) / 100;
  for (const e of entities) {
    if (!productSection.toLowerCase().includes(e.toLowerCase())) {
      deficiencies.push(`未确认用户提到的实体"${e}"`);
    }
  }

  // 3. Ambiguity handling (20%)
  const ambiguitySignals = ['假设', '歧义', '不确定', '不明确', '如果', 'TODO', '待确认', 'assumption', 'ambiguous', 'unclear'];
  const hasAmbiguity = ambiguitySignals.some(s => productSection.toLowerCase().includes(s.toLowerCase()));
  details['歧义处理'] = hasAmbiguity ? 1 : 0;
  if (!hasAmbiguity) {
    deficiencies.push('未识别需求歧义或列出假设');
  }

  // 4. Priority judgment (20%)
  const hasPriority = /\b(P0|P1|P2)\b/i.test(productSection) || /优先级|priority/i.test(productSection);
  details['优先级判断'] = hasPriority ? 1 : 0;
  if (!hasPriority) {
    deficiencies.push('未标注优先级 P0/P1/P2');
  }

  const score =
    0.35 * details['Spec完整性'] +
    0.25 * details['需求忠实度'] +
    0.20 * details['歧义处理'] +
    0.20 * details['优先级判断'];

  return { role: 'product', score: Math.round(score * 100) / 100, details, deficiencies };
}

// ─── Engineer Role ───

function evaluateEngineer(_userPrompt: string, response: string): RoleEvaluation {
  const details: Record<string, number> = {};
  const deficiencies: string[] = [];

  const engineerSection = extractRoleSection(response, 'engineer');
  const section = engineerSection || response;

  // 1. Solution completeness (30%)
  const hasSystemUnderstanding = /(系统理解|架构|context|understanding|overview)/i.test(section);
  const hasTechPlan = /(技术方案|solution|approach|plan|option)/i.test(section);
  const hasRecommendation = /(推荐|建议|recommend|chosen|selected|preferred)/i.test(section);
  const hasCode = /(```|代码|code|diff|patch)/i.test(section);
  const completenessParts = [hasSystemUnderstanding, hasTechPlan, hasRecommendation, hasCode].filter(Boolean).length;
  const solutionCompleteness = completenessParts / 4;
  details['方案完整性'] = Math.round(solutionCompleteness * 100) / 100;
  if (!hasSystemUnderstanding) deficiencies.push('缺少系统理解说明');
  if (!hasTechPlan) deficiencies.push('缺少技术方案说明，直接给出代码');
  if (!hasRecommendation) deficiencies.push('未给出明确推荐方案');
  if (!hasCode) deficiencies.push('未提供代码修改');

  // 2. Option comparison (20%)
  const optionMatches = section.match(/(?:方案|option|approach|alternative)[\s\S]*?(?:方案|option|approach|alternative)/gi);
  const hasComparison = (optionMatches && optionMatches.length >= 2) || /(?:vs|versus|对比|比较|or)/i.test(section);
  details['方案对比'] = hasComparison ? 1 : 0;
  if (!hasComparison) {
    deficiencies.push('未提供方案对比');
  }

  // 3. Spec compliance (25%) — engineer mentions product spec points
  const productSection = extractRoleSection(response, 'product');
  const specKeywords = extractKeywords(productSection);
  const covered = specKeywords.filter(k => section.toLowerCase().includes(k.toLowerCase()));
  const specCompliance = specKeywords.length > 0 ? covered.length / specKeywords.length : 0.5;
  details['Spec遵从'] = Math.round(specCompliance * 100) / 100;
  if (specCompliance < 0.5) {
    deficiencies.push('代码实现未覆盖 Product Spec 中的要点');
  }

  // 4. MVP compliance (25%) — rough heuristic: count changed files
  const fileMatches = section.match(/(?:修改|编辑|文件|file|changed|\b\w+\.[a-z]+\b)/gi) || [];
  const changedFiles = new Set(fileMatches).size;
  let mvpScore = 1;
  if (changedFiles > 8) { mvpScore = 0.3; deficiencies.push(`改动范围过大（约${changedFiles}个文件），可能违反MVP原则`); }
  else if (changedFiles > 5) { mvpScore = 0.6; deficiencies.push(`改动范围较大（约${changedFiles}个文件）`); }
  else if (changedFiles === 0) { mvpScore = 0.5; deficiencies.push('未明确标注改动文件'); }
  details['MVP合规'] = mvpScore;

  const score =
    0.30 * details['方案完整性'] +
    0.20 * details['方案对比'] +
    0.25 * details['Spec遵从'] +
    0.25 * details['MVP合规'];

  return { role: 'engineer', score: Math.round(score * 100) / 100, details, deficiencies };
}

// ─── QA Role ───

function evaluateQA(_userPrompt: string, response: string): RoleEvaluation {
  const details: Record<string, number> = {};
  const deficiencies: string[] = [];

  const qaSection = extractRoleSection(response, 'qa');

  // 1. Independence (25%)
  const isPlaceholder = /(?:无需审查|无需测试|no issues|nothing to review|跳过|skip)/i.test(qaSection);
  const isSubstantial = qaSection.length > 150;
  details['独立性'] = isPlaceholder ? 0 : (isSubstantial ? 1 : 0.5);
  if (isPlaceholder) deficiencies.push('QA段落为占位内容（"无需审查"等）');
  else if (!isSubstantial) deficiencies.push('QA段落过短，内容不足');

  // 2. Edge case coverage (25%)
  const edgeSignals = ['边界', 'edge', 'corner', '极端', '异常', '空值', 'null', 'undefined', 'empty', '边界情况'];
  const hasEdgeCases = edgeSignals.some(s => qaSection.toLowerCase().includes(s.toLowerCase()));
  details['边界覆盖'] = hasEdgeCases ? 1 : 0;
  if (!hasEdgeCases) deficiencies.push('未列出边界情况/edge cases');

  // 3. Risk labeling (25%)
  const riskLabels = /(?:高|中|低|high|medium|low)\s*(?:风险|risk)/i.test(qaSection);
  details['风险标注'] = riskLabels ? 1 : 0;
  if (!riskLabels) deficiencies.push('未标注风险等级（高/中/低）');

  // 4. Issue discovery (25%)
  const issueSignals = ['问题', '缺陷', '风险', 'bug', 'concern', 'issue', '潜在', '建议', '注意'];
  const hasIssues = issueSignals.some(s => qaSection.toLowerCase().includes(s.toLowerCase()));
  details['问题发现'] = hasIssues ? 1 : 0;
  if (!hasIssues) deficiencies.push('未发现任何具体问题，审查可能不充分');

  const score =
    0.25 * details['独立性'] +
    0.25 * details['边界覆盖'] +
    0.25 * details['风险标注'] +
    0.25 * details['问题发现'];

  return { role: 'qa', score: Math.round(score * 100) / 100, details, deficiencies };
}

// ─── Tech Lead Role ───

function evaluateTechLead(_userPrompt: string, response: string): RoleEvaluation {
  const details: Record<string, number> = {};
  const deficiencies: string[] = [];

  const tlSection = extractRoleSection(response, 'techlead');

  // 1. Decision completeness (30%)
  const hasSummary = /(?:总结|summary|方案总结|overview)/i.test(tlSection);
  const hasQaRisk = /(?:QA|风险|qa|risk)/i.test(tlSection);
  const hasExecution = /(?:执行|建议|recommendation|action|proceed|go ahead|执行建议)/i.test(tlSection);
  const hasUserDecision = /(?:用户|决策|确认|decision|用户决策点|user decision)/i.test(tlSection);
  const completeness = [hasSummary, hasQaRisk, hasExecution, hasUserDecision].filter(Boolean).length / 4;
  details['决策完整性'] = Math.round(completeness * 100) / 100;
  if (!hasSummary) deficiencies.push('缺少方案总结');
  if (!hasQaRisk) deficiencies.push('未传达QA风险');
  if (!hasExecution) deficiencies.push('缺少明确的执行建议');
  if (!hasUserDecision) deficiencies.push('未列出需要用户确认的决策点');

  // 2. Risk conveyance (25%)
  const qaSection = extractRoleSection(response, 'qa');
  const qaRiskKeywords = ['风险', '问题', '缺陷', '高', '中', '低', 'bug', 'risk', 'issue'];
  const qaRisks = qaRiskKeywords.filter(k => qaSection.toLowerCase().includes(k.toLowerCase()));
  const tlMentionsRisk = qaRiskKeywords.filter(k => tlSection.toLowerCase().includes(k.toLowerCase()));
  const riskConveyance = qaRisks.length > 0
    ? (tlMentionsRisk.length >= Math.min(2, qaRisks.length) ? 1 : 0.5)
    : 0.5;
  details['风险传达'] = riskConveyance;
  if (riskConveyance < 1) deficiencies.push('未准确传达QA发现的风险');

  // 3. Go/No-Go (25%)
  const goSignals = /(?:执行|继续|go|proceed|推荐执行|可以执行|approved|yes|go ahead)/i.test(tlSection);
  const noGoSignals = /(?:暂停|不执行|no-go|hold|停止|暂缓|reject)/i.test(tlSection);
  details['Go/No-Go'] = goSignals || noGoSignals ? 1 : 0;
  if (!goSignals && !noGoSignals) deficiencies.push('未给出明确的执行/暂停建议');

  // 4. Information synthesis (20%)
  const productMentioned = /(?:product|需求|spec)/i.test(tlSection);
  const engineerMentioned = /(?:engineer|技术|代码|方案)/i.test(tlSection);
  const qaMentioned = /(?:qa|质量|审查|测试)/i.test(tlSection);
  const synthesis = [productMentioned, engineerMentioned, qaMentioned].filter(Boolean).length / 3;
  details['信息综合'] = Math.round(synthesis * 100) / 100;
  if (synthesis < 1) deficiencies.push('Tech Lead 未有效综合各角色信息');

  const score =
    0.30 * details['决策完整性'] +
    0.25 * details['风险传达'] +
    0.25 * details['Go/No-Go'] +
    0.20 * details['信息综合'];

  return { role: 'techlead', score: Math.round(score * 100) / 100, details, deficiencies };
}

// ─── Orchestrator ───

export function evaluateAllRoles(userPrompt: string, response: string): RoleEvaluation[] {
  return [
    evaluateProduct(userPrompt, response),
    evaluateEngineer(userPrompt, response),
    evaluateQA(userPrompt, response),
    evaluateTechLead(userPrompt, response),
  ];
}

// ─── Helpers ───

function extractRoleSection(response: string, role: Role): string {
  const rolePatterns: Record<Role, RegExp[]> = {
    product: [/##\s*Product/i, /产品理解/i, /Engineering Task Spec/i],
    engineer: [/##\s*ENGINEER/i, /##\s*Engineer/i, /技术方案/i],
    qa: [/##\s*QA/i, /质量审查/i, /风险等级/i],
    techlead: [/##\s*TECH\s*LEAD/i, /##\s*Tech\s*Lead/i, /决策信息/i, /是否执行/i],
  };

  for (const pattern of rolePatterns[role]) {
    const match = response.match(pattern);
    if (match && match.index !== undefined) {
      const start = match.index;
      const nextSection = response.indexOf('##', start + 4);
      const end = nextSection > start ? nextSection : response.length;
      return response.slice(start, end);
    }
  }
  return '';
}

function extractEntities(text: string): string[] {
  const identifiers = text.match(/[A-Z][a-zA-Z]+|[a-z]+(?:-[a-z]+)+|\b\w{4,}\b/g) || [];
  const stopWords = new Set(['that', 'this', 'with', 'from', 'have', 'been', 'will', 'would', 'could', 'should', 'please', 'need', 'want', 'like', 'just', 'about', 'these', 'those', 'them']);
  return [...new Set(identifiers.filter(w => !stopWords.has(w.toLowerCase())))].slice(0, 15);
}

function extractKeywords(text: string): string[] {
  const words = text.match(/\b\w{3,}\b/g) || [];
  const stopWords = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
    'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'from', 'this',
    'that', 'with', 'will', 'would', 'could', 'should', 'please', 'need',
    'want', 'like', 'just', 'about', 'into', 'over', 'after', 'before',
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can',
  ]);
  return [...new Set(words.filter(w => !stopWords.has(w.toLowerCase())))].slice(0, 20);
}
