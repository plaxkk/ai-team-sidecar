# Changelog

## [最新]

### 2026-05-20
- **feature**: Checkpoint + Changelog + Build in Public 自动记录闭环
  - 新增 `checkpoints` / `changelog_entries` / `social_posts` 三张 DB 表，用于结构化存储改动节点、变更说明和推文
  - 新增 `src/analysis/checkpoint-detector.ts`：分析引擎在 episode 结束时自动创建检查点（auto_episode / auto_session_end），支持手动创建（manual）
  - 新增 `src/analysis/change-describer.ts`：两个检查点之间生成改动说明，从 episode_type 映射 change_type，提取文件变更和模块信息
  - 新增 `src/analysis/changelog-generator.ts`：从检查点对生成 changelog entries 并导出 CHANGELOG.md 到项目根目录
  - 新增 `src/analysis/social-post-generator.ts`：从小红书模板生成 build-in-public 推文并归档到 social-posts/ 目录
  - 新增 `bin/checkpoint.ts` CLI 入口：支持 create / changelog / post / list-checkpoints 子命令
  - 集成到分析引擎：`runAnalysis()` 末尾自动调用 `detectAndCreateCheckpoints()`
  - Dashboard 新增 6 个 API 端点：checkpoints CRUD、changelog 生成/查看、social-post 生成/归档
