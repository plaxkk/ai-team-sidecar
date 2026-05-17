// Detect virtual team role markers in Claude's response
export interface RoleDetection {
  roles: string[];
  has_product: boolean;
  has_engineer: boolean;
  has_qa: boolean;
  has_techlead: boolean;
  sections: { role: string; start: number; end: number; content: string }[];
}

const ROLE_PATTERNS: Record<string, RegExp[]> = {
  product: [
    /Engineering Task Spec/i,
    /产品理解/i,
    /## Product/i,
    /Step 1/i,
  ],
  engineer: [
    /## ENGINEER/i,
    /技术方案/i,
    /代码修改/i,
    /## Engineer/i,
  ],
  qa: [
    /## QA/i,
    /质量审查/i,
    /风险等级/i,
    /边界情况/i,
  ],
  techlead: [
    /## TECH LEAD/i,
    /## Tech Lead/i,
    /决策信息/i,
    /是否执行/i,
  ],
};

export function detectRoles(response: string): RoleDetection {
  const sections: RoleDetection['sections'] = [];
  const roles: string[] = [];
  let has_product = false, has_engineer = false, has_qa = false, has_techlead = false;

  for (const [role, patterns] of Object.entries(ROLE_PATTERNS)) {
    for (const pattern of patterns) {
      const match = response.match(pattern);
      if (match) {
        if (!roles.includes(role)) roles.push(role);
        switch (role) {
          case 'product': has_product = true; break;
          case 'engineer': has_engineer = true; break;
          case 'qa': has_qa = true; break;
          case 'techlead': has_techlead = true; break;
        }
        // Extract section content (from match to next ## or end)
        const startIdx = match.index ?? 0;
        const nextSection = response.indexOf('##', startIdx + 2);
        const endIdx = nextSection > startIdx ? nextSection : response.length;
        sections.push({
          role,
          start: startIdx,
          end: endIdx,
          content: response.slice(startIdx, endIdx),
        });
        break; // One match per role is enough
      }
    }
  }

  return { roles, has_product, has_engineer, has_qa, has_techlead, sections };
}
