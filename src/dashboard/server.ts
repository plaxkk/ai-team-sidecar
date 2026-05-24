import express from 'express';
import { getDb } from '../collector/db.js';
import { aggregateSessionMetrics } from '../analysis/metrics.js';
import { generateCeoReport, generateCeoReportFromDb } from '../analysis/ceo-report.js';
import { buildProjectManagementReport, getLatestProjectManagementReport, ProjectManagementReport } from '../analysis/project-report.js';
import { auditStartupProject } from '../analysis/startup-auditor.js';
import { buildOrganizationAudit, ProjectOrganizationInput } from '../analysis/organization-auditor.js';
import { loadConfig, isProjectAllowed } from '../config.js';
import { BRIEF_TEMPLATE, parseFounderBrief, validateFounderBrief } from '../analysis/founder-brief.js';
import { generateWeeklyReview } from '../analysis/weekly-review.js';
import { evaluateBusinessMetrics } from '../analysis/business-metrics.js';
import { parseGitDeploys } from '../collector/git-collector.js';
import { createManualCheckpoint } from '../analysis/checkpoint-detector.js';
import { generateChangelog, getChangelogEntries, exportChangelogMd } from '../analysis/changelog-generator.js';
import { generateXiaohongshuPost, archivePost, getSocialPosts } from '../analysis/social-post-generator.js';
import fs from 'fs';
import path from 'path';

const CONFIG = loadConfig();
const PORT = Number(process.env.PORT) || CONFIG.dashboardPort;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.resolve(import.meta.dirname, 'public'), {
  etag: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'public, max-age=600');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
  },
}));

// Overview metrics
app.get('/api/overview', (_req, res) => {
  const db = getDb();
  const sessions = db.prepare('SELECT session_id FROM sessions').all() as { session_id: string }[];
  const episodes = db.prepare('SELECT flow_score, handoff_score, req_score, overall_score, violations FROM episodes').all() as Array<{ flow_score: number; handoff_score: number; req_score: number; overall_score: number; violations: string }>;
  const projects = getProjectRows(db);

  const metrics = aggregateSessionMetrics(episodes);

  res.json({
    total_projects: projects.length,
    total_sessions: sessions.length,
    ...metrics,
    total_episodes: episodes.length,
    projects,
  });
});

// Project list
app.get('/api/projects', (_req, res) => {
  const db = getDb();
  res.json(getProjectRows(db));
});

// Company-level startup operating audit.
app.get('/api/company-audit', async (_req, res) => {
  const db = getDb();
  res.json(buildCompanyAuditReport(db));
});

app.get('/api/sync-status', (_req, res) => {
  const db = getDb();
  const rows = db.prepare(
    `SELECT source, last_started_at, last_finished_at, last_error,
            imported_sessions, skipped_sessions, pending_sessions, analyzed_sessions
     FROM collector_status
     ORDER BY source`
  ).all();
  res.json({
    generated_at: Date.now(),
    rows,
  });
});

// Session list
app.get('/api/sessions', (_req, res) => {
  const db = getDb();
  const sessions = db.prepare(
    'SELECT session_id, started_at, ended_at, cwd, total_turns FROM sessions ORDER BY started_at DESC'
  ).all();
  res.json(sessions);
});

// Episodes for a session
app.get('/api/episodes', async (req, res) => {
  const db = getDb();
  const sessionId = req.query.session_id as string;
  const projectPath = req.query.project_path as string;
  const limit = clampLimit(req.query.limit, 500);

  let episodes;
  if (projectPath) {
    episodes = db.prepare(
      `SELECT e.*
       FROM episodes e
       JOIN sessions s ON s.session_id = e.session_id
       WHERE s.cwd = ?
       ORDER BY s.started_at DESC, e.start_turn
       LIMIT ?`
    ).all(projectPath, limit);
  } else if (sessionId) {
    episodes = db.prepare(
      'SELECT * FROM episodes WHERE session_id = ? ORDER BY start_turn LIMIT ?'
    ).all(sessionId, limit);
  } else {
    episodes = db.prepare(
      'SELECT * FROM episodes ORDER BY id DESC LIMIT ?'
    ).all(limit);
  }
  res.json(episodes);
});

// Turns for an episode (full conversation)
app.get('/api/turns', (req, res) => {
  const db = getDb();
  const sessionId = req.query.session_id as string;
  const episodeId = req.query.episode_id as string;

  if (!sessionId || !episodeId) {
    res.status(400).json({ error: 'session_id and episode_id required' });
    return;
  }

  const episode = db.prepare('SELECT start_turn, end_turn FROM episodes WHERE id = ?').get(episodeId) as
    | { start_turn: number; end_turn: number }
    | undefined;

  if (!episode) {
    res.status(404).json({ error: 'Episode not found' });
    return;
  }

  const turns = db.prepare(
    'SELECT turn_number, user_prompt, user_prompt_at, assistant_response, assistant_response_at, detected_roles FROM turns WHERE session_id = ? AND turn_number >= ? AND turn_number <= ? ORDER BY turn_number'
  ).all(sessionId, episode.start_turn, episode.end_turn);

  res.json({ episode_id: Number(episodeId), turns });
});

// Single episode detail
app.get('/api/episode/:id', (req, res) => {
  const db = getDb();
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id) as Record<string, any> | undefined;
  if (!episode) {
    res.status(404).json({ error: 'Episode not found' });
    return;
  }

  // Also get the turns for this episode
  const turns = db.prepare(
    'SELECT * FROM turns WHERE session_id = ? AND turn_number >= ? AND turn_number <= ? ORDER BY turn_number'
  ).all(episode.session_id as string, episode.start_turn as number, episode.end_turn as number);

  res.json({ episode, turns });
});

// Role evaluations for a session
app.get('/api/role-evaluations', async (req, res) => {
  const db = getDb();
  const sessionId = req.query.session_id as string;
  const projectPath = req.query.project_path as string;

  const sessionIds = projectPath ? getSessionIdsForProject(db, projectPath) : sessionId ? [sessionId] : [];
  if (sessionIds.length === 0) {
    res.status(400).json({ error: 'session_id or project_path required' });
    return;
  }

  const placeholders = sessionIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT episode_id, role, score, details, deficiencies
     FROM role_evaluations
     WHERE session_id IN (${placeholders})
     ORDER BY episode_id, role`
  ).all(...sessionIds) as Array<{
    episode_id: number;
    role: string;
    score: number;
    details: string;
    deficiencies: string;
  }>;

  // Group by episode
  const byEpisode: Record<number, Array<{
    role: string;
    score: number;
    details: Record<string, number>;
    deficiencies: string[];
  }>> = {};

  for (const row of rows) {
    if (!byEpisode[row.episode_id]) byEpisode[row.episode_id] = [];
    byEpisode[row.episode_id].push({
      role: row.role,
      score: row.score,
      details: safeJsonParse(row.details, {}),
      deficiencies: safeJsonParse(row.deficiencies, []),
    });
  }

  // Aggregate across episodes
  const roleTotals: Record<string, { total: number; count: number }> = {};
  for (const row of rows) {
    if (!roleTotals[row.role]) roleTotals[row.role] = { total: 0, count: 0 };
    roleTotals[row.role].total += row.score;
    roleTotals[row.role].count++;
  }

  const aggregated: Record<string, number> = {};
  const aggregatedDetails: Record<string, Record<string, number>> = {};
  const aggregatedDeficiencies: Record<string, string[]> = {};
  for (const [role, data] of Object.entries(roleTotals)) {
    aggregated[role] = Math.round((data.total / data.count) * 100) / 100;
  }

  const roleGroups: Record<string, Array<{ details: Record<string, number>; deficiencies: string[] }>> = {};
  for (const rowsForEpisode of Object.values(byEpisode)) {
    for (const row of rowsForEpisode) {
      if (!roleGroups[row.role]) roleGroups[row.role] = [];
      roleGroups[row.role].push({ details: row.details, deficiencies: row.deficiencies });
    }
  }

  for (const [role, entries] of Object.entries(roleGroups)) {
    const detailAcc: Record<string, number[]> = {};
    const deficiencyCounts = new Map<string, number>();

    for (const entry of entries) {
      for (const [key, value] of Object.entries(entry.details || {})) {
        if (!detailAcc[key]) detailAcc[key] = [];
        detailAcc[key].push(value);
      }
      for (const deficiency of entry.deficiencies || []) {
        deficiencyCounts.set(deficiency, (deficiencyCounts.get(deficiency) || 0) + 1);
      }
    }

    aggregatedDetails[role] = Object.fromEntries(
      Object.entries(detailAcc).map(([key, values]) => [
        key,
        Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
      ])
    );
    aggregatedDeficiencies[role] = Array.from(deficiencyCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([deficiency]) => deficiency);
  }

  res.json({
    session_id: sessionId || null,
    project_path: projectPath || null,
    aggregated,
    aggregated_details: aggregatedDetails,
    aggregated_deficiencies: aggregatedDeficiencies,
    by_episode: byEpisode,
  });
});

// CEO report for a session
app.get('/api/ceo-report', async (req, res) => {
  const db = getDb();
  const sessionId = req.query.session_id as string;
  const projectPath = req.query.project_path as string;

  if (!sessionId && !projectPath) {
    res.status(400).json({ error: 'session_id or project_path required' });
    return;
  }

  if (projectPath) {
    res.json(buildProjectCeoReport(db, projectPath));
    return;
  }

  // Read the latest stored CEO report
  const row = db.prepare(
    'SELECT * FROM ceo_reports WHERE session_id = ? ORDER BY generated_at DESC LIMIT 1'
  ).get(sessionId) as Record<string, any> | undefined;

  if (row) {
    res.json({
      team_health: row.team_health,
      role_scores: safeJsonParse(row.role_scores, {}),
      top_issues: safeJsonParse(row.top_issues, []),
      weakest_role: row.weakest_role,
      trend: row.trend,
      prompt_quality: row.prompt_quality ?? 0,
      delivery_quality: row.delivery_quality ?? 0,
      user_suggestions: safeJsonParse(row.user_suggestions, []),
      prompt_details: safeJsonParse(row.prompt_details, {}),
      delivery_details: safeJsonParse(row.delivery_details, {}),
      prompt_explainability: safeJsonParse(row.prompt_explainability, {}),
      delivery_explainability: safeJsonParse(row.delivery_explainability, {}),
    });
    return;
  }

  // Fallback: regenerate from DB
  const report = generateCeoReportFromDb(db, sessionId);
  res.json(report);
});

// Project management report for a session
app.get('/api/project-management-report', async (req, res) => {
  const db = getDb();
  const sessionId = req.query.session_id as string;
  const projectPath = req.query.project_path as string;

  if (!sessionId && !projectPath) {
    res.status(400).json({ error: 'session_id or project_path required' });
    return;
  }

  if (projectPath) {
    res.json(buildProjectManagementReportForPath(db, projectPath));
    return;
  }

  res.json(getLatestProjectManagementReport(db, sessionId));
});

// Project lifecycle/resource analytics
app.get('/api/project-resource-report', async (req, res) => {
  const db = getDb();
  const projectPath = req.query.project_path as string;

  if (!projectPath) {
    res.status(400).json({ error: 'project_path required' });
    return;
  }

  res.json(buildProjectResourceReport(db, projectPath));
});

// AiTeam startup audit: project rules + conversation transcript -> strict JSON feedback.
app.get('/api/startup-audit', async (req, res) => {
  const db = getDb();
  const projectPath = req.query.project_path as string;

  if (!projectPath) {
    res.status(400).json({ error: 'project_path required' });
    return;
  }

  res.json(buildStartupAuditReport(db, projectPath));
});

// Execution review: one actionable project landing report for founder/PMO review.
app.get('/api/execution-review', async (req, res) => {
  const db = getDb();
  const projectPath = req.query.project_path as string;

  if (!projectPath) {
    res.status(400).json({ error: 'project_path required' });
    return;
  }

  res.json(buildExecutionReviewReport(db, projectPath));
});

// Proposed rule patches produced by AiTeam. Applying is explicit and append-only.
app.get('/api/rule-feedback', async (req, res) => {
  const db = getDb();
  const projectPath = req.query.project_path as string;

  if (!projectPath) {
    res.status(400).json({ error: 'project_path required' });
    return;
  }

  const audit = buildStartupAuditReport(db, projectPath) as any;
  const feedback = audit.rule_feedback || {};
  res.json({
    project_path: projectPath,
    items: [{
      target_file: suggestRuleTargetFile(feedback.suggested_md_patch || ''),
      status: 'proposed',
      current_weakness: feedback.current_weakness || '',
      suggested_md_patch: feedback.suggested_md_patch || '',
    }],
  });
});

app.post('/api/rule-feedback/apply', (req, res) => {
  const { project_path: projectPath, target_file: targetFile, suggested_md_patch: suggestedPatch } = req.body || {};
  if (!projectPath || !targetFile || !suggestedPatch) {
    res.status(400).json({ error: 'project_path, target_file and suggested_md_patch required' });
    return;
  }

  const targetPath = path.resolve(projectPath, targetFile);
  const projectRoot = path.resolve(projectPath);
  if (!targetPath.startsWith(projectRoot + path.sep)) {
    res.status(400).json({ error: 'target_file must stay inside project_path' });
    return;
  }
  if (!fs.existsSync(targetPath)) {
    res.status(404).json({ error: 'target file not found' });
    return;
  }

  const block = `\n\n## AiTeam Rule Feedback - ${new Date().toISOString()}\n\n${suggestedPatch}\n`;
  fs.appendFileSync(targetPath, block, 'utf8');
  res.json({ status: 'applied', target_file: targetFile, bytes_appended: Buffer.byteLength(block) });
});

// Founder Brief template
app.get('/api/founder-brief-template', (_req, res) => {
  res.json({ template: BRIEF_TEMPLATE });
});

// Validate a Founder Brief
app.post('/api/validate-brief', (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt) {
    res.status(400).json({ error: 'prompt required' });
    return;
  }
  const brief = parseFounderBrief(prompt);
  if (!brief) {
    res.json({ found: false, validation: null });
    return;
  }
  const validation = validateFounderBrief(brief);
  res.json({ found: true, brief, validation });
});

// Weekly CEO Review for a project
app.get('/api/weekly-review', (req, res) => {
  const db = getDb();
  const projectPath = req.query.project_path as string;
  if (!projectPath) {
    res.status(400).json({ error: 'project_path required' });
    return;
  }

  const now = Date.now();
  const weekEnd = now;
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;

  const review = generateWeeklyReview(db, projectPath, weekStart, weekEnd);

  // Persist
  db.prepare(
    `INSERT INTO weekly_reviews (project_path, week_start, week_end, label, project_status, health_trend, review_json, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    projectPath,
    review.period.week_start,
    review.period.week_end,
    review.period.label,
    review.project_status,
    review.management_health_trend,
    JSON.stringify(review),
    Date.now()
  );

  res.json(review);
});

// List all weekly reviews for a project
app.get('/api/weekly-reviews', (req, res) => {
  const db = getDb();
  const projectPath = req.query.project_path as string;
  if (!projectPath) {
    res.status(400).json({ error: 'project_path required' });
    return;
  }

  const rows = db.prepare(
    `SELECT week_start, week_end, label, project_status, health_trend, generated_at
     FROM weekly_reviews
     WHERE project_path = ?
     ORDER BY week_start DESC`
  ).all(projectPath);

  res.json(rows);
});

// Business metrics for a project (DORA + custom signals)
app.get('/api/business-metrics', (req, res) => {
  const db = getDb();
  const projectPath = req.query.project_path as string;
  if (!projectPath) {
    res.status(400).json({ error: 'project_path required' });
    return;
  }

  // Parse git deploys and store them
  const deploys = parseGitDeploys(projectPath);
  if (deploys.length > 0) {
    const insertDeploy = db.prepare(
      `INSERT OR IGNORE INTO deploy_events (project_path, deploy_at, commit_hash, commit_message, deploy_type)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const deploy of deploys) {
      insertDeploy.run(projectPath, deploy.deploy_at, deploy.commit_hash, deploy.commit_message, deploy.deploy_type);
    }
  }

  const metrics = evaluateBusinessMetrics(db, projectPath);
  res.json(metrics);
});

// Record a business signal
app.post('/api/business-signals', (req, res) => {
  const db = getDb();
  const { project_path, signal_type, signal_value, signal_unit, notes } = req.body || {};
  if (!project_path || !signal_type || signal_value === undefined) {
    res.status(400).json({ error: 'project_path, signal_type and signal_value required' });
    return;
  }

  db.prepare(
    `INSERT INTO business_signals (project_path, signal_type, signal_value, signal_unit, captured_at, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(project_path, signal_type, signal_value, signal_unit || '', Date.now(), notes || '');

  res.json({ status: 'recorded', project_path, signal_type, signal_value });
});

// === Checkpoint + Changelog + Social Post APIs ===

// GET /api/checkpoints — list checkpoints for a project
app.get('/api/checkpoints', (req, res) => {
  const db = getDb();
  const projectPath = req.query.project_path as string;
  if (!projectPath) {
    res.status(400).json({ error: 'project_path required' });
    return;
  }
  const rows = db.prepare(
    'SELECT * FROM checkpoints WHERE project_path = ? ORDER BY created_at DESC'
  ).all(projectPath);
  res.json(rows);
});

// POST /api/checkpoints — manual checkpoint creation
app.post('/api/checkpoints', (req, res) => {
  const db = getDb();
  const { project_path, label } = req.body;
  if (!project_path || !label) {
    res.status(400).json({ error: 'project_path and label required' });
    return;
  }
  const id = createManualCheckpoint(db, project_path, label);
  res.json({ id, project_path, label });
});

// GET /api/changelog — view changelog entries
app.get('/api/changelog', (req, res) => {
  const db = getDb();
  const projectPath = req.query.project_path as string;
  if (!projectPath) {
    res.status(400).json({ error: 'project_path required' });
    return;
  }
  const entries = getChangelogEntries(db, projectPath);
  res.json(entries);
});

// POST /api/changelog/generate — generate changelog and export CHANGELOG.md
app.post('/api/changelog/generate', (req, res) => {
  const db = getDb();
  const projectPath = req.query.project_path as string || req.body?.project_path;
  if (!projectPath) {
    res.status(400).json({ error: 'project_path required' });
    return;
  }
  const count = generateChangelog(db, projectPath);
  let filePath: string | null = null;
  if (count > 0) {
    filePath = exportChangelogMd(db, projectPath);
  }
  res.json({ entries_generated: count, file_path: filePath });
});

// GET /api/social-posts — list social posts
app.get('/api/social-posts', (req, res) => {
  const db = getDb();
  const projectPath = req.query.project_path as string;
  if (!projectPath) {
    res.status(400).json({ error: 'project_path required' });
    return;
  }
  const posts = getSocialPosts(db, projectPath);
  res.json(posts);
});

// POST /api/social-post/generate — generate xiaohongshu post
app.post('/api/social-post/generate', (req, res) => {
  const db = getDb();
  const projectPath = req.query.project_path as string || req.body?.project_path;
  const entryIds = req.body?.changelog_entry_ids as number[] | undefined;
  if (!projectPath) {
    res.status(400).json({ error: 'project_path required' });
    return;
  }
  const post = generateXiaohongshuPost(db, projectPath, entryIds);
  if (!post) {
    res.status(404).json({ error: 'No changelog entries found to generate post from' });
    return;
  }
  res.json(post);
});

// POST /api/social-post/:id/archive — archive post to social-posts/ directory
app.post('/api/social-post/:id/archive', (req, res) => {
  const db = getDb();
  const postId = Number(req.params.id);
  const projectPath = req.query.project_path as string || req.body?.project_path;
  if (!projectPath) {
    res.status(400).json({ error: 'project_path required' });
    return;
  }
  const filePath = archivePost(db, postId, projectPath);
  if (!filePath) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }
  res.json({ id: postId, file_path: filePath, status: 'archived' });
});

app.listen(PORT, () => {
  console.log(`[dashboard] Running at http://localhost:${PORT}`);
});

function clampLimit(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 500);
}

function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function getProjectRows(db: ReturnType<typeof getDb>) {
  const rows = db.prepare(
    `SELECT cwd as project_path,
            COUNT(*) as session_count,
            COALESCE(SUM(total_turns), 0) as total_turns,
            MIN(started_at) as started_at,
            MAX(COALESCE(ended_at, started_at)) as last_activity
     FROM sessions
     WHERE cwd IS NOT NULL AND cwd != ''
     GROUP BY cwd
     ORDER BY last_activity DESC`
  ).all() as Array<{
    project_path: string;
    session_count: number;
    total_turns: number;
    started_at: number;
    last_activity: number;
  }>;

  return rows
    .filter(row => isProjectAllowed(row.project_path))
    .map(row => {
    const sessionIds = getSessionIdsForProject(db, row.project_path);
    const report = buildProjectManagementReportForSessionIds(db, row.project_path, sessionIds);
    const episodeCount = db.prepare(
      `SELECT COUNT(*) as count
       FROM episodes
       WHERE session_id IN (${sessionIds.map(() => '?').join(',') || "''"})`
    ).get(...sessionIds) as { count: number };

    return {
      ...row,
      project_name: path.basename(row.project_path),
      total_episodes: episodeCount.count,
      overall_score: report.overall_score,
      input_quality_score: report.input_quality_score,
      process_health_score: report.process_health_score,
      output_quality_score: report.output_quality_score,
      confidence_score: report.confidence_score,
      top_risks: report.top_risks,
      data_quality_flags: report.data_quality_flags,
    };
  });
}

function buildCompanyAuditReport(db: ReturnType<typeof getDb>) {
  const projectRows = getProjectRows(db);
  const projectInputs: ProjectOrganizationInput[] = projectRows.map(row => ({
    project_path: row.project_path,
    project_name: row.project_name,
    session_count: row.session_count,
    total_turns: row.total_turns,
    total_episodes: row.total_episodes,
    last_activity: row.last_activity,
    management_report: buildProjectManagementReportForPath(db, row.project_path),
    resource_report: buildProjectResourceReport(db, row.project_path),
    startup_audit: buildStartupAuditReport(db, row.project_path),
  }));

  const report = buildOrganizationAudit(projectInputs);
  db.prepare(
    `INSERT INTO company_audit_reports (generated_at, company_score, report_json)
     VALUES (?, ?, ?)`
  ).run(report.generated_at, report.company_score, JSON.stringify(report));
  return report;
}

function getSessionIdsForProject(db: ReturnType<typeof getDb>, projectPath: string): string[] {
  const rows = db.prepare(
    'SELECT session_id FROM sessions WHERE cwd = ? ORDER BY started_at DESC'
  ).all(projectPath) as Array<{ session_id: string }>;
  return rows.map(row => row.session_id);
}

function buildExecutionReviewReport(db: ReturnType<typeof getDb>, projectPath: string) {
  const projectReport = buildProjectManagementReportForPath(db, projectPath);
  const resourceReport = buildProjectResourceReport(db, projectPath);
  const startupAudit = buildStartupAuditReport(db, projectPath) as any;
  const roleBottlenecks = buildRoleNodeBottlenecks(db, projectPath, resourceReport);
  const managementBottlenecks = buildManagementBottlenecks(projectReport, startupAudit);
  const resourceBottlenecks = buildResourceBottlenecks(resourceReport);
  const developmentEfficiency = buildDevelopmentEfficiency(projectReport, resourceReport);
  const goalAttainment = buildGoalAttainment(projectReport, startupAudit);
  const primaryBottleneck = pickPrimaryBottleneck([
    ...managementBottlenecks,
    ...roleBottlenecks.map(role => ({
      area: `${role.role_label} 节点`,
      score: role.score,
      severity: role.severity,
      evidence: role.bottleneck,
      action: role.next_action,
    })),
    ...resourceBottlenecks.items,
  ]);
  const actionPlan = buildExecutionActionPlan({
    primaryBottleneck,
    managementBottlenecks,
    roleBottlenecks,
    resourceBottlenecks,
    developmentEfficiency,
    goalAttainment,
    startupAudit,
  });

  return {
    project_path: projectPath,
    generated_at: Date.now(),
    executive_summary: {
      current_bottleneck: primaryBottleneck.area,
      bottleneck_severity: primaryBottleneck.severity,
      target_attainment_score: goalAttainment.score,
      prompt_session_efficiency_score: developmentEfficiency.prompt_session_efficiency_score,
      review_summary: summarizeExecutionReview(primaryBottleneck, goalAttainment, developmentEfficiency),
    },
    management_bottlenecks: managementBottlenecks,
    role_node_bottlenecks: roleBottlenecks,
    resource_bottlenecks: resourceBottlenecks,
    development_efficiency: developmentEfficiency,
    goal_attainment: goalAttainment,
    retrospective: buildRetrospective(projectReport, startupAudit, resourceReport, primaryBottleneck),
    action_plan: actionPlan,
    startup_audit: startupAudit,
  };
}

function buildManagementBottlenecks(projectReport: ProjectManagementReport, startupAudit: any) {
  const startupScores = startupAudit?.dimension_scores || {};
  const dimensions = [
    {
      area: 'CEO 输入 / 需求规格',
      score: projectReport.input_quality_score || 0,
      evidence: first(projectReport.top_risks, '目标、边界、验收标准或上下文不足会直接放大返工。'),
      action: '下一轮先写 Founder Brief：目标用户、痛点、P0、不做范围、验收标准、成功指标。',
    },
    {
      area: '项目过程 / 协作流',
      score: projectReport.process_health_score || 0,
      evidence: first(projectReport.top_risks, '角色参与、交接、轮次收敛或验证闭环存在过程风险。'),
      action: '每个 episode 强制输出“上一步结论 -> 当前动作 -> 验收证据 -> 下一步”。',
    },
    {
      area: '交付结果 / 验收闭环',
      score: projectReport.output_quality_score || 0,
      evidence: (projectReport.top_risks || []).find(risk => /交付|验证|闭环|go\/no-go/i.test(risk)) || '交付需要明确验证证据、结果摘要和 go/no-go 判断。',
      action: '交付末尾固定包含 build/test/deploy 证据、剩余风险、go/no-go、下一步最小动作。',
    },
    {
      area: '指标置信度 / 数据质量',
      score: projectReport.confidence_score || 0,
      evidence: first(projectReport.data_quality_flags, '当前样本量、耗时或重复记录会影响管理判断可信度。'),
      action: '先修采集口径和异常样本，再用分数做趋势判断。',
    },
    {
      area: '初创纪律 / MVP 聚焦',
      score: normalizePercentScore(startupScores.startup_excellence),
      evidence: first(startupAudit?.anti_patterns, '需要保持极致 MVP、用户验证和商业闭环约束。'),
      action: '砍掉非 P0 范围，只推进一个能被用户或业务结果验证的小闭环。',
    },
  ];

  return dimensions
    .map(item => ({ ...item, severity: severityForScore(item.score) }))
    .sort((a, b) => a.score - b.score);
}

function buildRoleNodeBottlenecks(db: ReturnType<typeof getDb>, projectPath: string, resourceReport: any) {
  const sessionIds = getSessionIdsForProject(db, projectPath);
  const roleOrder = ['product', 'engineer', 'qa', 'techlead'];
  const roleLabels: Record<string, string> = {
    product: 'Product',
    engineer: 'Engineer',
    qa: 'QA',
    techlead: 'Tech Lead',
  };
  const nodeLabels: Record<string, string> = {
    product: '需求定义 / 目标拆解',
    engineer: '技术方案 / 实现收敛',
    qa: '验证覆盖 / 风险暴露',
    techlead: '决策收口 / Go-No-Go',
  };
  const resourceByRole = new Map<string, any>((resourceReport?.role_effort || []).map((role: any) => [role.role, role]));

  if (sessionIds.length === 0) {
    return roleOrder.map(role => ({
      role,
      role_label: roleLabels[role],
      node: nodeLabels[role],
      score: 0,
      severity: 'critical',
      evaluations: 0,
      token_share: 0,
      counted_tokens: 0,
      deficiencies: ['暂无该项目会话样本'],
      bottleneck: '还没有可分析的角色执行样本。',
      next_action: '先用 AiTeam 跑一次完整项目执行会话，再评估角色节点瓶颈。',
    }));
  }

  const placeholders = sessionIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT role, score, deficiencies
     FROM role_evaluations
     WHERE session_id IN (${placeholders})`
  ).all(...sessionIds) as Array<{ role: string; score: number; deficiencies: string }>;
  const byRole = new Map<string, Array<{ score: number; deficiencies: string[] }>>();

  for (const row of rows) {
    if (!byRole.has(row.role)) byRole.set(row.role, []);
    byRole.get(row.role)!.push({
      score: Number(row.score || 0),
      deficiencies: safeJsonParse(row.deficiencies, []),
    });
  }

  return roleOrder.map(role => {
    const entries = byRole.get(role) || [];
    const resource = resourceByRole.get(role) || {};
    const score = entries.length ? ratio(entries.reduce((total, entry) => total + entry.score, 0), entries.length) : 0;
    const deficiencies = topFrequent(entries.flatMap(entry => entry.deficiencies || []), 4);
    const tokenShare = Number(resource.token_share || 0);
    const bottleneck = deriveRoleBottleneck(role, score, tokenShare, deficiencies, entries.length);

    return {
      role,
      role_label: roleLabels[role],
      node: nodeLabels[role],
      score,
      severity: severityForScore(score),
      evaluations: entries.length,
      token_share: tokenShare,
      counted_tokens: Number(resource.counted_tokens || 0),
      tokens_per_score_point: Number(resource.tokens_per_score_point || 0),
      deficiencies,
      bottleneck,
      next_action: roleNextAction(role, score, deficiencies),
    };
  }).sort((a, b) => {
    const severityDiff = severityRank(b.severity) - severityRank(a.severity);
    return severityDiff || a.score - b.score || b.token_share - a.token_share;
  });
}

function buildResourceBottlenecks(resourceReport: any) {
  const totals = resourceReport?.totals || {};
  const countedTokens = Number(totals.counted_tokens || totals.estimated_tokens || 0);
  const episodes = Number(totals.episodes || 0);
  const turns = Number(totals.turns || 0);
  const tools = Number(totals.tool_calls || 0);
  const tokensPerEpisode = ratio(countedTokens, episodes || 1);
  const turnsPerEpisode = ratio(turns, episodes || 1);
  const toolCallsPerEpisode = ratio(tools, episodes || 1);
  const biggestStage = (resourceReport?.lifecycle_stages || [])[0] || null;
  const biggestRole = (resourceReport?.role_effort || [])[0] || null;
  const topConversation = (resourceReport?.top_conversations || [])[0] || null;
  const items: Array<Record<string, any>> = [];

  if (Number(totals.sessions || 0) === 0) {
    items.push({
      area: '资源观测 / 数据采集',
      score: 0,
      severity: 'critical',
      evidence: '当前项目没有 sessions，无法判断 token、轮次和阶段消耗。',
      action: '先完成 setup/start，并让至少一次 Codex 或 Claude Code 会话进入该项目 cwd。',
    });
  }
  if (biggestStage && Number(biggestStage.token_share || 0) >= 0.55) {
    items.push({
      area: `${biggestStage.stage} 阶段 token 集中`,
      score: Math.max(0, 1 - Number(biggestStage.token_share || 0)),
      severity: severityForScore(Math.max(0, 1 - Number(biggestStage.token_share || 0))),
      evidence: `${biggestStage.stage} 消耗 ${Math.round(Number(biggestStage.token_share || 0) * 100)}% token，平均分 ${Math.round(Number(biggestStage.avg_score || 0) * 100)}%。`,
      action: '把该阶段拆成更短的验收回合，先确认输入和退出条件，再允许继续消耗 token。',
    });
  }
  if (biggestRole && Number(biggestRole.token_share || 0) >= 0.45 && Number(biggestRole.avg_score || 0) < 0.7) {
    items.push({
      area: `${biggestRole.role} 角色资源瓶颈`,
      score: Number(biggestRole.avg_score || 0),
      severity: severityForScore(Number(biggestRole.avg_score || 0)),
      evidence: `${biggestRole.role} 消耗 ${Math.round(Number(biggestRole.token_share || 0) * 100)}% token，但评分只有 ${Math.round(Number(biggestRole.avg_score || 0) * 100)}%。`,
      action: '给该角色增加输入模板和退出标准，避免高消耗低质量的开放式探索。',
    });
  }
  if (topConversation && Number(topConversation.counted_tokens || 0) > tokensPerEpisode * 1.5 && Number(topConversation.score || 0) < 0.7) {
    items.push({
      area: '高 token 低产出会话',
      score: Number(topConversation.score || 0),
      severity: severityForScore(Number(topConversation.score || 0)),
      evidence: `最高消耗 episode 使用 ${topConversation.counted_tokens} tokens，得分 ${Math.round(Number(topConversation.score || 0) * 100)}%。`,
      action: '复盘该 episode 的 prompt、工具调用和验证缺口，把任务拆成更小闭环。',
    });
  }

  return {
    totals: {
      counted_tokens: countedTokens,
      actual_tokens: Number(totals.actual_tokens || 0),
      estimated_tokens: Number(totals.estimated_tokens || 0),
      tool_io_tokens: Number(totals.tool_io_tokens || 0),
      sessions: Number(totals.sessions || 0),
      episodes,
      turns,
      tool_calls: tools,
      tokens_per_episode: tokensPerEpisode,
      turns_per_episode: turnsPerEpisode,
      tool_calls_per_episode: toolCallsPerEpisode,
      actual_token_coverage: Number(totals.actual_token_coverage || 0),
    },
    biggest_stage: biggestStage,
    biggest_role: biggestRole,
    top_token_conversation: topConversation,
    items: items.length ? items : [{
      area: '资源消耗结构',
      score: 0.8,
      severity: 'low',
      evidence: '当前没有明显单点资源瓶颈。',
      action: '保持每轮只推进一个可验证目标，继续观察 token/episode 趋势。',
    }],
  };
}

function buildDevelopmentEfficiency(projectReport: ProjectManagementReport, resourceReport: any) {
  const totals = resourceReport?.totals || {};
  const episodes = Number(totals.episodes || 0);
  const turns = Number(totals.turns || 0);
  const tools = Number(totals.tool_calls || 0);
  const turnsPerEpisode = ratio(turns, episodes || 1);
  const toolCallsPerEpisode = ratio(tools, episodes || 1);
  const promptSessionEfficiencyScore = roundNumber(
    (projectReport.efficiency_score || 0) * 0.45 +
    (projectReport.prompt_issue_score || 0) * 0.30 +
    (projectReport.output_quality_score || 0) * 0.25
  );
  const bottlenecks: string[] = [];

  if ((projectReport.prompt_issue_score || 0) < 0.65) bottlenecks.push('Prompt 输入质量不足，需求需要先产品化整理。');
  if ((projectReport.efficiency_score || 0) < 0.65) bottlenecks.push('会话效率偏低，可能存在轮次发散、重复探索或验证不足。');
  if (turnsPerEpisode > 5) bottlenecks.push(`平均每个 episode ${turnsPerEpisode} turns，沟通往返成本偏高。`);
  if (toolCallsPerEpisode > 12) bottlenecks.push(`平均每个 episode ${toolCallsPerEpisode} 次工具调用，探索成本偏高。`);

  return {
    prompt_session_efficiency_score: promptSessionEfficiencyScore,
    prompt_quality_score: projectReport.prompt_issue_score || 0,
    execution_efficiency_score: projectReport.efficiency_score || 0,
    output_quality_score: projectReport.output_quality_score || 0,
    turns_per_episode: turnsPerEpisode,
    tool_calls_per_episode: toolCallsPerEpisode,
    bottlenecks,
    next_action: bottlenecks.length
      ? '下一轮把任务压缩成一个 P0 输出，并在 prompt 中写明验收命令、失败条件和停止条件。'
      : '保持当前 prompt 和会话节奏，继续用 episode 级别趋势观察效率。',
  };
}

function buildGoalAttainment(projectReport: ProjectManagementReport, startupAudit: any) {
  const startupExcellence = normalizePercentScore(startupAudit?.dimension_scores?.startup_excellence);
  const score = roundNumber(
    (projectReport.output_quality_score || 0) * 0.40 +
    (projectReport.confidence_score || 0) * 0.20 +
    startupExcellence * 0.25 +
    (projectReport.process_health_score || 0) * 0.15
  );

  return {
    score,
    status: score >= 0.75 ? 'on-track' : score >= 0.55 ? 'at-risk' : 'off-track',
    evidence: [
      `Output ${Math.round((projectReport.output_quality_score || 0) * 100)}%`,
      `Process ${Math.round((projectReport.process_health_score || 0) * 100)}%`,
      `Confidence ${Math.round((projectReport.confidence_score || 0) * 100)}%`,
      `Startup Excellence ${Math.round(startupExcellence * 100)}%`,
    ],
    gap: score >= 0.75
      ? '目标达成信号较稳定，下一步重点是沉淀规则和保持节奏。'
      : '目标达成还不稳定，需要补强交付验证、范围控制和 CEO 输入规格。',
    next_success_metric: '下一轮至少完成 1 个可验证 P0 交付，并留下 build/test/deploy 或用户验证证据。',
  };
}

function buildRetrospective(projectReport: ProjectManagementReport, startupAudit: any, resourceReport: any, primaryBottleneck: any) {
  return {
    what_worked: [
      ...((startupAudit?.highlights || []).slice(0, 3)),
      (projectReport.output_quality_score || 0) >= 0.7 ? '交付质量达到可复用水平。' : '',
    ].filter(Boolean),
    what_did_not_work: [
      primaryBottleneck.evidence,
      ...((projectReport.top_risks || []).slice(0, 3)),
      ...((startupAudit?.anti_patterns || []).slice(0, 2)),
    ].filter(Boolean),
    decision_log: [
      `当前优先瓶颈：${primaryBottleneck.area}`,
      `目标达成状态：${buildGoalAttainment(projectReport, startupAudit).status}`,
      `资源口径：${resourceReport?.token_source || 'unknown'}`,
    ],
    next_review_questions: [
      '这一轮的 P0 目标是否被真实验证，而不仅是完成代码？',
      '哪个角色节点最拖慢收口，它需要模板、约束还是更小任务？',
      '最高 token episode 是否产生了匹配的业务或交付价值？',
      '本轮学到的规则是否已经写回项目 md 文件？',
    ],
  };
}

function buildExecutionActionPlan(input: {
  primaryBottleneck: any;
  managementBottlenecks: any[];
  roleBottlenecks: any[];
  resourceBottlenecks: any;
  developmentEfficiency: any;
  goalAttainment: any;
  startupAudit: any;
}) {
  const weakestRole = input.roleBottlenecks[0];
  const plan = [
    {
      priority: 'P0',
      owner: 'CEO/Founder',
      action: input.primaryBottleneck.action,
      success_metric: '下一轮 Management Health 提升，且 current bottleneck 不再是同一项。',
      cadence: 'next session',
    },
    {
      priority: 'P0',
      owner: weakestRole?.role_label || 'Tech Lead',
      action: weakestRole?.next_action || '补齐最弱角色节点的输出模板和验收门禁。',
      success_metric: `${weakestRole?.role_label || 'Role'} score >= 70%，且缺陷项减少。`,
      cadence: 'next episode',
    },
    {
      priority: 'P1',
      owner: 'PMO/AiTeam',
      action: input.developmentEfficiency.next_action,
      success_metric: 'prompt/session efficiency >= 70%，turns per episode 不继续上升。',
      cadence: 'daily review',
    },
    {
      priority: 'P1',
      owner: 'Tech Lead',
      action: input.resourceBottlenecks.items[0]?.action || '复盘 token 消耗最高的 episode 并拆小任务。',
      success_metric: '最高 token episode 的 score/token 比例改善，低产出高消耗会话减少。',
      cadence: 'weekly review',
    },
    {
      priority: 'P2',
      owner: 'CEO/Founder',
      action: input.goalAttainment.next_success_metric,
      success_metric: '每周至少 1 个可验证项目结果进入复盘记录。',
      cadence: 'weekly review',
    },
  ];

  return plan;
}

function pickPrimaryBottleneck(items: any[]) {
  const usable = items.filter(Boolean);
  if (usable.length === 0) {
    return {
      area: '暂无瓶颈样本',
      score: 0,
      severity: 'critical',
      evidence: '还没有足够项目数据。',
      action: '先采集至少一次完整项目执行会话。',
    };
  }
  return usable
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.score - b.score)[0];
}

function summarizeExecutionReview(primaryBottleneck: any, goalAttainment: any, developmentEfficiency: any): string {
  return `当前最需要处理的是 ${primaryBottleneck.area}；目标达成状态为 ${goalAttainment.status}，prompt/会话效率为 ${Math.round((developmentEfficiency.prompt_session_efficiency_score || 0) * 100)}%。下一轮应优先执行 P0 动作，而不是继续扩大范围。`;
}

function deriveRoleBottleneck(role: string, score: number, tokenShare: number, deficiencies: string[], evaluations: number): string {
  if (evaluations === 0) return '没有该角色的执行样本，说明角色节点没有进入稳定工作流。';
  if (tokenShare >= 0.45 && score < 0.7) return '资源占比较高但质量分不足，是高消耗低杠杆节点。';
  if (deficiencies.length > 0) return deficiencies[0];
  if (score < 0.7) return `${role} 节点输出不够稳定，需要强化模板和验收门禁。`;
  return '当前没有明显角色节点瓶颈。';
}

function roleNextAction(role: string, score: number, deficiencies: string[]): string {
  if (score >= 0.7 && deficiencies.length === 0) return '保持当前角色模板，下一轮只观察趋势。';
  if (role === 'product') return 'Product 先输出 Engineering Task Spec：目标、场景、痛点、约束、验收、优先级。';
  if (role === 'engineer') return 'Engineer 先给方案边界、改动文件、风险和最小实现路径，再动代码。';
  if (role === 'qa') return 'QA 必须列出正常、异常、边界测试用例，并标注风险等级。';
  if (role === 'techlead') return 'Tech Lead 必须给 go/no-go、剩余风险、验证证据和下一步最小动作。';
  return '补齐该角色的输入模板、输出格式和退出条件。';
}

function severityForScore(score: number): string {
  if (score < 0.4) return 'critical';
  if (score < 0.6) return 'high';
  if (score < 0.75) return 'medium';
  return 'low';
}

function severityRank(severity: string): number {
  if (severity === 'critical') return 4;
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

function normalizePercentScore(value: number): number {
  if (!Number.isFinite(Number(value))) return 0;
  return Number(value) > 1 ? roundNumber(Number(value) / 100) : roundNumber(Number(value));
}

function first(items: string[] | undefined, fallback: string): string {
  return (items || []).find(Boolean) || fallback;
}

function buildProjectManagementReportForPath(db: ReturnType<typeof getDb>, projectPath: string): ProjectManagementReport {
  return buildProjectManagementReportForSessionIds(db, projectPath, getSessionIdsForProject(db, projectPath));
}

function buildProjectManagementReportForSessionIds(
  db: ReturnType<typeof getDb>,
  projectPath: string,
  sessionIds: string[]
): ProjectManagementReport {
  const reports = sessionIds.map(sessionId => buildProjectManagementReport(db, sessionId));
  const episodes = reports.flatMap(report => report.episodes || []);

  return {
    session_id: projectPath,
    generated_at: Math.max(0, ...reports.map(report => report.generated_at || 0)),
    overall_score: avg(reports.map(report => report.overall_score)),
    input_quality_score: avg(reports.map(report => report.input_quality_score)),
    process_health_score: avg(reports.map(report => report.process_health_score)),
    output_quality_score: avg(reports.map(report => report.output_quality_score)),
    confidence_score: avg(reports.map(report => report.confidence_score)),
    team_composition_score: avg(reports.map(report => report.team_composition_score)),
    efficiency_score: avg(reports.map(report => report.efficiency_score)),
    prompt_issue_score: avg(reports.map(report => report.prompt_issue_score)),
    top_risks: topFrequent(reports.flatMap(report => report.top_risks || []), 10),
    data_quality_flags: topFrequent(reports.flatMap(report => report.data_quality_flags || []), 8),
    recommendations: topFrequent(reports.flatMap(report => report.recommendations || []), 10),
    episodes,
  };
}

function buildProjectCeoReport(db: ReturnType<typeof getDb>, projectPath: string) {
  const sessionIds = getSessionIdsForProject(db, projectPath);
  if (sessionIds.length === 0) {
    return generateCeoReport([]);
  }

  const placeholders = sessionIds.map(() => '?').join(',');
  const roleRows = db.prepare(
    `SELECT role, score, deficiencies
     FROM role_evaluations
     WHERE session_id IN (${placeholders})`
  ).all(...sessionIds) as Array<{ role: string; score: number; deficiencies: string }>;
  const episodeRows = db.prepare(
    `SELECT prompt_score, delivery_score
     FROM episodes
     WHERE session_id IN (${placeholders})`
  ).all(...sessionIds) as Array<{ prompt_score: number; delivery_score: number }>;
  const ceoRows = db.prepare(
    `SELECT prompt_explainability, delivery_explainability
     FROM ceo_reports
     WHERE session_id IN (${placeholders})
     ORDER BY generated_at DESC`
  ).all(...sessionIds) as Array<{ prompt_explainability: string; delivery_explainability: string }>;

  const evaluations = roleRows.map(row => ({
    role: row.role as any,
    score: row.score,
    details: {},
    deficiencies: safeJsonParse(row.deficiencies, []),
  }));
  const promptQuality = avg(episodeRows.map(row => row.prompt_score));
  const deliveryQuality = avg(episodeRows.map(row => row.delivery_score));

  return generateCeoReport(evaluations, {
    promptQuality,
    deliveryQuality,
    promptExplainability: aggregateStoredExplainability(ceoRows.map(row => safeJsonParse(row.prompt_explainability, {}))),
    deliveryExplainability: aggregateStoredExplainability(ceoRows.map(row => safeJsonParse(row.delivery_explainability, {}))),
  });
}

function aggregateStoredExplainability(rows: Array<Record<string, any>>): Record<string, any> {
  const usable = rows.filter(row => row && row.dimensions);
  if (usable.length === 0) return {};
  const dimensionAcc = new Map<string, any>();

  for (const row of usable) {
    for (const [name, dim] of Object.entries(row.dimensions || {}) as Array<[string, any]>) {
      if (!dimensionAcc.has(name)) {
        dimensionAcc.set(name, {
          score_total: 0,
          count: 0,
          weight: dim.weight,
          signals: new Map<string, number>(),
          missing: new Map<string, number>(),
          rationale: dim.rationale,
          recommendation: dim.recommendation,
        });
      }
      const acc = dimensionAcc.get(name);
      acc.score_total += Number(dim.score || 0);
      acc.count += 1;
      for (const signal of dim.signals || []) acc.signals.set(signal, (acc.signals.get(signal) || 0) + 1);
      for (const missing of dim.missing || []) acc.missing.set(missing, (acc.missing.get(missing) || 0) + 1);
    }
  }

  return {
    formula: usable[0].formula,
    confidence: avg(usable.map(row => Number(row.confidence || 0))),
    qualitative_summary: usable[0].qualitative_summary || '',
    dimensions: Object.fromEntries(Array.from(dimensionAcc.entries()).map(([name, acc]) => [
      name,
      {
        score: ratio(acc.score_total, acc.count),
        weight: acc.weight,
        signals: topMap(acc.signals, 4),
        missing: topMap(acc.missing, 4),
        rationale: acc.rationale,
        recommendation: acc.recommendation,
      },
    ])),
  };
}

function topMap(map: Map<string, number>, limit: number): string[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => `${value} (${count}x)`);
}

function buildStartupAuditReport(db: ReturnType<typeof getDb>, projectPath: string) {
  const sessionIds = getSessionIdsForProject(db, projectPath);
  const projectReport = buildProjectManagementReportForSessionIds(db, projectPath, sessionIds);
  const rulesText = readProjectRules(projectPath);

  if (sessionIds.length === 0) {
    const emptyAudit = auditStartupProject({
      rulesText,
      turns: [],
      episodes: [],
      roleScores: {},
      projectReport,
    });
    return decorateProjectAudit(db, projectPath, emptyAudit, projectReport, {});
  }

  const placeholders = sessionIds.map(() => '?').join(',');
  const turns = db.prepare(
    `SELECT t.session_id, t.turn_number, t.user_prompt, t.assistant_response, t.response_duration_ms
     FROM turns t
     JOIN sessions s ON s.session_id = t.session_id
     WHERE t.session_id IN (${placeholders})
     ORDER BY s.started_at, t.turn_number`
  ).all(...sessionIds) as Array<{
    session_id: string;
    turn_number: number;
    user_prompt: string;
    assistant_response: string;
    response_duration_ms: number | null;
  }>;
  const episodes = db.prepare(
    `SELECT e.flow_score, e.handoff_score, e.req_score, e.prompt_score, e.delivery_score, e.overall_score, e.violations
     FROM episodes e
     JOIN sessions s ON s.session_id = e.session_id
     WHERE e.session_id IN (${placeholders})
     ORDER BY s.started_at, e.start_turn`
  ).all(...sessionIds) as Array<{
    flow_score: number;
    handoff_score: number;
    req_score: number;
    prompt_score: number;
    delivery_score: number;
    overall_score: number;
    violations: string;
  }>;
  const roleRows = db.prepare(
    `SELECT role, AVG(score) as score
     FROM role_evaluations
     WHERE session_id IN (${placeholders})
     GROUP BY role`
  ).all(...sessionIds) as Array<{ role: string; score: number }>;

  const audit = auditStartupProject({
    rulesText,
    turns,
    episodes,
    roleScores: Object.fromEntries(roleRows.map(row => [row.role, row.score])),
    projectReport,
  });
  return decorateProjectAudit(db, projectPath, audit, projectReport, Object.fromEntries(roleRows.map(row => [row.role, row.score])));
}

function decorateProjectAudit(
  db: ReturnType<typeof getDb>,
  projectPath: string,
  audit: ReturnType<typeof auditStartupProject>,
  projectReport: ProjectManagementReport,
  roleScores: Record<string, number>
) {
  const resourceReport = buildProjectResourceReport(db, projectPath);
  const decorated = {
    ...audit,
    hierarchy: {
      company: 'Start-up Company',
      ceo: 'CEO/Founder at keyboard',
      project_group: projectPath,
      project_roles: Object.keys(roleScores),
      sidecar: 'independent evaluator',
      flywheel: 'audit -> feedback -> rule patch -> next iteration',
    },
    project_layer: {
      project_path: projectPath,
      management_health: projectReport.overall_score,
      input_quality: projectReport.input_quality_score,
      process_health: projectReport.process_health_score,
      output_quality: projectReport.output_quality_score,
      confidence: projectReport.confidence_score,
      operating_stage: inferProjectOperatingStage(resourceReport, projectReport),
      biggest_bottleneck: inferProjectAuditBottleneck(audit, projectReport),
    },
    role_layer: (resourceReport.role_effort || []).map((role: any) => ({
      role: role.role,
      quality_score: Math.round((role.avg_score || 0) * 100),
      token_share: role.token_share || 0,
      counted_tokens: role.counted_tokens || 0,
      leverage_score: Math.max(0, Math.min(100, Math.round((role.avg_score || 0) * 100 - (role.token_share || 0) * 20))),
      efficiency_note: role.tokens_per_score_point > 100000 ? 'high cost per score point' : 'normal',
    })),
    sidecar_findings: {
      highlights: audit.highlights,
      anti_patterns: audit.anti_patterns,
      root_causes: deriveProjectRootCauses(audit, projectReport),
      recommended_interventions: deriveProjectInterventions(audit, projectReport),
    },
    rule_feedback_queue: [{
      target_file: suggestRuleTargetFile(audit.rule_feedback.suggested_md_patch),
      status: 'proposed',
      current_weakness: audit.rule_feedback.current_weakness,
      suggested_md_patch: audit.rule_feedback.suggested_md_patch,
    }],
  };

  db.prepare(
    `INSERT INTO project_audit_reports (project_path, generated_at, total_score, report_json)
     VALUES (?, ?, ?, ?)`
  ).run(projectPath, Date.now(), audit.total_score, JSON.stringify(decorated));
  return decorated;
}

function readProjectRules(projectPath: string): string {
  const candidates = [
    '项目规则.md',
    'CLAUDE.md',
    'docs/TEAM-ROLES.md',
    'docs/ITERATION-PROCESS.md',
    'docs/MVP-CHECKLIST.md',
    'docs/MVP.md',
  ];

  return candidates
    .map(file => path.join(projectPath, file))
    .filter(file => fs.existsSync(file) && fs.statSync(file).isFile())
    .map(file => `# Source: ${path.relative(projectPath, file)}\n${fs.readFileSync(file, 'utf8')}`)
    .join('\n\n---\n\n');
}

function suggestRuleTargetFile(patch: string): string {
  if (/QA|测试/.test(patch)) return 'CLAUDE.md';
  if (/Product|需求|CEO|Tech Lead|go\/no-go/.test(patch)) return 'docs/ITERATION-PROCESS.md';
  if (/MVP|框架|重构|P0|过度设计/.test(patch)) return 'docs/MVP-CHECKLIST.md';
  return 'CLAUDE.md';
}

function inferProjectOperatingStage(resourceReport: any, projectReport: ProjectManagementReport): string {
  const topStage = resourceReport?.lifecycle_stages?.[0]?.stage;
  if (topStage) return topStage;
  if ((projectReport.input_quality_score || 0) < 0.5) return 'Discover';
  if ((projectReport.output_quality_score || 0) < 0.6) return 'Build';
  if ((projectReport.confidence_score || 0) < 0.75) return 'Validate';
  return 'Operate';
}

function inferProjectAuditBottleneck(audit: ReturnType<typeof auditStartupProject>, projectReport: ProjectManagementReport): string {
  const candidates = [
    ['Rule Compliance', audit.dimension_scores.rule_compliance],
    ['Dialogue Quality', audit.dimension_scores.dialogue_quality],
    ['Startup Excellence', audit.dimension_scores.startup_excellence],
    ['Input Quality', Math.round((projectReport.input_quality_score || 0) * 100)],
    ['Process Health', Math.round((projectReport.process_health_score || 0) * 100)],
    ['Output Quality', Math.round((projectReport.output_quality_score || 0) * 100)],
  ] as Array<[string, number]>;
  return candidates.sort((a, b) => a[1] - b[1])[0][0];
}

function deriveProjectRootCauses(audit: ReturnType<typeof auditStartupProject>, projectReport: ProjectManagementReport): string[] {
  const causes: string[] = [];
  if (audit.dimension_scores.dialogue_quality < 60) causes.push('上下文传递与交接质量不足，需求、实现、验证之间存在信息损耗。');
  if ((projectReport.input_quality_score || 0) < 0.6) causes.push('CEO/Product 输入规格不足，目标、边界或验收标准没有形成强门禁。');
  if (audit.dimension_scores.startup_excellence < 70) causes.push('MVP 和商业闭环约束不够硬，执行容易滑向泛化优化或过度设计。');
  if ((projectReport.output_quality_score || 0) < 0.6) causes.push('交付缺少足够验证证据和 go/no-go 收口。');
  if (causes.length === 0) causes.push('当前主要矛盾是把 AiTeam 发现持续写回项目规则，而不是单轮执行质量。');
  return causes;
}

function deriveProjectInterventions(audit: ReturnType<typeof auditStartupProject>, projectReport: ProjectManagementReport): string[] {
  const interventions: string[] = [];
  if ((projectReport.input_quality_score || 0) < 0.6) interventions.push('下一轮需求先补 Engineering Task Spec，明确 P0、目标用户、痛点、验收标准和不做范围。');
  if (audit.dimension_scores.dialogue_quality < 60) interventions.push('每次角色交接必须显式写出“上一步结论 -> 下一步动作 -> 验收证据”。');
  if (audit.dimension_scores.startup_excellence < 70) interventions.push('砍掉非 P0 范围，用一个可上线或可验证的最小动作闭环。');
  if ((projectReport.output_quality_score || 0) < 0.6) interventions.push('交付末尾强制包含 build/test/deploy 证据和 go/no-go 结论。');
  interventions.push('将本轮 rule_feedback 进入规则反馈队列，人工接受后写回项目 md 文件。');
  return interventions.slice(0, 5);
}

function avg(values: number[]): number {
  const usable = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  if (usable.length === 0) return 0;
  return Math.round((usable.reduce((sum, value) => sum + value, 0) / usable.length) * 100) / 100;
}

function topFrequent(items: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const item of items.filter(Boolean)) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([item]) => item);
}

function buildProjectResourceReport(db: ReturnType<typeof getDb>, projectPath: string) {
  const sessionIds = getSessionIdsForProject(db, projectPath);
  if (sessionIds.length === 0) {
    return {
      project_path: projectPath,
      generated_at: Date.now(),
      token_source: 'none',
      token_note: 'No sessions found for this project.',
      totals: emptyResourceTotals(),
      agent_mix: [],
      lifecycle_stages: [],
      role_effort: [],
      top_conversations: [],
    };
  }

  const placeholders = sessionIds.map(() => '?').join(',');
  const sessions = db.prepare(
    `SELECT session_id, agent_source, model, total_turns, total_tokens, token_source
     FROM sessions
     WHERE session_id IN (${placeholders})`
  ).all(...sessionIds) as Array<Record<string, any>>;
  const episodes = db.prepare(
    `SELECT e.*, s.cwd, s.agent_source
     FROM episodes e
     JOIN sessions s ON s.session_id = e.session_id
     WHERE e.session_id IN (${placeholders})
     ORDER BY s.started_at DESC, e.start_turn`
  ).all(...sessionIds) as Array<Record<string, any>>;
  const turns = db.prepare(
    `SELECT *
     FROM turns
     WHERE session_id IN (${placeholders})
     ORDER BY session_id, turn_number`
  ).all(...sessionIds) as Array<Record<string, any>>;
  const toolRows = db.prepare(
    `SELECT session_id, turn_number, COUNT(*) as count, COALESCE(SUM(estimated_tokens), 0) as estimated_tokens
     FROM tool_calls
     WHERE session_id IN (${placeholders})
     GROUP BY session_id, turn_number`
  ).all(...sessionIds) as Array<{ session_id: string; turn_number: number; count: number; estimated_tokens: number }>;
  const roleRows = db.prepare(
    `SELECT episode_id, role, score
     FROM role_evaluations
     WHERE session_id IN (${placeholders})`
  ).all(...sessionIds) as Array<{ episode_id: number; role: string; score: number }>;

  const toolsByTurn = new Map<string, number>();
  const toolTokensByTurn = new Map<string, number>();
  const turnsWithStoredToolTokens = new Set<string>();
  for (const row of toolRows) {
    const key = `${row.session_id}:${row.turn_number}`;
    toolsByTurn.set(key, row.count);
    toolTokensByTurn.set(key, Number(row.estimated_tokens || 0));
    if (Number(row.estimated_tokens || 0) > 0) turnsWithStoredToolTokens.add(key);
  }

  for (const [key, value] of estimateToolTokensFromEvents(db, sessionIds, turns).entries()) {
    if (!turnsWithStoredToolTokens.has(key)) {
      toolTokensByTurn.set(key, (toolTokensByTurn.get(key) || 0) + value);
    }
  }

  const rolesByEpisode = new Map<number, Array<{ role: string; score: number }>>();
  for (const row of roleRows) {
    if (!rolesByEpisode.has(row.episode_id)) rolesByEpisode.set(row.episode_id, []);
    rolesByEpisode.get(row.episode_id)!.push({ role: row.role, score: row.score });
  }

  const stageAcc = new Map<string, ReturnType<typeof createStageAccumulator>>();
  const roleAcc = new Map<string, ReturnType<typeof createRoleAccumulator>>();
  const agentAcc = new Map<string, ReturnType<typeof createAgentAccumulator>>();
  const topConversations: Array<Record<string, any>> = [];
  const totals = emptyResourceTotals();

  for (const session of sessions) {
    const agentSource = session.agent_source || 'claude_code';
    const agentData = getOrCreate(agentAcc, agentSource, createAgentAccumulator);
    agentData.sessions += 1;
    agentData.turns += Number(session.total_turns || 0);
    agentData.actual_tokens += Number(session.total_tokens || 0);
    agentData.models.add(session.model || 'unknown');

    totals.sessions += 1;
    if (Number(session.total_tokens || 0) > 0) totals.sessions_with_actual_tokens += 1;
    totals.actual_tokens += Number(session.total_tokens || 0);
  }

  for (const episode of episodes) {
    const episodeTurns = turns.filter(
      turn => turn.session_id === episode.session_id
        && turn.turn_number >= episode.start_turn
        && turn.turn_number <= episode.end_turn
    );
    const stage = lifecycleStageForEpisode(episode.episode_type || '');
    const visibleTextTokens = episodeTurns.reduce(
      (sum, turn) => sum + Number(turn.estimated_tokens || estimateTokens(`${turn.user_prompt || ''}\n${turn.assistant_response || ''}`)),
      0
    );
    const actualTokens = episodeTurns.reduce((sum, turn) => sum + Number(turn.total_tokens || 0), 0);
    const toolTokens = episodeTurns.reduce((sum, turn) => sum + (toolTokensByTurn.get(`${turn.session_id}:${turn.turn_number}`) || 0), 0);
    const countedTokens = actualTokens > 0 ? actualTokens : visibleTextTokens + toolTokens;
    const tokenSource = actualTokens > 0 ? 'actual' : toolTokens > 0 ? 'estimated_with_tool_io' : 'estimated_visible_text';
    const durationMinutes = roundNumber(episodeTurns
      .map(turn => turn.response_duration_ms)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 120 * 60_000)
      .reduce((sum, value) => sum + value, 0) / 60_000);
    const toolCalls = episodeTurns.reduce((sum, turn) => sum + (toolsByTurn.get(`${turn.session_id}:${turn.turn_number}`) || 0), 0);
    const roleEvals = rolesByEpisode.get(episode.id) || [];
    const agentSource = episode.agent_source || 'claude_code';

    const stageData = getOrCreate(stageAcc, stage, createStageAccumulator);
    stageData.episodes += 1;
    stageData.turns += episodeTurns.length;
    stageData.counted_tokens += countedTokens;
    stageData.actual_tokens += actualTokens;
    stageData.estimated_tokens += visibleTextTokens + toolTokens;
    stageData.visible_text_tokens += visibleTextTokens;
    stageData.tool_io_tokens += toolTokens;
    stageData.tool_calls += toolCalls;
    stageData.duration_minutes += durationMinutes;
    stageData.score_total += Number(episode.overall_score || 0);

    const agentData = getOrCreate(agentAcc, agentSource, createAgentAccumulator);
    agentData.episodes += 1;
    agentData.counted_tokens += countedTokens;
    agentData.estimated_tokens += visibleTextTokens + toolTokens;
    agentData.tool_io_tokens += toolTokens;
    agentData.tool_calls += toolCalls;
    agentData.score_total += Number(episode.overall_score || 0);

    totals.episodes += 1;
    totals.turns += episodeTurns.length;
    totals.counted_tokens += countedTokens;
    totals.estimated_tokens += visibleTextTokens + toolTokens;
    totals.visible_text_tokens += visibleTextTokens;
    totals.tool_io_tokens += toolTokens;
    totals.tool_calls += toolCalls;
    totals.duration_minutes += durationMinutes;

    const perRoleTokens = roleEvals.length > 0 ? Math.round(countedTokens / roleEvals.length) : 0;
    for (const roleEval of roleEvals) {
      const roleData = getOrCreate(roleAcc, roleEval.role, createRoleAccumulator);
      roleData.evaluations += 1;
      roleData.score_total += Number(roleEval.score || 0);
      roleData.counted_tokens += perRoleTokens;
      roleData.duration_minutes += roleEvals.length > 0 ? durationMinutes / roleEvals.length : 0;
    }

    topConversations.push({
      episode_id: episode.id,
      session_id: episode.session_id,
      agent_source: agentSource,
      task_type: episode.episode_type,
      lifecycle_stage: stage,
      user_requirement: episode.user_requirement,
      counted_tokens: countedTokens,
      actual_tokens: actualTokens,
      estimated_tokens: visibleTextTokens + toolTokens,
      visible_text_tokens: visibleTextTokens,
      tool_io_tokens: toolTokens,
      token_source: tokenSource,
      turns: episodeTurns.length,
      tool_calls: toolCalls,
      duration_minutes: durationMinutes,
      score: Number(episode.overall_score || 0),
    });
  }

  totals.duration_minutes = roundNumber(totals.duration_minutes);
  totals.estimated_cost_units = roundNumber(totals.counted_tokens / Math.max(1, totals.episodes));
  totals.actual_token_coverage = ratio(totals.sessions_with_actual_tokens, totals.sessions);

  const lifecycleStages = Array.from(stageAcc.entries()).map(([stage, value]) => ({
    stage,
    episodes: value.episodes,
    turns: value.turns,
    counted_tokens: value.counted_tokens,
    actual_tokens: value.actual_tokens,
    estimated_tokens: value.estimated_tokens,
    visible_text_tokens: value.visible_text_tokens,
    tool_io_tokens: value.tool_io_tokens,
    token_share: ratio(value.counted_tokens, totals.counted_tokens),
    tool_calls: value.tool_calls,
    duration_minutes: roundNumber(value.duration_minutes),
    avg_score: ratio(value.score_total, value.episodes),
    tokens_per_episode: ratio(value.counted_tokens, value.episodes),
  }));

  const roleEffort = Array.from(roleAcc.entries()).map(([role, value]) => ({
    role,
    evaluations: value.evaluations,
    avg_score: ratio(value.score_total, value.evaluations),
    counted_tokens: value.counted_tokens,
    token_share: ratio(value.counted_tokens, totals.counted_tokens),
    duration_minutes: roundNumber(value.duration_minutes),
    tokens_per_score_point: ratio(value.counted_tokens, value.score_total),
  }));

  const agentMix = Array.from(agentAcc.entries()).map(([agent_source, value]) => ({
    agent_source,
    sessions: value.sessions,
    episodes: value.episodes,
    turns: value.turns,
    models: Array.from(value.models).filter(Boolean).slice(0, 4),
    actual_tokens: value.actual_tokens,
    estimated_tokens: value.estimated_tokens,
    counted_tokens: value.actual_tokens > 0 ? value.actual_tokens : value.counted_tokens,
    tool_io_tokens: value.tool_io_tokens,
    tool_calls: value.tool_calls,
    avg_score: ratio(value.score_total, value.episodes),
  }));

  return {
    project_path: projectPath,
    generated_at: Date.now(),
    token_source: totals.sessions_with_actual_tokens > 0 ? 'mixed' : 'estimated',
    token_note: 'Token 口径已拆分：Codex CLI 使用本地 threads.tokens_used 与 rollout token_count，属于真实 usage；Claude Code 当前没有账单级 usage，使用可见 prompt/response 与 tool input/output 文本按约 4 字符 = 1 token 估算。模型系统提示、隐藏推理、缓存上下文重放和未落盘的 agent 内部上下文仍不能精确还原，因此页面展示的是管理分析口径，不是财务结算口径。',
    totals,
    agent_mix: agentMix.sort((a, b) => b.counted_tokens - a.counted_tokens),
    lifecycle_stages: lifecycleStages.sort((a, b) => b.counted_tokens - a.counted_tokens),
    role_effort: roleEffort.sort((a, b) => b.counted_tokens - a.counted_tokens),
    top_conversations: topConversations
      .sort((a, b) => b.counted_tokens - a.counted_tokens)
      .slice(0, 8),
  };
}

function emptyResourceTotals() {
  return {
    sessions: 0,
    sessions_with_actual_tokens: 0,
    episodes: 0,
    turns: 0,
    counted_tokens: 0,
    actual_tokens: 0,
    estimated_tokens: 0,
    visible_text_tokens: 0,
    tool_io_tokens: 0,
    estimated_cost_units: 0,
    tool_calls: 0,
    duration_minutes: 0,
    actual_token_coverage: 0,
  };
}

function createStageAccumulator() {
  return {
    episodes: 0,
    turns: 0,
    counted_tokens: 0,
    actual_tokens: 0,
    estimated_tokens: 0,
    visible_text_tokens: 0,
    tool_io_tokens: 0,
    tool_calls: 0,
    duration_minutes: 0,
    score_total: 0,
  };
}

function createRoleAccumulator() {
  return {
    evaluations: 0,
    score_total: 0,
    counted_tokens: 0,
    duration_minutes: 0,
  };
}

function createAgentAccumulator() {
  return {
    sessions: 0,
    episodes: 0,
    turns: 0,
    actual_tokens: 0,
    counted_tokens: 0,
    estimated_tokens: 0,
    tool_io_tokens: 0,
    tool_calls: 0,
    score_total: 0,
    models: new Set<string>(),
  };
}

function estimateToolTokensFromEvents(
  db: ReturnType<typeof getDb>,
  sessionIds: string[],
  turns: Array<Record<string, any>>
): Map<string, number> {
  const result = new Map<string, number>();
  if (sessionIds.length === 0) return result;

  const placeholders = sessionIds.map(() => '?').join(',');
  const eventRows = db.prepare(
    `SELECT session_id, captured_at, payload
     FROM events
     WHERE session_id IN (${placeholders}) AND event_type = 'PostToolUse'`
  ).all(...sessionIds) as Array<{ session_id: string; captured_at: number; payload: string }>;

  const turnsBySession = new Map<string, Array<Record<string, any>>>();
  for (const turn of turns) {
    if (!turnsBySession.has(turn.session_id)) turnsBySession.set(turn.session_id, []);
    turnsBySession.get(turn.session_id)!.push(turn);
  }
  for (const rows of turnsBySession.values()) {
    rows.sort((a, b) => Number(a.user_prompt_at || 0) - Number(b.user_prompt_at || 0));
  }

  for (const event of eventRows) {
    const turn = findTurnForTimestamp(turnsBySession.get(event.session_id) || [], event.captured_at);
    if (!turn) continue;

    const payload = safeJsonParse(event.payload, {}) as Record<string, any>;
    const toolInput = JSON.stringify(payload.tool_input || {});
    const toolResponse = JSON.stringify(payload.tool_response || {});
    const key = `${event.session_id}:${turn.turn_number}`;
    result.set(key, (result.get(key) || 0) + estimateTokens(`${toolInput}\n${toolResponse}`));
  }

  return result;
}

function findTurnForTimestamp(turns: Array<Record<string, any>>, timestamp: number) {
  let selected: Record<string, any> | null = null;
  for (const turn of turns) {
    if (Number(turn.user_prompt_at || 0) <= timestamp) selected = turn;
    if (Number(turn.user_prompt_at || 0) > timestamp) break;
  }
  return selected;
}

function getOrCreate<T>(map: Map<string, T>, key: string, factory: () => T): T {
  const existing = map.get(key);
  if (existing) return existing;
  const created = factory();
  map.set(key, created);
  return created;
}

function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}

function lifecycleStageForEpisode(type: string): string {
  if (/planning|role_planning/i.test(type)) return 'Plan';
  if (/feature|bugfix|refactor|task/i.test(type)) return 'Build';
  if (/testing|review/i.test(type)) return 'Validate';
  if (/deploy/i.test(type)) return 'Release';
  if (/operation/i.test(type)) return 'Operate';
  if (/continuation/i.test(type)) return 'Coordinate';
  return 'Build';
}

function ratio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return roundNumber(numerator / denominator);
}

function roundNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
