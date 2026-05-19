# PMO 周期评审指南

## 每日

- 查看最新 episode 的评分趋势
- 关注 rule_compliance 是否低于 70
- 处理 Sidecar 提出的 rule feedback

## 每周

- 查看 Weekly CEO Review
- 关注项目状态（on_track / at_risk / off_track）
- 复盘本周的 anti-patterns
- 制定下周最小动作

## 每两周

- 运行 Startup Audit
- 检查各角色评分趋势
- 更新 CLAUDE.md 规则（接受 rule feedback）
- 评估 DORA 指标

## 每月

- 运行 Organization Audit（公司级审计）
- 评估项目组合健康度
- 调整项目优先级
- 更新模板和流程文档

## 评审要点

### 关注指标

| 指标 | 阈值 | 行动 |
|------|------|------|
| rule_compliance | < 70 | 修复流程问题再继续开发 |
| dialogue_quality | < 70 | 改善需求描述和交接质量 |
| startup_excellence | < 70 | 砍掉非 P0 范围 |
| team_health | 下降趋势 | 找到最弱角色并强化规则 |

### Rule Feedback 处理流程

1. 查看 `/api/rule-feedback` 获取建议
2. 人工审阅建议内容
3. 确认后 apply 到对应文件
4. 下一轮迭代验证效果
