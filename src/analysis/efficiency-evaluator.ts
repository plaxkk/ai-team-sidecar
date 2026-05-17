import { ProjectTaskType } from './team-model.js';

export interface EfficiencyInputTurn {
  turn_number: number;
  user_prompt: string;
  assistant_response: string;
  response_duration_ms?: number | null;
}

export interface ToolCallSummary {
  total: number;
  by_tool: Record<string, number>;
}

export interface EfficiencyEvaluation {
  score: number;
  details: Record<string, number>;
  bottlenecks: string[];
  recommendations: string[];
  data_quality: string[];
}

export function evaluateEfficiency(
  taskType: ProjectTaskType,
  turns: EfficiencyInputTurn[],
  tools: ToolCallSummary
): EfficiencyEvaluation {
  const details: Record<string, number> = {};
  const bottlenecks: string[] = [];
  const recommendations: string[] = [];
  const dataQuality: string[] = [];

  const durations = turns
    .map(t => t.response_duration_ms)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  const nonAnomalousDurations = durations.filter(v => v <= 120 * 60_000);
  const durationsForScoring = nonAnomalousDurations.length >= Math.max(2, Math.ceil(durations.length / 2))
    ? nonAnomalousDurations
    : durations;

  let durationScore = 0.7;
  if (durationsForScoring.length === 0) {
    dataQuality.push('缺少可用响应耗时数据');
  } else {
    const avg = durationsForScoring.reduce((a, b) => a + b, 0) / durationsForScoring.length;
    const minutes = avg / 60_000;
    if (minutes <= 8) durationScore = 1;
    else if (minutes <= 25) durationScore = 0.7;
    else {
      durationScore = 0.35;
      bottlenecks.push(`平均响应耗时偏长（约 ${Math.round(minutes)} 分钟）`);
      recommendations.push('拆小任务或在长耗时任务中增加阶段性状态更新');
    }
    if (durations.length !== durationsForScoring.length) {
      dataQuality.push('已忽略异常长耗时样本（超过 120 分钟）');
    } else if (minutes > 120) {
      dataQuality.push('存在异常长耗时，可能来自历史导入或跨会话 Stop 事件');
    }
  }
  details['响应效率'] = round(durationScore);

  const expectedTurns = taskType === 'continuation' ? 1 : taskType === 'deploy' ? 2 : 3;
  const turnScore = turns.length <= expectedTurns ? 1 : Math.max(0.25, 1 - (turns.length - expectedTurns) * 0.18);
  details['轮次收敛'] = round(turnScore);
  if (turnScore < 0.7) {
    bottlenecks.push(`episode 轮次较多（${turns.length} 轮）`);
    recommendations.push('把需求拆成更小的验收单元，减少往返确认');
  }

  const toolScore = scoreToolUsage(tools.total, taskType);
  details['工具效率'] = toolScore;
  if (toolScore < 0.7) {
    bottlenecks.push(`工具调用较多（${tools.total} 次）`);
    recommendations.push('优先批量读取相关文件，减少重复探索和无效验证');
  }

  const combinedText = turns.map(t => `${t.user_prompt}\n${t.assistant_response}`).join('\n');
  const reworkSignals = (combinedText.match(/重新|不对|不是|遗漏|再改|返工|错了|修正|redo|wrong|missing/gi) || []).length;
  const reworkScore = reworkSignals === 0 ? 1 : Math.max(0.2, 1 - reworkSignals * 0.2);
  details['返工控制'] = round(reworkScore);
  if (reworkSignals > 0) {
    bottlenecks.push(`发现 ${reworkSignals} 个返工/纠偏信号`);
    recommendations.push('在 Product 阶段补齐验收标准和约束，减少实现后纠偏');
  }

  const verificationScore = /测试|验证|检查|build|tsc|npm|部署|验收|verify|test|check/i.test(combinedText) ? 1 : 0.35;
  details['验证闭环'] = verificationScore;
  if (verificationScore < 0.7) {
    bottlenecks.push('缺少明确验证闭环');
    recommendations.push('每个交付 episode 结束时记录验证命令或验收结果');
  }

  const score = round(
    0.25 * details['响应效率'] +
    0.20 * details['轮次收敛'] +
    0.20 * details['工具效率'] +
    0.20 * details['返工控制'] +
    0.15 * details['验证闭环']
  );

  return {
    score,
    details,
    bottlenecks: [...new Set(bottlenecks)].slice(0, 8),
    recommendations: [...new Set(recommendations)].slice(0, 8),
    data_quality: dataQuality,
  };
}

function scoreToolUsage(total: number, taskType: ProjectTaskType): number {
  const expected = taskType === 'continuation' ? 0 : taskType === 'planning' || taskType === 'operation' ? 3 : 12;
  if (total <= expected) return 1;
  if (total <= expected * 2) return 0.75;
  if (total <= expected * 4) return 0.45;
  return 0.2;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
