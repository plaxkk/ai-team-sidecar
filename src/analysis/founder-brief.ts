// Founder Brief: structured input template for CEO/product requirements
// Converts "write whatever" into "fill this template" for better requirement quality

export interface FounderBrief {
  target_user: string;      // 目标用户
  pain_point: string;       // 痛点
  p0_scope: string;         // P0 范围
  not_doing: string;        // 不做什么
  success_metric: string;   // 成功指标
  validation_method: string;// 验证方式
  deadline: string;         // 截止日期
}

export interface FounderBriefValidation {
  is_valid: boolean;
  completeness: number;     // 0-1, fraction of filled fields
  missing_fields: string[];
  field_lengths: Record<string, number>;
  quality_score: number;    // 0-1, quality of content
  suggestions: string[];
}

export interface FounderBriefScore {
  score: number;            // 0-1
  completeness: number;
  specificity: number;
  validation_readiness: number;
}

export const BRIEF_FIELDS: (keyof FounderBrief)[] = [
  'target_user', 'pain_point', 'p0_scope', 'not_doing',
  'success_metric', 'validation_method', 'deadline',
];

export const BRIEF_FIELD_LABELS: Record<keyof FounderBrief, string> = {
  target_user: '目标用户',
  pain_point: '痛点',
  p0_scope: 'P0 范围',
  not_doing: '不做什么',
  success_metric: '成功指标',
  validation_method: '验证方式',
  deadline: '截止日期',
};

export const BRIEF_TEMPLATE = `## Founder Brief
目标用户 | 痛点 | P0 范围 | 不做什么 | 成功指标 | 验证方式 | 截止日期
--- | --- | --- | --- | --- | --- | ---
（填写） | （填写） | （填写） | （填写） | （填写） | （填写） | （填写）

详细说明：
- **目标用户**：谁会使用这个功能？
- **痛点**：他们现在遇到什么问题？
- **P0 范围**：这次只做什么？
- **不做什么**：明确排除什么？
- **成功指标**：怎么判断成功了？
- **验证方式**：用什么方式验证？
- **截止日期**：什么时候需要完成？`;

/**
 * Parse a Founder Brief from prompt text.
 * Detects structured brief markers and extracts fields.
 */
export function parseFounderBrief(text: string): FounderBrief | null {
  if (!text) return null;

  // Check for Founder Brief marker
  const hasBriefMarker = /founder\s*brief|创始人简报|简报模板/i.test(text);
  if (!hasBriefMarker) return null;

  const brief: FounderBrief = {
    target_user: '',
    pain_point: '',
    p0_scope: '',
    not_doing: '',
    success_metric: '',
    validation_method: '',
    deadline: '',
  };

  // Extract fields using Chinese labels or English labels
  const fieldPatterns: Array<{ field: keyof FounderBrief; patterns: RegExp[] }> = [
    { field: 'target_user', patterns: [/目标用户[：:]\s*(.+)/i, /target\s*user[：:]\s*(.+)/i] },
    { field: 'pain_point', patterns: [/痛点[：:]\s*(.+)/i, /pain\s*point[：:]\s*(.+)/i] },
    { field: 'p0_scope', patterns: [/P0\s*范围[：:]\s*(.+)/i, /p0\s*scope[：:]\s*(.+)/i, /这次只做[：:]\s*(.+)/i] },
    { field: 'not_doing', patterns: [/不做什么[：:]\s*(.+)/i, /not\s*doing[：:]\s*(.+)/i, /排除[：:]\s*(.+)/i] },
    { field: 'success_metric', patterns: [/成功指标[：:]\s*(.+)/i, /success\s*metric[：:]\s*(.+)/i, /怎么判断.*成功[：:]\s*(.+)/i] },
    { field: 'validation_method', patterns: [/验证方式[：:]\s*(.+)/i, /validation\s*method[：:]\s*(.+)/i, /怎么验证[：:]\s*(.+)/i] },
    { field: 'deadline', patterns: [/截止日期[：:]\s*(.+)/i, /deadline[：:]\s*(.+)/i, /什么时候.*完成[：:]\s*(.+)/i] },
  ];

  for (const { field, patterns } of fieldPatterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        brief[field] = match[1].trim();
        break;
      }
    }
  }

  return brief;
}

/**
 * Validate a Founder Brief for completeness and quality.
 */
export function validateFounderBrief(brief: FounderBrief): FounderBriefValidation {
  const missingFields: string[] = [];
  const fieldLengths: Record<string, number> = {};
  const suggestions: string[] = [];
  let filledCount = 0;

  for (const field of BRIEF_FIELDS) {
    const value = brief[field] || '';
    const length = value.length;
    fieldLengths[field] = length;

    if (!value || value === '（填写）' || value === '(fill)') {
      missingFields.push(BRIEF_FIELD_LABELS[field]);
    } else {
      filledCount++;

      // Quality checks per field
      if (length < 5) {
        suggestions.push(`${BRIEF_FIELD_LABELS[field]}描述过短，建议补充更多细节`);
      }
    }
  }

  const completeness = filledCount / BRIEF_FIELDS.length;

  // Specificity suggestions
  if (brief.p0_scope && /所有|全部|一切/.test(brief.p0_scope)) {
    suggestions.push('P0 范围过于宽泛，建议缩小到 1 个可验证的最小功能');
  }
  if (brief.not_doing && /无|没有|暂无|none/i.test(brief.not_doing)) {
    suggestions.push('"不做什么"很重要，建议至少列出 1-2 个明确排除项');
  }
  if (brief.success_metric && !/\d|%|率|数|时间|秒|分钟|小时|天/.test(brief.success_metric)) {
    suggestions.push('成功指标建议包含可量化的数字或百分比');
  }

  const qualityScore = Math.round(
    (completeness * 0.6 +
    (suggestions.length === 0 ? 0.4 : Math.max(0, 0.4 - suggestions.length * 0.1))) * 100
  ) / 100;

  return {
    is_valid: missingFields.length === 0 && qualityScore >= 0.5,
    completeness: Math.round(completeness * 100) / 100,
    missing_fields: missingFields,
    field_lengths: fieldLengths,
    quality_score: Math.min(1, qualityScore),
    suggestions,
  };
}

/**
 * Score a Founder Brief for alignment quality.
 * Used by prompt-evaluator to boost Completeness dimension.
 */
export function scoreFounderBrief(brief: FounderBrief): FounderBriefScore {
  const validation = validateFounderBrief(brief);

  // Specificity: average content length relative to a minimum threshold
  const lengths = BRIEF_FIELDS.map(f => (brief[f] || '').length);
  const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const specificity = Math.min(1, avgLength / 30); // 30 chars average is "specific"

  // Validation readiness: does the brief contain measurable success criteria?
  const hasMetrics = /\d|%|率|数|时间|秒|分钟|小时|天/.test(brief.success_metric || '');
  const hasValidation = /测试|验证|用户|上线|部署|手动|自动|test|verify/i.test(brief.validation_method || '');
  const validationReadiness = (hasMetrics ? 0.5 : 0) + (hasValidation ? 0.5 : 0);

  const score = Math.round(
    (validation.completeness * 0.4 + specificity * 0.3 + validationReadiness * 0.3) * 100
  ) / 100;

  return {
    score,
    completeness: validation.completeness,
    specificity: Math.round(specificity * 100) / 100,
    validation_readiness: Math.round(validationReadiness * 100) / 100,
  };
}
