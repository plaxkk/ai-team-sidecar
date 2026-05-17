import { getDb, closeDb } from '../src/collector/db.js';
import { syncCodexSessions } from '../src/collector/codex-sync.js';
import { runAnalysis } from '../src/analysis/engine.js';

const projectPath = process.argv[2];
const db = getDb();
const result = syncCodexSessions(db, projectPath ? { projectPath } : {});

for (const sessionId of result.analysis_session_ids) {
  await runAnalysis(db, sessionId);
}

console.log(JSON.stringify({
  ...result,
  analyzed_sessions: result.analysis_session_ids.length,
}, null, 2));

closeDb();
