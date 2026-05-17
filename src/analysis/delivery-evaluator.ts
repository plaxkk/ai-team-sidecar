// AI delivery quality evaluator
// Assesses whether the AI response is a high-quality deliverable

export interface DeliveryEvaluation {
  score: number; // 0-1 weighted composite
  details: Record<string, number>;
  deficiencies: string[];
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

export function evaluateDelivery(userPrompt: string, response: string): DeliveryEvaluation {
  const details: Record<string, number> = {};
  const deficiencies: string[] = [];
  const dimensions: Record<string, DimensionExplanation> = {};

  const text = (response || '').trim();
  const prompt = (userPrompt || '').trim();

  // 1. Task coverage (30%) — response addresses all points in the user request
  const promptRequests = extractRequests(prompt);
  const coveredRequests = promptRequests.filter(r =>
    text.toLowerCase().includes(r.toLowerCase()) ||
    matchesRequestConceptually(r, text)
  );
  const coverage = promptRequests.length > 0
    ? coveredRequests.length / promptRequests.length
    : 0.5;
  details['任务覆盖度'] = Math.round(coverage * 100) / 100;
  dimensions['任务覆盖度'] = {
    score: details['任务覆盖度'],
    weight: 0.30,
    signals: coveredRequests.slice(0, 3).map(r => `已覆盖：${truncate(r, 80)}`),
    missing: promptRequests.filter(r => !coveredRequests.includes(r)).slice(0, 3).map(r => `未明显覆盖：${truncate(r, 80)}`),
    rationale: '任务覆盖度衡量交付是否回应了用户显式提出的请求，防止答非所问或漏需求。',
    recommendation: '交付结尾用 checklist 逐项对应用户请求，标注完成/未完成/原因。',
  };
  if (coverage < 0.8) {
    deficiencies.push('未回应用户的全部请求');
  }

  // 2. Code quality (25%) — explanations, no obvious syntax errors
  const codeBlocks = text.match(/```[\s\S]*?```/g) || [];
  const hasCodeExplanation = /(?:解释|说明|注释|comment|explanation|purpose|这里|下面|上述)/i.test(text);
  let syntaxErrorCount = 0;
  for (const block of codeBlocks) {
    const code = block.replace(/```[\w]*\n?/g, '');
    // Heuristic: check for unbalanced brackets/parens
    const openParen = (code.match(/\(/g) || []).length;
    const closeParen = (code.match(/\)/g) || []).length;
    const openBrace = (code.match(/\{/g) || []).length;
    const closeBrace = (code.match(/\}/g) || []).length;
    const openBracket = (code.match(/\[/g) || []).length;
    const closeBracket = (code.match(/\]/g) || []).length;
    if (openParen !== closeParen) syntaxErrorCount++;
    if (openBrace !== closeBrace) syntaxErrorCount++;
    if (openBracket !== closeBracket) syntaxErrorCount++;
  }
  const hasSyntaxIssues = syntaxErrorCount > 0 && codeBlocks.length > 0;
  let codeQuality = 1;
  if (codeBlocks.length > 0 && !hasCodeExplanation) codeQuality -= 0.4;
  if (hasSyntaxIssues) codeQuality -= 0.4;
  if (codeBlocks.length === 0) codeQuality = 0.5; // no code blocks = neutral
  details['代码质量'] = Math.max(0, Math.round(codeQuality * 100) / 100);
  dimensions['代码质量'] = {
    score: details['代码质量'],
    weight: 0.25,
    signals: [
      codeBlocks.length > 0 ? `包含 ${codeBlocks.length} 个代码块` : '未输出代码块，按中性分处理',
      hasCodeExplanation ? '包含代码解释/说明' : '',
      !hasSyntaxIssues && codeBlocks.length > 0 ? '未发现明显括号不平衡' : '',
    ].filter(Boolean),
    missing: [
      codeBlocks.length > 0 && !hasCodeExplanation ? '代码缺少解释' : '',
      hasSyntaxIssues ? '代码可能存在语法结构问题' : '',
    ].filter(Boolean),
    rationale: '代码质量是静态启发式检查，用于发现明显低质量交付，不替代编译和测试。',
    recommendation: '代码交付必须说明改动目的、关键路径和潜在风险；最终以 build/test 结果校准。',
  };
  if (codeBlocks.length > 0 && !hasCodeExplanation) {
    deficiencies.push('代码缺少解释');
  }
  if (hasSyntaxIssues) {
    deficiencies.push('代码可能存在语法错误（未闭合括号等）');
  }

  // 3. Verification steps (20%) — includes testing, validation, checks
  const verificationSignals = [
    '测试', '验证', '检查', '确认', '运行', 'npm test', 'tsc', 'build',
    'test', 'verify', 'check', 'validate', '确认', 'try', 'console.log',
    'curl', 'httpie', 'refresh', '重启',
  ];
  const hasVerification = verificationSignals.some(s => text.toLowerCase().includes(s.toLowerCase()));
  details['验证步骤'] = hasVerification ? 1 : 0;
  dimensions['验证步骤'] = {
    score: details['验证步骤'],
    weight: 0.20,
    signals: verificationSignals.filter(s => text.toLowerCase().includes(s.toLowerCase())).slice(0, 5).map(s => `验证信号：${s}`),
    missing: hasVerification ? [] : ['缺少 build/test/run/verify/deploy 等验证证据'],
    rationale: '验证步骤衡量交付是否形成闭环。初创公司高速度不能以无验证为代价。',
    recommendation: '每次交付至少提供一个可执行验证命令或手动验收路径，并说明结果。',
  };
  if (!hasVerification) {
    deficiencies.push('缺少验证步骤');
  }

  // 4. Output completeness (25%) — summary, no omissions, next actions
  const hasSummary = /(?:总结|summary|小结|overview|overall|整体)/i.test(text);
  const hasNextActions = /(?:下一步|后续|建议|可以|TODO|FIXME|注意|提醒)/i.test(text);
  const hasCodeOrPlan = /(?:```|代码|diff|修改|方案|实现)/i.test(text);
  const completenessParts = [hasSummary, hasNextActions, hasCodeOrPlan].filter(Boolean).length;
  const completeness = completenessParts / 3;
  details['输出完整性'] = Math.round(completeness * 100) / 100;
  dimensions['输出完整性'] = {
    score: details['输出完整性'],
    weight: 0.25,
    signals: [
      hasSummary ? '包含总结/整体说明' : '',
      hasNextActions ? '包含下一步/建议/注意事项' : '',
      hasCodeOrPlan ? '包含代码、diff、方案或实现说明' : '',
    ].filter(Boolean),
    missing: [
      !hasSummary ? '缺少总结' : '',
      !hasNextActions ? '缺少后续行动' : '',
      !hasCodeOrPlan ? '缺少代码/方案/实现证据' : '',
    ].filter(Boolean),
    rationale: '输出完整性衡量结果是否可验收、可交接、可继续推进。',
    recommendation: '交付固定包含：改了什么、为什么、如何验证、剩余风险、下一步最小动作。',
  };
  if (!hasSummary) {
    deficiencies.push('缺少总结');
  }
  if (!hasNextActions) {
    deficiencies.push('缺少后续行动建议');
  }

  const score =
    0.30 * details['任务覆盖度'] +
    0.25 * details['代码质量'] +
    0.20 * details['验证步骤'] +
    0.25 * details['输出完整性'];

  return {
    score: Math.round(score * 100) / 100,
    details,
    deficiencies,
    explainability: {
      formula: '30% 任务覆盖度 + 25% 代码质量 + 20% 验证步骤 + 25% 输出完整性',
      confidence: deliveryConfidence(text, codeBlocks.length, hasVerification, deficiencies.length),
      qualitative_summary: summarizeDelivery(score, deficiencies),
      dimensions,
    },
  };
}

// Extract likely request items from the prompt
function extractRequests(prompt: string): string[] {
  // Split by common delimiters and look for actionable segments
  const sentences = prompt.split(/[。.；;!！\n]+/).map(s => s.trim()).filter(s => s.length > 5);
  const requests: string[] = [];
  for (const sentence of sentences) {
    // Look for imperative patterns
    if (/\b(实现|修复|添加|设计|创建|构建|重构|更新|删除|优化|部署|测试|验证|调整|帮我|请|can you|please|implement|fix|add|create|build|refactor|update|delete|optimize|deploy|test|verify)\b/i.test(sentence)) {
      requests.push(sentence);
    }
  }
  return requests.length > 0 ? requests.slice(0, 6) : [prompt];
}

// Check if a request is conceptually addressed (even without exact keyword match)
function matchesRequestConceptually(request: string, response: string): boolean {
  const reqWords = request.match(/\b\w{3,}\b/g) || [];
  const respLower = response.toLowerCase();
  const matches = reqWords.filter(w => respLower.includes(w.toLowerCase()));
  return reqWords.length > 0 && matches.length / reqWords.length >= 0.3;
}

function deliveryConfidence(text: string, codeBlockCount: number, hasVerification: boolean, deficiencyCount: number): number {
  let confidence = text.length > 200 ? 0.85 : text.length > 80 ? 0.7 : 0.5;
  if (codeBlockCount > 0) confidence += 0.05;
  if (hasVerification) confidence += 0.08;
  confidence -= Math.min(0.25, deficiencyCount * 0.06);
  return Math.round(Math.max(0.3, Math.min(1, confidence)) * 100) / 100;
}

function summarizeDelivery(score: number, deficiencies: string[]): string {
  if (score >= 0.8) return '交付基本完整，具备较好的覆盖、实现说明和验证闭环。';
  if (score >= 0.6) return '交付可用但仍需补强验证证据、覆盖清单或后续动作。';
  return `交付闭环不足，优先修复：${deficiencies.slice(0, 3).join('、') || '覆盖、验证和总结'}`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
