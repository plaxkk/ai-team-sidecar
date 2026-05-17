import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { getDataDir } from '../config.js';

const DATA_DIR = getDataDir();
const DB_PATH = path.join(DATA_DIR, 'feedback.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('busy_timeout = 5000');
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      started_at INTEGER,
      ended_at INTEGER,
      cwd TEXT,
      total_turns INTEGER DEFAULT 0,
      agent_source TEXT DEFAULT 'claude_code',
      model TEXT,
      total_tokens INTEGER DEFAULT 0,
      token_source TEXT DEFAULT 'estimated'
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      event_type TEXT,
      captured_at INTEGER,
      payload TEXT
    );

    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      turn_number INTEGER,
      user_prompt TEXT,
      user_prompt_at INTEGER,
      assistant_response TEXT,
      assistant_response_at INTEGER,
      response_duration_ms INTEGER,
      detected_roles TEXT,
      has_product_step INTEGER DEFAULT 0,
      has_engineer_step INTEGER DEFAULT 0,
      has_qa_step INTEGER DEFAULT 0,
      has_techlead_step INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      estimated_tokens INTEGER DEFAULT 0,
      token_source TEXT DEFAULT 'estimated'
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      turn_number INTEGER,
      tool_name TEXT,
      tool_input TEXT,
      tool_response TEXT,
      estimated_tokens INTEGER DEFAULT 0,
      captured_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      start_turn INTEGER,
      end_turn INTEGER,
      episode_type TEXT,
      user_requirement TEXT,
      flow_score REAL DEFAULT 0,
      handoff_score REAL DEFAULT 0,
      req_score REAL DEFAULT 0,
      overall_score REAL DEFAULT 0,
      violations TEXT,
      prompt_score REAL DEFAULT 0,
      delivery_score REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS role_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      episode_id INTEGER REFERENCES episodes(id),
      role TEXT,
      score REAL DEFAULT 0,
      details TEXT,
      deficiencies TEXT
    );

    CREATE TABLE IF NOT EXISTS ceo_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      generated_at INTEGER,
      team_health REAL DEFAULT 0,
      role_scores TEXT,
      top_issues TEXT,
      weakest_role TEXT,
      trend TEXT,
      prompt_quality REAL DEFAULT 0,
      delivery_quality REAL DEFAULT 0,
      user_suggestions TEXT,
      prompt_details TEXT,
      delivery_details TEXT,
      prompt_explainability TEXT,
      delivery_explainability TEXT
    );

    CREATE TABLE IF NOT EXISTS project_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      generated_at INTEGER,
      overall_score REAL DEFAULT 0,
      input_quality_score REAL DEFAULT 0,
      process_health_score REAL DEFAULT 0,
      output_quality_score REAL DEFAULT 0,
      confidence_score REAL DEFAULT 0,
      team_composition_score REAL DEFAULT 0,
      efficiency_score REAL DEFAULT 0,
      prompt_issue_score REAL DEFAULT 0,
      top_risks TEXT,
      data_quality_flags TEXT,
      recommendations TEXT,
      episodes TEXT
    );

    CREATE TABLE IF NOT EXISTS company_audit_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generated_at INTEGER,
      company_score REAL DEFAULT 0,
      report_json TEXT
    );

    CREATE TABLE IF NOT EXISTS project_audit_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT,
      generated_at INTEGER,
      total_score REAL DEFAULT 0,
      report_json TEXT
    );

    CREATE TABLE IF NOT EXISTS rule_feedback_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT,
      target_file TEXT,
      status TEXT DEFAULT 'proposed',
      weakness TEXT,
      suggested_patch TEXT,
      created_at INTEGER,
      applied_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
    CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(session_id);
    CREATE INDEX IF NOT EXISTS idx_project_reports_session ON project_reports(session_id);
    CREATE INDEX IF NOT EXISTS idx_project_audit_path ON project_audit_reports(project_path, generated_at);
    CREATE INDEX IF NOT EXISTS idx_rule_feedback_project ON rule_feedback_items(project_path, status);
  `);

  // Schema migrations for existing databases
  try { db.exec('ALTER TABLE episodes ADD COLUMN prompt_score REAL DEFAULT 0'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE episodes ADD COLUMN delivery_score REAL DEFAULT 0'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE ceo_reports ADD COLUMN prompt_quality REAL DEFAULT 0'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE ceo_reports ADD COLUMN delivery_quality REAL DEFAULT 0'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE ceo_reports ADD COLUMN user_suggestions TEXT'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE ceo_reports ADD COLUMN prompt_details TEXT'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE ceo_reports ADD COLUMN delivery_details TEXT'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE ceo_reports ADD COLUMN prompt_explainability TEXT'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE ceo_reports ADD COLUMN delivery_explainability TEXT'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE project_reports ADD COLUMN input_quality_score REAL DEFAULT 0'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE project_reports ADD COLUMN process_health_score REAL DEFAULT 0'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE project_reports ADD COLUMN output_quality_score REAL DEFAULT 0'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE project_reports ADD COLUMN confidence_score REAL DEFAULT 0'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE project_reports ADD COLUMN data_quality_flags TEXT'); } catch { /* exists */ }
  try { db.exec("ALTER TABLE sessions ADD COLUMN agent_source TEXT DEFAULT 'claude_code'"); } catch { /* exists */ }
  try { db.exec('ALTER TABLE sessions ADD COLUMN model TEXT'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE sessions ADD COLUMN total_tokens INTEGER DEFAULT 0'); } catch { /* exists */ }
  try { db.exec("ALTER TABLE sessions ADD COLUMN token_source TEXT DEFAULT 'estimated'"); } catch { /* exists */ }
  try { db.exec('ALTER TABLE turns ADD COLUMN input_tokens INTEGER DEFAULT 0'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE turns ADD COLUMN output_tokens INTEGER DEFAULT 0'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE turns ADD COLUMN total_tokens INTEGER DEFAULT 0'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE turns ADD COLUMN estimated_tokens INTEGER DEFAULT 0'); } catch { /* exists */ }
  try { db.exec("ALTER TABLE turns ADD COLUMN token_source TEXT DEFAULT 'estimated'"); } catch { /* exists */ }
  try { db.exec('ALTER TABLE tool_calls ADD COLUMN tool_response TEXT'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE tool_calls ADD COLUMN estimated_tokens INTEGER DEFAULT 0'); } catch { /* exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_cwd_source ON sessions(cwd, agent_source)'); } catch { /* unavailable */ }
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
