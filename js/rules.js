// 熟练度状态机与计划队列生成：纯函数，不碰存储，便于手算核对
export const DISCARDED = -1;
export const MASTERED = 100;
export const MAX_LEVEL = 10;
export const FAMILIAR_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

export function isDue(mastery) {
  return mastery >= 0 && mastery <= MAX_LEVEL;
}

export function applyAction(mastery, action, createdAt, now = Date.now()) {
  switch (action) {
    case 'know': {
      // 熟练知识再按"会"只推进，不降级；否则 +1 后封顶 10 会把它打回不熟练
      if (mastery >= MASTERED) return MASTERED;
      const next = Math.min(mastery + 1, MAX_LEVEL);
      if (next >= MAX_LEVEL && now - createdAt >= FAMILIAR_AFTER_MS) return MASTERED;
      return next;
    }
    case 'unknown':
      return Math.max(mastery - 1, 0);
    case 'discard':
      return DISCARDED;
    case 'master':
      return MASTERED;
    case 'relearn':
      return 5;
    default:
      throw new Error('未知操作: ' + action);
  }
}

export function matchRange(knowledge, ranges) {
  const { discarded = false, due = false, mastered = false } = ranges || {};
  if (knowledge.mastery === DISCARDED) return discarded;
  if (knowledge.mastery === MASTERED) return mastered;
  return due;
}

export function shuffle(items, random = Math.random) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 新知识只落在"当前进度之后"的剩余区段里，已复习过的部分不受影响
export function insertIndex(progress, length, random = Math.random) {
  const start = Math.max(0, Math.min(progress, length));
  return start + Math.floor(random() * (length - start + 1));
}

export function planQueue(knowledgeList, ranges, random = Math.random) {
  const ids = knowledgeList.filter(k => matchRange(k, ranges)).map(k => k.id);
  return shuffle(ids, random);
}

export function masteryLabel(mastery) {
  if (mastery === DISCARDED) return { text: '废弃', tone: 'discard' };
  if (mastery === MASTERED) return { text: '熟练', tone: 'mastered' };
  return { text: '熟练度 ' + mastery, tone: 'due' };
}
