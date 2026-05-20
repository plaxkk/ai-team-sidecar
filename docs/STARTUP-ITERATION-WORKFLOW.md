# 初创公司 AI 工程化迭代流程规范

本文档沉淀公司用 AI 做产品从方向评审到上线反馈的标准流程。目标是让 CEO、项目负责人、AI coding agent 和评审角色在同一套节奏里协作，避免过早写代码、重复选型和交付不可验收。

## 1. 标准工具链

默认工具链以“快速验证、可上线、可复盘”为原则，不追求大而全。

| 环节 | 默认工具 | 使用原则 |
| --- | --- | --- |
| 协作与任务 | Slock + GitHub Issues/Projects | Slock 做团队沟通、任务认领和线程决策；GitHub 承载工程任务、PR 和 CI 记录。 |
| 产品原型 | v0 + Figma / FigJam | v0 快速生成可运行 MVP demo；Figma/FigJam 做用户流程、线框和设计规范。 |
| AI 开发 | Cursor / Claude Code / Codex / GitHub Copilot | AI agent 只在明确任务边界内实现，通过分支和 PR 交付。 |
| 本地环境 | npm/pnpm + TypeScript + Docker Compose | 单服务优先简单脚本，多服务再引入 Docker Compose。 |
| 数据与认证 | Supabase | 需要登录、用户数据、文件存储、行程存储时优先评估。 |
| 测试 | Vitest/Jest + Playwright | 单元/模块测试覆盖关键逻辑，Playwright 覆盖关键用户路径。 |
| CI/CD | GitHub Actions | 每个 PR 必须跑 lint/test/build；main 合并后自动部署。 |
| 部署 | Vercel + Supabase | Web/Next.js/静态站优先 Vercel；数据库/认证优先 Supabase。 |
| 监控反馈 | Sentry + PostHog | Sentry 看稳定性和错误，PostHog 看用户行为、漏斗和 feature flag。 |

## 2. 端到端流程

所有产品方向默认按以下阶段推进：

```text
方向评审 -> 项目基线 -> 原型 -> 工程化 -> CI/CD -> 上线 -> 反馈迭代
```

### 2.1 方向评审

负责人：`@初创公司-CEO`

输出一条方向评审任务，必须包含：

- 目标用户：谁有强需求，使用场景是什么。
- 要验证的问题：本轮 MVP 要验证的核心假设。
- MVP demo：最小可交付范围，只保留验证假设所需能力。
- 商业化或开源目标：赚钱路径、获客路径，或开源增长目标。
- Go/No-Go 标准：什么结果代表继续投入，什么结果代表暂停。

规则：

- 没有方向评审，不进入工程开发。
- 方向评审缺少目标用户、MVP 范围或 Go/No-Go 标准时，项目负责人必须先追问，不得直接开工。

### 2.2 项目基线

负责人：对应项目负责人，例如 `@travelAi-项目负责人`、`@MirrorLife-项目负责人`、`@claude`

方向评审通过后，项目负责人在任务线程补项目基线：

- 仓库位置和当前可运行状态。
- 当前产品能力和已知限制。
- P0 交付目标。
- 关键风险和待确认问题。
- 需要接入的工具：Supabase、Vercel、Sentry、PostHog 等。

规则：

- 项目基线是工程任务拆分的输入。
- 基线未确认前，只能做调研、梳理和原型，不做大规模代码改动。

### 2.3 原型

负责人：项目负责人 + 产品/设计 agent

输出物：

- v0 可运行 demo 或 Figma/FigJam 流程图。
- 核心用户路径说明。
- MVP 范围外能力清单。

验收：

- CEO 或项目负责人确认核心路径可表达业务假设。
- 原型能指导工程拆分，而不是只做视觉展示。

### 2.4 工程化

负责人：项目负责人 + AI coding agent

工程任务必须包含：

- Objective：本任务解决什么问题。
- Scope：本次做什么、不做什么。
- Acceptance：验收标准。
- Commands：必须通过的本地命令。
- Risk：主要风险。

分支规则：

```text
feature/{short-description}-{YYYY-MM-DD}
fix/{short-description}-{YYYY-MM-DD}
refactor/{short-description}-{YYYY-MM-DD}
chore/{short-description}-{YYYY-MM-DD}
```

PR 规则：

- 一个 PR 只解决一个明确任务。
- PR 描述必须包含任务链接、改动摘要、验证命令、风险和回滚方式。
- 没有 lint/test/build 结果的 PR 不进入合并评审。

### 2.5 CI/CD

每个项目至少提供以下命令：

```bash
npm run lint
npm run test
npm run build
```

如果项目暂时没有某类命令，必须在 README 或项目基线中说明原因和补齐计划。

GitHub Actions 默认门禁：

- PR：安装依赖、lint、test、build。
- main：通过门禁后部署到生产或发布构建产物。
- preview：Web 项目优先生成 Vercel Preview URL，供 CEO/项目负责人验收。

### 2.6 上线

上线前必须确认：

- `.env.example` 和环境变量说明完整。
- 生产环境与预览环境分离。
- 数据库迁移可重复执行。
- Sentry 至少接入错误监控。
- PostHog 至少定义 3 个关键事件。
- README 中有本地启动、构建、部署说明。

开源项目前还必须确认：

- LICENSE 明确。
- README 包含项目定位、功能、架构、安装、运行和贡献说明。
- 示例数据或 demo 路径可用。
- CHANGELOG 或 Release Notes 可追踪。

### 2.7 反馈迭代

上线后每轮复盘必须看三类信号：

- 稳定性：Sentry 错误量、关键接口失败、页面性能。
- 使用行为：PostHog 访问、留存、关键漏斗、功能点击。
- 交付质量：任务是否按验收标准完成，是否出现返工。

复盘输出：

- 保留什么。
- 改什么。
- 停止什么。
- 下一轮 P0 任务是什么。

## 3. 角色分工

| 角色 | 主要责任 | 不该做什么 |
| --- | --- | --- |
| CEO | 定方向、优先级、商业化/开源目标、Go/No-Go | 不直接下达无边界开发任务。 |
| 项目负责人 | 补项目基线、拆任务、把控交付、验收 PR | 不在方向未确认时推动大规模开发。 |
| AI coding agent | 在明确任务内实现代码、补测试、提交 PR | 不自行扩大范围或绕过 CI。 |
| QA / Tech Lead | 审查风险、验证路径、给 Go/No-Go 建议 | 不用口头感觉替代验证命令和证据。 |
| Cindy | 维护流程、协助搭建频道/任务/规范、推动协作清晰 | 不替代项目负责人做长期项目 owner。 |

## 4. 任务状态规范

Slock 任务状态：

- `todo`：任务已提出但未开始。
- `in_progress`：已认领并正在执行。
- `in_review`：产出已提交，等待人类或负责人确认。
- `done`：负责人确认完成。

规则：

- 开始执行前必须认领任务。
- 多人协作时，每个任务只保留一个主负责人。
- 讨论放在线程，避免主频道淹没上下文。
- 任务完成但无人验收时，停在 `in_review`，不自行标 `done`。

## 5. 项目负责人最低交付标准

每个项目方向启动后，项目负责人必须在 24 小时内补齐：

- 方向评审链接或摘要。
- 项目基线。
- P0 任务拆分。
- 本地运行方式。
- CI/CD 当前状态。
- 风险清单。

如果缺少明确产品方向，应先发“待确认问题”，不要开始写代码。

## 6. 三个当前项目的落地口径

### travelAi

优先事项：

- 等方向评审确认目标用户、商业模式和 MVP 阶段目标。
- 输出 travelAi 项目基线。
- 如果涉及登录、用户数据、行程存储，优先评估 Supabase。
- 第一版 demo 目标是验证用户是否愿意用 AI 生成或管理旅行方案。

### MirrorLife

优先事项：

- 补齐开源发布链路：README、安装运行、示例数据、LICENSE、CI、Release Checklist。
- 等方向评审确认产品定位后再进入功能开发。
- 工程任务必须同时考虑可开源、可运行、可演示。

### virtualTeam / AI Team Sidecar

优先事项：

- 作为公司流程规范和 AI 团队管理能力的载体。
- 沉淀本文件及模板，后续可产品化到 dashboard 或规则反馈中。
- 补齐开源工程标准：README、LICENSE、`.env.example`、GitHub Actions、部署说明、Sentry/PostHog 接入计划。

## 7. 文档与模板

常用模板：

- [方向评审模板](./templates/DIRECTION-REVIEW.md)
- [项目基线模板](./templates/PROJECT-BASELINE.md)
- [工程交付任务模板](./templates/DELIVERY-TASK.md)

更新规则：

- 流程规范改动必须走 PR。
- 如果某个项目发现更好的实践，先在项目线程复盘，再合并回本规范。
- 不为单一项目临时偏好改动公司默认流程，除非能证明它能提高交付速度或降低线上风险。
