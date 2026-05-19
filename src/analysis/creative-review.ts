// Creative Review: 5th virtual team role
// Evaluates multi-proposal coverage, devil's advocate, user evidence, and commercial value

export interface CreativeReviewResult {
  score: number;                     // 0-1 weighted composite
  has_multiple_proposals: boolean;
  has_counter_opinion: boolean;
  has_user_evidence: boolean;
  feasibility_score: number;         // 0-1
  commercial_score: number;          // 0-1
  deficiencies: string[];
}

/**
 * Evaluate the Creative Review quality of an AI response.
 * Checks for multi-proposal comparison, devil's advocate reasoning,
 * user evidence, feasibility, and commercial value signals.
 */
export function evaluateCreativeReview(userPrompt: string, response: string): CreativeReviewResult {
  const text = (response || '').trim();
  const deficiencies: string[] = [];

  // 1. Multi-proposal coverage (30%) — at least 2 proposals/options
  const proposalPatterns = /(?:方案|option|approach|alternative)[\sAB]{0,3}[12AB一二两]/i;
  const optionComparison = /(?:方案\s*[AB一二]|Option\s*[12AB]|方案一.*方案二|approach\s*1.*approach\s*2)/i;
  const hasMultiple = proposalPatterns.test(text) || optionComparison.test(text) ||
    (text.match(/(?:方案|option|approach|alternative)/gi) || []).length >= 2;
  const proposalScore = hasMultiple ? 1 : 0;
  if (!hasMultiple) deficiencies.push('未提供多个备选方案进行对比');

  // 2. Counter opinion / Devil's advocate (25%)
  const counterPatterns = [
    /反对|counter|反对意见|different view|disagree/i,
    /风险|risk|downside|drawback|缺点|局限|limitation/i,
    /但.*可能|however.*might|but.*could|不过.*也许/i,
    /反面|devil'?s?\s*advocate|魔鬼代言人|挑战/i,
    /alternative|替代|另一.*思路|换.*角度/i,
  ];
  const hasCounterOpinion = counterPatterns.some(p => p.test(text));
  const counterScore = hasCounterOpinion ? 1 : 0;
  if (!hasCounterOpinion) deficiencies.push('缺少反面意见或魔鬼代言人分析');

  // 3. User evidence (25%) — interviews, research, data, validation signals
  const evidencePatterns = [
    /访谈|interview|用户调研|survey|问卷|用户反馈/i,
    /数据|data|metrics|指标|统计|statistic/i,
    /验证|validated|confirmed|验证过|已确认/i,
    /测试用户|beta|内测|灰度|A\/B/i,
    /用户说|customer said|用户提到|用户反映/i,
  ];
  const hasUserEvidence = evidencePatterns.some(p => p.test(text));
  const evidenceScore = hasUserEvidence ? 1 : 0;
  if (!hasUserEvidence) deficiencies.push('缺少用户证据（访谈、调研、数据或验证信号）');

  // 4. Commercial value (20%) — conversion, revenue, retention, acquisition signals
  const commercialPatterns = [
    /转化|conversion|转化率/i,
    /收入|revenue|营收|付费|pricing|定价/i,
    /留存|retention|复购|回访/i,
    /获客|acquisition|拉新|引 流/i,
    /GMV|ARPU|LTV|CAC|ROI/i,
    /商业|monetiz|business value|business model/i,
  ];
  const hasCommercial = commercialPatterns.some(p => p.test(text));
  const commercialScore = hasCommercial ? 1 : 0;
  if (!hasCommercial) deficiencies.push('缺少商业价值分析（转化、收入、留存或获客）');

  // Feasibility assessment: technical + timeline signals
  const feasibilitySignals = [
    /可行性|feasib/i,
    /技术.*可行|technically.*possible/i,
    /时间.*足够|timeline.*feasible/i,
    /资源.*足够|resource.*available/i,
    /难度|complexity|工期|workload/i,
  ];
  const feasibilityScore = feasibilitySignals.some(p => p.test(text)) ? 1 : 0.5;

  const score = Math.round(
    (0.30 * proposalScore +
     0.25 * counterScore +
     0.25 * evidenceScore +
     0.20 * commercialScore) * 100
  ) / 100;

  return {
    score,
    has_multiple_proposals: hasMultiple,
    has_counter_opinion: hasCounterOpinion,
    has_user_evidence: hasUserEvidence,
    feasibility_score: feasibilityScore,
    commercial_score: commercialScore,
    deficiencies,
  };
}
