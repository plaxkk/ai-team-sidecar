// Analyze requirement understanding quality
export interface ReqAnalysisResult {
  req_score: number;
  entity_confirmation: number;
  spec_quality: number;
  keyword_coverage: number;
  iteration_convergence: number;
}

// Required fields in Engineering Task Spec
const SPEC_REQUIRED_FIELDS = [
  '目标', '背景', '范围', '实现步骤', '测试策略', '风险', '依赖',
  'objective', 'background', 'scope', 'implementation', 'testing', 'risk', 'dependency',
];

export function analyzeRequirement(
  userPrompt: string,
  assistantResponse: string,
  previousCorrections: number = 0
): ReqAnalysisResult {
  // 1. Entity confirmation rate (30%)
  const userEntities = extractEntities(userPrompt);
  const entityConfirmation = userEntities.length > 0
    ? userEntities.filter(e => assistantResponse.toLowerCase().includes(e.toLowerCase())).length / userEntities.length
    : 0.5; // Neutral if no clear entities

  // 2. Spec quality (30%)
  const specMatch = assistantResponse.match(/Engineering Task Spec[\s\S]*?(?=##|$)/i);
  const specContent = specMatch ? specMatch[0] : '';
  const specFieldsFound = SPEC_REQUIRED_FIELDS.filter(f =>
    specContent.toLowerCase().includes(f.toLowerCase())
  );
  const spec_quality = specFieldsFound.length / SPEC_REQUIRED_FIELDS.length;

  // 3. Keyword coverage (25%)
  const userKeywords = extractKeywords(userPrompt);
  const responseLower = assistantResponse.toLowerCase();
  const coveredKeywords = userKeywords.filter(k => responseLower.includes(k.toLowerCase()));
  const keyword_coverage = userKeywords.length > 0 ? coveredKeywords.length / userKeywords.length : 0.5;

  // 4. Iteration convergence (15%) - fewer corrections = better
  const iteration_convergence = Math.max(0, 1 - (previousCorrections * 0.2));

  const req_score =
    0.30 * entityConfirmation +
    0.30 * spec_quality +
    0.25 * keyword_coverage +
    0.15 * iteration_convergence;

  return {
    req_score: Math.round(req_score * 100) / 100,
    entity_confirmation: Math.round(entityConfirmation * 100) / 100,
    spec_quality: Math.round(spec_quality * 100) / 100,
    keyword_coverage: Math.round(keyword_coverage * 100) / 100,
    iteration_convergence: Math.round(iteration_convergence * 100) / 100,
  };
}

function extractEntities(text: string): string[] {
  // Extract camelCase, PascalCase, kebab-case identifiers
  const identifiers = text.match(/[A-Z][a-zA-Z]+|[a-z]+(?:-[a-z]+)+|\b\w{4,}\b/g) || [];
  // Filter common stop words
  const stopWords = new Set(['that', 'this', 'with', 'from', 'have', 'been', 'will', 'would', 'could', 'should', 'please', 'need', 'want', 'like', 'just', 'about']);
  return [...new Set(identifiers.filter(w => !stopWords.has(w.toLowerCase())))];
}

function extractKeywords(text: string): string[] {
  const words = text.match(/\b\w{3,}\b/g) || [];
  const stopWords = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
    'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'from', 'this',
    'that', 'with', 'will', 'would', 'could', 'should', 'please', 'need',
    'want', 'like', 'just', 'about', 'into', 'over', 'after', 'before',
  ]);
  return [...new Set(words.filter(w => !stopWords.has(w.toLowerCase())))];
}
