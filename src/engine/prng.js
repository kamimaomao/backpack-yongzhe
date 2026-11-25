// 《勇者塞满包 · 背包合成乱斗》确定性 Mulberry32 伪随机数生成器
// 用于商店刷新、战斗暴击/闪避判定及 200 局无头 AI 平衡性压测

/**
 * 创建确定性伪随机数生成器实例（Mulberry32）
 * @param {number} [seed=Date.now()]
 */
export function createRng(seed = Date.now()) {
  let state = (Number(seed) >>> 0) || 0x6d2b79f5;

  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(min, maxInclusive) {
    const lo = Math.ceil(min);
    const hi = Math.floor(maxInclusive);
    if (hi <= lo) return lo;
    return lo + Math.floor(next() * (hi - lo + 1));
  }

  function pick(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr[Math.floor(next() * arr.length)];
  }

  function weightedPick(items, weightFn = (it) => (it && typeof it.shopWeight === 'number' ? it.shopWeight : 1)) {
    if (!Array.isArray(items) || items.length === 0) return null;
    let total = 0;
    const weights = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
      const w = Number(weightFn(items[i], i)) || 0;
      weights[i] = w > 0 ? w : 0;
      total += weights[i];
    }
    if (total <= 0) return null;
    let roll = next() * total;
    for (let i = 0; i < items.length; i++) {
      if (weights[i] > 0) {
        if (roll < weights[i]) return items[i];
        roll -= weights[i];
      }
    }
    for (let i = items.length - 1; i >= 0; i--) {
      if (weights[i] > 0) return items[i];
    }
    return null;
  }

  function shuffle(arr) {
    if (!Array.isArray(arr)) return [];
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function chance(prob0to1) {
    const p = Number(prob0to1) || 0;
    if (p <= 0) return false;
    if (p >= 1) return true;
    return next() < p;
  }

  return {
    next,
    int,
    pick,
    weightedPick,
    shuffle,
    chance,
    getState: () => state >>> 0,
  };
}
