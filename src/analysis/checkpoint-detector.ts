// Checkpoint detector — auto-create checkpoints from episode data
import Database from 'better-sqlite3';

interface ToolCallRow {
  id: number;
  turn_number: number;
  tool_name: string;
  tool_input: string;
}

interface EpisodeRow {
  id: number;
  session_id: string;
  start_turn: number;
  end_turn: number;
  episode_type: string;
  user_requirement: string;
}

interface FileChange {
  file: string;
  action: 'create' | 'edit' | 'delete';
}

interface ToolsSummary {
  edits: number;
  writes: number;
  bash: number;
  reads: number;
  other: number;
}

const FILE_TOOLS = new Set(['Edit', 'Write']);
const BASH_TOOL = 'Bash';

function classifyToolAction(toolName: string, toolInput: string): { file?: string; action?: FileChange['action'] } {
  try {
    const input = JSON.parse(toolInput);
    if (toolName === 'Write' && input.file_path) {
      return { file: input.file_path, action: 'create' };
    }
    if (toolName === 'Edit' && input.file_path) {
      return { file: input.file_path, action: 'edit' };
    }
    if (toolName === BASH_TOOL && typeof input.command === 'string') {
      const cmd = input.command;
      // Detect file operations in bash commands
      const rmMatch = cmd.match(/(?:rm|git\s+rm|git\s+checkout\s+--)\s+['"]?([^\s'"]+)['"]?/);
      if (rmMatch) return { file: rmMatch[1], action: 'delete' };
    }
  } catch { /* ignore parse errors */ }
  return {};
}

function extractToolsSummary(tools: ToolCallRow[]): ToolsSummary {
  const summary: ToolsSummary = { edits: 0, writes: 0, bash: 0, reads: 0, other: 0 };
  for (const tool of tools) {
    if (tool.tool_name === 'Edit') summary.edits++;
    else if (tool.tool_name === 'Write') summary.writes++;
    else if (tool.tool_name === BASH_TOOL) summary.bash++;
    else if (tool.tool_name === 'Read' || tool.tool_name === 'Glob' || tool.tool_name === 'Grep') summary.reads++;
    else summary.other++;
  }
  return summary;
}

function extractFilesChanged(tools: ToolCallRow[]): FileChange[] {
  const files: FileChange[] = [];
  const seen = new Set<string>();

  for (const tool of tools) {
    const result = classifyToolAction(tool.tool_name, tool.tool_input);
    if (result.file && !seen.has(result.file)) {
      seen.add(result.file);
      files.push({ file: result.file, action: result.action || 'edit' });
    }
  }
  return files;
}

function generateLabel(episode: EpisodeRow): string {
  const typeLabel: Record<string, string> = {
    feature: '新增功能',
    bugfix: '修复问题',
    refactor: '重构优化',
    deploy: '部署发布',
    testing: '测试验证',
    task: '任务执行',
    continuation: '继续执行',
  };
  const prefix = typeLabel[episode.episode_type] || '任务';
  const req = (episode.user_requirement || '').slice(0, 60);
  return req ? `${prefix}: ${req}` : prefix;
}

export function detectAndCreateCheckpoints(db: Database.Database, sessionId: string): void {
  // Get session's cwd as project_path
  const session = db.prepare(
    'SELECT session_id, cwd FROM sessions WHERE session_id = ?'
  ).get(sessionId) as { session_id: string; cwd: string } | undefined;
  if (!session || !session.cwd) return;

  const projectPath = session.cwd;

  // Get episodes for this session
  const episodes = db.prepare(
    'SELECT id, session_id, start_turn, end_turn, episode_type, user_requirement FROM episodes WHERE session_id = ? ORDER BY start_turn'
  ).all(sessionId) as EpisodeRow[];

  if (episodes.length === 0) return;

  const insertCheckpoint = db.prepare(
    `INSERT INTO checkpoints (project_path, session_id, episode_id, checkpoint_type, label, files_changed, tools_summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const now = Date.now();

  for (const episode of episodes) {
    // Dedup: skip if checkpoint already exists for this episode
    const existing = db.prepare(
      'SELECT id FROM checkpoints WHERE episode_id = ? AND checkpoint_type = ?'
    ).get(episode.id, 'auto_episode') as { id: number } | undefined;
    if (existing) continue;

    // Query tool_calls for this episode's turn range
    const tools = db.prepare(
      `SELECT id, turn_number, tool_name, tool_input
       FROM tool_calls
       WHERE session_id = ? AND turn_number >= ? AND turn_number <= ?
       ORDER BY turn_number`
    ).all(sessionId, episode.start_turn, episode.end_turn) as ToolCallRow[];

    // Skip episodes with no meaningful tool calls
    if (tools.length === 0) continue;

    const filesChanged = extractFilesChanged(tools);
    const toolsSummary = extractToolsSummary(tools);
    const label = generateLabel(episode);

    insertCheckpoint.run(
      projectPath,
      sessionId,
      episode.id,
      'auto_episode',
      label,
      JSON.stringify(filesChanged),
      JSON.stringify(toolsSummary),
      now
    );
  }

  // Create session-end checkpoint
  const existingSessionEnd = db.prepare(
    "SELECT id FROM checkpoints WHERE session_id = ? AND checkpoint_type = 'auto_session_end'"
  ).get(sessionId) as { id: number } | undefined;

  if (!existingSessionEnd) {
    // Aggregate all tool calls in this session
    const allTools = db.prepare(
      `SELECT id, turn_number, tool_name, tool_input
       FROM tool_calls
       WHERE session_id = ?`
    ).all(sessionId) as ToolCallRow[];

    const filesChanged = extractFilesChanged(allTools);
    const toolsSummary = extractToolsSummary(allTools);

    insertCheckpoint.run(
      projectPath,
      sessionId,
      null,
      'auto_session_end',
      `Session 完成: ${episodes.length} 个 episode`,
      JSON.stringify(filesChanged),
      JSON.stringify(toolsSummary),
      now
    );
  }
}

export function createManualCheckpoint(db: Database.Database, projectPath: string, label: string): number {
  const result = db.prepare(
    `INSERT INTO checkpoints (project_path, session_id, episode_id, checkpoint_type, label, files_changed, tools_summary, created_at)
     VALUES (?, NULL, NULL, 'manual', ?, '[]', '{}', ?)`
  ).run(projectPath, label, Date.now());

  return Number(result.lastInsertRowid);
}
