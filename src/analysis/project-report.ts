import Database from 'better-sqlite3';
import { normalizeTurns } from './episode-grouper.js';
import { EfficiencyEvaluation, evaluateEfficiency } from './efficiency-evaluator.js';
import { PromptIssueAnalysis, analyzePromptIssues } from './prompt-issue-analyzer.js';
import { TeamEvaluation, evaluateTeamComposition } from './team-evaluator.js';
import { ProjectTaskType, detectProjectTaskType } from './team-model.js';

export interface ProjectEpisodeReport {
  episode_id: number;
  session_id: string;
  task_type: ProjectTaskType;
  user_requirement: string;
  flow_score: number;
  handoff_score: number;
  req_score: number;
  prompt_score: number;
  delivery_score: number;
  role_execution_score: number;
  input_quality_score: number;
  process_health_score: number;
  output_quality_score: number;
  confidence_score: number;
  diagnostic_score: number;
  team: TeamEvaluation;
  efficiency: EfficiencyEvaluation;
  prompt: PromptIssueAnalysis;
  data_quality_flags: string[];
  overall_score: number;
}

export interface ProjectManagementReport {
  session_id: string;
  generated_at: number;
  overall_score: number;
  input_quality_score: number;
  process_health_score: number;
  output_quality_score: number;
  confidence_score: number;
  team_composition_score: number;
  efficiency_score: number;
  prompt_issue_score: number;
  top_risks: string[];
  data_quality_flags: string[];
  recommendations: string[];
  episodes: ProjectEpisodeReport[];
}

interface TurnRow {
  id?: number;
  turn_number: number;
  user_prompt: string;
  assistant_response: string;
  response_duration_ms: number | null;
  detected_roles: string | null;
}

interface EpisodeRow {
  id: number;
  session_id: string;
  start_turn: number;
  end_turn: number;
  episode_type: string;
  user_requirement: string;
  flow_score: number;
  handoff_score: number;
  req_score: number;
  prompt_score: number;
  delivery_score: number;
}

export function buildProjectManagementReport(db: Database.Database, sessionId: string): ProjectManagementReport {
  const episodes = db.prepare(
    `SELECT id, session_id, start_turn, end_turn, episode_type, user_requirement,
            flow_score, handoff_score, req_score, prompt_score, delivery_score
     FROM episodes
     WHERE session_id = ?
     ORDER BY start_turn`
  ).all(sessionId) as EpisodeRow[];

  const reports: ProjectEpisodeReport[] = [];
  const sessionFlags = new Set<string>();

  for (const episode of episodes) {
    const rawTurns = db.prepare(
      `SELECT id, turn_number, user_prompt, assistant_response, response_duration_ms, detected_roles
       FROM turns
       WHERE session_id = ? AND turn_number >= ? AND turn_number <= ?
       ORDER BY turn_number, id`
    ).all(sessionId, episode.start_turn, episode.end_turn) as TurnRow[];

    const turns = normalizeTurns(rawTurns);
    const toolRows = db.prepare(
      `SELECT tool_name, COUNT(*) as count
       FROM tool_calls
       WHERE session_id = ? AND turn_number >= ? AND turn_number <= ?
       GROUP BY tool_name`
    ).all(sessionId, episode.start_turn, episode.end_turn) as Array<{ tool_name: string; count: number }>;
    const roleRows = db.prepare(
      'SELECT role, score FROM role_evaluations WHERE episode_id = ? ORDER BY role'
    ).all(episode.id) as Array<{ role: string; score: number }>;

    const firstPrompt = turns[0]?.user_prompt || episode.user_requirement || '';
    const fullResponse = turns.map(t => t.assistant_response || '').join('\n\n');
    const taskType = detectProjectTaskType(firstPrompt || episode.episode_type);
    const detectedRoles = collectDetectedRoles(turns);
    const tools = {
      total: toolRows.reduce((sum, row) => sum + row.count, 0),
      by_tool: Object.fromEntries(toolRows.map(row => [row.tool_name || 'unknown', row.count])),
    };

    const team = evaluateTeamComposition(taskType, firstPrompt, fullResponse, detectedRoles);
    const efficiency = evaluateEfficiency(taskType, turns, tools);
    const prompt = analyzePromptIssues(firstPrompt);
    const dataQualityFlags = assessEpisodeDataQuality(rawTurns, turns, efficiency.data_quality);
    const roleExecutionScore = avg(roleRows.map(row => row.score), 0.5);
    const inputQualityScore = prompt.score;
    const processHealthScore = round(
      0.25 * team.score +
      0.25 * efficiency.score +
      0.20 * episode.flow_score +
      0.15 * episode.handoff_score +
      0.15 * episode.req_score
    );
    const outputQualityScore = round(0.60 * episode.delivery_score + 0.40 * roleExecutionScore);
    const confidenceScore = scoreDataConfidence(dataQualityFlags);
    const diagnosticScore = round(0.40 * team.score + 0.30 * efficiency.score + 0.30 * prompt.score);
    const managementHealth = round(
      0.20 * inputQualityScore +
      0.35 * processHealthScore +
      0.30 * outputQualityScore +
      0.15 * confidenceScore
    );

    for (const flag of dataQualityFlags) sessionFlags.add(flag);

    reports.push({
      episode_id: episode.id,
      session_id: episode.session_id,
      task_type: taskType,
      user_requirement: episode.user_requirement,
      flow_score: episode.flow_score,
      handoff_score: episode.handoff_score,
      req_score: episode.req_score,
      prompt_score: episode.prompt_score,
      delivery_score: episode.delivery_score,
      role_execution_score: roleExecutionScore,
      input_quality_score: inputQualityScore,
      process_health_score: processHealthScore,
      output_quality_score: outputQualityScore,
      confidence_score: confidenceScore,
      diagnostic_score: diagnosticScore,
      team,
      efficiency,
      prompt,
      data_quality_flags: dataQualityFlags,
      overall_score: managementHealth,
    });
  }

  const teamScore = avg(reports.map(r => r.team.score));
  const efficiencyScore = avg(reports.map(r => r.efficiency.score));
  const promptScore = avg(reports.map(r => r.prompt.score));
  const overallScore = avg(reports.map(r => r.overall_score));
  const inputQualityScore = avg(reports.map(r => r.input_quality_score));
  const processHealthScore = avg(reports.map(r => r.process_health_score));
  const outputQualityScore = avg(reports.map(r => r.output_quality_score));
  const confidenceScore = avg(reports.map(r => r.confidence_score), reports.length === 0 ? 0 : 0.6);
  const topRisks = deriveTopRisks(reports);
  const recommendations = deriveRecommendations(reports, Array.from(sessionFlags));

  return {
    session_id: sessionId,
    generated_at: Date.now(),
    overall_score: overallScore,
    input_quality_score: inputQualityScore,
    process_health_score: processHealthScore,
    output_quality_score: outputQualityScore,
    confidence_score: confidenceScore,
    team_composition_score: teamScore,
    efficiency_score: efficiencyScore,
    prompt_issue_score: promptScore,
    top_risks: topRisks,
    data_quality_flags: Array.from(sessionFlags).slice(0, 8),
    recommendations,
    episodes: reports,
  };
}

export function saveProjectManagementReport(db: Database.Database, report: ProjectManagementReport): void {
  db.prepare(
    `INSERT INTO project_reports
      (session_id, generated_at, overall_score, input_quality_score, process_health_score, output_quality_score, confidence_score, team_composition_score, efficiency_score, prompt_issue_score, top_risks, data_quality_flags, recommendations, episodes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    report.session_id,
    report.generated_at,
    report.overall_score,
    report.input_quality_score,
    report.process_health_score,
    report.output_quality_score,
    report.confidence_score,
    report.team_composition_score,
    report.efficiency_score,
    report.prompt_issue_score,
    JSON.stringify(report.top_risks),
    JSON.stringify(report.data_quality_flags),
    JSON.stringify(report.recommendations),
    JSON.stringify(report.episodes)
  );
}

export function getLatestProjectManagementReport(db: Database.Database, sessionId: string): ProjectManagementReport {
  const row = db.prepare(
    `SELECT * FROM project_reports
     WHERE session_id = ?
     ORDER BY generated_at DESC
     LIMIT 1`
  ).get(sessionId) as Record<string, any> | undefined;

  if (!row) return buildProjectManagementReport(db, sessionId);

  return {
    session_id: row.session_id,
    generated_at: row.generated_at,
    overall_score: row.overall_score,
    input_quality_score: row.input_quality_score ?? 0,
    process_health_score: row.process_health_score ?? 0,
    output_quality_score: row.output_quality_score ?? 0,
    confidence_score: row.confidence_score ?? 0,
    team_composition_score: row.team_composition_score,
    efficiency_score: row.efficiency_score,
    prompt_issue_score: row.prompt_issue_score,
    top_risks: safeJsonParse(row.top_risks, []),
    data_quality_flags: safeJsonParse(row.data_quality_flags, []),
    recommendations: safeJsonParse(row.recommendations, []),
    episodes: safeJsonParse(row.episodes, []),
  };
}

function collectDetectedRoles(turns: TurnRow[]): string[] {
  const roles = new Set<string>();
  for (const turn of turns) {
    for (const role of safeJsonParse<string[]>(turn.detected_roles || '[]', [])) {
      roles.add(role);
    }
  }
  return Array.from(roles);
}

function assessEpisodeDataQuality(rawTurns: TurnRow[], turns: TurnRow[], inheritedFlags: string[]): string[] {
  const flags = new Set<string>(inheritedFlags.filter(Boolean));
  const duplicateCount = Math.max(0, rawTurns.length - turns.length);
  const anomalousDurationCount = turns.filter(
    turn => typeof turn.response_duration_ms === 'number' && turn.response_duration_ms > 120 * 60_000
  ).length;

  if (duplicateCount > 0) {
    flags.add(`发现 ${duplicateCount} 个重复 turn 记录`);
  }
  if (turns.length <= 1) {
    flags.add('episode 样本较少，单次指标波动较大');
  }
  if (anomalousDurationCount > 0) {
    flags.add(`发现 ${anomalousDurationCount} 个异常长耗时样本`);
  }

  return Array.from(flags).slice(0, 6);
}

function scoreDataConfidence(flags: string[]): number {
  let score = 1;

  for (const flag of flags) {
    if (/缺少可用响应耗时数据/.test(flag)) score -= 0.20;
    else if (/异常长耗时/.test(flag)) score -= 0.14;
    else if (/重复 turn/.test(flag)) score -= 0.14;
    else if (/样本较少/.test(flag)) score -= 0.10;
    else score -= 0.08;
  }

  return round(Math.max(0.3, score));
}

function deriveTopRisks(reports: ProjectEpisodeReport[]): string[] {
  const risks: string[] = [];
  for (const report of reports) {
    risks.push(...report.team.issues);
    risks.push(...report.efficiency.bottlenecks);
    risks.push(...report.prompt.issues.map(issue => issue.issue));
    if (report.output_quality_score < 0.6) risks.push('交付结果质量偏弱，输出与结论闭环不足');
    if (report.confidence_score < 0.7) risks.push(...report.data_quality_flags);
  }
  return topFrequent(risks, 10);
}

function deriveRecommendations(reports: ProjectEpisodeReport[], sessionFlags: string[]): string[] {
  const recommendations: string[] = [];
  for (const report of reports) {
    recommendations.push(...report.team.recommendations);
    recommendations.push(...report.efficiency.recommendations);
    recommendations.push(...report.prompt.issues.map(issue => issue.suggestion));
    if (report.output_quality_score < 0.7) {
      recommendations.push('在交付结尾增加结果总结、验证证据和明确的 go/no-go 结论');
    }
  }

  for (const flag of sessionFlags) {
    if (/重复 turn/.test(flag)) recommendations.push('修正 turn 采集去重逻辑，避免重复样本放大轮次和耗时');
    if (/异常长耗时/.test(flag)) recommendations.push('将 Stop/恢复类耗时与真实响应耗时分离，避免污染效率指标');
    if (/缺少可用响应耗时数据/.test(flag)) recommendations.push('补齐响应耗时采集，避免效率分长期失真');
  }

  return topFrequent(recommendations, 10);
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

function avg(values: number[], fallback = 0): number {
  if (values.length === 0) return fallback;
  return round(values.reduce((a, b) => a + b, 0) / values.length);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
