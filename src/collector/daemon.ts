import { getDb } from './db.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { getDataDir, getPipePath, isProjectAllowed, loadConfig } from '../config.js';
import { syncCodexSessions } from './codex-sync.js';
import { runAnalysis } from '../analysis/engine.js';

const CONFIG = loadConfig();
const DATA_DIR = getDataDir(CONFIG);
const FIFO_PATH = getPipePath(CONFIG);

let currentTurnNumber = 0;
let currentSessionId = '';
const pendingAnalysisSessionIds = new Set<string>();
let codexSyncRunning = false;
let analysisRunning = false;

async function main() {
  // Ensure FIFO exists
  fs.mkdirSync(path.dirname(FIFO_PATH), { recursive: true });
  if (!fs.existsSync(FIFO_PATH)) {
    try {
      execSync(`mkfifo "${FIFO_PATH}"`);
    } catch {
      // Already exists
    }
  }

  console.log(`[collector] Opening FIFO at ${FIFO_PATH}`);
  const db = getDb();

  // Prepare statements
  const insertEvent = db.prepare(
    'INSERT INTO events (session_id, event_type, captured_at, payload) VALUES (?, ?, ?, ?)'
  );
  const upsertSession = db.prepare(
    `INSERT INTO sessions (session_id, started_at, cwd, total_turns, agent_source, token_source) VALUES (?, ?, ?, 0, 'claude_code', 'estimated')
     ON CONFLICT(session_id) DO UPDATE SET ended_at = excluded.started_at, agent_source = COALESCE(agent_source, 'claude_code')`
  );
  const insertTurn = db.prepare(
    `INSERT INTO turns (session_id, turn_number, user_prompt, user_prompt_at)
     VALUES (?, ?, ?, ?)`
  );
  const updateTurnResponse = db.prepare(
    `UPDATE turns SET assistant_response = ?, assistant_response_at = ?, response_duration_ms = ?
     WHERE session_id = ? AND turn_number = ?`
  );
  const insertToolCall = db.prepare(
    'INSERT INTO tool_calls (session_id, turn_number, tool_name, tool_input, tool_response, estimated_tokens, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const incrementTurns = db.prepare(
    'UPDATE sessions SET total_turns = total_turns + 1 WHERE session_id = ?'
  );

  // Codex CLI has no hook stream, so keep it fresh from the local Codex state in
  // the background instead of doing this work during dashboard requests.
  const CODEX_SYNC_INTERVAL = 10_000;
  async function syncCodexInBackground() {
    if (codexSyncRunning) return;
    codexSyncRunning = true;
    const startedAt = Date.now();
    writeCollectorStatus(db, {
      source: 'codex_sync',
      last_started_at: startedAt,
      last_finished_at: 0,
      last_error: '',
    });

    try {
      const result = syncCodexSessions(db);
      for (const sessionId of result.analysis_session_ids) {
        pendingAnalysisSessionIds.add(sessionId);
      }
      writeCollectorStatus(db, {
        source: 'codex_sync',
        last_started_at: startedAt,
        last_finished_at: Date.now(),
        last_error: '',
        imported_sessions: result.imported_sessions,
        skipped_sessions: result.skipped_sessions,
        pending_sessions: pendingAnalysisSessionIds.size,
      });
      if (result.imported_sessions > 0 || result.analysis_session_ids.length > 0) {
        console.log(`[collector] Codex sync imported ${result.imported_sessions}, pending analysis ${pendingAnalysisSessionIds.size}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeCollectorStatus(db, {
        source: 'codex_sync',
        last_started_at: startedAt,
        last_finished_at: Date.now(),
        last_error: message,
        pending_sessions: pendingAnalysisSessionIds.size,
      });
      console.error('[collector] Codex sync error:', err);
    } finally {
      codexSyncRunning = false;
    }
  }

  // Analysis: incremental queue for changed sessions, plus periodic full refresh.
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  async function triggerAnalysis(sessionIds?: string[]) {
    if (analysisRunning) return;
    analysisRunning = true;
    const startedAt = Date.now();
    writeCollectorStatus(db, {
      source: 'analysis',
      last_started_at: startedAt,
      last_finished_at: 0,
      last_error: '',
      pending_sessions: pendingAnalysisSessionIds.size,
    });

    try {
      const sessions = sessionIds || (db.prepare('SELECT DISTINCT session_id FROM turns').all() as { session_id: string }[])
        .map(row => row.session_id);
      for (const sessionId of sessions) {
        await runAnalysis(db, sessionId);
        pendingAnalysisSessionIds.delete(sessionId);
      }
      writeCollectorStatus(db, {
        source: 'analysis',
        last_started_at: startedAt,
        last_finished_at: Date.now(),
        last_error: '',
        analyzed_sessions: sessions.length,
        pending_sessions: pendingAnalysisSessionIds.size,
      });
      console.log(`[collector] Analysis complete for ${sessions.length} session(s)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeCollectorStatus(db, {
        source: 'analysis',
        last_started_at: startedAt,
        last_finished_at: Date.now(),
        last_error: message,
        pending_sessions: pendingAnalysisSessionIds.size,
      });
      console.error('[collector] Analysis error:', err);
    } finally {
      analysisRunning = false;
    }
  }
  async function drainAnalysisQueue() {
    if (pendingAnalysisSessionIds.size === 0) return;
    await triggerAnalysis(Array.from(pendingAnalysisSessionIds));
  }
  setInterval(syncCodexInBackground, CODEX_SYNC_INTERVAL);
  setTimeout(syncCodexInBackground, 1_000);
  setInterval(drainAnalysisQueue, 5_000);
  // Run analysis every 12 hours
  setInterval(triggerAnalysis, TWELVE_HOURS);
  // Also run once at startup so dashboard has data immediately
  setTimeout(triggerAnalysis, 5_000);

  // Read FIFO continuously
  async function readLoop() {
    while (true) {
      try {
        const stream = fs.createReadStream(FIFO_PATH, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: stream });

        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const envelope = JSON.parse(line);
            const { ts, event, data } = envelope;
            const sessionId = data?.session_id || data?.cwd || 'unknown';

            if (event === 'SessionStart') {
              currentSessionId = sessionId;
              const cwd = data?.cwd || '';
              // Filter: only record sessions from allowed project directories
              if (cwd && !isProjectAllowed(cwd)) {
                continue;
              }
              upsertSession.run(sessionId, ts, cwd);
              insertEvent.run(sessionId, event, ts, eventPayload(data));
            } else if (event === 'UserPromptSubmit') {
              currentTurnNumber++;
              currentSessionId = sessionId;
              insertTurn.run(sessionId, currentTurnNumber, data?.prompt || '', ts);
              insertEvent.run(sessionId, event, ts, eventPayload(data));
              incrementTurns.run(sessionId);
            } else if (event === 'Stop') {
              const turn = db.prepare(
                'SELECT user_prompt_at FROM turns WHERE session_id = ? AND turn_number = ?'
              ).get(sessionId, currentTurnNumber) as { user_prompt_at: number } | undefined;

              const duration = turn ? ts - turn.user_prompt_at : 0;
              updateTurnResponse.run(
                data?.last_assistant_message || '', ts, duration,
                sessionId, currentTurnNumber
              );
              insertEvent.run(sessionId, event, ts, eventPayload(data));
              pendingAnalysisSessionIds.add(sessionId);
            } else if (event === 'PostToolUse') {
              const toolInput = JSON.stringify(data?.tool_input || {});
              const toolResponse = CONFIG.privacy.storeToolOutput ? JSON.stringify(data?.tool_response || {}) : '';
              insertToolCall.run(
                sessionId, currentTurnNumber,
                data?.tool_name || '', toolInput, toolResponse, estimateTokens(`${toolInput}\n${toolResponse}`),
                ts
              );
              insertEvent.run(sessionId, event, ts, eventPayload(data));
            }
          } catch (parseErr) {
            console.error('[collector] Parse error:', parseErr);
          }
        }
      } catch (err) {
        console.error('[collector] FIFO read error:', err);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  console.log('[collector] Daemon started. Waiting for events...');
  readLoop();
}

function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}

function eventPayload(data: unknown): string {
  return CONFIG.privacy.storeRawPayload ? JSON.stringify(data) : '{}';
}

function writeCollectorStatus(
  db: ReturnType<typeof getDb>,
  fields: {
    source: string;
    last_started_at?: number;
    last_finished_at?: number;
    last_error?: string;
    imported_sessions?: number;
    skipped_sessions?: number;
    pending_sessions?: number;
    analyzed_sessions?: number;
  }
) {
  const current = db.prepare('SELECT * FROM collector_status WHERE source = ?').get(fields.source) as
    | {
      last_started_at: number;
      last_finished_at: number;
      last_error: string;
      imported_sessions: number;
      skipped_sessions: number;
      pending_sessions: number;
      analyzed_sessions: number;
    }
    | undefined;

  db.prepare(
    `INSERT INTO collector_status
      (source, last_started_at, last_finished_at, last_error, imported_sessions, skipped_sessions, pending_sessions, analyzed_sessions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source) DO UPDATE SET
      last_started_at = excluded.last_started_at,
      last_finished_at = excluded.last_finished_at,
      last_error = excluded.last_error,
      imported_sessions = excluded.imported_sessions,
      skipped_sessions = excluded.skipped_sessions,
      pending_sessions = excluded.pending_sessions,
      analyzed_sessions = excluded.analyzed_sessions`
  ).run(
    fields.source,
    fields.last_started_at ?? current?.last_started_at ?? 0,
    fields.last_finished_at ?? current?.last_finished_at ?? 0,
    fields.last_error ?? current?.last_error ?? '',
    fields.imported_sessions ?? current?.imported_sessions ?? 0,
    fields.skipped_sessions ?? current?.skipped_sessions ?? 0,
    fields.pending_sessions ?? current?.pending_sessions ?? 0,
    fields.analyzed_sessions ?? current?.analyzed_sessions ?? 0
  );
}

main().catch(err => {
  console.error('[collector] Fatal:', err);
  process.exit(1);
});
