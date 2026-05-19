// DORA metrics and business signal evaluation
import Database from 'better-sqlite3';

export interface DoraMetrics {
  deploy_count: number;
  lead_time_hours: number;
  failure_rate: number;
  recovery_time_hours: number;
}

export interface BusinessSignal {
  signal_type: string;
  signal_value: number;
  signal_unit: string;
  captured_at: number;
  notes?: string;
}

export interface BusinessMetricsEvaluation {
  dora: DoraMetrics;
  business_signals: BusinessSignal[];
  score: number; // 0-100 composite
}

/**
 * Calculate DORA metrics from deploy events in the database.
 */
export function calculateDoraMetrics(db: Database.Database, projectPath: string, days = 30): DoraMetrics {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const deploys = db.prepare(
    `SELECT deploy_at, commit_hash, commit_message
     FROM deploy_events
     WHERE project_path = ? AND deploy_at >= ?
     ORDER BY deploy_at`
  ).all(projectPath, since) as Array<{
    deploy_at: number;
    commit_hash: string;
    commit_message: string;
  }>;

  const deployCount = deploys.length;

  // Lead time: average hours between commits
  let totalLeadTime = 0;
  let leadTimeSamples = 0;
  for (let i = 1; i < deploys.length; i++) {
    const diff = (deploys[i].deploy_at - deploys[i - 1].deploy_at) / (1000 * 60 * 60);
    totalLeadTime += diff;
    leadTimeSamples++;
  }
  const avgLeadTime = leadTimeSamples > 0 ? Math.round((totalLeadTime / leadTimeSamples) * 100) / 100 : 0;

  // Failure rate: placeholder (would need incident tracking)
  // Phase 1: assume 0% as we don't track incidents yet
  const failureRate = 0;

  // Recovery time: placeholder
  const recoveryTimeHours = 0;

  return {
    deploy_count: deployCount,
    lead_time_hours: avgLeadTime,
    failure_rate: failureRate,
    recovery_time_hours: recoveryTimeHours,
  };
}

/**
 * Evaluate business signals from the database.
 */
export function evaluateBusinessSignals(db: Database.Database, projectPath: string): BusinessSignal[] {
  const signals = db.prepare(
    `SELECT signal_type, signal_value, signal_unit, captured_at, notes
     FROM business_signals
     WHERE project_path = ?
     ORDER BY captured_at DESC`
  ).all(projectPath) as BusinessSignal[];

  return signals;
}

/**
 * Generate a composite business metrics evaluation.
 */
export function evaluateBusinessMetrics(db: Database.Database, projectPath: string, days = 30): BusinessMetricsEvaluation {
  const dora = calculateDoraMetrics(db, projectPath, days);
  const signals = evaluateBusinessSignals(db, projectPath);

  // Composite score: based on deploy frequency and lead time
  let score = 50; // baseline

  // Deploy frequency bonus
  if (dora.deploy_count >= 10) score += 20;
  else if (dora.deploy_count >= 5) score += 15;
  else if (dora.deploy_count >= 1) score += 10;

  // Lead time bonus (shorter is better)
  if (dora.lead_time_hours > 0 && dora.lead_time_hours <= 24) score += 20;
  else if (dora.lead_time_hours > 0 && dora.lead_time_hours <= 72) score += 10;

  // Business signals bonus
  if (signals.length > 0) score += 10;

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));

  return {
    dora,
    business_signals: signals,
    score,
  };
}
