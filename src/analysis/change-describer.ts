// Change describer — generate change descriptions between two checkpoints
import Database from 'better-sqlite3';

export interface ChangeDescription {
  change_type: 'feature' | 'fix' | 'refactor' | 'chore';
  title: string;
  description: string;
  files_summary: string;
}

interface CheckpointRow {
  id: number;
  project_path: string;
  session_id: string | null;
  episode_id: number | null;
  label: string;
  files_changed: string;
  tools_summary: string;
  created_at: number;
}

interface EpisodeRow {
  episode_type: string;
  user_requirement: string;
}

const EPISODE_TYPE_MAP: Record<string, ChangeDescription['change_type']> = {
  feature: 'feature',
  bugfix: 'fix',
  refactor: 'refactor',
  testing: 'chore',
  deploy: 'chore',
  task: 'chore',
  continuation: 'chore',
};

function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function extractModules(files: string[]): string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    const parts = file.split('/');
    if (parts.length > 1) {
      dirs.add(parts[0]);
    }
  }
  return Array.from(dirs);
}

export function generateChangeDescription(
  db: Database.Database,
  fromCheckpointId: number,
  toCheckpointId: number
): ChangeDescription | null {
  const from = db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(fromCheckpointId) as CheckpointRow | undefined;
  const to = db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(toCheckpointId) as CheckpointRow | undefined;

  if (!from || !to) return null;

  // Gather all files and tools across the checkpoint range
  const fromFiles = safeJsonParse<{ file: string; action: string }[]>(from.files_changed, []);
  const toFiles = safeJsonParse<{ file: string; action: string }[]>(to.files_changed, []);
  const allFileNames = [...new Set([...fromFiles.map(f => f.file), ...toFiles.map(f => f.file)])].filter(Boolean);

  const fromTools = safeJsonParse<Record<string, number>>(from.tools_summary, {});
  const toTools = safeJsonParse<Record<string, number>>(to.tools_summary, {});
  const totalEdits = (fromTools.edits || 0) + (toTools.edits || 0);
  const totalWrites = (fromTools.writes || 0) + (toTools.writes || 0);
  const totalBash = (fromTools.bash || 0) + (toTools.bash || 0);

  // Determine change_type from episode
  let changeType: ChangeDescription['change_type'] = 'chore';
  if (to.episode_id) {
    const episode = db.prepare('SELECT episode_type, user_requirement FROM episodes WHERE id = ?').get(to.episode_id) as EpisodeRow | undefined;
    if (episode) {
      changeType = EPISODE_TYPE_MAP[episode.episode_type] || 'chore';
      // Use to checkpoint's episode as primary type source
    }
  } else {
    // Check from checkpoint's episode
    if (from.episode_id) {
      const episode = db.prepare('SELECT episode_type, user_requirement FROM episodes WHERE id = ?').get(from.episode_id) as EpisodeRow | undefined;
      if (episode) {
        changeType = EPISODE_TYPE_MAP[episode.episode_type] || 'chore';
      }
    }
  }

  // Generate title from checkpoint labels
  const title = to.label || from.label || 'Untitled change';

  // Generate description
  const fileCount = allFileNames.length;
  const modules = extractModules(allFileNames);

  const parts: string[] = [];
  parts.push(`改动了 ${fileCount} 个文件`);
  if (totalEdits > 0 || totalWrites > 0) {
    parts.push(`${totalEdits} 次编辑，${totalWrites} 次新建`);
  }
  if (totalBash > 0) {
    parts.push(`${totalBash} 次命令执行`);
  }
  if (modules.length > 0) {
    parts.push(`涉及模块: ${modules.join(', ')}`);
  }

  const description = parts.join('。') + '。';

  // Generate files summary
  const filesSummary = allFileNames
    .map(file => {
      const action = toFiles.find(f => f.file === file)?.action || fromFiles.find(f => f.file === file)?.action || 'edit';
      return `${action}: ${file}`;
    })
    .join('\n');

  return {
    change_type: changeType,
    title,
    description,
    files_summary: filesSummary,
  };
}

export function generateChangelogEntriesBetweenCheckpoints(
  db: Database.Database,
  projectPath: string
): number {
  const checkpoints = db.prepare(
    'SELECT id, created_at FROM checkpoints WHERE project_path = ? ORDER BY created_at'
  ).all(projectPath) as Array<{ id: number; created_at: number }>;

  if (checkpoints.length < 2) return 0;

  const insertEntry = db.prepare(
    `INSERT INTO changelog_entries (project_path, from_checkpoint_id, to_checkpoint_id, change_type, title, description, files_summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let count = 0;
  for (let i = 1; i < checkpoints.length; i++) {
    const fromId = checkpoints[i - 1].id;
    const toId = checkpoints[i].id;

    // Skip if entry already exists for this pair
    const existing = db.prepare(
      'SELECT id FROM changelog_entries WHERE from_checkpoint_id = ? AND to_checkpoint_id = ?'
    ).get(fromId, toId) as { id: number } | undefined;
    if (existing) continue;

    const desc = generateChangeDescription(db, fromId, toId);
    if (!desc) continue;

    insertEntry.run(
      projectPath,
      fromId,
      toId,
      desc.change_type,
      desc.title,
      desc.description,
      desc.files_summary,
      checkpoints[i].created_at
    );
    count++;
  }
  return count;
}
