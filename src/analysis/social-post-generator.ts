// Social post generator — generate xiaohongshu posts from changelog
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

interface ChangelogEntry {
  id: number;
  change_type: string;
  title: string;
  description: string;
  files_summary: string;
  created_at: number;
}

function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function extractFileStats(filesSummary: string): { fileCount: number; modules: string[] } {
  const lines = filesSummary.split('\n').filter(Boolean);
  const modules = new Set<string>();
  for (const line of lines) {
    const parts = line.split('/');
    if (parts.length > 1) {
      modules.add(parts[0]);
    }
  }
  return { fileCount: lines.length, modules: Array.from(modules) };
}

function changeTypeEmoji(type: string): string {
  switch (type) {
    case 'feature': return '✨';
    case 'fix': return '🐛';
    case 'refactor': return '♻️';
    default: return '🔧';
  }
}

export function generateXiaohongshuPost(
  db: Database.Database,
  projectPath: string,
  changelogEntryIds?: number[]
): { id: number; content: string } | null {
  let entries: ChangelogEntry[];

  if (changelogEntryIds && changelogEntryIds.length > 0) {
    const placeholders = changelogEntryIds.map(() => '?').join(',');
    entries = db.prepare(
      `SELECT id, change_type, title, description, files_summary, created_at
       FROM changelog_entries
       WHERE project_path = ? AND id IN (${placeholders})`
    ).all(projectPath, ...changelogEntryIds) as ChangelogEntry[];
  } else {
    // Get latest entries from today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    entries = db.prepare(
      `SELECT id, change_type, title, description, files_summary, created_at
       FROM changelog_entries
       WHERE project_path = ? AND created_at >= ?
       ORDER BY created_at DESC`
    ).all(projectPath, todayStart.getTime()) as ChangelogEntry[];
  }

  if (entries.length === 0) return null;

  const date = new Date().toISOString().slice(0, 10);
  const projectName = path.basename(projectPath);

  // Build post content
  const lines: string[] = [];
  lines.push(`# 🔥 今日开发手记 | ${date}`);
  lines.push('');

  // Section: 做了什么
  lines.push('## 做了什么');
  for (const entry of entries) {
    lines.push(`- ${changeTypeEmoji(entry.change_type)} ${entry.title}`);
  }
  lines.push('');

  // Section: 技术亮点
  lines.push('## 技术亮点');
  const allModules = new Set<string>();
  for (const entry of entries) {
    const { modules } = extractFileStats(entry.files_summary);
    for (const m of modules) allModules.add(m);
  }
  if (allModules.size > 0) {
    lines.push(`涉及模块: ${Array.from(allModules).join(', ')}`);
  } else {
    lines.push('独立模块变更');
  }
  lines.push('');

  // Section: 代码量
  lines.push('## 代码量');
  let totalFiles = 0;
  for (const entry of entries) {
    const { fileCount } = extractFileStats(entry.files_summary);
    totalFiles += fileCount;
  }
  lines.push(`- 修改了 ${totalFiles} 个文件`);
  lines.push('');

  // Section: 感悟
  lines.push('## 感悟');
  const types = new Set(entries.map(e => e.change_type));
  if (types.has('feature')) {
    lines.push('今天在 AI 辅助下推进了功能开发，逐步把想法变成可运行的代码。');
  } else if (types.has('fix')) {
    lines.push('调试和修复的过程虽然曲折，但每解决一个 bug 都让系统更稳定。');
  } else {
    lines.push('持续迭代中，每一步小改进都在积累。');
  }
  lines.push('');

  // Footer
  lines.push('---');
  lines.push('🤖 Solo Founder | AiTeam');
  lines.push('#buildinpublic #独立开发者 #AI编程 #soloFounder');

  const content = lines.join('\n');

  // Save to DB
  const result = db.prepare(
    `INSERT INTO social_posts (project_path, post_type, content, changelog_entry_ids, status, created_at)
     VALUES (?, 'xiaohongshu', ?, ?, 'draft', ?)`
  ).run(
    projectPath,
    content,
    JSON.stringify(entries.map(e => e.id)),
    Date.now()
  );

  return { id: Number(result.lastInsertRowid), content };
}

export function archivePost(db: Database.Database, postId: number, projectPath: string): string | null {
  const post = db.prepare(
    'SELECT * FROM social_posts WHERE id = ? AND project_path = ?'
  ).get(postId, projectPath) as {
    id: number;
    content: string;
    created_at: number;
    status: string;
  } | undefined;

  if (!post) return null;

  // Write to social-posts/ directory
  const date = new Date(post.created_at).toISOString().slice(0, 10);
  const dir = path.join(projectPath, 'social-posts');
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${date}.md`);
  fs.writeFileSync(filePath, post.content, 'utf8');

  // Update status
  db.prepare("UPDATE social_posts SET status = 'archived' WHERE id = ?").run(postId);

  return filePath;
}

export function getSocialPosts(db: Database.Database, projectPath: string) {
  return db.prepare(
    'SELECT * FROM social_posts WHERE project_path = ? ORDER BY created_at DESC'
  ).all(projectPath);
}
