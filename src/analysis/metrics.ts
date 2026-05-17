// Calculate composite metrics
export interface CompositeMetrics {
  overall_score: number;
  flow_score: number;
  handoff_score: number;
  req_score: number;
}

export function calculateMetrics(
  flow_score: number,
  handoff_score: number,
  req_score: number
): CompositeMetrics {
  const overall_score =
    0.35 * flow_score +
    0.35 * handoff_score +
    0.30 * req_score;

  return {
    overall_score: Math.round(overall_score * 100) / 100,
    flow_score: Math.round(flow_score * 100) / 100,
    handoff_score: Math.round(handoff_score * 100) / 100,
    req_score: Math.round(req_score * 100) / 100,
  };
}

export interface SessionMetrics {
  session_id: string;
  total_episodes: number;
  avg_flow_score: number;
  avg_handoff_score: number;
  avg_req_score: number;
  avg_overall_score: number;
  total_violations: number;
}

export function aggregateSessionMetrics(
  episodes: Array<{ flow_score: number; handoff_score: number; req_score: number; overall_score: number; violations: string }>
): Omit<SessionMetrics, 'session_id'> {
  if (episodes.length === 0) {
    return {
      total_episodes: 0,
      avg_flow_score: 0,
      avg_handoff_score: 0,
      avg_req_score: 0,
      avg_overall_score: 0,
      total_violations: 0,
    };
  }

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const n = episodes.length;

  return {
    total_episodes: n,
    avg_flow_score: Math.round((sum(episodes.map(e => e.flow_score)) / n) * 100) / 100,
    avg_handoff_score: Math.round((sum(episodes.map(e => e.handoff_score)) / n) * 100) / 100,
    avg_req_score: Math.round((sum(episodes.map(e => e.req_score)) / n) * 100) / 100,
    avg_overall_score: Math.round((sum(episodes.map(e => e.overall_score)) / n) * 100) / 100,
    total_violations: episodes.reduce((acc, e) => {
      try {
        return acc + JSON.parse(e.violations || '[]').length;
      } catch {
        return acc;
      }
    }, 0),
  };
}
