import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { loadConfig } from '../config.js';

interface CodexThreadRow {
  id: string;
  rollout_path: string;
  created_at: number;
  updated_at: number;
  cwd: string;
  title: string;
  tokens_used: number;
  model: string | null;
}

interface CodexToolCall {
  turn_number: number;
  name: string;
  input: string;
  output: string;
  captured_at: number;
}

interface CodexTurn {
  turn_number: number;
  user_prompt: string;
  user_prompt_at: number;
  assistant_response: string;
  assistant_response_at: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_tokens: number;
}

interface ParsedCodexRollout {
  session_id: string;
  cwd: string;
  started_at: number;
  ended_at: number;
  model: string | null;
  total_tokens: number;
  turns: CodexTurn[];
  tool_calls: CodexToolCall[];
}

interface SyncResult {
  imported_sessions: number;
  skipped_sessions: number;
  analysis_session_ids: string[];
}

export function syncCodexSessions(
  db: Database.Database,
  options: { projectPath?: string } = {}
): SyncResult {
  const config = loadConfig();
  if (!config.agents.codexCli) {
    return { imported_sessions: 0, skipped_sessions: 0, analysis_session_ids: [] };
  }

  const codexDbPath = path.join(process.env.HOME || '', '.codex/state_5.sqlite');
  if (!fs.existsSync(codexDbPath)) {
    return { imported_sessions: 0, skipped_sessions: 0, analysis_session_ids: [] };
  }

  const codexDb = new Database(codexDbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = options.projectPath
      ? codexDb.prepare(
          `SELECT id, rollout_path, created_at, updated_at, cwd, title, tokens_used, model
           FROM threads
           WHERE cwd = ?
           ORDER BY updated_at DESC`
        ).all(options.projectPath) as CodexThreadRow[]
      : codexDb.prepare(
          `SELECT id, rollout_path, created_at, updated_at, cwd, title, tokens_used, model
           FROM threads
           WHERE cwd IS NOT NULL AND cwd != ''
           ORDER BY updated_at DESC`
        ).all() as CodexThreadRow[];

    let imported = 0;
    let skipped = 0;
    const analysisSessionIds: string[] = [];

    for (const row of rows) {
      if (!row.rollout_path || !fs.existsSync(row.rollout_path)) {
        skipped++;
        continue;
      }

      const parsed = parseCodexRollout(row, config.privacy.storeToolOutput);
      const normalizedSessionId = `codex:${parsed.session_id}`;
      const existing = db.prepare(
        'SELECT ended_at, total_turns, total_tokens FROM sessions WHERE session_id = ?'
      ).get(normalizedSessionId) as { ended_at: number; total_turns: number; total_tokens: number } | undefined;
      const existingTurnTokens = db.prepare(
        'SELECT COALESCE(SUM(total_tokens), 0) as total FROM turns WHERE session_id = ?'
      ).get(normalizedSessionId) as { total: number };
      const episodeCount = db.prepare(
        'SELECT COUNT(*) as count FROM episodes WHERE session_id = ?'
      ).get(normalizedSessionId) as { count: number };
      const tokenMismatch = Math.abs(Number(existingTurnTokens.total || 0) - parsed.total_tokens) > parsed.total_tokens * 0.05;

      const unchanged = existing
        && Number(existing.ended_at || 0) === parsed.ended_at
        && Number(existing.total_turns || 0) === parsed.turns.length
        && Number(existing.total_tokens || 0) === parsed.total_tokens
        && !tokenMismatch;

      if (unchanged) {
        skipped++;
        if (episodeCount.count === 0 && parsed.turns.length > 0) {
          analysisSessionIds.push(normalizedSessionId);
        }
        continue;
      }

      upsertCodexSession(db, normalizedSessionId, parsed);
      imported++;
      if (parsed.turns.length > 0) {
        analysisSessionIds.push(normalizedSessionId);
      }
    }

    return {
      imported_sessions: imported,
      skipped_sessions: skipped,
      analysis_session_ids: analysisSessionIds,
    };
  } finally {
    codexDb.close();
  }
}

function upsertCodexSession(db: Database.Database, sessionId: string, parsed: ParsedCodexRollout) {
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO sessions (session_id, started_at, ended_at, cwd, total_turns, agent_source, model, total_tokens, token_source)
       VALUES (?, ?, ?, ?, ?, 'codex_cli', ?, ?, 'actual')
       ON CONFLICT(session_id) DO UPDATE SET
         started_at = excluded.started_at,
         ended_at = excluded.ended_at,
         cwd = excluded.cwd,
         total_turns = excluded.total_turns,
         agent_source = excluded.agent_source,
         model = excluded.model,
         total_tokens = excluded.total_tokens,
         token_source = excluded.token_source`
    ).run(
      sessionId,
      parsed.started_at,
      parsed.ended_at,
      parsed.cwd,
      parsed.turns.length,
      parsed.model,
      parsed.total_tokens
    );

    db.prepare('DELETE FROM tool_calls WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM turns WHERE session_id = ?').run(sessionId);

    const insertTurn = db.prepare(
      `INSERT INTO turns (
        session_id, turn_number, user_prompt, user_prompt_at, assistant_response, assistant_response_at,
        response_duration_ms, input_tokens, output_tokens, total_tokens, estimated_tokens, token_source
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'actual')`
    );
    for (const turn of parsed.turns) {
      insertTurn.run(
        sessionId,
        turn.turn_number,
        turn.user_prompt,
        turn.user_prompt_at,
        turn.assistant_response,
        turn.assistant_response_at,
        Math.max(0, turn.assistant_response_at - turn.user_prompt_at),
        turn.input_tokens,
        turn.output_tokens,
        turn.total_tokens,
        turn.estimated_tokens
      );
    }

    const insertTool = db.prepare(
      `INSERT INTO tool_calls (session_id, turn_number, tool_name, tool_input, tool_response, estimated_tokens, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const call of parsed.tool_calls) {
      insertTool.run(
        sessionId,
        call.turn_number,
        call.name,
        call.input,
        call.output,
        estimateTokens(`${call.input}\n${call.output}`),
        call.captured_at
      );
    }
  });

  tx();
}

function parseCodexRollout(row: CodexThreadRow, storeToolOutput: boolean): ParsedCodexRollout {
  const lines = fs.readFileSync(row.rollout_path, 'utf8').split('\n').filter(Boolean);
  const turns: CodexTurn[] = [];
  const toolCalls: CodexToolCall[] = [];
  const pendingCalls = new Map<string, CodexToolCall>();
  let current: CodexTurn | null = null;
  let metaCwd = row.cwd;
  let metaModel: string | null = row.model || null;
  let startedAt = row.created_at * 1000;
  let endedAt = row.updated_at * 1000;
  let cumulativeInputTokens = 0;
  let cumulativeOutputTokens = 0;
  let cumulativeTotalTokens = 0;

  const finishCurrent = () => {
    if (!current) return;
    if (!current.assistant_response_at) current.assistant_response_at = current.user_prompt_at;
    current.estimated_tokens = estimateTokens(`${current.user_prompt}\n${current.assistant_response}`);
    turns.push(current);
    current = null;
  };

  for (const line of lines) {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : endedAt;
    if (Number.isFinite(ts)) {
      startedAt = Math.min(startedAt, ts);
      endedAt = Math.max(endedAt, ts);
    }

    if (entry.type === 'session_meta') {
      metaCwd = entry.payload?.cwd || metaCwd;
      metaModel = entry.payload?.model || metaModel;
      continue;
    }

    const payload = entry.payload || {};
    if (entry.type === 'event_msg' && payload.type === 'user_message') {
      finishCurrent();
      current = {
        turn_number: turns.length + 1,
        user_prompt: String(payload.message || ''),
        user_prompt_at: ts,
        assistant_response: '',
        assistant_response_at: ts,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        estimated_tokens: 0,
      };
      continue;
    }

    if (!current) continue;

    if (entry.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant') {
      const text = contentToText(payload.content);
      if (text) {
        current.assistant_response += current.assistant_response ? `\n\n${text}` : text;
        current.assistant_response_at = ts;
      }
      continue;
    }

    if (entry.type === 'event_msg' && payload.type === 'token_count') {
      const usage = payload.info?.total_token_usage;
      if (usage) {
        const nextInputTokens = Number(usage.input_tokens || 0);
        const nextOutputTokens = Number(usage.output_tokens || 0) + Number(usage.reasoning_output_tokens || 0);
        const nextTotalTokens = Number(usage.total_tokens || 0);
        current.input_tokens += Math.max(0, nextInputTokens - cumulativeInputTokens);
        current.output_tokens += Math.max(0, nextOutputTokens - cumulativeOutputTokens);
        current.total_tokens += Math.max(0, nextTotalTokens - cumulativeTotalTokens);
        cumulativeInputTokens = Math.max(cumulativeInputTokens, nextInputTokens);
        cumulativeOutputTokens = Math.max(cumulativeOutputTokens, nextOutputTokens);
        cumulativeTotalTokens = Math.max(cumulativeTotalTokens, nextTotalTokens);
      }
      continue;
    }

    if (entry.type === 'response_item' && (payload.type === 'function_call' || payload.type === 'custom_tool_call')) {
      const call: CodexToolCall = {
        turn_number: current.turn_number,
        name: payload.name || payload.tool_name || payload.type,
        input: String(payload.arguments || payload.input || ''),
        output: '',
        captured_at: ts,
      };
      if (payload.call_id) pendingCalls.set(payload.call_id, call);
      toolCalls.push(call);
      continue;
    }

    if (entry.type === 'response_item' && (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output')) {
      const output = storeToolOutput
        ? typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output || '')
        : '';
      const existing = payload.call_id ? pendingCalls.get(payload.call_id) : null;
      if (existing) {
        existing.output = output;
      } else {
        toolCalls.push({
          turn_number: current.turn_number,
          name: payload.type,
          input: '',
          output,
          captured_at: ts,
        });
      }
    }
  }

  finishCurrent();

  return {
    session_id: row.id,
    cwd: metaCwd,
    started_at: startedAt,
    ended_at: endedAt,
    model: metaModel,
    total_tokens: Number(row.tokens_used || 0),
    turns,
    tool_calls: toolCalls,
  };
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item: any) => item?.text || item?.output_text || '')
    .filter(Boolean)
    .join('\n');
}

function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}
