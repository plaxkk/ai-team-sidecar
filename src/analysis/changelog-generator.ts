// Changelog generator — generate and export changelog from checkpoints
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { generateChangelogEntriesBetweenCheckpoints } from './change-describer.js';

interface ChangelogEntry {
  id: number;
  from_checkpoint_id: number;
  to_checkpoint_id: number;
  change_type: string;
  title: string;
  description: string;
  files_summary: string;
  created_at: number;
}

export function generateChangelog(db: Database.Database, projectPath: string): number {
  return generateChangelogEntriesBetweenCheckpoints(db, projectPath);
}

export function getChangelogEntries(db: Database.Database, projectPath: string): ChangelogEntry[] {
  return db.prepare(
    'SELECT * FROM changelog_entries WHERE project_path = ? ORDER BY created_at DESC'
  ).all(projectPath) as ChangelogEntry[];
}

export function exportChangelogMd(db: Database.Database, projectPath: string): string {
  const entries = getChangelogEntries(db, projectPath);

  const lines: string[] = ['# Changelog', ''];

  // Group by date
  const byDate = new Map<string, ChangelogEntry[]>();
  for (const entry of entries) {
    const date = new Date(entry.created_at).toISOString().slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(entry);
  }

  for (const [date, dateEntries] of byDate) {
    lines.push(`### ${date}`);
    for (const entry of dateEntries) {
      lines.push(`- **${entry.change_type}**: ${entry.title} (checkpoint #${entry.from_checkpoint_id} → #${entry.to_checkpoint_id})`);
      // Add file summary lines
      const fileLines = entry.files_summary.split('\n').filter(Boolean);
      for (const fl of fileLines) {
        lines.push(`  - ${fl}`);
      }
      if (entry.description) {
        lines.push(`  - ${entry.description}`);
      }
    }
    lines.push('');
  }

  const content = lines.join('\n');

  // Write to project root
  const filePath = path.join(projectPath, 'CHANGELOG.md');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');

  return filePath;
}
