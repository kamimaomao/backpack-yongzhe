// 《勇者塞满包 · 背包合成乱斗》7×5 异形网格几何、旋转、扩建、双层合成与邻接光环计算引擎

import {
  GRID_COLS,
  GRID_ROWS,
  ITEMS,
  SHAPE_PRESETS,
  findMythicRecipe,
  getItemById,
} from './catalog.js';

export const MIN_ITEM_CD = 0.45;

function normalizeZero(n) {
  return n === 0 ? 0 : n;
}

function normalizeRot(rot = 0) {
  const r = Number.isFinite(rot) ? Math.trunc(rot) : 0;
  return ((r % 4) + 4) % 4;
}

function resolveItemDef(itemIdOrDef) {
  if (!itemIdOrDef) return null;
  if (typeof itemIdOrDef === 'string') {
    return getItemById(itemIdOrDef) || ITEMS?.[itemIdOrDef] || null;
  }
  if (typeof itemIdOrDef === 'object') {
    return itemIdOrDef;
  }
  return null;
}

/**
 * 创建初始 5×7 背包状态（正中心 r:1..3, c:1..5 共 15 格默认解锁）
 * @param {Array<[number, number]>} [extraUnlockedCells=[]]
 */
export function createInitialBag(extraUnlockedCells = []) {
  const rows = GRID_ROWS || 5;
  const cols = GRID_COLS || 7;
  const unlocked = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (__, c) => r >= 1 && r <= 3 && c >= 1 && c <= 5),
  );

  if (Array.isArray(extraUnlockedCells)) {
    for (const cell of extraUnlockedCells) {
      if (!Array.isArray(cell) || cell.length < 2) continue;
      const [r, c] = cell;
      if (r >= 0 && r < rows && c >= 0 && c < cols) {
        unlocked[r][c] = true;
      }
    }
  }

  return {
    rows,
    cols,
    unlocked,
    items: [],
    nextUid: 1,
  };
}

/**
 * 深拷贝背包状态
 */
export function cloneBag(bag) {
  return {
    rows: bag.rows,
    cols: bag.cols,
    unlocked: bag.unlocked.map((row) => row.slice()),
    items: bag.items.map((it) => ({ ...it })),
    nextUid: bag.nextUid,
  };
}

/**
 * 标准 90° 顺时针旋转归一化算法
 * @param {Array<[number, number]>} baseCells
 * @param {number} [rot=0]
 * @returns {{ cells: Array<[number, number]>, width: number, height: number }}
 */
export function rotateCells(baseCells, rot = 0) {
  const source = Array.isArray(baseCells) && baseCells.length > 0 ? baseCells : [[0, 0]];
  const steps = normalizeRot(rot);

  let pts = source.map(([r, c]) => [normalizeZero(r), normalizeZero(c)]);
  for (let s = 0; s < steps; s++) {
    pts = pts.map(([r, c]) => [normalizeZero(c), normalizeZero(-r)]);
  }

  let minR = Infinity;
  let minC = Infinity;
  for (const [r, c] of pts) {
    if (r < minR) minR = r;
    if (c < minC) minC = c;
  }

  const normalized = pts
    .map(([r, c]) => [normalizeZero(r - minR), normalizeZero(c - minC)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  let maxR = 0;
  let maxC = 0;
  for (const [r, c] of normalized) {
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }

  return {
    cells: normalized,
    width: maxC + 1,
    height: maxR + 1,
  };
}

const FOOTPRINT_CACHE = new Map();

/**
 * 获取某物品在指定旋转步数下的局部相对格与包围盒宽高（带预设形状高速缓存）
 * @param {string | object} itemIdOrDef
 * @param {number} [rot=0]
 */
export function getItemFootprint(itemIdOrDef, rot = 0) {
  const normRot = normalizeRot(rot);
  const def = resolveItemDef(itemIdOrDef);

  if (def && Array.isArray(def.shape)) {
    return rotateCells(def.shape, normRot);
  }

  const shapeKey =
    def?.shape ||
    (typeof itemIdOrDef === 'string' && SHAPE_PRESETS?.[itemIdOrDef] ? itemIdOrDef : '1x1');

  const cacheKey = `${shapeKey}:${normRot}`;
  let cached = FOOTPRINT_CACHE.get(cacheKey);
  if (!cached) {
    const baseCells = SHAPE_PRESETS?.[shapeKey] || [[0, 0]];
    cached = rotateCells(baseCells, normRot);
    FOOTPRINT_CACHE.set(cacheKey, cached);
  }

  return {
    cells: cached.cells.map(([r, c]) => [r, c]),
    width: cached.width,
    height: cached.height,
  };
}

function getCachedFootprintCells(itemIdOrDef, rot = 0) {
  const normRot = normalizeRot(rot);
  const def = resolveItemDef(itemIdOrDef);
  if (def && Array.isArray(def.shape)) {
    return rotateCells(def.shape, normRot).cells;
  }
  const shapeKey =
    def?.shape ||
    (typeof itemIdOrDef === 'string' && SHAPE_PRESETS?.[itemIdOrDef] ? itemIdOrDef : '1x1');
  const cacheKey = `${shapeKey}:${normRot}`;
  let cached = FOOTPRINT_CACHE.get(cacheKey);
  if (!cached) {
    const baseCells = SHAPE_PRESETS?.[shapeKey] || [[0, 0]];
    cached = rotateCells(baseCells, normRot);
    FOOTPRINT_CACHE.set(cacheKey, cached);
  }
  return cached.cells;
}

/**
 * 返回物品锚点置于 (row, col) 时的绝对网格占用坐标列表
 * @param {string | object} itemIdOrDef
 * @param {number} row
 * @param {number} col
 * @param {number} [rot=0]
 * @returns {Array<[number, number]>}
 */
export function getOccupiedCells(itemIdOrDef, row, col, rot = 0) {
  const cells = getCachedFootprintCells(itemIdOrDef, rot);
  return cells.map(([dr, dc]) => [normalizeZero(row + dr), normalizeZero(col + dc)]);
}

/**
 * 查找占据指定单格 (row, col) 的背包物品实例
 */
export function getItemAtCell(bag, row, col) {
  if (!bag || !Array.isArray(bag.items)) return null;
  for (const it of bag.items) {
    const cells = getOccupiedCells(it.itemId, it.row, it.col, it.rot);
    for (const [r, c] of cells) {
      if (r === row && c === col) return it;
    }
  }
  return null;
}

/**
 * 校验在 (row, col, rot) 放置 itemId 是否合法
 * @param {object} bag
 * @param {string | object} itemId
 * @param {number} row
 * @param {number} col
 * @param {number} [rot=0]
 * @param {string | string[] | null} [ignoreUid=null]
 */
export function checkPlacement(bag, itemId, row, col, rot = 0, ignoreUid = null) {
  const cells = getOccupiedCells(itemId, row, col, rot);
  const rows = bag.rows;
  const cols = bag.cols;
  const singleIgnore = typeof ignoreUid === 'string' ? ignoreUid : null;
  const ignoreSet = Array.isArray(ignoreUid) ? new Set(ignoreUid) : null;

  // 使用整数格索引替代字符串拼接 Map，大幅加速高频碰撞检测
  const cellOwners = new Array(rows * cols);
  for (let i = 0; i < bag.items.length; i++) {
    const existing = bag.items[i];
    if (existing.uid === singleIgnore || (ignoreSet && ignoreSet.has(existing.uid))) continue;
    const relCells = getCachedFootprintCells(existing.itemId, existing.rot);
    for (let k = 0; k < relCells.length; k++) {
      const er = existing.row + relCells[k][0];
      const ec = existing.col + relCells[k][1];
      if (er >= 0 && er < rows && ec >= 0 && ec < cols) {
        cellOwners[er * cols + ec] = existing.uid;
      }
    }
  }

  let outOfBounds = false;
  let lockedCell = false;
  const overlappingUids = [];

  for (let i = 0; i < cells.length; i++) {
    const r = cells[i][0];
    const c = cells[i][1];
    if (r < 0 || r >= rows || c < 0 || c >= cols || !Number.isInteger(r) || !Number.isInteger(c)) {
      outOfBounds = true;
      continue;
    }
    if (!bag.unlocked[r]?.[c]) {
      lockedCell = true;
    }
    const ownerUid = cellOwners[r * cols + c];
    if (ownerUid && !overlappingUids.includes(ownerUid)) {
      overlappingUids.push(ownerUid);
    }
  }

  if (outOfBounds) {
    return {
      valid: false,
      reason: 'out_of_bounds',
      cells,
      overlappingUids,
    };
  }

  if (lockedCell) {
    return {
      valid: false,
      reason: 'locked_cell',
      cells,
      overlappingUids,
    };
  }

  if (overlappingUids.length > 0) {
    return {
      valid: false,
      reason: 'overlap',
      cells,
      overlappingUids,
    };
  }

  return {
    valid: true,
    cells,
    overlappingUids: [],
  };
}

/**
 * 返回所有与当前已解锁格正交相邻（上下左右）的待扩建格坐标 Array<[row, col]>
 */
export function getExpandableCells(bag) {
  const result = [];
  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  let anyUnlocked = false;
  for (let r = 0; r < bag.rows; r++) {
    for (let c = 0; c < bag.cols; c++) {
      if (bag.unlocked[r]?.[c]) {
        anyUnlocked = true;
        break;
      }
    }
    if (anyUnlocked) break;
  }

  if (!anyUnlocked) {
    return [[Math.floor(bag.rows / 2), Math.floor(bag.cols / 2)]];
  }

  for (let r = 0; r < bag.rows; r++) {
    for (let c = 0; c < bag.cols; c++) {
      if (bag.unlocked[r]?.[c]) continue;
      let adjacent = false;
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < bag.rows && nc >= 0 && nc < bag.cols && bag.unlocked[nr]?.[nc]) {
          adjacent = true;
          break;
        }
      }
      if (adjacent) {
        result.push([r, c]);
      }
    }
  }

  return result;
}

/**
 * 解锁单个正交相邻背包格
 */
export function unlockBagCell(bag, row, col) {
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= bag.rows || col < 0 || col >= bag.cols) {
    return { ok: false, reason: 'out_of_bounds' };
  }
  if (bag.unlocked[row][col]) {
    return { ok: false, reason: 'already_unlocked' };
  }

  const expandable = getExpandableCells(bag);
  const canExpand = expandable.some(([er, ec]) => er === row && ec === col);
  if (!canExpand) {
    return { ok: false, reason: 'not_adjacent' };
  }

  bag.unlocked[row][col] = true;
  return { ok: true, row, col };
}

/**
 * 判定两件物品是否可合成（优先同名同阶进化，其次跨物品★神话配方）
 * @returns {null | { kind: 'upgrade' | 'mythic', resultId: string, recipeId?: string }}
 */
export function checkMergeCompatibility(itemIdA, itemIdB) {
  if (!itemIdA || !itemIdB) return null;
  const defA = resolveItemDef(itemIdA);
  const defB = resolveItemDef(itemIdB);
  if (!defA || !defB) return null;

  if (itemIdA === itemIdB && defA.upgradesTo) {
    const nextDef = resolveItemDef(defA.upgradesTo);
    if (nextDef) {
      return {
        kind: 'upgrade',
        resultId: defA.upgradesTo,
      };
    }
  }

  const recipe = typeof findMythicRecipe === 'function' ? findMythicRecipe(itemIdA, itemIdB) : null;
  if (recipe && recipe.resultId) {
    return {
      kind: 'mythic',
      resultId: recipe.resultId,
      recipeId: recipe.id,
    };
  }

  return null;
}

function allocateUid(bag, forcedUid = null) {
  if (forcedUid) {
    const match = /^itm_(\d+)$/.exec(forcedUid);
    if (match) {
      const num = Number(match[1]);
      if (num >= bag.nextUid) {
        bag.nextUid = num + 1;
      }
    }
    return forcedUid;
  }
  const uid = `itm_${bag.nextUid}`;
  bag.nextUid += 1;
  return uid;
}

/**
 * 在背包中放置或移动单件物品
 */
export function placeItemInBag(bag, itemId, row, col, rot = 0, forcedUid = null) {
  const normRot = normalizeRot(rot);
  const check = checkPlacement(bag, itemId, row, col, normRot, forcedUid);
  if (!check.valid) {
    return {
      ok: false,
      reason: check.reason,
      overlappingUids: check.overlappingUids,
    };
  }

  if (forcedUid) {
    const existingIdx = bag.items.findIndex((it) => it.uid === forcedUid);
    if (existingIdx !== -1) {
      bag.items.splice(existingIdx, 1);
    }
  }

  const uid = allocateUid(bag, forcedUid);
  const placed = {
    uid,
    itemId,
    row,
    col,
    rot: normRot,
  };
  bag.items.push(placed);

  return {
    ok: true,
    uid,
    item: placed,
  };
}

/**
 * 从背包移除指定 uid 的物品实例
 */
export function removeItemFromBag(bag, uid) {
  const idx = bag.items.findIndex((it) => it.uid === uid);
  if (idx === -1) {
    return { ok: false, reason: 'not_found', item: null };
  }
  const [removed] = bag.items.splice(idx, 1);
  return { ok: true, item: removed };
}

/**
 * 为物品寻找合法落点（优先贴近 preferredRow/preferredCol 与 preferredRot）
 * @returns {{ row: number, col: number, rot: number } | null}
 */
export function findValidPlacementForItem(
  bag,
  itemId,
  preferredRow = 1,
  preferredCol = 1,
  preferredRot = 0,
  ignoreUids = [],
) {
  const baseRot = normalizeRot(preferredRot);
  const rots = [baseRot, (baseRot + 1) % 4, (baseRot + 2) % 4, (baseRot + 3) % 4];
  const centerR = Math.floor(bag.rows / 2);
  const centerC = Math.floor(bag.cols / 2);

  const coords = [];
  for (let r = 0; r < bag.rows; r++) {
    for (let c = 0; c < bag.cols; c++) {
      const distPref = Math.abs(r - preferredRow) + Math.abs(c - preferredCol);
      const distCenter = Math.abs(r - centerR) + Math.abs(c - centerC);
      coords.push({ r, c, distPref, distCenter });
    }
  }
  coords.sort((a, b) => a.distPref - b.distPref || a.distCenter - b.distCenter || a.r - b.r || a.c - b.c);

  // 第一轮：优先在锚点 ±1 格邻域内尝试 4 个旋转角（保证手动原地/微调合成手感）
  for (const { r, c, distPref } of coords) {
    if (distPref > 1) break;
    for (const rot of rots) {
      if (checkPlacement(bag, itemId, r, c, rot, ignoreUids).valid) {
        return { row: r, col: c, rot };
      }
    }
  }

  // 第二轮：按距离由近及远扫描全盘
  for (const { r, c, distPref } of coords) {
    if (distPref <= 1) continue;
    for (const rot of rots) {
      if (checkPlacement(bag, itemId, r, c, rot, ignoreUids).valid) {
        return { row: r, col: c, rot };
      }
    }
  }

  return null;
}

/**
 * 判断两组格子集合是否满足正交十字相邻或八向星位相邻
 */
export function areCellSetsAdjacent(cellsA, cellsB, pattern = 'orthogonal') {
  for (const [r1, c1] of cellsA) {
    for (const [r2, c2] of cellsB) {
      const dr = Math.abs(r1 - r2);
      const dc = Math.abs(c1 - c2);
      if (pattern === 'star8') {
        if (Math.max(dr, dc) === 1) return true;
      } else if (dr + dc === 1) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 战前自动扫描背包内正交相邻且满足 MYTHIC_RECIPES 的配对物品并融合
 * @param {object} bag
 * @param {{ onOverflowToTray?: (uid: string, itemId: string) => boolean }} [options={}]
 */
export function resolveAdjacentMythicMerges(bag, options = {}) {
  const events = [];
  let mergedCount = 0;
  let changed = true;

  while (changed) {
    changed = false;
    const occMap = new Map();
    for (const it of bag.items) {
      occMap.set(it.uid, getOccupiedCells(it.itemId, it.row, it.col, it.rot));
    }

    for (let i = 0; i < bag.items.length && !changed; i++) {
      for (let j = i + 1; j < bag.items.length && !changed; j++) {
        const itemA = bag.items[i];
        const itemB = bag.items[j];
        const recipe = typeof findMythicRecipe === 'function' ? findMythicRecipe(itemA.itemId, itemB.itemId) : null;
        if (!recipe || !recipe.resultId) continue;

        const cellsA = occMap.get(itemA.uid);
        const cellsB = occMap.get(itemB.uid);
        if (!areCellSetsAdjacent(cellsA, cellsB, 'orthogonal')) continue;

        const placement = findValidPlacementForItem(
          bag,
          recipe.resultId,
          itemA.row,
          itemA.col,
          0,
          [itemA.uid, itemB.uid],
        );

        if (placement) {
          removeItemFromBag(bag, itemA.uid);
          removeItemFromBag(bag, itemB.uid);
          const placedRes = placeItemInBag(bag, recipe.resultId, placement.row, placement.col, placement.rot);
          mergedCount += 1;
          events.push({
            uidA: itemA.uid,
            uidB: itemB.uid,
            itemA: itemA.itemId,
            itemB: itemB.itemId,
            resultId: recipe.resultId,
            recipeId: recipe.id,
            placedInBag: true,
            uidResult: placedRes.uid,
          });
          changed = true;
        } else if (typeof options.onOverflowToTray === 'function') {
          const uidResult = allocateUid(bag, null);
          const accepted = options.onOverflowToTray(uidResult, recipe.resultId);
          if (accepted) {
            removeItemFromBag(bag, itemA.uid);
            removeItemFromBag(bag, itemB.uid);
            mergedCount += 1;
            events.push({
              uidA: itemA.uid,
              uidB: itemB.uid,
              itemA: itemA.itemId,
              itemB: itemB.itemId,
              resultId: recipe.resultId,
              recipeId: recipe.id,
              placedInBag: false,
              uidResult,
            });
            changed = true;
          }
        }
      }
    }
  }

  return { mergedCount, events };
}

function doesItemMatchAuraTarget(targetDef, targetTag = 'any') {
  if (!targetDef) return false;
  const tags = Array.isArray(targetDef.tags) ? targetDef.tags : [];
  const combat = targetDef.combat || {};

  if (targetTag === 'weapon') {
    return targetDef.category === 'weapon' || tags.includes('weapon') || (combat.damage || 0) > 0;
  }
  if (targetTag === 'armor') {
    return (
      targetDef.category === 'armor' ||
      tags.includes('armor') ||
      (combat.shield || 0) > 0 ||
      (combat.startShield || 0) > 0
    );
  }
  if (targetTag === 'any') {
    return (
      (targetDef.cooldown || 0) > 0 ||
      targetDef.category === 'weapon' ||
      targetDef.category === 'armor' ||
      tags.includes('weapon') ||
      tags.includes('armor')
    );
  }
  return targetDef.category === targetTag || tags.includes(targetTag);
}

function summarizeAuraEffect(aura) {
  const parts = [];
  if (aura.hastePct) parts.push(`${aura.hastePct > 0 ? '+' : ''}${aura.hastePct}% 加速`);
  if (aura.bonusDamage) parts.push(`+${aura.bonusDamage} 伤害`);
  if (aura.damageMultPct) parts.push(`+${aura.damageMultPct}% 增伤`);
  if (aura.bonusCritPct) parts.push(`+${aura.bonusCritPct}% 暴击`);
  if (aura.shieldMultPct) parts.push(`+${aura.shieldMultPct}% 护盾`);
  if (aura.bonusShield) parts.push(`+${aura.bonusShield} 护盾`);
  if (aura.bonusPoison) parts.push(`+${aura.bonusPoison} 剧毒`);
  if (aura.bonusChill) parts.push(`+${aura.bonusChill} 寒霜`);
  if (aura.bonusVampPct) parts.push(`+${aura.bonusVampPct}% 吸血`);
  if (aura.onTriggerHeal) parts.push(`+${aura.onTriggerHeal} 治疗`);

  let effectType = 'haste';
  if (aura.bonusPoison) {
    effectType = 'poison';
  } else if (aura.bonusVampPct) {
    effectType = 'vamp';
  } else if (aura.shieldMultPct || aura.bonusShield) {
    effectType = 'shield';
  } else if (aura.hastePct) {
    effectType = 'haste';
  } else if (aura.bonusDamage || aura.damageMultPct || aura.bonusCritPct) {
    effectType = 'damage';
  } else if (aura.onTriggerHeal) {
    effectType = 'shield';
  }

  return {
    effectType,
    label: parts.join(' · ') || '邻接增益',
  };
}

/**
 * 实时计算背包内所有物品的十字/星位邻接加成与可视化连线
 * @param {object} bag
 * @param {object} [heroBonuses={}]
 */
export function computeBagSynergies(bag, heroBonuses = {}) {
  const itemStats = {};
  const links = [];
  const occMap = new Map();
  const defMap = new Map();

  const items = Array.isArray(bag?.items) ? bag.items : [];
  for (const it of items) {
    occMap.set(it.uid, getOccupiedCells(it.itemId, it.row, it.col, it.rot));
    defMap.set(it.uid, resolveItemDef(it.itemId));
  }

  // 初始化每个物品实例的累加器
  const accum = new Map();
  for (const it of items) {
    accum.set(it.uid, {
      hastePct: Number(heroBonuses?.globalHastePct || 0),
      flatDamage: 0,
      damageMultPct: 0,
      flatShield: 0,
      shieldMultPct: 0,
      bonusCritPct: Number(heroBonuses?.globalCritPct || 0),
      bonusPoison: 0,
      bonusChill: 0,
      bonusVampPct: 0,
      onTriggerHeal: 0,
      buffSources: [],
    });
  }

  // 1. 计算所有带光环物品对邻接目标物品的增益（同一对 A->B 只计 1 次）
  for (const src of items) {
    const srcDef = defMap.get(src.uid);
    const aura = srcDef?.aura;
    if (!aura) continue;

    const pattern = aura.pattern === 'star8' ? 'star8' : 'orthogonal';
    const targetTag = aura.targetTag || 'any';
    const cellsSrc = occMap.get(src.uid);
    const { effectType, label } = summarizeAuraEffect(aura);

    for (const dst of items) {
      if (src.uid === dst.uid) continue;
      const dstDef = defMap.get(dst.uid);
      if (!doesItemMatchAuraTarget(dstDef, targetTag)) continue;

      const cellsDst = occMap.get(dst.uid);
      if (!areCellSetsAdjacent(cellsSrc, cellsDst, pattern)) continue;

      const acc = accum.get(dst.uid);
      acc.hastePct += Number(aura.hastePct || 0);
      acc.flatDamage += Number(aura.bonusDamage || 0);
      acc.damageMultPct += Number(aura.damageMultPct || 0);
      acc.flatShield += Number(aura.bonusShield || 0);
      acc.shieldMultPct += Number(aura.shieldMultPct || 0);
      acc.bonusCritPct += Number(aura.bonusCritPct || 0);
      acc.bonusPoison += Number(aura.bonusPoison || 0);
      acc.bonusChill += Number(aura.bonusChill || 0);
      acc.bonusVampPct += Number(aura.bonusVampPct || 0);
      acc.onTriggerHeal += Number(aura.onTriggerHeal || 0);

      acc.buffSources.push({
        fromUid: src.uid,
        fromItemId: src.itemId,
        label,
      });

      links.push({
        fromUid: src.uid,
        toUid: dst.uid,
        pattern,
        effectType,
        label,
      });
    }
  }

  // 2. 扫描正交相邻的跨物品★神话待融合连线提示
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const recipe = typeof findMythicRecipe === 'function' ? findMythicRecipe(a.itemId, b.itemId) : null;
      if (!recipe) continue;
      if (areCellSetsAdjacent(occMap.get(a.uid), occMap.get(b.uid), 'orthogonal')) {
        links.push({
          fromUid: a.uid,
          toUid: b.uid,
          pattern: 'orthogonal',
          effectType: 'mythic_ready',
          label: '★可融合神话',
        });
      }
    }
  }

  // 3. 结算每件物品最终属性与全包汇总值
  let totalEstimatedDps = 0;
  let bonusMaxHp = Number(heroBonuses?.bonusMaxHp || 0);
  let startShield = Number(heroBonuses?.startShield || 0);
  let bonusDodgePct = Number(heroBonuses?.bonusDodgePct || 0);
  let bonusThorns = Number(heroBonuses?.bonusThorns || 0);
  let roundGoldBonus = 0;

  for (const it of items) {
    const def = defMap.get(it.uid);
    const combat = def?.combat || {};
    const acc = accum.get(it.uid);
    const tags = Array.isArray(def?.tags) ? def.tags : [];
    const isWeaponLike = def?.category === 'weapon' || tags.includes('weapon') || (combat.damage || 0) > 0;

    const baseCd = Number(def?.cooldown || 0);
    const clampedHaste = Math.max(-50, Math.min(150, acc.hastePct));
    const effectiveCd =
      baseCd > 0 ? Number(Math.max(MIN_ITEM_CD, baseCd / (1 + clampedHaste / 100)).toFixed(3)) : 0;

    const baseDmg = Number(combat.damage || 0);
    const damage =
      baseDmg > 0
        ? Math.max(1, Math.round((baseDmg + acc.flatDamage) * (1 + acc.damageMultPct / 100)))
        : 0;

    const baseShield = Number(combat.shield || 0);
    const shield =
      baseShield > 0 || acc.flatShield > 0
        ? Math.max(0, Math.round((baseShield + acc.flatShield) * (1 + acc.shieldMultPct / 100)))
        : 0;

    const baseHeal = Number(combat.heal || 0);
    const heal = baseCd > 0 ? Math.max(0, Math.round(baseHeal + acc.onTriggerHeal)) : 0;

    const basePoison = Number(combat.poison || 0);
    const canCarryPoison = baseCd > 0 && (basePoison > 0 || isWeaponLike || def?.category === 'potion');
    const poison = canCarryPoison ? Math.max(0, Math.round(basePoison + acc.bonusPoison)) : 0;

    const baseChill = Number(combat.chill || 0);
    const canCarryChill = baseCd > 0 && (baseChill > 0 || isWeaponLike || def?.category === 'potion');
    const chill = canCarryChill ? Math.max(0, Math.round(baseChill + acc.bonusChill)) : 0;

    const critPct =
      damage > 0 ? Math.max(0, Math.min(85, Math.round((combat.critPct || 0) + acc.bonusCritPct))) : 0;

    const vampPct = damage > 0 ? Math.max(0, Math.round((combat.vampPct || 0) + acc.bonusVampPct)) : 0;

    let dps = 0;
    if (effectiveCd > 0 && (damage > 0 || poison > 0)) {
      const expectedDirect = damage * (1 + (critPct / 100) * 0.65);
      const expectedPoison = poison * 1.5;
      dps = Number(((expectedDirect + expectedPoison) / effectiveCd).toFixed(1));
    }

    totalEstimatedDps += dps;
    bonusMaxHp += Number(combat.bonusMaxHp || 0);
    startShield += Number(combat.startShield || 0);
    bonusDodgePct += Number(combat.bonusDodgePct || 0);
    bonusThorns += Number(combat.bonusThorns || 0);
    roundGoldBonus += Number(combat.roundGoldBonus || 0);

    itemStats[it.uid] = {
      uid: it.uid,
      itemId: it.itemId,
      baseCd,
      effectiveCd,
      hastePct: Math.round(clampedHaste),
      damage,
      shield,
      heal,
      poison,
      chill,
      critPct,
      vampPct,
      dps,
      buffSources: acc.buffSources,
    };
  }

  return {
    itemStats,
    links,
    totals: {
      estimatedDps: Number(totalEstimatedDps.toFixed(1)),
      bonusMaxHp: Math.round(bonusMaxHp),
      startShield: Math.round(startShield),
      bonusDodgePct: Math.min(60, Math.max(0, Math.round(bonusDodgePct))),
      bonusThorns: Math.max(0, Math.round(bonusThorns)),
      roundGoldBonus: Math.round(roundGoldBonus),
    },
  };
}
