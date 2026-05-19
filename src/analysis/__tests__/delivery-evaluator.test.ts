import { describe, it, expect } from 'vitest';
import { evaluateDelivery } from '../delivery-evaluator.js';

describe('evaluateDelivery', () => {
  it('returns complete delivery evaluation', () => {
    const result = evaluateDelivery('实现登录功能', '已完成登录功能实现。\n\n```typescript\nconst login = async (email: string) => {};\n```\n\n解释：这里使用 JWT 认证。\n\n验证：运行 npm test 确认通过。\n\n总结：登录功能已实现，下一步添加注册。');

    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('details');
    expect(result).toHaveProperty('deficiencies');
    expect(result).toHaveProperty('explainability');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('scores complete delivery highly', () => {
    const response = `
已实现用户登录功能。

\`\`\`typescript
function login(email: string, password: string) {
  // 验证逻辑
}
\`\`\`

解释：使用 bcrypt 验证密码，JWT 签发 token。

验证步骤：运行 npm test，所有测试通过。

总结：登录功能已完成。下一步可以添加注册功能。
`;
    const result = evaluateDelivery('实现用户登录功能', response);

    expect(result.score).toBeGreaterThan(0.5);
    expect(result.details['任务覆盖度']).toBeGreaterThan(0);
    expect(result.details['验证步骤']).toBe(1);
    expect(result.details['输出完整性']).toBeGreaterThan(0.5);
  });

  it('penalizes missing verification', () => {
    const result = evaluateDelivery('实现登录', '代码已写好。\n\n```typescript\nfunction login() {}\n```');

    expect(result.deficiencies.some(d => /验证/.test(d))).toBe(true);
    expect(result.details['验证步骤']).toBe(0);
  });

  it('penalizes missing summary', () => {
    const result = evaluateDelivery('实现登录', '```typescript\nfunction login() {}\n```\n验证：npm test');

    expect(result.deficiencies.some(d => /总结/.test(d))).toBe(true);
  });

  it('penalizes code without explanation', () => {
    const result = evaluateDelivery('实现登录', '```typescript\nfunction login() {}\n```');

    expect(result.deficiencies.some(d => /解释/.test(d))).toBe(true);
  });

  it('handles empty response', () => {
    const result = evaluateDelivery('实现功能', '');

    expect(result.score).toBeLessThan(0.5);
    expect(result.deficiencies.length).toBeGreaterThan(0);
  });

  it('includes explainability', () => {
    const result = evaluateDelivery('test', 'response');

    expect(result.explainability).toHaveProperty('formula');
    expect(result.explainability).toHaveProperty('confidence');
    expect(result.explainability).toHaveProperty('dimensions');
  });
});
