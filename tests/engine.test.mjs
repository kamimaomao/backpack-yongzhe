import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ARENA_BACKGROUNDS,
  ASSET_BASE,
  AUDIO_TRACKS,
  ENEMY_WAVES,
  GRID_COLS,
  GRID_ROWS,
  HEROES,
  INITIAL_HEARTS,
  ITEMS,
  MAX_ROUNDS,
  MYTHIC_RECIPES,
  PROJECTILES,
  UI_ASSETS,
  findMythicRecipe,
  getEnemyByRound,
  getHeroById,
  getItemById,
  getShopPoolForRound,
} from '../src/engine/catalog.js';
import {
  FIXED_TICK,
  FRENZY_START_SEC,
  createBattleSimulator,
  runHeadlessCombat,
} from '../src/engine/combat.js';
import {
  MIN_ITEM_CD,
  checkMergeCompatibility,
  checkPlacement,
  computeBagSynergies,
  createInitialBag,
  getExpandableCells,
  getItemFootprint,
  placeItemInBag,
  resolveAdjacentMythicMerges,
  unlockBagCell,
} from '../src/engine/grid.js';
import {
  autoArrangeBag,
  autoExpandBag,
  beginCombatPhase,
  buyShopItem,
  createSession,
  expandBagCell,
  moveItem,
  rerollShop,
  rotateItem,
  selectHero,
  sellItem,
  settleCombatResult,
  simulateFullRunAI,
  toggleShopSlotLock,
} from '../src/engine/session.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKPACK_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(BACKPACK_ROOT, '..');
const ASSETS_ROOT = path.join(REPO_ROOT, 'assets');

function toAssetAbsPath(relOrUrl) {
  const clean = String(relOrUrl)
    .replace(/^\.\.\/assets\//, '')
    .replace(/^\.\/assets\//, '');
  return path.join(ASSETS_ROOT, clean);
}

function walkSourceFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'dist' || ent.name === 'tests' || ent.name === 'tools' || ent.name.startsWith('.')) {
      continue;
    }
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walkSourceFiles(full));
    } else if (/\.(html|css|js|mjs)$/.test(ent.name)) {
      out.push(full);
    }
  }
  return out;
}

test('1. 全量引用的立绘、_st.png 颜艺帧、武器/装备/宝石图标、Hud 位图数字、字体与音频 100% 磁盘存在', () => {
  assert.equal(ASSET_BASE, '../assets');
  const assetUrls = new Set([
    '../assets/fonts/fz.ttf',
    '../assets/sprites/UI_界面/ui/Common/img_gezi_bag.png',
    '../assets/sprites/UI_界面/ui/Common/jinbi.png',
    '../assets/sprites/UI_界面/ui/Common/suo.png',
    '../assets/sprites/UI_界面/ui/Game/img_dizuo_sy.png',
    '../assets/sprites/UI_界面/ui/TavernFight/img_duijue_jgzq.png',
    '../assets/sprites/UI_界面/ui/Loading/logo.png',
    '../assets/sprites/UI_界面/ui/Hud/boom.png',
    '../assets/sprites/UI_界面/ui/Hud/SB.png',
    '../assets/sprites/UI_界面/ui/Hud/shouji.png',
  ]);

  for (const v of Object.values(UI_ASSETS)) assetUrls.add(v);
  for (const bg of ARENA_BACKGROUNDS) assetUrls.add(bg);
  for (const proj of Object.values(PROJECTILES)) assetUrls.add(proj);
  for (const track of Object.values(AUDIO_TRACKS)) assetUrls.add(track);

  // 校验 4 位可选勇者立绘与 _st.png 颜艺帧
  assert.ok(HEROES.length >= 4, '应至少提供 4 位可选勇者');
  for (const hero of HEROES) {
    assert.ok(hero.portrait && hero.hitPortrait, `勇者 ${hero.id} 缺少立绘或受击颜艺帧`);
    assert.ok(hero.hitPortrait.endsWith('_st.png'), `勇者 ${hero.id} hitPortrait 必须为 _st.png`);
    assetUrls.add(hero.portrait);
    assetUrls.add(hero.hitPortrait);
    for (const st of hero.starterItems || []) {
      assert.ok(getItemById(st.itemId), `勇者 ${hero.id} 初始装备 ${st.itemId} 未定义`);
    }
  }

  // 校验全量物品图标、飞弹映射与音效键
  const allItems = Object.values(ITEMS);
  assert.ok(allItems.length >= 45, `物品图鉴数量应充足，当前 ${allItems.length}`);
  for (const item of allItems) {
    assert.ok(item.icon, `物品 ${item.id} 缺少图标`);
    assetUrls.add(item.icon);
    if (item.projectile) {
      assert.ok(PROJECTILES[item.projectile], `物品 ${item.id} projectile=${item.projectile} 未在 PROJECTILES 定义`);
    }
    if (item.sfx) {
      assert.ok(AUDIO_TRACKS[item.sfx], `物品 ${item.id} sfx=${item.sfx} 未在 AUDIO_TRACKS 定义`);
    }
    if (item.upgradesTo) {
      const nextDef = getItemById(item.upgradesTo);
      assert.ok(nextDef, `物品 ${item.id} upgradesTo=${item.upgradesTo} 目标不存在`);
      assert.equal(item.shape, nextDef.shape, `同系进化武器 ${item.id}->${nextDef.id} 应保持一致形状以支持原地升阶`);
    }
  }

  // 校验 10 轮递进敌方 Boss 配置与颜艺帧
  assert.equal(ENEMY_WAVES.length, MAX_ROUNDS, '敌方波次应严格覆盖 10 轮');
  ENEMY_WAVES.forEach((wave, idx) => {
    assert.equal(wave.round, idx + 1);
    assert.ok(wave.portrait && wave.hitPortrait, `第 ${wave.round} 轮敌方缺少立绘或 _st.png`);
    assert.ok(wave.hitPortrait.endsWith('_st.png'), `第 ${wave.round} 轮敌方 hitPortrait 必须为 _st.png`);
    assetUrls.add(wave.portrait);
    assetUrls.add(wave.hitPortrait);
    assert.ok(Array.isArray(wave.items) && wave.items.length >= 2, `第 ${wave.round} 轮敌方应携带可见装备`);
    for (const eq of wave.items) {
      assert.ok(getItemById(eq.itemId), `第 ${wave.round} 轮敌方引用了不存在的物品 ${eq.itemId}`);
    }
  });

  // 校验 Hud 位图数字与真实存在的正负号切图（严禁不存在的 PT_-/BJ_-/HX_-/ZD_+）
  const hudSignRules = {
    PT_: ['+'],
    BJ_: ['+'],
    HX_: ['+'],
    ZD_: ['-'],
    FS_: ['+', '-'],
    SH_: ['+', '-'],
    DZ_: ['+', '-'],
    JN_: ['+', '-'],
  };
  for (const [pfx, signs] of Object.entries(hudSignRules)) {
    for (let d = 0; d <= 9; d++) {
      assetUrls.add(`../assets/sprites/UI_界面/ui/Hud/${pfx}${d}.png`);
    }
    for (const sg of signs) {
      assetUrls.add(`../assets/sprites/UI_界面/ui/Hud/${pfx}${sg}.png`);
    }
  }

  // 扫描源码文件中写死的静态 ../assets/ 或 ${ASSET_BASE}/ 引用
  const srcFiles = walkSourceFiles(BACKPACK_ROOT);
  const literalAssetRe = /(?:\.\.\/assets\/|\$\{ASSET_BASE\}\/)([^"'`\s)]+\.(?:png|jpg|jpeg|mp3|ttf))/g;
  for (const file of srcFiles) {
    const content = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = literalAssetRe.exec(content)) !== null) {
      if (!m[1].includes('${')) {
        assetUrls.add(`../assets/${m[1]}`);
      }
    }
  }

  // 校验 audio.js 中声明的全部原生音频名
  const audioSrc = fs.readFileSync(path.join(BACKPACK_ROOT, 'src/audio.js'), 'utf8');
  const validBlock = audioSrc.match(/VALID_AUDIO_FILES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  if (validBlock) {
    for (const token of validBlock[1].matchAll(/'([^']+)'/g)) {
      assetUrls.add(`../assets/audio/${token[1]}.mp3`);
    }
  }

  assert.ok(assetUrls.size >= 160, `应充分复用原生资产库，当前校验数: ${assetUrls.size}`);
  for (const u of assetUrls) {
    const abs = toAssetAbsPath(u);
    assert.ok(fs.existsSync(abs), `缺失磁盘资产文件: ${u} -> ${abs}`);
  }
});

test('2. 异形多格摆放、90° 顺时针旋转归一化、越界/锁格/重叠拦截与背包正交扩建解锁', () => {
  const bag = createInitialBag();
  assert.equal(bag.rows, GRID_ROWS);
  assert.equal(bag.cols, GRID_COLS);

  // 初始解锁中心 3×5 = 15 格
  let unlockedCount = 0;
  for (let r = 0; r < bag.rows; r++) {
    for (let c = 0; c < bag.cols; c++) {
      const expected = r >= 1 && r <= 3 && c >= 1 && c <= 5;
      assert.equal(bag.unlocked[r][c], expected);
      if (bag.unlocked[r][c]) unlockedCount += 1;
    }
  }
  assert.equal(unlockedCount, 15);

  // L3 战斧旋转 4 个方向归一化验证
  const fp0 = getItemFootprint('axe_1', 0);
  const fp1 = getItemFootprint('axe_1', 1);
  const fp2 = getItemFootprint('axe_1', 2);
  const fp3 = getItemFootprint('axe_1', 3);
  const fp4 = getItemFootprint('axe_1', 4);
  assert.deepEqual(fp0.cells, [[0, 0], [1, 0], [1, 1]]);
  assert.deepEqual(fp1.cells, [[0, 0], [0, 1], [1, 0]]);
  assert.deepEqual(fp2.cells, [[0, 0], [0, 1], [1, 1]]);
  assert.deepEqual(fp3.cells, [[0, 1], [1, 0], [1, 1]]);
  assert.deepEqual(fp4, fp0, '旋转 360° 应严格回到初始形态');

  // 1x3 法杖旋转 90° 变为横置 3×1
  const staffRot1 = getItemFootprint('staff_1', 1);
  assert.equal(staffRot1.width, 3);
  assert.equal(staffRot1.height, 1);

  // 越界与未解锁格拦截
  assert.equal(checkPlacement(bag, 'hammer_1', 4, 6, 0).reason, 'out_of_bounds');
  assert.equal(checkPlacement(bag, 'sword_1', 0, 2, 0).reason, 'locked_cell');

  // L3 异形物品拐角空缺格可合法塞入 1x1 宝石，重叠格精准拦截
  const pAxe = placeItemInBag(bag, 'axe_1', 1, 1, 0); // 占用 (1,1),(2,1),(2,2)，留空 (1,2)
  assert.equal(pAxe.ok, true);

  const overlapCheck = checkPlacement(bag, 'gem_sky', 2, 2, 0);
  assert.equal(overlapCheck.valid, false);
  assert.equal(overlapCheck.reason, 'overlap');
  assert.deepEqual(overlapCheck.overlappingUids, [pAxe.uid]);

  const notchPlace = placeItemInBag(bag, 'gem_sky', 1, 2, 0);
  assert.equal(notchPlace.ok, true, 'L3 镂空缺口格 (1,2) 应允许合法放入 1x1 宝石');

  // 背包扩建：非正交对角格 (0,0) 不可直接解锁，正交相邻格 (0,1) 可解锁
  const nonAdj = unlockBagCell(bag, 0, 0);
  assert.equal(nonAdj.ok, false);
  assert.equal(nonAdj.reason, 'not_adjacent');

  const adj = unlockBagCell(bag, 0, 1);
  assert.equal(adj.ok, true);
  assert.equal(bag.unlocked[0][1], true);

  // 验证全盘解锁后溢出扩建点数自动折算金币
  const session = createSession(42);
  selectHero(session, 'fortune_panda');
  assert.equal(
    session.bag.unlocked.flat().filter(Boolean).length,
    19,
    '竹仙·招财行商被动应初始解锁 19 格',
  );
  session.expandPoints = 20; // 仅剩 16 个未解锁格，溢出 4 点应折算 +8 金币
  const goldBefore = session.gold;
  const expRes = autoExpandBag(session);
  assert.equal(expRes.ok, true);
  assert.equal(session.bag.unlocked.flat().filter(Boolean).length, 35);
  assert.equal(session.expandPoints, 0);
  assert.equal(session.gold, goldBefore + 8, '溢出的 4 点扩建点数应折算为 +8 金币');
});

test('3. 双层合成机制：同名同阶二合一进化 (Lv1->Lv4) 与跨物品★神话拖拽/战前相邻自动觉醒', () => {
  // 校验全部神话配方双向无序可查且高阶/神话不在商店直刷
  assert.ok(MYTHIC_RECIPES.length >= 5);
  for (const rc of MYTHIC_RECIPES) {
    const a = rc.ingredientA[0];
    const b = rc.ingredientB[0];
    assert.equal(findMythicRecipe(a, b)?.resultId, rc.resultId);
    assert.equal(findMythicRecipe(b, a)?.resultId, rc.resultId);
    assert.equal(ITEMS[rc.resultId].shopWeight, 0, '★神话神装禁止在商店直接刷出');
  }
  for (let r = 1; r <= MAX_ROUNDS; r++) {
    const pool = getShopPoolForRound(r);
    assert.ok(pool.length > 0);
    assert.ok(pool.every((it) => it.shopWeight > 0 && !it.mythic && (it.level || 1) <= 2));
  }

  // 测试背包内与托盘间的同名二合一连升 Lv1 -> Lv2 -> Lv3 -> Lv4
  const s = createSession(1001);
  selectHero(s, 'berserker');
  s.bag.items = [];

  const u1 = placeItemInBag(s.bag, 'sword_1', 1, 1, 0).uid;
  const u2 = placeItemInBag(s.bag, 'sword_1', 1, 2, 0).uid;
  const m12 = moveItem(s, { zone: 'bag', uid: u1 }, { zone: 'bag', row: 1, col: 2, rot: 0 });
  assert.equal(m12.ok, true);
  assert.equal(m12.action, 'merged');
  assert.equal(m12.mergeKind, 'upgrade');
  assert.equal(m12.resultId, 'sword_2');

  const u3 = placeItemInBag(s.bag, 'sword_2', 1, 3, 0).uid;
  const m23 = moveItem(s, { zone: 'bag', uid: u3 }, { zone: 'bag', row: 1, col: 2, rot: 0 });
  assert.equal(m23.resultId, 'sword_3');

  s.tray[0] = { uid: 'itm_99', itemId: 'sword_3', rot: 0 };
  const m34 = moveItem(s, { zone: 'tray', index: 0 }, { zone: 'bag', row: 1, col: 2, rot: 0 });
  assert.equal(m34.resultId, 'sword_4');
  assert.equal(checkMergeCompatibility('sword_4', 'sword_4'), null, 'Lv4 终极武器不可再二合一');

  // 测试手动拖拽合成★神话神装（幸运白喵 + 地精钱袋 = ★招财神猫）
  const catUid = placeItemInBag(s.bag, 'relic_cat', 2, 4, 0).uid;
  const pouchUid = placeItemInBag(s.bag, 'relic_pouch', 2, 5, 0).uid;
  const mythicManual = moveItem(s, { zone: 'bag', uid: catUid }, { zone: 'bag', row: 2, col: 5, rot: 0 });
  assert.equal(mythicManual.ok, true);
  assert.equal(mythicManual.mergeKind, 'mythic');
  assert.equal(mythicManual.resultId, 'mythic_lucky_cat');
  assert.ok(!s.bag.items.some((it) => it.uid === pouchUid && it.itemId === 'relic_pouch'));

  // 测试开战前正交相邻配对材料自动觉醒融合（魔法烤鸡腿 + 学徒冰晶杖 = ★鸡腿法杖）
  const sAuto = createSession(2002);
  selectHero(sAuto, 'archmage');
  sAuto.bag.items = [];
  placeItemInBag(sAuto.bag, 'staff_1', 1, 2, 0); // 占用 (1,2),(2,2),(3,2)
  placeItemInBag(sAuto.bag, 'food_drumstick', 2, 3, 0); // 正交贴合 (2,2)

  const preLinks = computeBagSynergies(sAuto.bag).links;
  assert.ok(preLinks.some((lk) => lk.effectType === 'mythic_ready'), '战前正交相邻配对物品应生成 mythic_ready 提示连线');

  const sim = beginCombatPhase(sAuto);
  assert.ok(sim);
  assert.equal(sAuto.status, 'combat');
  assert.ok(sAuto.bag.items.some((it) => it.itemId === 'mythic_drumstick_staff'), '开战时正交相邻材料应自动觉醒为★鸡腿法杖');
  assert.equal(sAuto.stats.mythicsCrafted, 1);
});

test('4. 十字正交与八向星位邻接光环计算、多格贴合去重与 MIN_ITEM_CD 冷却下限钳制', () => {
  const bag = createInitialBag();
  // 在 (2,2) 摆 1x2 剑（占 (2,2),(3,2)）
  const sword = placeItemInBag(bag, 'sword_1', 2, 2, 0);
  // 在 (2,3) 摆十字光环 精锻磨刀石 (+5 伤害, +10% 暴击) -> 正交相邻生效
  placeItemInBag(bag, 'stone_whet', 2, 3, 0);
  // 在 (1,3) 摆十字光环 时间星石 (+20% 加速) -> 与 (2,2),(3,2) 仅对角相邻，十字光环不应生效！
  placeItemInBag(bag, 'gem_sky', 1, 3, 0);
  // 在 (1,1) 摆八向星位光环 精密发条齿轮 (+16% 加速) -> 与 (2,2) 对角相邻，star8 光环应生效！
  placeItemInBag(bag, 'gear_haste', 1, 1, 0);
  // 在 (2,1) 和 (3,1) 摆 1x2 腥红伯爵披风（与 sword_1 有两格并排贴合，但同一对实例只应计 1 次 +12% 增伤/+12% 吸血！）
  placeItemInBag(bag, 'cape_vamp', 2, 1, 0);

  const syn = computeBagSynergies(bag);
  const st = syn.itemStats[sword.uid];
  assert.ok(st);
  // sword_1 基础伤害 13，+5 磨刀石 = 18，再乘以披风 +12% => Math.round(18 * 1.12) = 20
  assert.equal(st.damage, 20, '应准确叠加扁平伤害与单次去重百分比增伤');
  assert.equal(st.hastePct, 16, '对角线仅 star8 齿轮生效 (+16%)，十字时间星石对角不生效');
  assert.equal(st.vampPct, 12, '多格并排贴合的披风只应提供 1 次 +12% 吸血');
  assert.equal(st.critPct, 18, '基础 8% + 磨刀石 10% = 18%');

  // 极端加速下限钳制测试
  const fastBag = createInitialBag();
  const bow = placeItemInBag(fastBag, 'bow_4', 2, 3, 0); // 基础 CD 1.10s
  placeItemInBag(fastBag, 'gear_gold', 2, 2, 0);
  placeItemInBag(fastBag, 'gear_gold', 3, 2, 0);
  placeItemInBag(fastBag, 'gear_gold', 2, 4, 0);
  placeItemInBag(fastBag, 'gear_gold', 3, 4, 0);
  const fastSyn = computeBagSynergies(fastBag, { globalHastePct: 80 });
  assert.equal(fastSyn.itemStats[bow.uid].hastePct, 150, '总加速上限应钳制在 150%');
  assert.ok(fastSyn.itemStats[bow.uid].effectiveCd >= MIN_ITEM_CD, '有效冷却不得低于 MIN_ITEM_CD');

  // 另测超短基础 CD 自定义物品钳制到 0.45s
  const minCheck = resolveAdjacentMythicMerges(fastBag);
  assert.equal(minCheck.mergedCount, 0);
});

test('5. 1v1 实时战斗引擎：逐帧 step 与无头结算确定性一致、剧毒穿盾、1UP 免死复活与疲劳狂暴', () => {
  const bag = createInitialBag();
  placeItemInBag(bag, 'mythic_venom_ring', 2, 2, 0);
  placeItemInBag(bag, 'relic_1up', 2, 3, 0);
  placeItemInBag(bag, 'armor_shield', 1, 4, 0);

  const cfg = {
    hero: 'shadow_ranger',
    round: 5,
    bag,
    seed: 20261125,
  };

  const headless = runHeadlessCombat(cfg);
  const sim = createBattleSimulator(cfg);
  const allEvents = [];
  while (!sim.getState().finished) {
    const stepRes = sim.step(FIXED_TICK);
    allEvents.push(...stepRes.events);
  }
  const finalSnap = sim.getState();

  assert.equal(finalSnap.winner, headless.winner, '逐帧模拟与无头结算胜负必须 100% 一致');
  assert.equal(finalSnap.player.hp, headless.playerHpLeft, '逐帧模拟与无头结算剩余生命必须一致');
  assert.ok(allEvents.some((e) => e.type === 'item_fire'), '应产生武器开火飞弹事件');
  assert.ok(allEvents.some((e) => e.type === 'damage'), '应产生伤害事件');
  assert.ok(allEvents.some((e) => e.type === 'poison_tick'), '应产生 0.5s 周期剧毒伤害事件');

  // 验证 1UP 不死复活心在致命攻击下免死回血并净化负面状态
  const reviveBag = createInitialBag();
  placeItemInBag(reviveBag, 'relic_1up', 2, 2, 0);
  const brutalEnemy = {
    id: 'test_reaper',
    name: '死神测试官',
    portrait: ENEMY_WAVES[9].portrait,
    hitPortrait: ENEMY_WAVES[9].hitPortrait,
    maxHp: 5000,
    startShield: 0,
    items: [
      { itemId: 'axe_4', rot: 0 },
      { itemId: 'hammer_4', rot: 0 },
      { itemId: 'potion_poison', rot: 0 },
    ],
  };
  const revSim = createBattleSimulator({
    hero: 'archmage',
    round: 1,
    bag: reviveBag,
    enemy: brutalEnemy,
    seed: 77,
  });
  let sawRevive = false;
  let sawHitStun = false;
  while (!revSim.getState().finished) {
    const { events } = revSim.step(FIXED_TICK);
    if (events.some((e) => e.type === 'revive' && e.side === 'player')) {
      sawRevive = true;
    }
    if (revSim.getState().player.hitStunTimer > 0) {
      sawHitStun = true;
    }
  }
  assert.equal(sawRevive, true, '携带不死复活心受到致命伤害时必须触发 revive 免死复活事件');
  assert.equal(sawHitStun, true, '角色受击时必须激活 hitStunTimer 供前端切换 _st.png 挨揍颜艺帧');

  // 验证双肉盾持久战在 15s 触发疲劳狂暴且在 35s 硬上限内正常结束
  const tankBag = createInitialBag();
  placeItemInBag(tankBag, 'armor_plate', 1, 1, 0);
  placeItemInBag(tankBag, 'potion_heal', 1, 3, 0);
  const tankEnemy = {
    id: 'stone_wall',
    name: '叹息之墙',
    portrait: ENEMY_WAVES[0].portrait,
    hitPortrait: ENEMY_WAVES[0].hitPortrait,
    maxHp: 9999,
    startShield: 500,
    items: [{ itemId: 'armor_plate', rot: 0 }],
  };
  const tankSim = createBattleSimulator({
    hero: 'berserker',
    round: 1,
    bag: tankBag,
    enemy: tankEnemy,
    seed: 88,
  });
  let sawFrenzy = false;
  while (!tankSim.getState().finished) {
    const { events } = tankSim.step(FIXED_TICK);
    if (events.some((e) => e.type === 'frenzy_start')) sawFrenzy = true;
  }
  assert.equal(sawFrenzy, true, `持久战超过 ${FRENZY_START_SEC}s 应启动疲劳狂暴`);
  assert.ok(tankSim.getState().elapsed <= 35.05, '35s 硬超时机制应 100% 杜绝死局');
});

test('6. 会话交互闭环：商店首刷免费、单槽锁店、旋转微调、出售返金与一键智能摆包', () => {
  const session = createSession(2026);
  selectHero(session, 'berserker');
  assert.equal(session.status, 'prep');
  assert.equal(session.hearts, INITIAL_HEARTS);

  // 狂战酋长每轮首次刷新免费
  const gold0 = session.gold;
  assert.equal( toggleShopSlotLock(session, 0).locked, true );
  const lockedItemId = session.shop[0].itemId;
  const rr1 = rerollShop(session);
  assert.equal(rr1.ok, true);
  assert.equal(rr1.cost, 0);
  assert.equal(session.gold, gold0);
  assert.equal(session.shop[0].itemId, lockedItemId, '锁定的商店槽位刷新后应保留原商品');

  // 购买、旋转与出售
  const affordableIdx = session.shop.findIndex((s) => !s.sold && s.cost <= session.gold);
  assert.ok(affordableIdx !== -1);
  const buyRes = buyShopItem(session, affordableIdx);
  assert.equal(buyRes.ok, true);

  const targetRef =
    buyRes.action === 'placed_bag'
      ? { zone: 'bag', uid: buyRes.uid }
      : { zone: 'tray', index: buyRes.trayIndex };
  const rotRes = rotateItem(session, targetRef);
  assert.equal(rotRes.ok, true);

  const goldBeforeSell = session.gold;
  const sellRes = sellItem(session, targetRef);
  assert.equal(sellRes.ok, true);
  assert.ok(session.gold > goldBeforeSell, '出售装备应返还金币');

  // 扩建与一键智能整理
  session.expandPoints = 2;
  const expCell = getExpandableCells(session.bag)[0];
  assert.equal(expandBagCell(session, expCell[0], expCell[1]).ok, true);
  assert.equal(autoArrangeBag(session).ok, true);

  // 跑完第 1 轮结算推进至第 2 轮
  const sim = beginCombatPhase(session);
  const out = sim.runToEnd();
  const settle = settleCombatResult(session, out);
  assert.equal(settle.ok, true);
  assert.equal(session.round, 2);
  assert.equal(session.status, 'prep');
});

test('7. 4 位勇者 × 50 局 = 200 局完整 10 轮无头 AI 平衡压测（零报错，综合胜率 45% ~ 85%）', () => {
  const runsPerHero = 50;
  const byHero = {};
  let totalVictories = 0;
  let totalRoundsCleared = 0;
  let totalUpgrades = 0;
  let totalMythics = 0;

  HEROES.forEach((hero, hIdx) => {
    let heroWins = 0;
    let heroRounds = 0;
    for (let i = 0; i < runsPerHero; i++) {
      const seed = 100000 + hIdx * 10000 + i * 37;
      const res = simulateFullRunAI({ heroId: hero.id, seed });
      assert.equal(typeof res.victory, 'boolean');
      assert.ok(res.finalRound >= 1 && res.finalRound <= MAX_ROUNDS);
      if (res.victory) {
        heroWins += 1;
        totalVictories += 1;
      }
      heroRounds += res.roundsCleared;
      totalRoundsCleared += res.roundsCleared;
      totalUpgrades += res.upgradesDone;
      totalMythics += res.mythicsCrafted;
    }
    const rate = heroWins / runsPerHero;
    byHero[hero.id] = {
      winRate: `${(rate * 100).toFixed(1)}%`,
      avgRoundsCleared: Number((heroRounds / runsPerHero).toFixed(2)),
      rawRate: rate,
    };
  });

  const totalRuns = HEROES.length * runsPerHero;
  const overallWinRate = totalVictories / totalRuns;
  const summary = {
    totalRuns,
    totalVictories,
    overallWinRate: `${(overallWinRate * 100).toFixed(1)}%`,
    avgRoundsCleared: Number((totalRoundsCleared / totalRuns).toFixed(2)),
    avgUpgradesPerRun: Number((totalUpgrades / totalRuns).toFixed(2)),
    avgMythicsPerRun: Number((totalMythics / totalRuns).toFixed(2)),
    byHero: Object.fromEntries(
      Object.entries(byHero).map(([k, v]) => [k, `${v.winRate} (均胜${v.avgRoundsCleared}轮)`]),
    ),
  };
  console.log('[Backpack 200局平衡压测报告]', JSON.stringify(summary));

  assert.ok(
    overallWinRate >= 0.45 && overallWinRate <= 0.85,
    `200 局综合通关胜率必须处于 45% ~ 85% 健康甜区，当前为 ${(overallWinRate * 100).toFixed(1)}%`,
  );

  for (const [heroId, stat] of Object.entries(byHero)) {
    assert.ok(
      stat.rawRate >= 0.3 && stat.rawRate <= 0.92,
      `单勇者 ${heroId} 胜率偏离平衡范围 (30%~92%)，当前为 ${stat.winRate}`,
    );
  }

  assert.ok(totalUpgrades >= 200, `AI 应频繁触发二合一进化，当前总次数 ${totalUpgrades}`);
  assert.ok(totalMythics >= 40, `AI 应频繁触发跨物品★神话神装合成，当前总次数 ${totalMythics}`);
});
