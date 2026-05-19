// Weekly CEO Review: periodic aggregate report for project oversight
import Database from 'better-sqlite3';

export interface WeeklyCeoReview {
  period: {
    week_start: number;   // Unix timestamp
    week_end: number;
    label: string;        // Human-readable like "2026-W21"
  };
  project_status: 'on_track' | 'at_risk' | 'off_track' | 'no_data';
  management_health_trend: 'improving' | 'stable' | 'declining' | 'no_data';
  key_metrics: {
    episodes: number;
    input_quality: number;
    output_quality: number;
    efficiency: number;
    team_health: number;
  };
  key_risks: string[];
  verified_facts: string[];
  highlights: string[];
  anti_patterns: string[];
  next_week_action: string;
  rule_feedback: string;
}

/**
 * Generate a weekly CEO review by aggregating data from the specified week.
 * All data comes from existing tables — no new collection needed.
 */
export function generateWeeklyReview(
  db: Database.Database,
  projectPath: string,
  weekStart: number,
  weekEnd: number
): WeeklyCeoReview {
  const weekEndInclusive = weekEnd;

  // 1. Get sessions in this week for the project
  const sessions = db.prepare(
    `SELECT session_id, started_at, total_turns
     FROM sessions
     WHERE cwd = ? AND started_at >= ? AND started_at <= ?
     ORDER BY started_at`
  ).all(projectPath, weekStart, weekEndInclusive) as Array<{
    session_id: string;
    started_at: number;
    total_turns: number;
  }>;

  const sessionIds = sessions.map(s => s.session_id);

  // 2. Get episodes for these sessions
  let episodes: Array<{
    id: number;
    session_id: string;
    flow_score: number;
    handoff_score: number;
    req_score: number;
    overall_score: number;
    prompt_score: number;
    delivery_score: number;
    violations: string;
  }> = [];

  if (sessionIds.length > 0) {
    const placeholders = sessionIds.map(() => '?').join(',');
    episodes = db.prepare(
      `SELECT id, session_id, flow_score, handoff_score, req_score, overall_score, prompt_score, delivery_score, violations
       FROM episodes
       WHERE session_id IN (${placeholders})`
    ).all(...sessionIds) as typeof episodes;
  }

  // 3. Get project reports for these sessions
  let projectReport: Record<string, any> | null = null;
  if (sessionIds.length > 0) {
    const placeholders = sessionIds.map(() => '?').join(',');
    const reportRow = db.prepare(
      `SELECT overall_score, input_quality_score, output_quality_score, efficiency_score, top_risks
       FROM project_reports
       WHERE session_id IN (${placeholders})
       ORDER BY generated_at DESC LIMIT 1`
    ).get(...sessionIds) as Record<string, any> | undefined;
    projectReport = reportRow || null;
  }

  // 4. Get CEO reports for team health
  let prevTeamHealth: number | null = null;
  let currentTeamHealth = 0;
  if (sessionIds.length > 0) {
    const placeholders = sessionIds.map(() => '?').join(',');
    const ceoRows = db.prepare(
      `SELECT team_health FROM ceo_reports
       WHERE session_id IN (${placeholders})
       ORDER BY generated_at DESC`
    ).all(...sessionIds) as Array<{ team_health: number }>;
    if (ceoRows.length > 0) {
      currentTeamHealth = ceoRows[0].team_health;
    }
  }

  // Get previous week's team health for trend
  const prevWeekEnd = weekStart - 1;
  const prevWeekStart = prevWeekEnd - 7 * 24 * 60 * 60 * 1000;
  const prevSessions = db.prepare(
    `SELECT session_id FROM sessions WHERE cwd = ? AND started_at >= ? AND started_at <= ?`
  ).all(projectPath, prevWeekStart, prevWeekEnd) as Array<{ session_id: string }>;

  if (prevSessions.length > 0) {
    const placeholders = prevSessions.map(() => '?').join(',');
    const prevCeo = db.prepare(
      `SELECT team_health FROM ceo_reports
       WHERE session_id IN (${placeholders})
       ORDER BY generated_at DESC LIMIT 1`
    ).get(...prevSessions.map(s => s.session_id)) as { team_health: number } | undefined;
    prevTeamHealth = prevCeo?.team_health ?? null;
  }

  // 5. Get startup audit for the project
  const auditRow = db.prepare(
    `SELECT report_json FROM project_audit_reports
     WHERE project_path = ?
     ORDER BY generated_at DESC LIMIT 1`
  ).get(projectPath) as { report_json: string } | undefined;

  let auditData: Record<string, any> = {};
  if (auditRow) {
    try { auditData = JSON.parse(auditRow.report_json); } catch { /* ignore */ }
  }

  // 6. Get rule feedback
  const ruleFeedbackRow = db.prepare(
    `SELECT weakness, suggested_patch FROM rule_feedback_items
     WHERE project_path = ? AND status = 'proposed'
     ORDER BY created_at DESC LIMIT 1`
  ).get(projectPath) as { weakness: string; suggested_patch: string } | undefined;

  // Compute metrics
  const avgInputQuality = projectReport?.input_quality_score ?? avg(episodes.map(e => e.prompt_score));
  const avgOutputQuality = projectReport?.output_quality_score ?? avg(episodes.map(e => e.delivery_score));
  const avgEfficiency = projectReport?.efficiency_score ?? avg(episodes.map(e => e.overall_score));
  const episodeCount = episodes.length;
  const totalTurns = sessions.reduce((s, sess) => s + (sess.total_turns || 0), 0);

  // Determine project status
  const overallAvg = avg(episodes.map(e => e.overall_score));
  let projectStatus: WeeklyCeoReview['project_status'] = 'no_data';
  if (episodeCount > 0) {
    if (overallAvg >= 0.6 && avgOutputQuality >= 0.5) projectStatus = 'on_track';
    else if (overallAvg >= 0.4) projectStatus = 'at_risk';
    else projectStatus = 'off_track';
  }

  // Determine trend
  let trend: WeeklyCeoReview['management_health_trend'] = 'no_data';
  if (currentTeamHealth > 0 && prevTeamHealth !== null) {
    if (currentTeamHealth - prevTeamHealth >= 0.05) trend = 'improving';
    else if (prevTeamHealth - currentTeamHealth >= 0.05) trend = 'declining';
    else trend = 'stable';
  } else if (currentTeamHealth > 0) {
    trend = 'stable';
  }

  // Gather risks, highlights, anti-patterns from audit data
  const keyRisks: string[] = (projectReport?.top_risks ? safeJsonParse(projectReport.top_risks as string, []) : []);
  const verifiedFacts = deriveVerifiedFacts(episodes, sessions);
  const highlights: string[] = (auditData as any).highlights || [];
  const antiPatterns: string[] = (auditData as any).anti_patterns || [];

  // Next week action
  const nextAction = deriveNextAction(projectStatus, keyRisks, avgInputQuality, avgOutputQuality);

  // Generate week label (ISO week)
  const startDate = new Date(weekStart);
  const weekNumber = getISOWeek(startDate);
  const label = `${startDate.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;

  return {
    period: {
      week_start: weekStart,
      week_end: weekEnd,
      label,
    },
    project_status: projectStatus,
    management_health_trend: trend,
    key_metrics: {
      episodes: episodeCount,
      input_quality: round(avgInputQuality),
      output_quality: round(avgOutputQuality),
      efficiency: round(avgEfficiency),
      team_health: round(currentTeamHealth),
    },
    key_risks: keyRisks.slice(0, 5),
    verified_facts: verifiedFacts,
    highlights: highlights.slice(0, 3),
    anti_patterns: antiPatterns.slice(0, 3),
    next_week_action: nextAction,
    rule_feedback: ruleFeedbackRow?.suggested_patch || '',
  };
}

function deriveVerifiedFacts(
  episodes: Array<{ violations: string }>,
  sessions: Array<{ total_turns: number }>
): string[] {
  const facts: string[] = [];

  if (sessions.length > 0) {
    facts.push(`本周完成 ${sessions.length} 个会话，${episodes.length} 个工作单元`);
  }

  const episodesWithLowViolations = episodes.filter(e => {
    const viols = safeJsonParse<string[]>(e.violations || '[]', []);
    return viols.length <= 1;
  });
  if (episodesWithLowViolations.length > 0 && episodes.length > 0) {
    facts.push(`${episodesWithLowViolations.length}/${episodes.length} 个工作单元流程合规性较好`);
  }

  if (facts.length === 0) {
    facts.push('本周暂无足够数据生成已验证事实');
  }

  return facts;
}

function deriveNextAction(
  status: WeeklyCeoReview['project_status'],
  risks: string[],
  inputQuality: number,
  outputQuality: number
): string {
  if (status === 'no_data') {
    return '本周无数据，建议下一轮先启动一个会话并完成一个完整 episode。';
  }
  if (status === 'off_track') {
    return '项目偏离轨道，建议下一轮只聚焦一个最小可验证闭环，确保流程完整后再扩展范围。';
  }
  if (inputQuality < 0.5) {
    return '输入质量不足，建议下一轮使用 Founder Brief 模板写需求，确保目标、范围、约束明确。';
  }
  if (outputQuality < 0.5) {
    return '交付质量需要提升，建议每个 episode 结尾包含验证证据、总结和 go/no-go 决策。';
  }
  if (risks.length > 3) {
    return `存在 ${risks.length} 个风险项，建议下一轮优先解决最高优先级风险后再继续开发。`;
  }
  return '项目进展正常，建议保持当前节奏，下一轮推进一个可验证、可上线的小功能。';
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function avg(values: number[]): number {
  const usable = values.filter(Number.isFinite);
  if (usable.length === 0) return 0;
  return usable.reduce((a, b) => a + b, 0) / usable.length;
}

function round(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
