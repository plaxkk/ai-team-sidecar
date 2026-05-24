// Analysis orchestrator - triggered periodically by collector daemon
import Database from 'better-sqlite3';
import { detectRoles } from './role-detector.js';
import { trackFlow } from './flow-tracker.js';
import { groupEpisodes, getTurnsForSession } from './episode-grouper.js';
import { analyzeRequirement } from './requirement-analyzer.js';
import { calculateMetrics } from './metrics.js';
import { evaluateAllRoles } from './role-evaluator.js';
import { evaluateCreativeReview } from './creative-review.js';
import { evaluatePrompt } from './prompt-evaluator.js';
import { evaluateDelivery } from './delivery-evaluator.js';
import { generateCeoReport } from './ceo-report.js';
import { buildProjectManagementReport, saveProjectManagementReport } from './project-report.js';
import { detectAndCreateCheckpoints } from './checkpoint-detector.js';

export async function runAnalysis(db: Database.Database, sessionId: string) {
  const turns = getTurnsForSession(db, sessionId);
  if (turns.length === 0) return;

  // 1. Detect roles and update turns
  const updateTurnRoles = db.prepare(
    `UPDATE turns SET detected_roles = ?, has_product_step = ?, has_engineer_step = ?, has_qa_step = ?, has_techlead_step = ?
     WHERE id = ?`
  );

  for (const turn of turns) {
    const response = turn.assistant_response || '';
    if (!response) continue;

    const detection = detectRoles(response);
    updateTurnRoles.run(
      JSON.stringify(detection.roles),
      detection.has_product ? 1 : 0,
      detection.has_engineer ? 1 : 0,
      detection.has_qa ? 1 : 0,
      detection.has_techlead ? 1 : 0,
      turn.id
    );
  }

  // 2. Group into episodes
  const episodes = groupEpisodes(turns);

  // 3. Analyze each episode
  const findEpisode = db.prepare(
    `SELECT id FROM episodes
     WHERE session_id = ? AND start_turn = ? AND end_turn = ?
     ORDER BY id
     LIMIT 1`
  );
  const insertEpisode = db.prepare(`
    INSERT INTO episodes (session_id, start_turn, end_turn, episode_type, user_requirement, flow_score, handoff_score, req_score, overall_score, violations, prompt_score, delivery_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateEpisode = db.prepare(`
    UPDATE episodes
    SET episode_type = ?,
        user_requirement = ?,
        flow_score = ?,
        handoff_score = ?,
        req_score = ?,
        overall_score = ?,
        violations = ?,
        prompt_score = ?,
        delivery_score = ?
    WHERE id = ?
  `);

  // Refresh derived analysis rows while preserving episode ids used by checkpoints.
  db.prepare('DELETE FROM project_reports WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM role_evaluations WHERE session_id = ?').run(sessionId);

  // Accumulate prompt/delivery data for CEO report
  let totalPromptScore = 0;
  let totalDeliveryScore = 0;
  const allPromptDeficiencies: string[] = [];
  const promptDetailsAcc: Record<string, number[]> = {};
  const deliveryDetailsAcc: Record<string, number[]> = {};
  const promptExplainabilityAcc: any[] = [];
  const deliveryExplainabilityAcc: any[] = [];

  for (const episode of episodes) {
    // Gather all responses in this episode
    const episodeTurns = turns.filter(
      t => t.turn_number >= episode.start_turn && t.turn_number <= episode.end_turn
    );

    // Aggregate response for role detection
    const fullResponse = episodeTurns.map(t => t.assistant_response || '').join('\n\n');
    const firstPrompt = episodeTurns[0]?.user_prompt || '';

    // Role detection on aggregated response
    const detection = detectRoles(fullResponse);

    // Flow tracking
    const flowResult = trackFlow(detection, fullResponse);

    // Requirement analysis
    const reqResult = analyzeRequirement(firstPrompt, fullResponse);

    // Composite metrics
    const metrics = calculateMetrics(flowResult.flow_score, flowResult.handoff_score, reqResult.req_score);

    // Prompt + delivery quality evaluation
    const promptEval = evaluatePrompt(firstPrompt);
    const deliveryEval = evaluateDelivery(firstPrompt, fullResponse);
    promptExplainabilityAcc.push(promptEval.explainability);
    deliveryExplainabilityAcc.push(deliveryEval.explainability);

    totalPromptScore += promptEval.score;
    totalDeliveryScore += deliveryEval.score;
    allPromptDeficiencies.push(...promptEval.deficiencies);
    for (const [k, v] of Object.entries(promptEval.details)) {
      if (!promptDetailsAcc[k]) promptDetailsAcc[k] = [];
      promptDetailsAcc[k].push(v);
    }
    for (const [k, v] of Object.entries(deliveryEval.details)) {
      if (!deliveryDetailsAcc[k]) deliveryDetailsAcc[k] = [];
      deliveryDetailsAcc[k].push(v);
    }

    const existingEpisode = findEpisode.get(
      sessionId,
      episode.start_turn,
      episode.end_turn
    ) as { id: number } | undefined;
    const episodeId = existingEpisode
      ? Number(existingEpisode.id)
      : Number(insertEpisode.run(
          sessionId,
          episode.start_turn,
          episode.end_turn,
          episode.episode_type,
          episode.user_requirement,
          metrics.flow_score,
          metrics.handoff_score,
          metrics.req_score,
          metrics.overall_score,
          JSON.stringify(flowResult.violations),
          promptEval.score,
          deliveryEval.score
        ).lastInsertRowid);

    if (existingEpisode) {
      updateEpisode.run(
        episode.episode_type,
        episode.user_requirement,
        metrics.flow_score,
        metrics.handoff_score,
        metrics.req_score,
        metrics.overall_score,
        JSON.stringify(flowResult.violations),
        promptEval.score,
        deliveryEval.score,
        episodeId
      );
    }

    // 4. Role evaluations for this episode
    const roleEvals = evaluateAllRoles(firstPrompt, fullResponse);
    const insertRoleEval = db.prepare(
      'INSERT INTO role_evaluations (session_id, episode_id, role, score, details, deficiencies) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const ev of roleEvals) {
      insertRoleEval.run(
        sessionId,
        episodeId,
        ev.role,
        ev.score,
        JSON.stringify(ev.details),
        JSON.stringify(ev.deficiencies)
      );
    }

    // 4b. Creative Review evaluation (additional)
    const crEval = evaluateCreativeReview(firstPrompt, fullResponse);
    insertRoleEval.run(
      sessionId,
      episodeId,
      'creative_review',
      crEval.score,
      JSON.stringify({
        has_multiple_proposals: crEval.has_multiple_proposals,
        has_counter_opinion: crEval.has_counter_opinion,
        has_user_evidence: crEval.has_user_evidence,
        feasibility_score: crEval.feasibility_score,
        commercial_score: crEval.commercial_score,
      }),
      JSON.stringify(crEval.deficiencies)
    );
  }

  // 5. Generate CEO report
  const allRoleEvals = db.prepare(
    'SELECT role, score, deficiencies FROM role_evaluations WHERE session_id = ?'
  ).all(sessionId) as Array<{ role: string; score: number; deficiencies: string }>;

  if (allRoleEvals.length > 0) {
    const episodeCount = episodes.length || 1;
    const previousCeo = db.prepare(
      'SELECT team_health FROM ceo_reports WHERE session_id = ? ORDER BY generated_at DESC LIMIT 1'
    ).get(sessionId) as { team_health: number } | undefined;
    const ceoReport = generateCeoReport(
      allRoleEvals.map(r => ({
        role: r.role as any,
        score: r.score,
        details: {},
        deficiencies: safeJsonParse(r.deficiencies, []),
      })),
      {
        promptQuality: totalPromptScore / episodeCount,
        deliveryQuality: totalDeliveryScore / episodeCount,
        promptDeficiencies: allPromptDeficiencies,
        promptDetails: avgMap(promptDetailsAcc),
        deliveryDetails: avgMap(deliveryDetailsAcc),
        promptExplainability: aggregateExplainability(promptExplainabilityAcc),
        deliveryExplainability: aggregateExplainability(deliveryExplainabilityAcc),
        previousTeamHealth: previousCeo?.team_health ?? null,
      }
    );

    db.prepare(
      `INSERT INTO ceo_reports (session_id, generated_at, team_health, role_scores, top_issues, weakest_role, trend, prompt_quality, delivery_quality, user_suggestions, prompt_details, delivery_details, prompt_explainability, delivery_explainability)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      Date.now(),
      ceoReport.team_health,
      JSON.stringify(ceoReport.role_scores),
      JSON.stringify(ceoReport.top_issues),
      ceoReport.weakest_role,
      ceoReport.trend,
      ceoReport.prompt_quality,
      ceoReport.delivery_quality,
      JSON.stringify(ceoReport.user_suggestions),
      JSON.stringify(ceoReport.prompt_details),
      JSON.stringify(ceoReport.delivery_details),
      JSON.stringify(ceoReport.prompt_explainability || {}),
      JSON.stringify(ceoReport.delivery_explainability || {})
    );
  }

  const projectReport = buildProjectManagementReport(db, sessionId);
  saveProjectManagementReport(db, projectReport);

  // 6. Checkpoint detection
  detectAndCreateCheckpoints(db, sessionId);

  console.log(`[analysis] Analyzed session ${sessionId}: ${turns.length} turns, ${episodes.length} episodes`);
}

function aggregateExplainability(entries: any[]): Record<string, any> {
  const usable = entries.filter(Boolean);
  if (usable.length === 0) return {};
  const dimensionAcc: Record<string, any> = {};

  for (const entry of usable) {
    for (const [name, dim] of Object.entries(entry.dimensions || {}) as Array<[string, any]>) {
      if (!dimensionAcc[name]) {
        dimensionAcc[name] = {
          score_total: 0,
          count: 0,
          weight: dim.weight,
          signals: new Map<string, number>(),
          missing: new Map<string, number>(),
          rationale: dim.rationale,
          recommendation: dim.recommendation,
        };
      }
      const acc = dimensionAcc[name];
      acc.score_total += Number(dim.score || 0);
      acc.count += 1;
      for (const signal of dim.signals || []) acc.signals.set(signal, (acc.signals.get(signal) || 0) + 1);
      for (const missing of dim.missing || []) acc.missing.set(missing, (acc.missing.get(missing) || 0) + 1);
    }
  }

  return {
    formula: usable[0].formula,
    confidence: round(usable.reduce((sum, entry) => sum + Number(entry.confidence || 0), 0) / usable.length),
    qualitative_summary: summarizeAggregateExplainability(usable),
    dimensions: Object.fromEntries(Object.entries(dimensionAcc).map(([name, acc]: [string, any]) => [
      name,
      {
        score: round(acc.score_total / Math.max(1, acc.count)),
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

function summarizeAggregateExplainability(entries: any[]): string {
  const avgConfidence = entries.reduce((sum, entry) => sum + Number(entry.confidence || 0), 0) / entries.length;
  if (avgConfidence >= 0.8) return '样本证据较充分，定量评分可信度较高，可直接用于管理判断。';
  if (avgConfidence >= 0.6) return '样本证据基本可用，建议结合缺失项做定性复核。';
  return '样本证据不足，当前评分更适合作为诊断线索，不适合作为强结论。';
}

function avgMap(acc: Record<string, number[]>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [k, arr] of Object.entries(acc)) {
    result[k] = Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
  }
  return result;
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
