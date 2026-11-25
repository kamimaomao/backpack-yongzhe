// 《勇者塞满包 · 背包合成乱斗》1v1 独立 CD 实时模拟与毫秒级无头压测战斗引擎

import {
  HEROES,
  getEnemyByRound,
  getHeroById,
  getItemById,
} from './catalog.js';
import {
  computeBagSynergies,
  createInitialBag,
  findValidPlacementForItem,
  placeItemInBag,
} from './grid.js';
import { createRng } from './prng.js';

export const FIXED_TICK = 0.05;
export const POISON_TICK_INTERVAL = 0.5;
export const FRENZY_START_SEC = 15.0;
export const FRENZY_RATE_PER_SEC = 0.12;
export const HARD_TIMEOUT_SEC = 35.0;
export const CRIT_MULTIPLIER = 1.65;
export const HIT_STUN_SEC = 0.28;

const EPS = 1e-7;

function roundNum(n, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function rollChance(rng, prob0to1) {
  if (prob0to1 <= 0) return false;
  if (prob0to1 >= 1) return true;
  if (rng && typeof rng.chance === 'function') {
    return rng.chance(prob0to1);
  }
  return rng.next() < prob0to1;
}

/**
 * 为敌方装备列表构建对称的虚拟 5×7 全解锁背包，使敌方携带的光环挂件同样真实生效
 */
function buildEnemyVirtualBag(enemyItems = []) {
  const bag = createInitialBag();
  for (let r = 0; r < bag.rows; r++) {
    for (let c = 0; c < bag.cols; c++) {
      bag.unlocked[r][c] = true;
    }
  }

  const normalized = enemyItems
    .filter(Boolean)
    .map((entry, idx) => {
      if (typeof entry === 'string') {
        return { itemId: entry, rot: 0, order: idx };
      }
      return {
        itemId: entry.itemId,
        rot: entry.rot || 0,
        row: Number.isInteger(entry.row) ? entry.row : null,
        col: Number.isInteger(entry.col) ? entry.col : null,
        order: idx,
      };
    });

  // 先放明确指定了坐标的装备，再放带光环的核心挂件居中，最后围绕中心放武器与防具
  const withCoords = normalized.filter((e) => e.row !== null && e.col !== null);
  const withoutCoords = normalized
    .filter((e) => e.row === null || e.col === null)
    .sort((a, b) => {
      const defA = getItemById(a.itemId);
      const defB = getItemById(b.itemId);
      const auraA = defA?.aura ? 1 : 0;
      const auraB = defB?.aura ? 1 : 0;
      if (auraA !== auraB) return auraB - auraA;
      return a.order - b.order;
    });

  const unplaced = [];

  for (const e of withCoords) {
    const uid = `enemy_itm_${e.order + 1}`;
    const res = placeItemInBag(bag, e.itemId, e.row, e.col, e.rot, uid);
    if (!res.ok) {
      unplaced.push({ ...e, uid });
    }
  }

  for (const e of withoutCoords) {
    const uid = `enemy_itm_${e.order + 1}`;
    const pos = findValidPlacementForItem(bag, e.itemId, 2, 3, e.rot);
    if (pos) {
      placeItemInBag(bag, e.itemId, pos.row, pos.col, pos.rot, uid);
    } else {
      unplaced.push({ ...e, uid });
    }
  }

  // 保持与 enemyDef.items 原始定义一致的槽位顺序，方便前端 #enemy-loadout-bar 一一对应渲染
  bag.items.sort((a, b) => {
    const ia = Number(a.uid.replace('enemy_itm_', '')) || 0;
    const ib = Number(b.uid.replace('enemy_itm_', '')) || 0;
    return ia - ib;
  });

  return { bag, unplaced };
}

function createSlotsFromBagAndSynergies(bag, synergies, fallbackItems = []) {
  const slots = [];
  const reviveQueue = [];

  for (const it of bag.items) {
    const def = getItemById(it.itemId);
    const stat = synergies.itemStats[it.uid];
    if (!def || !stat) continue;

    if (def.combat?.revivePct > 0) {
      reviveQueue.push({
        uid: it.uid,
        itemId: it.itemId,
        revivePct: Number(def.combat.revivePct),
      });
    }

    slots.push({
      uid: it.uid,
      itemId: it.itemId,
      row: it.row,
      col: it.col,
      cooldown: stat.effectiveCd,
      timer: 0,
      progress: 0,
      triggerCount: 0,
      totalDamageDealt: 0,
      totalShieldGained: 0,
      totalHealDone: 0,
      // 内部战斗结算快照值
      damage: stat.damage,
      shield: stat.shield,
      heal: stat.heal,
      poison: stat.poison,
      chill: stat.chill,
      critPct: stat.critPct,
      vampPct: stat.vampPct,
      projectile: def.projectile || null,
      sfx: def.sfx || null,
    });
  }

  // 兜底：若敌方配置超出 35 格未塞入网格，仍保证其按基础属性参战
  for (const fb of fallbackItems) {
    const def = getItemById(fb.itemId);
    if (!def) continue;
    const combat = def.combat || {};
    if (combat.revivePct > 0) {
      reviveQueue.push({
        uid: fb.uid,
        itemId: fb.itemId,
        revivePct: Number(combat.revivePct),
      });
    }
    slots.push({
      uid: fb.uid,
      itemId: fb.itemId,
      row: 0,
      col: 0,
      cooldown: Number(def.cooldown || 0),
      timer: 0,
      progress: 0,
      triggerCount: 0,
      totalDamageDealt: 0,
      totalShieldGained: 0,
      totalHealDone: 0,
      damage: Number(combat.damage || 0),
      shield: Number(combat.shield || 0),
      heal: Number(combat.heal || 0),
      poison: Number(combat.poison || 0),
      chill: Number(combat.chill || 0),
      critPct: Number(combat.critPct || 0),
      vampPct: Number(combat.vampPct || 0),
      projectile: def.projectile || null,
      sfx: def.sfx || null,
    });
  }

  return { slots, reviveQueue };
}

function serializeFighter(f) {
  return {
    id: f.id,
    name: f.name,
    portrait: f.portrait,
    hitPortrait: f.hitPortrait,
    hp: Math.max(0, Math.round(f.hp)),
    maxHp: Math.round(f.maxHp),
    shield: Math.max(0, Math.round(f.shield)),
    poison: Math.max(0, Math.round(f.poison)),
    chill: Math.max(0, Math.round(f.chill)),
    dodgePct: f.dodgePct,
    thorns: f.thorns,
    hitStunTimer: roundNum(f.hitStunTimer, 3),
    reviveAvailable: f.reviveQueue.length > 0,
    slots: f.slots.map((s) => ({
      uid: s.uid,
      itemId: s.itemId,
      row: s.row,
      col: s.col,
      cooldown: s.cooldown,
      timer: roundNum(s.timer, 3),
      progress: s.cooldown > 0 ? Math.min(1, Math.max(0, roundNum(s.timer / s.cooldown, 4))) : 0,
      triggerCount: s.triggerCount,
      totalDamageDealt: s.totalDamageDealt,
      totalShieldGained: s.totalShieldGained,
      totalHealDone: s.totalHealDone,
    })),
  };
}

/**
 * 构建 1v1 背包实时战斗模拟器
 * @param {{
 *   hero: object | string,
 *   round?: number,
 *   bag: object,
 *   enemy?: object,
 *   seed?: number,
 * }} config
 */
export function createBattleSimulator(config = {}) {
  const round = Math.max(1, Number(config.round || 1));
  const heroDef =
    (typeof config.hero === 'string' ? getHeroById(config.hero) : config.hero) ||
    HEROES?.[0] || {
      id: 'berserker',
      name: '勇者',
      portrait: '',
      hitPortrait: '',
      baseHp: 170,
      hpPerRound: 46,
      bonuses: {},
    };

  const enemyDef = config.enemy || getEnemyByRound(round) || {
    id: `enemy_${round}`,
    name: `第${round}轮守卫`,
    portrait: '',
    hitPortrait: '',
    maxHp: 130 + (round - 1) * 80,
    startShield: 0,
    items: [],
  };

  const rng = createRng(config.seed ?? Date.now());
  const playerBag = config.bag || createInitialBag();
  const playerSynergies = computeBagSynergies(playerBag, heroDef.bonuses || {});
  const playerSetup = createSlotsFromBagAndSynergies(playerBag, playerSynergies);

  const playerMaxHp = Math.max(
    1,
    Math.round(
      Number(heroDef.baseHp || 170) +
        (round - 1) * Number(heroDef.hpPerRound || 46) +
        playerSynergies.totals.bonusMaxHp,
    ),
  );

  const player = {
    side: 'player',
    id: heroDef.id,
    name: heroDef.name,
    portrait: heroDef.portrait,
    hitPortrait: heroDef.hitPortrait || heroDef.portrait,
    hp: playerMaxHp,
    maxHp: playerMaxHp,
    shield: Math.max(0, playerSynergies.totals.startShield),
    poison: 0,
    chill: 0,
    dodgePct: playerSynergies.totals.bonusDodgePct,
    thorns: playerSynergies.totals.bonusThorns,
    hitStunTimer: 0,
    reviveQueue: playerSetup.reviveQueue,
    slots: playerSetup.slots,
    totalDamageDealt: 0,
  };

  const { bag: enemyBag, unplaced: enemyUnplaced } = buildEnemyVirtualBag(enemyDef.items || []);
  const enemySynergies = computeBagSynergies(enemyBag, {
    startShield: Number(enemyDef.startShield || 0),
    bonusThorns: Number(enemyDef.bonusThorns || 0),
    bonusDodgePct: Number(enemyDef.bonusDodgePct || 0),
  });
  const enemySetup = createSlotsFromBagAndSynergies(enemyBag, enemySynergies, enemyUnplaced);

  const enemyMaxHp = Math.max(
    1,
    Math.round(Number(enemyDef.maxHp || 130) + enemySynergies.totals.bonusMaxHp),
  );

  const enemy = {
    side: 'enemy',
    id: enemyDef.id || `enemy_${round}`,
    name: enemyDef.name || `第${round}轮强敌`,
    portrait: enemyDef.portrait || '',
    hitPortrait: enemyDef.hitPortrait || enemyDef.portrait || '',
    hp: enemyMaxHp,
    maxHp: enemyMaxHp,
    shield: Math.max(0, enemySynergies.totals.startShield),
    poison: 0,
    chill: 0,
    dodgePct: enemySynergies.totals.bonusDodgePct,
    thorns: enemySynergies.totals.bonusThorns,
    hitStunTimer: 0,
    reviveQueue: enemySetup.reviveQueue,
    slots: enemySetup.slots,
    totalDamageDealt: 0,
  };

  let elapsed = 0;
  let poisonTimer = 0;
  let frenzyStarted = false;
  let frenzyMult = 1.0;
  let finished = false;
  let winner = null;
  let totalTriggers = 0;

  function computeFrenzyMultiplier(timeSec) {
    if (timeSec <= FRENZY_START_SEC) return 1.0;
    return 1 + (timeSec - FRENZY_START_SEC) * FRENZY_RATE_PER_SEC;
  }

  function checkDeathOrRevive(unit, events) {
    if (finished || unit.hp > 0) return false;

    if (unit.reviveQueue.length > 0) {
      const rev = unit.reviveQueue.shift();
      const restoredHp = Math.max(1, Math.round(unit.maxHp * rev.revivePct));
      unit.hp = Math.min(unit.maxHp, restoredHp);
      unit.poison = 0;
      unit.chill = 0;
      events.push({
        time: roundNum(elapsed, 3),
        type: 'revive',
        side: unit.side,
        targetSide: unit.side,
        sourceUid: rev.uid,
        itemId: rev.itemId,
        amount: unit.hp,
        sfx: 'GongXiHuoDe',
      });
      return false;
    }

    finished = true;
    winner = unit.side === 'enemy' ? 'player' : 'enemy';
    events.push({
      time: roundNum(elapsed, 3),
      type: 'battle_end',
      side: winner,
      winner,
    });
    return true;
  }

  function inflictDamageWithShield(defender, amount) {
    const dmg = Math.max(1, Math.round(amount));
    let rem = dmg;
    if (defender.shield > 0) {
      const blocked = Math.min(defender.shield, rem);
      defender.shield -= blocked;
      rem -= blocked;
    }
    if (rem > 0) {
      defender.hp = Math.max(0, defender.hp - rem);
    }
    defender.hitStunTimer = HIT_STUN_SEC;
    return dmg;
  }

  function applyHealToUnit(actor, rawHeal, sourceSlot, events) {
    if (rawHeal <= 0 || actor.hp <= 0) return 0;
    const amount = Math.max(1, Math.round(rawHeal));
    const before = actor.hp;
    actor.hp = Math.min(actor.maxHp, actor.hp + amount);
    const actual = actor.hp - before;
    if (sourceSlot) {
      sourceSlot.totalHealDone += actual > 0 ? actual : amount;
    }
    if (actual > 0) {
      events.push({
        time: roundNum(elapsed, 3),
        type: 'heal',
        side: actor.side,
        targetSide: actor.side,
        sourceUid: sourceSlot?.uid,
        itemId: sourceSlot?.itemId,
        amount: actual,
      });
    }
    return actual;
  }

  function updateFighterSlots(actor, defender, dt, events) {
    if (finished || actor.hp <= 0 || defender.hp <= 0) return;

    const chillFactor = 1 - Math.min(0.45, actor.chill * 0.018);
    const effDt = dt * chillFactor;

    for (const slot of actor.slots) {
      if (finished || actor.hp <= 0 || defender.hp <= 0) break;
      if (slot.cooldown <= 0) continue;

      slot.timer = roundNum(slot.timer + effDt, 6);

      while (slot.timer + EPS >= slot.cooldown && !finished) {
        slot.timer = Math.max(0, roundNum(slot.timer - slot.cooldown, 6));
        slot.triggerCount += 1;
        totalTriggers += 1;

        events.push({
          time: roundNum(elapsed, 3),
          type: 'item_fire',
          side: actor.side,
          targetSide: defender.side,
          sourceUid: slot.uid,
          itemId: slot.itemId,
          projectile: slot.projectile,
          sfx: slot.sfx,
          poisonAdded: slot.damage === 0 && slot.poison > 0 ? slot.poison : undefined,
          chillAdded: slot.damage === 0 && slot.chill > 0 ? slot.chill : undefined,
        });

        // 1. 攻击判定（闪避 / 暴击 / 扣盾扣血 / 附毒附冰 / 吸血 / 荆棘反震）
        if (slot.damage > 0) {
          const dodged = defender.dodgePct > 0 && rollChance(rng, defender.dodgePct / 100);
          if (dodged) {
            events.push({
              time: roundNum(elapsed, 3),
              type: 'dodge',
              side: actor.side,
              targetSide: defender.side,
              sourceUid: slot.uid,
              itemId: slot.itemId,
            });
          } else {
            const critChance = Math.min(85, Math.max(0, slot.critPct));
            const isCrit = critChance > 0 && rollChance(rng, critChance / 100);
            const rawDmg = slot.damage * (isCrit ? CRIT_MULTIPLIER : 1.0) * frenzyMult;
            const finalDmg = inflictDamageWithShield(defender, rawDmg);

            slot.totalDamageDealt += finalDmg;
            actor.totalDamageDealt += finalDmg;

            if (slot.poison > 0) {
              defender.poison += slot.poison;
            }
            if (slot.chill > 0) {
              defender.chill += slot.chill;
            }

            events.push({
              time: roundNum(elapsed, 3),
              type: 'damage',
              side: actor.side,
              targetSide: defender.side,
              sourceUid: slot.uid,
              itemId: slot.itemId,
              projectile: slot.projectile,
              sfx: slot.sfx,
              amount: finalDmg,
              isCrit,
              poisonAdded: slot.poison > 0 ? slot.poison : undefined,
              chillAdded: slot.chill > 0 ? slot.chill : undefined,
            });

            if (slot.vampPct > 0 && actor.hp > 0) {
              const vampHeal = Math.max(1, Math.round((finalDmg * slot.vampPct) / 100));
              applyHealToUnit(actor, vampHeal, slot, events);
            }

            if (checkDeathOrRevive(defender, events)) break;

            // 受击方荆棘反伤
            if (defender.thorns > 0 && actor.hp > 0 && !finished) {
              const thornDmg = inflictDamageWithShield(actor, defender.thorns);
              defender.totalDamageDealt += thornDmg;
              events.push({
                time: roundNum(elapsed, 3),
                type: 'thorns',
                side: defender.side,
                targetSide: actor.side,
                amount: thornDmg,
              });
              if (checkDeathOrRevive(actor, events)) break;
            }
          }
        } else {
          // 2. 纯非攻击类减益道具（如独立毒瓶、冰霜秘药）
          if (slot.poison > 0) {
            defender.poison += slot.poison;
          }
          if (slot.chill > 0) {
            defender.chill += slot.chill;
          }
        }

        if (finished || actor.hp <= 0) break;

        // 3. 自身叠盾与直接治疗结算
        if (slot.shield > 0) {
          const shieldGain = Math.max(1, Math.round(slot.shield));
          actor.shield += shieldGain;
          slot.totalShieldGained += shieldGain;
          events.push({
            time: roundNum(elapsed, 3),
            type: 'shield',
            side: actor.side,
            targetSide: actor.side,
            sourceUid: slot.uid,
            itemId: slot.itemId,
            amount: shieldGain,
          });
        }

        if (slot.heal > 0) {
          applyHealToUnit(actor, slot.heal, slot, events);
        }
      }

      slot.progress =
        slot.cooldown > 0 ? Math.min(1, Math.max(0, slot.timer / slot.cooldown)) : 0;
    }
  }

  function advanceSubStep(dt, events, maxAllowedSec = HARD_TIMEOUT_SEC) {
    if (finished || dt <= 0) return;

    elapsed = roundNum(elapsed + dt, 6);

    player.hitStunTimer = Math.max(0, roundNum(player.hitStunTimer - dt, 4));
    enemy.hitStunTimer = Math.max(0, roundNum(enemy.hitStunTimer - dt, 4));

    if (!frenzyStarted && elapsed + EPS >= FRENZY_START_SEC) {
      frenzyStarted = true;
      events.push({
        time: roundNum(elapsed, 3),
        type: 'frenzy_start',
        side: 'player',
      });
    }
    frenzyMult = computeFrenzyMultiplier(elapsed);

    // 推进我方与敌方全部主动装备 CD
    updateFighterSlots(player, enemy, dt, events);
    if (!finished) {
      updateFighterSlots(enemy, player, dt, events);
    }

    // 剧毒每 0.5s 周期结算（无视护盾直伤，随后层数 -1）
    if (!finished) {
      poisonTimer = roundNum(poisonTimer + dt, 6);
      while (poisonTimer + EPS >= POISON_TICK_INTERVAL && !finished) {
        poisonTimer = Math.max(0, roundNum(poisonTimer - POISON_TICK_INTERVAL, 6));

        // 敌方身上的毒（由玩家施加）
        if (enemy.poison > 0 && enemy.hp > 0) {
          const pDmg = Math.max(1, Math.round(enemy.poison * frenzyMult));
          enemy.hp = Math.max(0, enemy.hp - pDmg);
          enemy.hitStunTimer = HIT_STUN_SEC;
          player.totalDamageDealt += pDmg;
          enemy.poison = Math.max(0, enemy.poison - 1);
          events.push({
            time: roundNum(elapsed, 3),
            type: 'poison_tick',
            side: 'player',
            targetSide: 'enemy',
            amount: pDmg,
          });
          if (checkDeathOrRevive(enemy, events)) break;
        }

        // 玩家身上的毒（由敌方施加）
        if (!finished && player.poison > 0 && player.hp > 0) {
          const pDmg = Math.max(1, Math.round(player.poison * frenzyMult));
          player.hp = Math.max(0, player.hp - pDmg);
          player.hitStunTimer = HIT_STUN_SEC;
          enemy.totalDamageDealt += pDmg;
          player.poison = Math.max(0, player.poison - 1);
          events.push({
            time: roundNum(elapsed, 3),
            type: 'poison_tick',
            side: 'enemy',
            targetSide: 'player',
            amount: pDmg,
          });
          if (checkDeathOrRevive(player, events)) break;
        }
      }
    }

    // 硬超时结算：按剩余生命百分比高者获胜（相等判玩家险胜）
    if (!finished && elapsed + EPS >= maxAllowedSec) {
      const playerRatio = player.hp / player.maxHp;
      const enemyRatio = enemy.hp / enemy.maxHp;
      winner = playerRatio >= enemyRatio ? 'player' : 'enemy';
      finished = true;
      events.push({
        time: roundNum(elapsed, 3),
        type: 'battle_end',
        side: winner,
        winner,
      });
    }
  }

  function step(dtSec = FIXED_TICK, maxAllowedSec = HARD_TIMEOUT_SEC) {
    const events = [];
    if (finished || !Number.isFinite(dtSec) || dtSec <= 0) {
      return { events, finished, winner };
    }

    let remaining = dtSec;
    while (remaining > EPS && !finished) {
      const slice = remaining > FIXED_TICK + EPS ? FIXED_TICK : remaining;
      advanceSubStep(slice, events, maxAllowedSec);
      remaining = roundNum(remaining - slice, 6);
    }

    return { events, finished, winner };
  }

  function getState() {
    return {
      elapsed: roundNum(elapsed, 3),
      frenzyMult: roundNum(frenzyMult, 3),
      finished,
      winner,
      player: serializeFighter(player),
      enemy: serializeFighter(enemy),
    };
  }

  function runToEnd(maxSimSec = HARD_TIMEOUT_SEC) {
    const limitSec = Math.max(1, Math.min(HARD_TIMEOUT_SEC, Number(maxSimSec || HARD_TIMEOUT_SEC)));
    let safety = 0;
    const maxLoops = Math.ceil(limitSec / FIXED_TICK) + 20;

    while (!finished && safety < maxLoops) {
      safety += 1;
      step(FIXED_TICK, limitSec);
    }

    if (!finished) {
      const playerRatio = player.hp / player.maxHp;
      const enemyRatio = enemy.hp / enemy.maxHp;
      winner = playerRatio >= enemyRatio ? 'player' : 'enemy';
      finished = true;
    }

    return {
      winner,
      elapsed: roundNum(elapsed, 2),
      playerHpLeft: Math.max(0, Math.round(player.hp)),
      playerMaxHp: Math.round(player.maxHp),
      enemyHpLeft: Math.max(0, Math.round(enemy.hp)),
      enemyMaxHp: Math.round(enemy.maxHp),
      stats: {
        playerTotalDmg: Math.round(player.totalDamageDealt),
        enemyTotalDmg: Math.round(enemy.totalDamageDealt),
        triggers: totalTriggers,
      },
    };
  }

  return {
    getState,
    step,
    runToEnd,
  };
}

/**
 * 纯无头高速战斗结算（供 200 局 AI 压测毫秒级执行）
 */
export function runHeadlessCombat(config) {
  return createBattleSimulator(config).runToEnd();
}
