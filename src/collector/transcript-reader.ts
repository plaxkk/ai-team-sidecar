// Read Claude Code JSONL transcript files for deep analysis
import fs from 'fs';
import path from 'path';
import { getDb } from './db.js';
import Database from 'better-sqlite3';
import { loadConfig, normalizePath } from '../config.js';

interface TranscriptEntry {
  type: string;
  message?: {
    role: string;
    content: string | Array<{ type: string; text?: string; tool_use_id?: string; name?: string; input?: unknown }>;
  };
  timestamp?: string;
  sessionId?: string;
}

export function findTranscriptDirs(): string[] {
  const projectsDir = path.join(process.env.HOME || '/root', '.claude/projects');
  if (!fs.existsSync(projectsDir)) return [];

  const config = loadConfig();
  const entries = fs.readdirSync(projectsDir);
  if (config.projects.length === 0) {
    return entries.map(d => path.join(projectsDir, d));
  }

  const allowed = new Set(config.projects.map(project => claudeProjectDirName(project.path)));
  return entries
    .filter(d => allowed.has(d))
    .map(d => path.join(projectsDir, d));
}

export function findTranscriptFiles(): string[] {
  const dirs = findTranscriptDirs();
  const files: string[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    files.push(...entries.map(f => path.join(dir, f)));
  }
  return files;
}

export function parseTranscript(filePath: string): TranscriptEntry[] {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split('\n')
    .filter(line => line.trim())
    .map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    })
    .filter((e): e is TranscriptEntry => e !== null);
}

export function importTranscript(filePath: string, db?: Database.Database): number {
  const database = db || getDb();
  const entries = parseTranscript(filePath);
  const sessionId = path.basename(filePath, '.jsonl');
  let imported = 0;

  const insertEvent = database.prepare(
    'INSERT OR IGNORE INTO events (session_id, event_type, captured_at, payload) VALUES (?, ?, ?, ?)'
  );
  const upsertSession = database.prepare(
    `INSERT INTO sessions (session_id, started_at, cwd, agent_source, token_source) VALUES (?, ?, ?, 'claude_code', 'estimated')
     ON CONFLICT(session_id) DO UPDATE SET ended_at = MAX(COALESCE(ended_at, 0), ?), agent_source = COALESCE(agent_source, 'claude_code')`
  );

  let startedAt = 0;
  let endedAt = 0;

  for (const entry of entries) {
    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();
    if (!startedAt || ts < startedAt) startedAt = ts;
    if (ts > endedAt) endedAt = ts;

    insertEvent.run(
      sessionId,
      entry.type || 'unknown',
      ts,
      JSON.stringify(entry)
    );
    imported++;
  }

  if (startedAt) {
    upsertSession.run(sessionId, startedAt, cwdFromClaudeTranscriptPath(filePath), endedAt);
  }

  return imported;
}

function claudeProjectDirName(projectPath: string): string {
  return normalizePath(projectPath).replace(/\//g, '-');
}

function cwdFromClaudeTranscriptPath(filePath: string): string {
  const config = loadConfig();
  const parent = path.basename(path.dirname(filePath));
  const match = config.projects.find(project => claudeProjectDirName(project.path) === parent);
  return match ? normalizePath(match.path) : '';
}
