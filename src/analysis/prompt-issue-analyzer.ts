export type PromptIssueSeverity = 'high' | 'medium' | 'low';

export interface PromptIssue {
  category: string;
  severity: PromptIssueSeverity;
  issue: string;
  suggestion: string;
}

export interface PromptIssueAnalysis {
  score: number;
  issues: PromptIssue[];
  rewrite_suggestion: string;
}

export function analyzePromptIssues(prompt: string): PromptIssueAnalysis {
  const text = (prompt || '').trim();
  const issues: PromptIssue[] = [];

  // Check for Founder Brief and validate completeness
  const hasBriefMarker = /founder\s*brief|创始人简报|简报模板/i.test(text);
  if (hasBriefMarker) {
    const briefFieldPatterns = [
      { label: '目标用户', pattern: /目标用户[：:]/i },
      { label: '痛点', pattern: /痛点[：:]/i },
      { label: 'P0 范围', pattern: /P0\s*范围[：:]/i },
      { label: '不做什么', pattern: /不做什么[：:]/i },
      { label: '成功指标', pattern: /成功指标[：:]/i },
      { label: '验证方式', pattern: /验证方式[：:]/i },
      { label: '截止日期', pattern: /截止日期[：:]/i },
    ];
    const missingBriefFields = briefFieldPatterns.filter(f => !f.pattern.test(text)).map(f => f.label);
    if (missingBriefFields.length > 0) {
      issues.push({
        category: 'brief_completeness',
        severity: 'high',
        issue: `Founder Brief 缺少字段：${missingBriefFields.join('、')}`,
        suggestion: `补齐 Founder Brief 中的：${missingBriefFields.join('、')}`,
      });
    }
  }

  if (!/(目标|目的|期望|实现|修复|添加|建立|完成|goal|objective|expected|implement|fix|add)/i.test(text)) {
    issues.push({
      category: '目标',
      severity: 'high',
      issue: '缺少明确目标',
      suggestion: '用一句话说明完成后要达到什么结果',
    });
  }

  if (!/(验收|成功|指标|标准|完成标准|测试|验证|success|criteria|acceptance|verify|test)/i.test(text)) {
    issues.push({
      category: '验收',
      severity: 'high',
      issue: '缺少可验收标准',
      suggestion: '补充 2-3 条可验证的完成标准',
    });
  }

  if (!/(范围|只|不包括|不要|限制|约束|必须|不能|scope|constraint|only|must|avoid)/i.test(text)) {
    issues.push({
      category: '边界',
      severity: 'medium',
      issue: '任务边界不清晰',
      suggestion: '说明本次做什么、不做什么，以及技术或时间约束',
    });
  }

  const taskSignals = (text.match(/(\d+[，、.)]|同时|另外|还需要|并且|以及|and|also)/gi) || []).length;
  if (taskSignals >= 3 || text.length > 220) {
    issues.push({
      category: '拆分',
      severity: 'medium',
      issue: '可能混合了多个大任务',
      suggestion: '拆成多个 episode，每个 episode 只对应一个可验收交付物',
    });
  }

  if (!/(P0|P1|P2|优先级|紧急|重要|priority|urgent)/i.test(text)) {
    issues.push({
      category: '优先级',
      severity: 'low',
      issue: '缺少优先级',
      suggestion: '标注 P0/P1/P2，帮助团队决定投入深度',
    });
  }

  if (/^(继续|好的|可以|没问题|ok|yes|go ahead|proceed|sure|done|完成)$/i.test(text)) {
    issues.push({
      category: '上下文',
      severity: 'medium',
      issue: '继续类 prompt 缺少目标回指',
      suggestion: '写明继续哪个任务、下一步期望是什么',
    });
  }

  const penalty = issues.reduce((sum, issue) => {
    if (issue.severity === 'high') return sum + 0.25;
    if (issue.severity === 'medium') return sum + 0.15;
    return sum + 0.08;
  }, 0);

  return {
    score: Math.max(0, round(1 - penalty)),
    issues,
    rewrite_suggestion: buildRewriteSuggestion(text, issues),
  };
}

function buildRewriteSuggestion(prompt: string, issues: PromptIssue[]): string {
  if (issues.length === 0) return '当前 prompt 已具备较好的目标、边界和验收信息。';

  const trimmed = prompt.slice(0, 120);
  return [
    `目标：基于“${trimmed}”完成一个明确交付物。`,
    '范围：说明本次包含/不包含的内容，以及必须遵守的约束。',
    '验收标准：列出 2-3 条可验证结果。',
    '优先级：标注 P0/P1/P2。',
  ].join('\n');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

