import { getDb } from './db.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { getDataDir, getPipePath, loadConfig } from '../config.js';

const CONFIG = loadConfig();
const DATA_DIR = getDataDir(CONFIG);
const FIFO_PATH = getPipePath(CONFIG);

let currentTurnNumber = 0;
let currentSessionId = '';

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

  // Analysis: twice daily (12h interval), plus on-demand trigger for all sessions
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  async function triggerAnalysis() {
    try {
      const { runAnalysis } = await import('../analysis/engine.js');
      // Analyze all sessions that have turns, not just the current one
      const sessions = db.prepare('SELECT DISTINCT session_id FROM turns').all() as { session_id: string }[];
      for (const { session_id } of sessions) {
        await runAnalysis(db, session_id);
      }
      console.log(`[collector] Analysis complete for ${sessions.length} session(s)`);
    } catch (err) {
      console.error('[collector] Analysis error:', err);
    }
  }
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
              upsertSession.run(sessionId, ts, data?.cwd || '');
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

main().catch(err => {
  console.error('[collector] Fatal:', err);
  process.exit(1);
});
