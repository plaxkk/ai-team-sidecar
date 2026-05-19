// Track flow compliance: step completeness, order, depth, violations
export interface FlowResult {
  flow_score: number;
  handoff_score: number;
  violations: string[];
  step_order: string[];
  step_depths: Record<string, number>;
}

const ROLE_ORDER = ['product', 'engineer', 'creative_review', 'qa', 'techlead'];
const MIN_SECTION_DEPTH = 100; // chars

export function trackFlow(
  roleDetection: { has_product: boolean; has_engineer: boolean; has_qa: boolean; has_techlead: boolean; has_creative_review?: boolean; sections: { role: string; content: string; start: number }[] },
  response: string
): FlowResult {
  const violations: string[] = [];
  const stepDepths: Record<string, number> = {};
  const stepOrder: string[] = [];

  // 1. Step completeness (30%)
  const present: string[] = [];
  if (roleDetection.has_product) present.push('product');
  if (roleDetection.has_engineer) present.push('engineer');
  if (roleDetection.has_creative_review) present.push('creative_review');
  if (roleDetection.has_qa) present.push('qa');
  if (roleDetection.has_techlead) present.push('techlead');

  const completeness = present.length / 5;
  const missing = ROLE_ORDER.filter(r => !present.includes(r));
  for (const m of missing) {
    violations.push(`Missing role step: ${m}`);
  }

  // 2. Step order (20%)
  let orderScore = 1;
  if (present.length >= 2) {
    let prevIdx = -1;
    for (const role of present) {
      const idx = ROLE_ORDER.indexOf(role);
      if (idx < prevIdx) {
        orderScore = 0.5;
        violations.push(`Out-of-order step: ${role} appeared before previous step`);
      }
      prevIdx = idx;
    }
  } else {
    orderScore = present.length > 0 ? 0.5 : 0;
  }

  // 3. Step depth (30%)
  let depthScore = 0;
  for (const section of roleDetection.sections) {
    const depth = section.content.length;
    stepDepths[section.role] = depth;
    if (depth >= MIN_SECTION_DEPTH) {
      depthScore += 1 / 5;
    } else if (depth > 0) {
      depthScore += 0.3 / 5;
      violations.push(`Shallow ${section.role} section: ${depth} chars (min ${MIN_SECTION_DEPTH})`);
    }
  }

  // 4. Prohibited behaviors (20%)
  let prohibScore = 1;
  const prohibPatterns = [
    { pattern: /跳过\s*(QA|测试|review)/i, desc: 'Skip QA/testing step' },
    { pattern: /直接修改.*无需说明/i, desc: 'Code change without explanation' },
    { pattern: /不需要.*Spec/i, desc: 'Skip spec creation' },
  ];
  for (const { pattern, desc } of prohibPatterns) {
    if (pattern.test(response)) {
      prohibScore -= 0.3;
      violations.push(`Prohibited behavior: ${desc}`);
    }
  }
  prohibScore = Math.max(0, prohibScore);

  const flow_score = 0.30 * completeness + 0.20 * orderScore + 0.30 * depthScore + 0.20 * prohibScore;

  // Handoff quality: transitions between roles
  let handoff_score = 0;
  if (present.length >= 2) {
    let smoothTransitions = 0;
    for (let i = 1; i < present.length; i++) {
      const prevSection = roleDetection.sections.find(s => s.role === present[i - 1]);
      const currSection = roleDetection.sections.find(s => s.role === present[i]);
      if (prevSection && currSection) {
        // Check for transition language
        const transitionZone = response.slice(
          Math.max(0, currSection.start - 200),
          currSection.start + 50
        );
        if (/过渡|交接|接下来|转交|handoff|moving to|now.*will/i.test(transitionZone)) {
          smoothTransitions++;
        }
      }
    }
    handoff_score = smoothTransitions / (present.length - 1);
  } else {
    handoff_score = present.length === 1 ? 0.5 : 0;
  }

  return {
    flow_score: Math.round(flow_score * 100) / 100,
    handoff_score: Math.round(handoff_score * 100) / 100,
    violations,
    step_order: present,
    step_depths: stepDepths,
  };
}
