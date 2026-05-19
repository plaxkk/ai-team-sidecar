import { describe, it, expect } from 'vitest';
import { evaluateAllRoles, RoleEvaluation } from '../role-evaluator.js';

describe('role-evaluator', () => {
  // Use flat ## headers only, since extractRoleSection cuts at the next ##
  const highQualityResponse = `
## Product
**目标**：实现用户登录功能，支持邮箱和密码方式
**用户场景**：注册用户在首页点击登录按钮，输入邮箱和密码完成认证
**当前问题**：系统无登录功能，用户无法访问受保护资源
**期望行为**：用户输入正确邮箱密码后获得 JWT token，跳转到主页
**优先级**：P0
**限制条件**：使用 JWT，不引入 session；密码用 bcrypt
**成功指标**：用户可以在 2 秒内完成登录并获得有效 token

**不确定点/假设**：
- 假设用户已通过注册流程获得账号

## ENGINEER
系统理解：当前系统使用 Express + TypeScript，已有 User model 和 bcrypt 依赖。

技术方案 Option 1：JWT + bcrypt，优点是无状态水平扩展容易，缺点是token无法主动失效。
方案 Option 2：Session + Redis，优点是可以主动踢人，缺点是引入 Redis 依赖。
推荐方案：选择 Option 1，理由是 MVP 阶段不需要主动失效 token。

代码修改：
\`\`\`typescript
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
});
\`\`\`

## QA
检查项：
1. [高] 密码明文不得出现在日志中 — 风险：信息泄露
2. [中] JWT 过期时间需合理设置 — 风险：安全风险
3. [低] 登录失败不暴露用户是否存在 — 风险：信息泄露

边界情况：
- 空密码输入
- 超长密码（>1000字符）

潜在问题：
- 需要添加 rate limiting 防止暴力破解

## Tech Lead
方案总结：基于 Product Spec 和 Engineer 方案，推荐执行 JWT 登录方案。
QA 风险摘要：
- [高] 密码明文不得出现在日志
- [中] JWT 过期时间
执行建议：Go — MVP 范围合理，方案清晰。
需要用户确认的决策点：
1. JWT 过期时间设置多少？
2. 是否需要"记住我"功能？
`;

  it('evaluates all four roles', () => {
    const results = evaluateAllRoles('实现用户登录功能', highQualityResponse);

    expect(results).toHaveLength(5);
    const roles = results.map(r => r.role);
    expect(roles).toContain('product');
    expect(roles).toContain('engineer');
    expect(roles).toContain('creative_review');
    expect(roles).toContain('qa');
    expect(roles).toContain('techlead');
  });

  it('scores high-quality response well', () => {
    const results = evaluateAllRoles('实现用户登录功能', highQualityResponse);

    const product = results.find(r => r.role === 'product')!;
    expect(product.score).toBeGreaterThan(0.5);
    expect(product.details['Spec完整性']).toBe(1);
    expect(product.details['优先级判断']).toBe(1);
  });

  it('each result has required fields', () => {
    const results = evaluateAllRoles('test', highQualityResponse);

    for (const result of results) {
      expect(result).toHaveProperty('role');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('details');
      expect(result).toHaveProperty('deficiencies');
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    }
  });

  it('scores empty response poorly', () => {
    const results = evaluateAllRoles('实现功能', '');

    for (const result of results) {
      expect(result.score).toBeLessThan(0.5);
      expect(result.deficiencies.length).toBeGreaterThan(0);
    }
  });

  it('Product penalizes missing spec fields', () => {
    const poorResponse = '## Product\n随便写点什么';
    const results = evaluateAllRoles('实现功能', poorResponse);
    const product = results.find(r => r.role === 'product')!;

    expect(product.deficiencies.length).toBeGreaterThan(0);
  });

  it('QA penalizes placeholder content', () => {
    const placeholderResponse = '## QA\n无需审查，代码看起来没问题。';
    const results = evaluateAllRoles('修复bug', placeholderResponse);
    const qa = results.find(r => r.role === 'qa')!;

    expect(qa.details['独立性']).toBe(0);
    expect(qa.deficiencies.some(d => /占位/.test(d))).toBe(true);
  });

  it('Tech Lead penalizes missing Go/No-Go', () => {
    const noDecisionResponse = '## Tech Lead\n方案总结：看起来还行。';
    const results = evaluateAllRoles('实现功能', noDecisionResponse);
    const tl = results.find(r => r.role === 'techlead')!;

    expect(tl.details['Go/No-Go']).toBe(0);
  });
});
