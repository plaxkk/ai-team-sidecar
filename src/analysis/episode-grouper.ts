// Group turns into task episodes
import Database from 'better-sqlite3';

export interface Episode {
  start_turn: number;
  end_turn: number;
  episode_type: string;
  user_requirement: string;
}

interface TurnRow {
  id: number;
  turn_number: number;
  user_prompt: string;
  assistant_response: string;
}

function turnCompletenessScore(turn: Partial<TurnRow> & { response_duration_ms?: number | null }): number {
  return [
    turn.user_prompt?.trim() ? 1 : 0,
    turn.assistant_response?.trim() ? 1 : 0,
    typeof turn.response_duration_ms === 'number' ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0);
}

// Signals that indicate a new episode
const NEW_EPISODE_SIGNALS = [
  /(?:add|create|implement|build|fix|refactor|update)\s+(?:a\s+|the\s+)?/i,
  /(?:can you|please|I want|I need|let's|we should)/i,
  /(?:新增|添加|实现|构建|修复|重构|更新|优化|调整|设计|部署|上线)/,
];

// Signals that indicate continuation
const CONTINUATION_SIGNALS = [
  /^(?:继续|好的|执行|ok|yes|go ahead|proceed|sure|done|完成)/i,
  /^(?:looks good|LGTM|ship it|merge)/i,
  /^(?:继续|可以|没问题)/i,
];

export function groupEpisodes(turns: TurnRow[]): Episode[] {
  if (turns.length === 0) return [];

  const episodes: Episode[] = [];
  let currentEpisode: Episode | null = null;

  for (const turn of turns) {
    const prompt = (turn.user_prompt || '').trim();
    const isContinuation = CONTINUATION_SIGNALS.some(p => p.test(prompt));
    const isNewTopic = NEW_EPISODE_SIGNALS.some(p => p.test(prompt)) && !isContinuation;

    if (!currentEpisode || (prompt.length > 20 && isNewTopic)) {
      if (currentEpisode) {
        currentEpisode.end_turn = turn.turn_number - 1;
        episodes.push(currentEpisode);
      }
      currentEpisode = {
        start_turn: turn.turn_number,
        end_turn: turn.turn_number,
        episode_type: detectEpisodeType(prompt),
        user_requirement: prompt.slice(0, 200),
      };
    } else {
      currentEpisode.end_turn = turn.turn_number;
    }
  }

  if (currentEpisode) {
    episodes.push(currentEpisode);
  }

  return episodes;
}

function detectEpisodeType(prompt: string): string {
  if (/^(?:继续|好的|执行|ok|yes|go ahead|proceed|sure|done|完成|可以|没问题)/i.test(prompt)) return 'continuation';
  if (/错误|报错|异常|修复|问题|故障|fix|bug|error|issue|broken|debug/i.test(prompt)) return 'bugfix';
  if (/部署|上线|发版|发布到|deploy|release|ship/i.test(prompt)) return 'deploy';
  if (/新增|添加|实现|创建|构建|功能|add|create|implement|build|new feature/i.test(prompt)) return 'feature';
  if (/重构|整理|清理|refactor|clean|restructure|move/i.test(prompt)) return 'refactor';
  if (/测试|用例|覆盖率|test|spec|coverage/i.test(prompt)) return 'testing';
  return 'task';
}

export function getTurnsForSession(db: Database.Database, sessionId: string): TurnRow[] {
  const rows = db.prepare(
    'SELECT id, turn_number, user_prompt, assistant_response FROM turns WHERE session_id = ? ORDER BY turn_number'
  ).all(sessionId) as TurnRow[];

  return normalizeTurns(rows);
}

export function normalizeTurns<T extends { turn_number: number; id?: number; user_prompt?: string; assistant_response?: string; response_duration_ms?: number | null }>(
  turns: T[]
): T[] {
  const byTurn = new Map<number, T>();

  for (const turn of turns) {
    const existing = byTurn.get(turn.turn_number);
    if (!existing) {
      byTurn.set(turn.turn_number, turn);
      continue;
    }

    const existingScore = turnCompletenessScore(existing);
    const nextScore = turnCompletenessScore(turn);
    const existingId = existing.id ?? Number.MIN_SAFE_INTEGER;
    const nextId = turn.id ?? Number.MIN_SAFE_INTEGER;

    if (nextScore > existingScore || (nextScore === existingScore && nextId >= existingId)) {
      byTurn.set(turn.turn_number, turn);
    }
  }

  return Array.from(byTurn.values()).sort((a, b) => a.turn_number - b.turn_number);
}
