// 《勇者塞满包 · 背包合成乱斗》10 轮闯关状态机、商店/托盘/背包交互 API 与启发式智能摆包 AI

import {
  HEROES,
  INITIAL_HEARTS,
  MAX_ROUNDS,
  MYTHIC_RECIPES,
  REROLL_COST,
  SHOP_SLOT_COUNT,
  TRAY_CAPACITY,
  findMythicRecipe,
  getEnemyByRound,
  getHeroById,
  getItemById,
  getShopPoolForRound,
} from './catalog.js';
import { createBattleSimulator } from './combat.js';
import {
  areCellSetsAdjacent,
  checkMergeCompatibility,
  checkPlacement,
  cloneBag,
  computeBagSynergies,
  createInitialBag,
  findValidPlacementForItem,
  getExpandableCells,
  getItemAtCell,
  getItemFootprint,
  getOccupiedCells,
  placeItemInBag,
  removeItemFromBag,
  resolveAdjacentMythicMerges,
  unlockBagCell,
} from './grid.js';
import { createRng } from './prng.js';

const START_GOLD_ROUND_1 = 14;

function normalizeRot(rot = 0) {
  const r = Number.isFinite(rot) ? Math.trunc(rot) : 0;
  return ((r % 4) + 4) % 4;
}

function allocateSessionUid(session) {
  const uid = `itm_${session.bag.nextUid}`;
  session.bag.nextUid += 1;
  return uid;
}

function refreshSynergies(session) {
  session.synergies = computeBagSynergies(session.bag, session.hero?.bonuses || {});
  return session.synergies;
}

function countLockedCells(bag) {
  let locked = 0;
  for (let r = 0; r < bag.rows; r++) {
    for (let c = 0; c < bag.cols; c++) {
      if (!bag.unlocked[r]?.[c]) locked += 1;
    }
  }
  return locked;
}

function convertOverflowExpandPoints(session) {
  if (session.expandPoints <= 0) return 0;
  const lockedLeft = countLockedCells(session.bag);
  if (lockedLeft === 0) {
    const bonusGold = session.expandPoints * 2;
    session.gold += bonusGold;
    session.expandPoints = 0;
    return bonusGold;
  }
  return 0;
}

function rollShopSlots(session, { keepLocked = true } = {}) {
  const pool = getShopPoolForRound(session.round) || [];
  const nextShop = [];

  for (let i = 0; i < SHOP_SLOT_COUNT; i++) {
    const prev = session.shop?.[i];
    if (keepLocked && prev && prev.locked && !prev.sold) {
      nextShop.push({
        ...prev,
        slotIndex: i,
      });
      continue;
    }

    let picked = null;
    if (pool.length > 0) {
      if (typeof session.rng.weightedPick === 'function') {
        picked = session.rng.weightedPick(pool, (it) => Math.max(0, Number(it.shopWeight ?? 1)));
      } else {
        picked = session.rng.pick(pool);
      }
      if (!picked) picked = pool[0];
    }

    if (picked) {
      nextShop.push({
        slotIndex: i,
        itemId: picked.id,
        cost: Number(picked.cost || 3),
        locked: false,
        sold: false,
      });
    }
  }

  session.shop = nextShop;
  return session.shop;
}

/**
 * 计算某件物品当前的出售返还金币价格
 */
export function getSellPrice(session, itemId) {
  const def = getItemById(itemId);
  if (!def) return 1;
  const heroSellBonus = Number(session?.hero?.bonuses?.sellBonusGold || 0);
  return Math.max(1, Math.ceil(Number(def.cost || 2) * 0.5) + heroSellBonus);
}

/**
 * 根据 uid 查询物品所在位置（'bag' 或 'tray'）
 */
export function findItemLocation(session, uid) {
  if (!session || !uid) return null;
  const bagItem = session.bag.items.find((it) => it.uid === uid);
  if (bagItem) {
    return { zone: 'bag', uid: bagItem.uid, item: bagItem };
  }
  const trayIdx = session.tray.findIndex((t) => t && t.uid === uid);
  if (trayIdx !== -1) {
    return { zone: 'tray', index: trayIdx, uid, item: session.tray[trayIdx] };
  }
  return null;
}

/**
 * 创建全新单局游戏会话（初始处于 'hero_select' 阶段）
 * @param {number} [seed=Date.now()]
 */
export function createSession(seed = Date.now()) {
  const numericSeed = (Number(seed) >>> 0) || 1;
  const bag = createInitialBag();
  const session = {
    seed: numericSeed,
    rng: createRng(numericSeed),
    status: 'hero_select',
    round: 1,
    hearts: INITIAL_HEARTS,
    maxHearts: INITIAL_HEARTS,
    gold: 0,
    winStreak: 0,
    rerollsThisRound: 0,
    expandPoints: 0,
    heroId: null,
    hero: null,
    bag,
    tray: Array(TRAY_CAPACITY).fill(null),
    shop: [],
    synergies: computeBagSynergies(bag),
    lastMergeEvents: [],
    lastBattleSummary: null,
    history: [],
    stats: {
      upgradesDone: 0,
      mythicsCrafted: 0,
    },
  };
  return session;
}

/**
 * 选择初始勇者并初始化背包、初始装备与第 1 轮商店，进入 'prep' 整备阶段
 */
export function selectHero(session, heroId) {
  const hero = getHeroById(heroId) || HEROES?.[0] || null;
  if (!hero) {
    return { ok: false, reason: 'invalid_hero' };
  }

  session.heroId = hero.id;
  session.hero = hero;
  session.round = 1;
  session.hearts = INITIAL_HEARTS;
  session.maxHearts = INITIAL_HEARTS;
  session.gold = START_GOLD_ROUND_1;
  session.winStreak = 0;
  session.rerollsThisRound = 0;
  session.expandPoints = 0;
  session.tray = Array(TRAY_CAPACITY).fill(null);
  session.lastMergeEvents = [];
  session.lastBattleSummary = null;
  session.history = [];
  session.stats = {
    upgradesDone: 0,
    mythicsCrafted: 0,
  };

  const extraCells = Array.isArray(hero.bonuses?.extraStartCells) ? hero.bonuses.extraStartCells : [];
  session.bag = createInitialBag(extraCells);

  // 放置勇者开局自带装备（若有位置冲突自动就近安放）
  const starters = Array.isArray(hero.starterItems) ? hero.starterItems : [];
  for (const st of starters) {
    if (!st?.itemId || !getItemById(st.itemId)) continue;
    const direct = placeItemInBag(session.bag, st.itemId, st.row ?? 2, st.col ?? 2, st.rot ?? 0);
    if (!direct.ok) {
      const fallback = findValidPlacementForItem(session.bag, st.itemId, st.row ?? 2, st.col ?? 3, st.rot ?? 0);
      if (fallback) {
        placeItemInBag(session.bag, st.itemId, fallback.row, fallback.col, fallback.rot);
      } else {
        const emptyTray = session.tray.findIndex((t) => t === null);
        if (emptyTray !== -1) {
          session.tray[emptyTray] = {
            uid: allocateSessionUid(session),
            itemId: st.itemId,
            rot: normalizeRot(st.rot ?? 0),
          };
        }
      }
    }
  }

  refreshSynergies(session);
  rollShopSlots(session, { keepLocked: false });
  session.status = 'prep';

  return { ok: true, hero, session };
}

/**
 * 手动消耗 1 点扩建点数解锁正交相邻格
 */
export function expandBagCell(session, row, col) {
  if (session.status !== 'prep') {
    return { ok: false, reason: 'invalid_phase' };
  }
  if (session.expandPoints <= 0) {
    return { ok: false, reason: 'no_expand_points' };
  }

  const res = unlockBagCell(session.bag, row, col);
  if (!res.ok) {
    return res;
  }

  session.expandPoints -= 1;
  const bonusGold = convertOverflowExpandPoints(session);

  return {
    ok: true,
    row,
    col,
    expandPointsLeft: session.expandPoints,
    bonusGold,
  };
}

/**
 * 自动按距离中心 (2, 3) 曼哈顿距离最近优先消耗全部剩余扩建点数
 */
export function autoExpandBag(session) {
  const unlockedCells = [];
  let bonusGold = 0;

  const centerR = Math.floor(session.bag.rows / 2);
  const centerC = Math.floor(session.bag.cols / 2);

  while (session.expandPoints > 0) {
    const candidates = getExpandableCells(session.bag);
    if (candidates.length === 0) {
      bonusGold += convertOverflowExpandPoints(session);
      break;
    }

    candidates.sort((a, b) => {
      const distA = Math.abs(a[0] - centerR) + Math.abs(a[1] - centerC);
      const distB = Math.abs(b[0] - centerR) + Math.abs(b[1] - centerC);
      if (distA !== distB) return distA - distB;
      const rowDiff = Math.abs(a[0] - centerR) - Math.abs(b[0] - centerR);
      if (rowDiff !== 0) return rowDiff;
      return a[1] - b[1];
    });

    const [bestR, bestC] = candidates[0];
    const res = unlockBagCell(session.bag, bestR, bestC);
    if (!res.ok) break;

    session.expandPoints -= 1;
    unlockedCells.push([bestR, bestC]);
  }

  if (session.expandPoints > 0) {
    bonusGold += convertOverflowExpandPoints(session);
  }

  return {
    ok: true,
    unlockedCells,
    expandPointsLeft: session.expandPoints,
    bonusGold,
  };
}

/**
 * 返回当次刷新商店所需金币（考虑每轮首次免费刷新被动）
 */
export function getRerollCost(session) {
  if (session?.hero?.bonuses?.freeFirstReroll && session.rerollsThisRound === 0) {
    return 0;
  }
  return REROLL_COST;
}

/**
 * 刷新商店未锁定的槽位
 */
export function rerollShop(session) {
  if (session.status !== 'prep') {
    return { ok: false, reason: 'invalid_phase' };
  }
  const cost = getRerollCost(session);
  if (session.gold < cost) {
    return { ok: false, reason: 'not_enough_gold', cost };
  }

  session.gold -= cost;
  session.rerollsThisRound += 1;
  rollShopSlots(session, { keepLocked: true });

  return {
    ok: true,
    cost,
    gold: session.gold,
    shop: session.shop,
  };
}

/**
 * 切换单个商店槽位的锁定状态
 */
export function toggleShopSlotLock(session, slotIndex) {
  const slot = session.shop?.[slotIndex];
  if (!slot || slot.sold) {
    return { ok: false, reason: 'invalid_slot' };
  }
  slot.locked = !slot.locked;
  return { ok: true, slotIndex, locked: slot.locked };
}

/**
 * 一键切换全部未售出商店商品的锁定状态
 */
export function toggleShopAllLock(session) {
  const activeSlots = (session.shop || []).filter((s) => s && !s.sold);
  if (activeSlots.length === 0) {
    return { ok: false, reason: 'shop_empty', locked: false };
  }
  const allLocked = activeSlots.every((s) => s.locked);
  const nextLocked = !allLocked;
  for (const s of activeSlots) {
    s.locked = nextLocked;
  }
  return { ok: true, locked: nextLocked };
}

function recordMergeStatsAndEvent(session, compat, itemA, itemB, uidResult, placedZone) {
  if (compat.kind === 'upgrade') {
    session.stats.upgradesDone += 1;
  } else if (compat.kind === 'mythic') {
    session.stats.mythicsCrafted += 1;
  }
  session.lastMergeEvents.push({
    kind: compat.kind,
    itemA,
    itemB,
    resultId: compat.resultId,
    recipeId: compat.recipeId || null,
    uidResult,
    placedZone,
  });
}

/**
 * 尝试将一件新物品（或待移入物品）与背包中指定目标物品合成
 * @param {object} session
 * @param {string} srcItemId
 * @param {object} dstBagItem
 * @param {{ removeSourceFn?: () => void, sourceBagUid?: string | null, sourceFreesTraySlot?: boolean }} opts
 */
function attemptMergeOntoBagItem(session, srcItemId, dstBagItem, opts = {}) {
  const compat = checkMergeCompatibility(srcItemId, dstBagItem.itemId);
  if (!compat) return null;

  const ignoreUids = [dstBagItem.uid];
  if (opts.sourceBagUid) ignoreUids.push(opts.sourceBagUid);

  // 同阶进化且原地合法 -> 直接原地升级替换
  if (
    compat.kind === 'upgrade' &&
    checkPlacement(session.bag, compat.resultId, dstBagItem.row, dstBagItem.col, dstBagItem.rot, ignoreUids).valid
  ) {
    if (opts.removeSourceFn) opts.removeSourceFn();
    const oldItemB = dstBagItem.itemId;
    dstBagItem.itemId = compat.resultId;
    recordMergeStatsAndEvent(session, compat, srcItemId, oldItemB, dstBagItem.uid, 'bag');
    refreshSynergies(session);
    return {
      ok: true,
      action: 'merged',
      mergeKind: compat.kind,
      resultId: compat.resultId,
      uid: dstBagItem.uid,
      placedZone: 'bag',
    };
  }

  // 跨物品★神话融合（或进化后形状变化）：优先在目标锚点及邻域寻找合法落点
  const placement = findValidPlacementForItem(
    session.bag,
    compat.resultId,
    dstBagItem.row,
    dstBagItem.col,
    dstBagItem.rot,
    ignoreUids,
  );

  if (placement) {
    const keptUid = dstBagItem.uid;
    const oldItemB = dstBagItem.itemId;
    if (opts.removeSourceFn) opts.removeSourceFn();
    removeItemFromBag(session.bag, keptUid);
    placeItemInBag(session.bag, compat.resultId, placement.row, placement.col, placement.rot, keptUid);
    recordMergeStatsAndEvent(session, compat, srcItemId, oldItemB, keptUid, 'bag');
    refreshSynergies(session);
    return {
      ok: true,
      action: 'merged',
      mergeKind: compat.kind,
      resultId: compat.resultId,
      uid: keptUid,
      placedZone: 'bag',
    };
  }

  // 背包无空位容纳新神话形状 -> 检查移除源后暂存托盘是否有空槽兜底
  const hasEmptyTrayNow = session.tray.some((t) => t === null);
  if (hasEmptyTrayNow || opts.sourceFreesTraySlot) {
    const keptUid = dstBagItem.uid;
    const oldItemB = dstBagItem.itemId;
    if (opts.removeSourceFn) opts.removeSourceFn();
    removeItemFromBag(session.bag, keptUid);
    const emptyIdx = session.tray.findIndex((t) => t === null);
    session.tray[emptyIdx] = {
      uid: keptUid,
      itemId: compat.resultId,
      rot: 0,
    };
    recordMergeStatsAndEvent(session, compat, srcItemId, oldItemB, keptUid, 'tray');
    refreshSynergies(session);
    return {
      ok: true,
      action: 'merged',
      mergeKind: compat.kind,
      resultId: compat.resultId,
      uid: keptUid,
      placedZone: 'tray',
      trayIndex: emptyIdx,
    };
  }

  return {
    ok: false,
    reason: 'no_space_for_mythic',
  };
}

function attemptMergeOntoTrayItem(session, srcItemId, trayIndex, removeSourceFn = null) {
  const dstTrayItem = session.tray[trayIndex];
  if (!dstTrayItem) return null;
  const compat = checkMergeCompatibility(srcItemId, dstTrayItem.itemId);
  if (!compat) return null;

  const oldItemB = dstTrayItem.itemId;
  if (removeSourceFn) removeSourceFn();
  dstTrayItem.itemId = compat.resultId;
  dstTrayItem.rot = 0;
  recordMergeStatsAndEvent(session, compat, srcItemId, oldItemB, dstTrayItem.uid, 'tray');
  refreshSynergies(session);

  return {
    ok: true,
    action: 'merged',
    mergeKind: compat.kind,
    resultId: compat.resultId,
    uid: dstTrayItem.uid,
    placedZone: 'tray',
    trayIndex,
  };
}

function findSingleTargetBagItemForDrop(bag, itemId, row, col, rot, ignoreUid = null) {
  const directCellItem = getItemAtCell(bag, row, col);
  if (directCellItem && directCellItem.uid !== ignoreUid) {
    if (checkMergeCompatibility(itemId, directCellItem.itemId)) {
      return directCellItem;
    }
  }

  const check = checkPlacement(bag, itemId, row, col, rot, ignoreUid);
  if (check.overlappingUids.length === 1) {
    const candidate = bag.items.find((it) => it.uid === check.overlappingUids[0]);
    if (candidate && candidate.uid !== ignoreUid) {
      return candidate;
    }
  }
  return null;
}

/**
 * 购买商店槽位物品（支持定点拖拽购买/叠合合成，或一键购买自动入包/入托盘）
 */
export function buyShopItem(session, slotIndex, target = null) {
  if (session.status !== 'prep') {
    return { ok: false, reason: 'invalid_phase' };
  }
  const slot = session.shop?.[slotIndex];
  if (!slot || slot.sold) {
    return { ok: false, reason: 'invalid_slot' };
  }
  if (session.gold < slot.cost) {
    return { ok: false, reason: 'not_enough_gold' };
  }

  const finalizePurchase = () => {
    session.gold -= slot.cost;
    slot.sold = true;
    slot.locked = false;
  };

  // 模式 A：指定目标落点（拖拽购买或点选放置）
  if (target && target.zone === 'bag') {
    const row = Number(target.row);
    const col = Number(target.col);
    const rot = normalizeRot(target.rot ?? 0);

    const mergeCandidate = findSingleTargetBagItemForDrop(session.bag, slot.itemId, row, col, rot, null);
    if (mergeCandidate && checkMergeCompatibility(slot.itemId, mergeCandidate.itemId)) {
      const mergeRes = attemptMergeOntoBagItem(session, slot.itemId, mergeCandidate, {
        removeSourceFn: finalizePurchase,
      });
      return mergeRes;
    }

    const check = checkPlacement(session.bag, slot.itemId, row, col, rot);
    if (!check.valid) {
      return { ok: false, reason: check.reason };
    }

    finalizePurchase();
    const placed = placeItemInBag(session.bag, slot.itemId, row, col, rot);
    refreshSynergies(session);
    return {
      ok: true,
      action: 'placed_bag',
      uid: placed.uid,
      item: placed.item,
    };
  }

  if (target && target.zone === 'tray') {
    if (Number.isInteger(target.index) && target.index >= 0 && target.index < TRAY_CAPACITY) {
      if (session.tray[target.index]) {
        const mergeRes = attemptMergeOntoTrayItem(session, slot.itemId, target.index, finalizePurchase);
        if (mergeRes) return mergeRes;
        return { ok: false, reason: 'tray_slot_occupied' };
      }
      finalizePurchase();
      const uid = allocateSessionUid(session);
      session.tray[target.index] = {
        uid,
        itemId: slot.itemId,
        rot: normalizeRot(target.rot ?? 0),
      };
      return {
        ok: true,
        action: 'placed_tray',
        uid,
        trayIndex: target.index,
      };
    }

    const emptyIdx = session.tray.findIndex((t) => t === null);
    if (emptyIdx === -1) {
      return { ok: false, reason: 'no_space' };
    }
    finalizePurchase();
    const uid = allocateSessionUid(session);
    session.tray[emptyIdx] = { uid, itemId: slot.itemId, rot: 0 };
    return {
      ok: true,
      action: 'placed_tray',
      uid,
      trayIndex: emptyIdx,
    };
  }

  // 模式 B：未指定 target（快速点击购买）：同名升级 -> 自动入包 -> 入暂存托盘
  const def = getItemById(slot.itemId);
  if (def?.upgradesTo) {
    const sameInBag = session.bag.items.find((it) => it.itemId === slot.itemId);
    if (sameInBag) {
      const mergeRes = attemptMergeOntoBagItem(session, slot.itemId, sameInBag, {
        removeSourceFn: finalizePurchase,
      });
      if (mergeRes?.ok) return mergeRes;
    }

    const sameInTrayIdx = session.tray.findIndex((t) => t && t.itemId === slot.itemId);
    if (sameInTrayIdx !== -1) {
      const mergeRes = attemptMergeOntoTrayItem(session, slot.itemId, sameInTrayIdx, finalizePurchase);
      if (mergeRes?.ok) return mergeRes;
    }
  }

  const autoPos = findValidPlacementForItem(session.bag, slot.itemId, 2, 3, 0);
  if (autoPos) {
    finalizePurchase();
    const placed = placeItemInBag(session.bag, slot.itemId, autoPos.row, autoPos.col, autoPos.rot);
    refreshSynergies(session);
    return {
      ok: true,
      action: 'placed_bag',
      uid: placed.uid,
      item: placed.item,
    };
  }

  const emptyTrayIdx = session.tray.findIndex((t) => t === null);
  if (emptyTrayIdx !== -1) {
    finalizePurchase();
    const uid = allocateSessionUid(session);
    session.tray[emptyTrayIdx] = {
      uid,
      itemId: slot.itemId,
      rot: 0,
    };
    return {
      ok: true,
      action: 'placed_tray',
      uid,
      trayIndex: emptyTrayIdx,
    };
  }

  return { ok: false, reason: 'no_space' };
}

function resolveSourceRef(session, ref) {
  if (!ref) return null;
  if (ref.zone === 'bag') {
    const item = session.bag.items.find((it) => it.uid === ref.uid);
    if (!item) return null;
    return {
      zone: 'bag',
      uid: item.uid,
      itemId: item.itemId,
      row: item.row,
      col: item.col,
      rot: item.rot,
      raw: item,
    };
  }
  if (ref.zone === 'tray') {
    let idx = Number.isInteger(ref.index) ? ref.index : -1;
    if ((idx < 0 || idx >= TRAY_CAPACITY || !session.tray[idx]) && ref.uid) {
      idx = session.tray.findIndex((t) => t && t.uid === ref.uid);
    }
    if (idx < 0 || idx >= TRAY_CAPACITY || !session.tray[idx]) return null;
    const item = session.tray[idx];
    return {
      zone: 'tray',
      index: idx,
      uid: item.uid,
      itemId: item.itemId,
      rot: item.rot,
      raw: item,
    };
  }
  return null;
}

/**
 * 通用物品移动、合成与单目标智能交换（支持背包 <-> 背包、背包 <-> 托盘、托盘 <-> 托盘）
 */
export function moveItem(session, from, to) {
  if (session.status !== 'prep') {
    return { ok: false, reason: 'invalid_phase' };
  }
  const src = resolveSourceRef(session, from);
  if (!src) {
    return { ok: false, reason: 'source_not_found' };
  }
  if (!to || !to.zone) {
    return { ok: false, reason: 'invalid_target' };
  }

  const removeSource = () => {
    if (src.zone === 'bag') {
      removeItemFromBag(session.bag, src.uid);
    } else {
      session.tray[src.index] = null;
    }
  };

  // 目标在背包网格内
  if (to.zone === 'bag') {
    const row = Number(to.row);
    const col = Number(to.col);
    const rot = normalizeRot(to.rot ?? src.rot);

    if (src.zone === 'bag' && src.row === row && src.col === col && src.rot === rot) {
      return { ok: true, action: 'moved', uid: src.uid };
    }

    const ignoreUid = src.zone === 'bag' ? src.uid : null;
    const singleTarget = findSingleTargetBagItemForDrop(session.bag, src.itemId, row, col, rot, ignoreUid);

    // 1. 优先尝试二合一进化或★神话合成
    if (singleTarget && checkMergeCompatibility(src.itemId, singleTarget.itemId)) {
      const mergeRes = attemptMergeOntoBagItem(session, src.itemId, singleTarget, {
        removeSourceFn: removeSource,
        sourceBagUid: ignoreUid,
        sourceFreesTraySlot: src.zone === 'tray',
      });
      return mergeRes;
    }

    // 2. 检查空位直接放置
    const check = checkPlacement(session.bag, src.itemId, row, col, rot, ignoreUid);
    if (check.valid) {
      removeSource();
      placeItemInBag(session.bag, src.itemId, row, col, rot, src.uid);
      refreshSynergies(session);
      return {
        ok: true,
        action: 'moved',
        uid: src.uid,
      };
    }

    // 3. 单件重叠智能腾挪交换（绝不覆盖未解锁格或越界）
    if (check.reason === 'overlap' && check.overlappingUids.length === 1) {
      const displaced = session.bag.items.find((it) => it.uid === check.overlappingUids[0]);
      if (displaced && displaced.uid !== src.uid) {
        if (src.zone === 'tray') {
          removeItemFromBag(session.bag, displaced.uid);
          placeItemInBag(session.bag, src.itemId, row, col, rot, src.uid);
          session.tray[src.index] = {
            uid: displaced.uid,
            itemId: displaced.itemId,
            rot: displaced.rot,
          };
          refreshSynergies(session);
          return {
            ok: true,
            action: 'moved',
            swapped: true,
            uid: src.uid,
            displacedUid: displaced.uid,
          };
        }

        if (src.zone === 'bag') {
          const simBag = cloneBag(session.bag);
          removeItemFromBag(simBag, src.uid);
          removeItemFromBag(simBag, displaced.uid);
          placeItemInBag(simBag, src.itemId, row, col, rot, src.uid);
          const swapPos = findValidPlacementForItem(
            simBag,
            displaced.itemId,
            src.row,
            src.col,
            displaced.rot,
          );
          if (swapPos) {
            placeItemInBag(simBag, displaced.itemId, swapPos.row, swapPos.col, swapPos.rot, displaced.uid);
            session.bag = simBag;
            refreshSynergies(session);
            return {
              ok: true,
              action: 'moved',
              swapped: true,
              uid: src.uid,
              displacedUid: displaced.uid,
            };
          }

          const emptyTrayIdx = session.tray.findIndex((t) => t === null);
          if (emptyTrayIdx !== -1) {
            session.bag = simBag;
            session.tray[emptyTrayIdx] = {
              uid: displaced.uid,
              itemId: displaced.itemId,
              rot: displaced.rot,
            };
            refreshSynergies(session);
            return {
              ok: true,
              action: 'moved',
              swapped: true,
              uid: src.uid,
              displacedUid: displaced.uid,
            };
          }
        }
      }
    }

    return { ok: false, reason: check.reason || 'invalid_placement' };
  }

  // 目标在暂存托盘内
  if (to.zone === 'tray') {
    let targetIdx = Number.isInteger(to.index) ? to.index : -1;
    if (targetIdx < 0 || targetIdx >= TRAY_CAPACITY) {
      targetIdx = session.tray.findIndex((t) => t === null);
      if (targetIdx === -1) {
        return { ok: false, reason: 'tray_full' };
      }
    }

    if (src.zone === 'tray' && src.index === targetIdx) {
      return { ok: true, action: 'moved', uid: src.uid, trayIndex: targetIdx };
    }

    const dstTray = session.tray[targetIdx];
    if (dstTray) {
      // 1. 托盘槽内直接合成
      const mergeRes = attemptMergeOntoTrayItem(session, src.itemId, targetIdx, removeSource);
      if (mergeRes) return mergeRes;

      // 2. 托盘间互换或背包与托盘互换
      if (src.zone === 'tray') {
        session.tray[src.index] = dstTray;
        session.tray[targetIdx] = src.raw;
        return { ok: true, action: 'moved', swapped: true, uid: src.uid, trayIndex: targetIdx };
      }

      if (src.zone === 'bag') {
        if (checkPlacement(session.bag, dstTray.itemId, src.row, src.col, dstTray.rot, src.uid).valid) {
          removeItemFromBag(session.bag, src.uid);
          placeItemInBag(session.bag, dstTray.itemId, src.row, src.col, dstTray.rot, dstTray.uid);
          session.tray[targetIdx] = {
            uid: src.uid,
            itemId: src.itemId,
            rot: src.rot,
          };
          refreshSynergies(session);
          return { ok: true, action: 'moved', swapped: true, uid: src.uid, trayIndex: targetIdx };
        }

        const otherEmpty = session.tray.findIndex((t) => t === null);
        if (otherEmpty !== -1) {
          removeItemFromBag(session.bag, src.uid);
          session.tray[otherEmpty] = {
            uid: src.uid,
            itemId: src.itemId,
            rot: src.rot,
          };
          refreshSynergies(session);
          return { ok: true, action: 'moved', uid: src.uid, trayIndex: otherEmpty };
        }
        return { ok: false, reason: 'tray_slot_occupied' };
      }
    }

    removeSource();
    session.tray[targetIdx] = {
      uid: src.uid,
      itemId: src.itemId,
      rot: normalizeRot(to.rot ?? src.rot),
    };
    refreshSynergies(session);
    return {
      ok: true,
      action: 'moved',
      uid: src.uid,
      trayIndex: targetIdx,
    };
  }

  return { ok: false, reason: 'invalid_target' };
}

/**
 * 旋转背包或托盘中的物品（背包内支持 ±1 格邻域自适应微调锚点）
 */
export function rotateItem(session, ref) {
  if (session.status !== 'prep') {
    return { ok: false, reason: 'invalid_phase' };
  }
  const src = resolveSourceRef(session, ref);
  if (!src) {
    return { ok: false, reason: 'item_not_found' };
  }

  const nextRot = (src.rot + 1) % 4;
  if (src.zone === 'tray') {
    src.raw.rot = nextRot;
    return { ok: true, zone: 'tray', index: src.index, uid: src.uid, rot: nextRot };
  }

  const offsets = [
    [0, 0],
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];

  for (const [dr, dc] of offsets) {
    const nr = src.row + dr;
    const nc = src.col + dc;
    if (checkPlacement(session.bag, src.itemId, nr, nc, nextRot, src.uid).valid) {
      src.raw.row = nr;
      src.raw.col = nc;
      src.raw.rot = nextRot;
      refreshSynergies(session);
      return {
        ok: true,
        zone: 'bag',
        uid: src.uid,
        row: nr,
        col: nc,
        rot: nextRot,
      };
    }
  }

  return { ok: false, reason: 'no_space_to_rotate' };
}

/**
 * 出售背包或托盘中的物品并返还金币
 */
export function sellItem(session, ref) {
  if (session.status !== 'prep') {
    return { ok: false, reason: 'invalid_phase' };
  }
  const src = resolveSourceRef(session, ref);
  if (!src) {
    return { ok: false, reason: 'item_not_found' };
  }

  const goldGained = getSellPrice(session, src.itemId);
  if (src.zone === 'bag') {
    removeItemFromBag(session.bag, src.uid);
    refreshSynergies(session);
  } else {
    session.tray[src.index] = null;
  }

  session.gold += goldGained;
  return {
    ok: true,
    uid: src.uid,
    itemId: src.itemId,
    goldGained,
    gold: session.gold,
  };
}

const DISTINCT_ROT_CACHE = new Map();

function getDistinctRotations(itemId) {
  let cached = DISTINCT_ROT_CACHE.get(itemId);
  if (cached) return cached;

  const seen = new Set();
  const rots = [];
  for (let rot = 0; rot < 4; rot++) {
    const fp = getItemFootprint(itemId, rot);
    const sig = fp.cells.map(([r, c]) => `${r},${c}`).join(';');
    if (!seen.has(sig)) {
      seen.add(sig);
      rots.push(rot);
    }
  }
  DISTINCT_ROT_CACHE.set(itemId, rots);
  return rots;
}

function estimateBaseItemPriority(itemId) {
  const def = getItemById(itemId);
  if (!def) return 0;
  const c = def.combat || {};
  const cd = Number(def.cooldown || 0);
  let score = Number(def.tier || 1) * 14 + Number(def.level || 1) * 12 + Number(def.cost || 3) * 2.5;
  if (def.category === 'mythic' || def.mythic) score += 45;
  if (cd > 0) {
    score += ((Number(c.damage || 0) + Number(c.poison || 0) * 2 + Number(c.shield || 0) * 0.9 + Number(c.heal || 0) * 0.9) / cd) * 5;
  }
  if (def.aura) score += 28;
  if (c.revivePct) score += 34;
  if (c.roundGoldBonus) score += 18;
  return score;
}

function evaluateBagLayoutScore(bag, heroBonuses) {
  const syn = computeBagSynergies(bag, heroBonuses);
  let shieldPerSec = 0;
  let healPerSec = 0;
  let itemQualitySum = 0;

  for (const it of bag.items) {
    const stat = syn.itemStats[it.uid];
    const def = getItemById(it.itemId);
    if (!stat || !def) continue;
    if (stat.effectiveCd > 0) {
      shieldPerSec += stat.shield / stat.effectiveCd;
      healPerSec += stat.heal / stat.effectiveCd;
    }
    itemQualitySum += estimateBaseItemPriority(it.itemId) * 0.35;
    if (def.combat?.revivePct > 0) {
      itemQualitySum += 40;
    }
  }

  return (
    syn.totals.estimatedDps * 12 +
    shieldPerSec * 10 +
    healPerSec * 9 +
    syn.totals.startShield * 0.65 +
    syn.totals.bonusMaxHp * 0.35 +
    syn.totals.bonusThorns * 2.5 +
    syn.totals.bonusDodgePct * 1.4 +
    syn.totals.roundGoldBonus * 7 +
    syn.links.length * 4.5 +
    itemQualitySum
  );
}

function packItemsGreedyWithOrder(templateBag, orderedPool, heroBonuses) {
  const rows = templateBag.rows;
  const cols = templateBag.cols;
  const bag = cloneBag(templateBag);
  bag.items = [];
  const leftover = [];

  // 一维占用标记矩阵（避免内层循环反复构建碰撞 Map）
  const occupiedGrid = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!bag.unlocked[r]?.[c]) {
        occupiedGrid[r * cols + c] = 2; // 2 = 未解锁
      }
    }
  }

  const placedRecords = [];
  const centerR = Math.floor(rows / 2);
  const centerC = Math.floor(cols / 2);

  for (const entry of orderedPool) {
    const def = getItemById(entry.itemId);
    if (!def) continue;
    const rots = getDistinctRotations(entry.itemId);
    const rotFootprints = rots.map((rot) => ({
      rot,
      relCells: getItemFootprint(entry.itemId, rot).cells,
    }));

    let bestPlacement = null;
    let bestLocalScore = -Infinity;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        for (const { rot, relCells } of rotFootprints) {
          let fits = true;
          const candCells = [];
          for (let k = 0; k < relCells.length; k++) {
            const nr = r + relCells[k][0];
            const nc = c + relCells[k][1];
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || occupiedGrid[nr * cols + nc] !== 0) {
              fits = false;
              break;
            }
            candCells.push([nr, nc]);
          }
          if (!fits) continue;

          const distCenter = Math.abs(r - centerR) + Math.abs(c - centerC);
          let localScore = def.aura ? -distCenter * 3.2 : -distCenter * 1.1;

          // 快速评估与已放置物品的双向光环契合度
          for (let pIdx = 0; pIdx < placedRecords.length; pIdx++) {
            const pRec = placedRecords[pIdx];
            const pDef = pRec.def;

            if (pDef.aura) {
              const pat = pDef.aura.pattern === 'star8' ? 'star8' : 'orthogonal';
              if (areCellSetsAdjacent(pRec.cells, candCells, pat)) {
                const tTag = pDef.aura.targetTag || 'any';
                const matches = tTag === 'any' || def.category === tTag || def.tags?.includes(tTag);
                if (matches && (def.cooldown > 0 || def.category === 'armor' || def.category === 'weapon')) {
                  localScore += 24;
                }
              }
            }

            if (def.aura) {
              const pat = def.aura.pattern === 'star8' ? 'star8' : 'orthogonal';
              if (areCellSetsAdjacent(candCells, pRec.cells, pat)) {
                const tTag = def.aura.targetTag || 'any';
                const matches = tTag === 'any' || pDef.category === tTag || pDef.tags?.includes(tTag);
                if (matches && (pDef.cooldown > 0 || pDef.category === 'armor' || pDef.category === 'weapon')) {
                  localScore += 24;
                }
              }
            }
          }

          if (localScore > bestLocalScore) {
            bestLocalScore = localScore;
            bestPlacement = { row: r, col: c, rot, cells: candCells };
          }
        }
      }
    }

    if (bestPlacement) {
      for (const [pr, pc] of bestPlacement.cells) {
        occupiedGrid[pr * cols + pc] = 1;
      }
      bag.items.push({
        uid: entry.uid,
        itemId: entry.itemId,
        row: bestPlacement.row,
        col: bestPlacement.col,
        rot: bestPlacement.rot,
      });
      placedRecords.push({
        def,
        cells: bestPlacement.cells,
      });
    } else {
      leftover.push(entry);
    }
  }

  const totalScore = evaluateBagLayoutScore(bag, heroBonuses);
  return { bag, leftover, totalScore };
}

/**
 * 一键智能整理背包：自动扩格 + 自动合并进化/★神话配方 + 围绕光环最大化 DPS 与护盾重排
 */
export function autoArrangeBag(session) {
  if (session.status !== 'prep') {
    return { ok: false, reason: 'invalid_phase' };
  }

  if (session.expandPoints > 0) {
    autoExpandBag(session);
  }

  // 收集背包与托盘中的全部物品实例
  const pool = [];
  for (const it of session.bag.items) {
    pool.push({ uid: it.uid, itemId: it.itemId, rot: it.rot });
  }
  for (let i = 0; i < session.tray.length; i++) {
    if (session.tray[i]) {
      pool.push({ uid: session.tray[i].uid, itemId: session.tray[i].itemId, rot: session.tray[i].rot });
    }
  }

  // 自动执行所有可合成的跨物品★神话配方与同名二合一进化
  let mergedAny = true;
  let mergesCount = 0;
  while (mergedAny) {
    mergedAny = false;

    // 1) 优先跨物品★神话融合
    for (let i = 0; i < pool.length && !mergedAny; i++) {
      for (let j = i + 1; j < pool.length && !mergedAny; j++) {
        const recipe = typeof findMythicRecipe === 'function' ? findMythicRecipe(pool[i].itemId, pool[j].itemId) : null;
        if (recipe && recipe.resultId) {
          const kept = pool[i];
          const consumed = pool[j];
          const oldA = kept.itemId;
          kept.itemId = recipe.resultId;
          pool.splice(j, 1);
          mergesCount += 1;
          recordMergeStatsAndEvent(
            session,
            { kind: 'mythic', resultId: recipe.resultId, recipeId: recipe.id },
            oldA,
            consumed.itemId,
            kept.uid,
            'bag',
          );
          mergedAny = true;
        }
      }
    }

    if (mergedAny) continue;

    // 2) 同名同阶二合一进化
    for (let i = 0; i < pool.length && !mergedAny; i++) {
      const defA = getItemById(pool[i].itemId);
      if (!defA?.upgradesTo) continue;
      for (let j = i + 1; j < pool.length && !mergedAny; j++) {
        if (pool[i].itemId === pool[j].itemId) {
          const kept = pool[i];
          const consumed = pool[j];
          const oldA = kept.itemId;
          kept.itemId = defA.upgradesTo;
          pool.splice(j, 1);
          mergesCount += 1;
          recordMergeStatsAndEvent(
            session,
            { kind: 'upgrade', resultId: defA.upgradesTo },
            oldA,
            consumed.itemId,
            kept.uid,
            'bag',
          );
          mergedAny = true;
        }
      }
    }
  }

  // 策略 A：核心光环居中优先 -> 高价值主力武器/防具 -> 辅助件
  const orderAuraCenter = pool.slice().sort((a, b) => {
    const defA = getItemById(a.itemId);
    const defB = getItemById(b.itemId);
    const auraA = defA?.aura ? 1 : 0;
    const auraB = defB?.aura ? 1 : 0;
    if (auraA !== auraB) return auraB - auraA;
    return estimateBaseItemPriority(b.itemId) - estimateBaseItemPriority(a.itemId);
  });

  // 策略 B：大尺寸核心主战装备优先落位 -> 光环挂件见缝插针最大化贴边
  const orderBigMainsFirst = pool.slice().sort((a, b) => {
    const cellsA = getItemFootprint(a.itemId, 0).cells.length;
    const cellsB = getItemFootprint(b.itemId, 0).cells.length;
    const prioA = estimateBaseItemPriority(a.itemId) + cellsA * 8;
    const prioB = estimateBaseItemPriority(b.itemId) + cellsB * 8;
    return prioB - prioA;
  });

  const heroBonuses = session.hero?.bonuses || {};
  const planA = packItemsGreedyWithOrder(session.bag, orderAuraCenter, heroBonuses);
  const planB = packItemsGreedyWithOrder(session.bag, orderBigMainsFirst, heroBonuses);

  const chosen = planA.totalScore >= planB.totalScore ? planA : planB;

  session.bag.items = chosen.bag.items;
  session.tray = Array(TRAY_CAPACITY).fill(null);
  chosen.leftover
    .sort((a, b) => estimateBaseItemPriority(b.itemId) - estimateBaseItemPriority(a.itemId))
    .slice(0, TRAY_CAPACITY)
    .forEach((entry, idx) => {
      session.tray[idx] = {
        uid: entry.uid,
        itemId: entry.itemId,
        rot: 0,
      };
    });

  refreshSynergies(session);

  return {
    ok: true,
    mergesCount,
    placedCount: session.bag.items.length,
    trayCount: session.tray.filter(Boolean).length,
    synergies: session.synergies,
  };
}

/**
 * 开启本轮实时战斗：自动补齐扩格 -> 自动结算正交相邻★神话融合 -> 生成并返回 BattleSimulator
 */
export function beginCombatPhase(session) {
  if (session.status !== 'prep' && session.status !== 'combat') {
    return null;
  }

  if (session.status === 'prep') {
    if (session.expandPoints > 0) {
      autoExpandBag(session);
    }

    const mythicMergeRes = resolveAdjacentMythicMerges(session.bag, {
      onOverflowToTray: (uidResult, resultId) => {
        const emptyIdx = session.tray.findIndex((t) => t === null);
        if (emptyIdx === -1) return false;
        session.tray[emptyIdx] = { uid: uidResult, itemId: resultId, rot: 0 };
        return true;
      },
    });

    if (mythicMergeRes.mergedCount > 0) {
      session.stats.mythicsCrafted += mythicMergeRes.mergedCount;
      for (const ev of mythicMergeRes.events) {
        session.lastMergeEvents.push({
          kind: 'mythic',
          itemA: ev.itemA,
          itemB: ev.itemB,
          resultId: ev.resultId,
          recipeId: ev.recipeId || null,
          uidResult: ev.uidResult,
          placedZone: ev.placedInBag ? 'bag' : 'tray',
        });
      }
    }

    refreshSynergies(session);
    session.status = 'combat';
  }

  const combatSeed =
    (session.seed ^
      Math.imul(session.round, 0x9e3779b9) ^
      Math.imul(session.hearts + 1, 0x85ebca6b) ^
      Math.imul(session.history.length + 1, 0xc2b2ae35)) >>>
    0;

  const simulator = createBattleSimulator({
    hero: session.hero,
    round: session.round,
    bag: session.bag,
    enemy: getEnemyByRound(session.round),
    seed: combatSeed,
  });

  return simulator;
}

/**
 * 结算本轮战斗胜负：发放红心扣减、连胜、扩建点数与下轮金币，或判定通关/惜败
 */
export function settleCombatResult(session, combatOutcome = {}) {
  if (session.status !== 'combat') {
    return { ok: false, reason: 'not_in_combat' };
  }

  const winner = combatOutcome.winner === 'player' ? 'player' : 'enemy';
  const elapsed = Number(combatOutcome.elapsed || 0);
  const playerHpLeft = Math.max(0, Number(combatOutcome.playerHpLeft || 0));
  const enemyHpLeft = Math.max(0, Number(combatOutcome.enemyHpLeft || 0));
  const enemyDef = getEnemyByRound(session.round);

  session.history.push({
    round: session.round,
    enemyId: enemyDef?.id || `enemy_${session.round}`,
    winner,
    elapsed: Number(elapsed.toFixed(2)),
  });

  if (winner === 'player') {
    session.winStreak += 1;
    if (session.round >= MAX_ROUNDS) {
      session.status = 'victory';
      session.lastBattleSummary = {
        round: session.round,
        winner,
        elapsed,
        playerHpLeft,
        enemyHpLeft,
        goldAwarded: 0,
        expandAwarded: 0,
      };
      return {
        ok: true,
        status: 'victory',
        round: session.round,
        hearts: session.hearts,
      };
    }
  } else {
    session.winStreak = 0;
    session.hearts = Math.max(0, session.hearts - 1);
    if (session.hearts <= 0) {
      session.status = 'defeat';
      session.lastBattleSummary = {
        round: session.round,
        winner,
        elapsed,
        playerHpLeft,
        enemyHpLeft,
        goldAwarded: 0,
        expandAwarded: 0,
      };
      return {
        ok: true,
        status: 'defeat',
        round: session.round,
        hearts: 0,
      };
    }
  }

  // 进入下一轮（Round 2..10，若第 10 轮战败且仍有红心则留在第 10 轮再战终极魔王）
  const foughtRound = session.round;
  const expandAwarded = winner === 'player' ? 3 : 2;
  session.expandPoints += expandAwarded;
  const overflowGold = convertOverflowExpandPoints(session);

  session.round = Math.min(MAX_ROUNDS, session.round + 1);
  session.rerollsThisRound = 0;

  const syn = refreshSynergies(session);
  const winStreakBonus = Math.min(session.winStreak, 3);
  const heroGoldBonus = Number(session.hero?.bonuses?.extraRoundGold || 0);
  const bagIncomeBonus = Number(syn.totals.roundGoldBonus || 0);
  const roundGold = 10 + session.round * 2 + winStreakBonus + heroGoldBonus + bagIncomeBonus;

  session.gold += roundGold;
  rollShopSlots(session, { keepLocked: true });

  session.lastBattleSummary = {
    round: foughtRound,
    winner,
    elapsed,
    playerHpLeft,
    enemyHpLeft,
    goldAwarded: roundGold + overflowGold,
    expandAwarded,
  };
  session.status = 'prep';

  return {
    ok: true,
    status: 'prep',
    round: session.round,
    hearts: session.hearts,
    goldAwarded: roundGold + overflowGold,
    expandAwarded,
  };
}

function collectOwnedItemIds(session) {
  const ids = [];
  for (const it of session.bag.items) ids.push(it.itemId);
  for (const t of session.tray) {
    if (t) ids.push(t.itemId);
  }
  return ids;
}

function scoreShopCandidateForAI(session, itemId) {
  const def = getItemById(itemId);
  if (!def) return -999;

  const ownedIds = collectOwnedItemIds(session);
  const ownedSet = new Set(ownedIds);
  let score = estimateBaseItemPriority(itemId);

  // 1. 直接触发★神话配方（优先尚未拥有的神话神装）或同名升阶
  for (const oid of ownedIds) {
    const compat = checkMergeCompatibility(itemId, oid);
    if (compat?.kind === 'mythic') {
      score += ownedSet.has(compat.resultId) ? 28 : 125;
      break;
    }
    if (compat?.kind === 'upgrade') {
      score += 95;
      break;
    }
  }

  // 2. 是否属于某条尚未拥有的神话配方的潜伏配件
  if (Array.isArray(MYTHIC_RECIPES)) {
    const isFreshIngredient = MYTHIC_RECIPES.some(
      (r) =>
        !ownedSet.has(r.resultId) &&
        (r.ingredientA?.includes(itemId) || r.ingredientB?.includes(itemId)),
    );
    if (isFreshIngredient) score += 14;
  }

  // 3. 阵容结构互补加分
  let weaponCount = 0;
  let armorCount = 0;
  let auraCount = 0;
  let hasRevive = false;
  for (const oid of ownedIds) {
    const oDef = getItemById(oid);
    if (!oDef) continue;
    if (oDef.category === 'weapon' || oDef.tags?.includes('weapon')) weaponCount += 1;
    if (oDef.category === 'armor' || oDef.tags?.includes('armor')) armorCount += 1;
    if (oDef.aura) auraCount += 1;
    if (oDef.combat?.revivePct > 0) hasRevive = true;
  }

  if ((def.category === 'weapon' || def.tags?.includes('weapon')) && weaponCount < 3) {
    score += 32;
  }
  if (def.aura && weaponCount >= 2 && auraCount < 4) {
    score += 28;
  }
  if ((def.category === 'armor' || def.tags?.includes('armor')) && session.round >= 3 && armorCount < 2) {
    score += 26;
  }
  if (def.combat?.revivePct > 0 && !hasRevive && session.round >= 5) {
    score += 45;
  }
  if (def.combat?.roundGoldBonus > 0) {
    score += session.round <= 4 ? 24 : -14;
  }

  return score;
}

/**
 * 供 QA 200 局平衡压测直接调用的单局完整 AI 模拟函数
 * @param {{ heroId: string, seed: number }} opts
 */
export function simulateFullRunAI({ heroId, seed = 1 } = {}) {
  const session = createSession(seed);
  selectHero(session, heroId);

  let safetyRounds = 0;
  while (session.status === 'prep' && safetyRounds < MAX_ROUNDS + INITIAL_HEARTS + 3) {
    safetyRounds += 1;
    autoExpandBag(session);

    let shopActions = 0;
    const maxRerollsPerRound = 2;
    while (shopActions < 9 && session.status === 'prep') {
      shopActions += 1;

      const affordable = session.shop
        .filter((s) => s && !s.sold && s.cost <= session.gold)
        .map((s) => ({ slot: s, score: scoreShopCandidateForAI(session, s.itemId) }))
        .sort((a, b) => b.score - a.score);

      let bought = false;
      for (const cand of affordable) {
        if (cand.score < 22) break;

        let res = buyShopItem(session, cand.slot.slotIndex);
        if (!res.ok && res.reason === 'no_space') {
          const arrRes = autoArrangeBag(session);
          if (arrRes.mergesCount > 0) {
            res = buyShopItem(session, cand.slot.slotIndex);
          }
        }

        if (!res.ok && res.reason === 'no_space') {
          const trayWeakest = session.tray
            .map((t, idx) => (t ? { zone: 'tray', index: idx, score: estimateBaseItemPriority(t.itemId) } : null))
            .filter(Boolean)
            .sort((a, b) => a.score - b.score)[0];

          const bagWeakest = session.bag.items
            .map((it) => ({ zone: 'bag', uid: it.uid, score: estimateBaseItemPriority(it.itemId) }))
            .sort((a, b) => a.score - b.score)[0];

          const weakest =
            trayWeakest && (!bagWeakest || trayWeakest.score <= bagWeakest.score)
              ? trayWeakest
              : bagWeakest;

          if (weakest && cand.score > weakest.score + 28) {
            sellItem(session, weakest);
            res = buyShopItem(session, cand.slot.slotIndex);
          }
        }

        if (res.ok) {
          bought = true;
          break;
        }
      }

      if (bought) continue;

      // 锁定买不起但能直接合成新★神话或高阶进化的高价值商品
      for (const s of session.shop) {
        if (s && !s.sold && s.cost > session.gold) {
          const sc = scoreShopCandidateForAI(session, s.itemId);
          if (sc >= 120 && !s.locked) {
            toggleShopSlotLock(session, s.slotIndex);
          }
        }
      }

      const rerollCost = getRerollCost(session);
      if (
        session.rerollsThisRound < maxRerollsPerRound &&
        (rerollCost === 0 || session.gold >= rerollCost + 5)
      ) {
        const rr = rerollShop(session);
        if (!rr.ok) break;
      } else {
        break;
      }
    }

    autoArrangeBag(session);
    const sim = beginCombatPhase(session);
    const outcome = sim.runToEnd();
    settleCombatResult(session, outcome);
  }

  const roundsCleared = session.history.filter((h) => h.winner === 'player').length;

  return {
    victory: session.status === 'victory',
    roundsCleared,
    finalRound: session.round,
    heartsLeft: session.hearts,
    mythicsCrafted: session.stats.mythicsCrafted,
    upgradesDone: session.stats.upgradesDone,
    history: session.history,
  };
}
