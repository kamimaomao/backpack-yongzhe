// 《勇者塞满包 · 背包合成乱斗》前端主控制器（Pointer 丝滑拖拽 + 点选放置双模交互 + 60fps 独立 CD 对轰播放器）

import { AudioManager } from './audio.js';
import {
  ARENA_BACKGROUNDS,
  ASSET_BASE,
  GRID_COLS,
  GRID_ROWS,
  HEROES,
  INITIAL_HEARTS,
  ITEMS,
  MAX_ROUNDS,
  MYTHIC_RECIPES,
  getEnemyByRound,
  getItemById,
} from './engine/catalog.js';
import {
  checkMergeCompatibility,
  checkPlacement,
  computeBagSynergies,
  getExpandableCells,
  getItemAtCell,
  getItemFootprint,
  getOccupiedCells,
} from './engine/grid.js';
import {
  autoArrangeBag,
  autoExpandBag,
  beginCombatPhase,
  buyShopItem,
  createSession,
  expandBagCell,
  getRerollCost,
  moveItem,
  rerollShop,
  rotateItem,
  selectHero,
  sellItem,
  settleCombatResult,
  toggleShopAllLock,
  toggleShopSlotLock,
} from './engine/session.js';
import { FxRenderer } from './fx_renderer.js';

const ICON_GOLD = `${ASSET_BASE}/sprites/UI_界面/ui/Common/jinbi.png`;
const ICON_LOCK_CELL = `${ASSET_BASE}/sprites/UI_界面/ui/Common/suo.png`;
const DEFAULT_BG = `${ASSET_BASE}/textures/背景_大图/bigimg/bg_normal_level_1.jpg`;

const els = {
  appShell: document.getElementById('app-shell'),
  globalFxLayer: document.getElementById('global-fx-layer'),
  dragGhost: document.getElementById('drag-ghost'),
  toastBanner: document.getElementById('toast-banner'),
  mythicToast: document.getElementById('mythic-toast'),

  heroBadge: document.getElementById('hero-badge'),
  heroBadgeImg: document.getElementById('hero-badge-img'),
  heroBadgeName: document.getElementById('hero-badge-name'),
  heartsDisplay: document.getElementById('hearts-display'),
  goldDisplay: document.getElementById('gold-display'),
  roundDisplay: document.getElementById('round-display'),
  btnCatalog: document.getElementById('btn-catalog'),
  btnHelp: document.getElementById('btn-help'),
  btnMute: document.getElementById('btn-mute'),

  arenaStage: document.getElementById('arena-stage'),
  arenaBg: document.getElementById('arena-bg'),
  powerSummaryChip: document.getElementById('power-summary-chip'),
  frenzyBadge: document.getElementById('frenzy-badge'),
  enemyWaveChip: document.getElementById('enemy-wave-chip'),

  playerFighter: document.getElementById('player-fighter'),
  playerStageAnchor: document.getElementById('player-stage-anchor'),
  playerPortrait: document.getElementById('player-portrait'),
  playerName: document.getElementById('player-name'),
  playerShieldBadge: document.getElementById('player-shield-badge'),
  playerHpFill: document.getElementById('player-hp-fill'),
  playerShieldFill: document.getElementById('player-shield-fill'),
  playerHpText: document.getElementById('player-hp-text'),
  playerStatusRow: document.getElementById('player-status-row'),

  battleClock: document.getElementById('battle-clock'),

  enemyFighter: document.getElementById('enemy-fighter'),
  enemyStageAnchor: document.getElementById('enemy-stage-anchor'),
  enemyPortrait: document.getElementById('enemy-portrait'),
  enemyName: document.getElementById('enemy-name'),
  enemyShieldBadge: document.getElementById('enemy-shield-badge'),
  enemyHpFill: document.getElementById('enemy-hp-fill'),
  enemyShieldFill: document.getElementById('enemy-shield-fill'),
  enemyHpText: document.getElementById('enemy-hp-text'),
  enemyStatusRow: document.getElementById('enemy-status-row'),
  enemyLoadoutBar: document.getElementById('enemy-loadout-bar'),

  inspectorInfo: document.getElementById('inspector-info'),
  btnRotate: document.getElementById('btn-rotate'),
  btnSell: document.getElementById('btn-sell'),
  btnAutoSort: document.getElementById('btn-auto-sort'),
  trayCountText: document.getElementById('tray-count-text'),
  holdingTray: document.getElementById('holding-tray'),

  workshopZone: document.getElementById('workshop-zone'),
  bagCellsCount: document.getElementById('bag-cells-count'),
  synergyCountPill: document.getElementById('synergy-count-pill'),
  expandBanner: document.getElementById('expand-banner'),
  expandPointsText: document.getElementById('expand-points-text'),
  btnAutoExpand: document.getElementById('btn-auto-expand'),

  backpackBoard: document.getElementById('backpack-board'),
  backpackGrid: document.getElementById('backpack-grid'),
  synergySvg: document.getElementById('synergy-svg'),
  backpackItemsLayer: document.getElementById('backpack-items-layer'),

  shopPanel: document.getElementById('shop-panel'),
  streakChip: document.getElementById('streak-chip'),
  shopCardsRow: document.getElementById('shop-cards-row'),

  prepControls: document.getElementById('prep-controls'),
  combatControls: document.getElementById('combat-controls'),
  btnToggleShop: document.getElementById('btn-toggle-shop'),
  toggleShopLabel: document.getElementById('toggle-shop-label'),
  toggleShopSub: document.getElementById('toggle-shop-sub'),
  btnReroll: document.getElementById('btn-reroll'),
  rerollCostLabel: document.getElementById('reroll-cost-label'),
  btnLockShop: document.getElementById('btn-lock-shop'),
  lockShopLabel: document.getElementById('lock-shop-label'),
  lockShopSub: document.getElementById('lock-shop-sub'),
  btnStartCombat: document.getElementById('btn-start-combat'),
  startCombatSub: document.getElementById('start-combat-sub'),

  btnSpeed: document.getElementById('btn-speed'),
  speedBtnLabel: document.getElementById('speed-btn-label'),
  btnSkipCombat: document.getElementById('btn-skip-combat'),

  heroDialog: document.getElementById('hero-dialog'),
  heroPickGrid: document.getElementById('hero-pick-grid'),
  catalogDialog: document.getElementById('catalog-dialog'),
  catalogTabs: document.getElementById('catalog-tabs'),
  catalogBody: document.getElementById('catalog-body'),
  helpDialog: document.getElementById('help-dialog'),
  resultDialog: document.getElementById('result-dialog'),
  resultDialogTitle: document.getElementById('result-dialog-title'),
  resultDialogSub: document.getElementById('result-dialog-sub'),
  resultStatsGrid: document.getElementById('result-stats-grid'),
  resultBagShowcase: document.getElementById('result-bag-showcase'),
  btnRestart: document.getElementById('btn-restart'),
};

let session = createSession();
const audio = new AudioManager();
const fx = new FxRenderer({
  overlayEl: els.globalFxLayer,
  playerAnchorEl: els.playerStageAnchor,
  enemyAnchorEl: els.enemyStageAnchor,
  bagItemsLayerEl: els.backpackItemsLayer,
  enemyLoadoutEl: els.enemyLoadoutBar,
});

// UI 交互状态
let selected = null; // { zone: 'bag'|'tray'|'shop'|'enemy', uid?, index?, slotIndex?, itemId, rot }
let shopCollapsed = false;
let activeCatalogTab = 'mythic';
let dragState = null;
let suppressNextClickUntil = 0;

// 战斗逐帧播放状态
let battleSpeed = 1;
let battleSkipRequested = false;
let activeSimulator = null;
let combatRafId = null;
let runStats = { upgradesDone: 0, mythicsCrafted: 0 };

let toastTimer = null;
let mythicToastTimer = null;

function showToast(msg) {
  if (!msg) return;
  els.toastBanner.textContent = msg;
  els.toastBanner.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toastBanner.classList.remove('is-visible');
  }, 2100);
}

function formatMythicName(rawName = '') {
  const trimmed = String(rawName).trim();
  return trimmed.startsWith('★') ? trimmed : `★${trimmed}`;
}

function showMythicCelebration(resultId, prefixText = '🌟 神话融合成功！') {
  const def = getItemById(resultId);
  if (!def) return;
  els.mythicToast.innerHTML = '';
  const img = document.createElement('img');
  img.src = def.icon;
  img.alt = def.name;
  const txt = document.createElement('span');
  txt.innerHTML = `${prefixText} <strong>${formatMythicName(def.name)}</strong>`;
  els.mythicToast.appendChild(img);
  els.mythicToast.appendChild(txt);
  els.mythicToast.hidden = false;
  clearTimeout(mythicToastTimer);
  mythicToastTimer = setTimeout(() => {
    els.mythicToast.hidden = true;
  }, 3000);
}

function getSellPriceForItem(itemDef) {
  if (!itemDef) return 1;
  const heroBonus = Number(session.hero?.bonuses?.sellBonusGold || 0);
  return Math.max(1, Math.ceil((itemDef.cost || 2) * 0.5) + heroBonus);
}

// ================= 原生 <dialog> 初始化与兼容兜底 =================
function setupDialogs() {
  const allDialogs = document.querySelectorAll('dialog.game-dialog');
  for (const dlg of allDialogs) {
    dlg.addEventListener('close', () => {
      dlg.returnValue = '';
    });
  }

  // 必选弹窗拦截 Esc
  for (const dlg of [els.heroDialog, els.resultDialog]) {
    dlg.addEventListener('cancel', (ev) => {
      ev.preventDefault();
    });
  }

  // 针对不支持 closedby="any" 的浏览器补充精确矩形边界坐标点击关闭兜底
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    const isOutside = (ev, dialog) => {
      const panel = dialog.querySelector('.dialog-panel') || dialog;
      const r = panel.getBoundingClientRect();
      return ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
    };
    for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
      let pressedOutside = false;
      dialog.addEventListener('pointerdown', (ev) => {
        pressedOutside = isOutside(ev, dialog);
      });
      dialog.addEventListener('pointerup', (ev) => {
        if (pressedOutside && isOutside(ev, dialog)) {
          dialog.close();
        }
        pressedOutside = false;
      });
    }
  }
}

function openModalSafe(dialogEl) {
  if (dialogEl && !dialogEl.open) {
    dialogEl.showModal();
  }
}

function closeModalSafe(dialogEl) {
  if (dialogEl && dialogEl.open) {
    dialogEl.close();
  }
}

// ================= 迷你形状点阵与角色立绘视觉体量自适应 =================
function getSpriteBoostForPortrait(src = '') {
  const s = String(src);
  if (s.includes('moster_1_14')) return '1.52';
  if (s.includes('moster_2_2')) return '1.40';
  if (s.includes('moster_2_11') || s.includes('moster_2_7')) return '1.30';
  if (s.includes('moster_2_12')) return '1.18';
  if (s.includes('skin_14')) return '1.14';
  if (s.includes('skin_12')) return '1.10';
  return '1.06';
}

function createShapeMiniMatrix(itemId, rot = 0) {
  const fp = getItemFootprint(itemId, rot);
  const box = document.createElement('span');
  box.className = 'shape-mini-matrix';
  box.style.gridTemplateColumns = `repeat(${fp.width}, 4px)`;
  box.style.gridTemplateRows = `repeat(${fp.height}, 4px)`;
  box.setAttribute('aria-hidden', 'true');

  const onSet = new Set(fp.cells.map(([r, c]) => `${r},${c}`));
  for (let r = 0; r < fp.height; r++) {
    for (let c = 0; c < fp.width; c++) {
      const dot = document.createElement('i');
      dot.className = `shape-dot${onSet.has(`${r},${c}`) ? ' is-on' : ''}`;
      box.appendChild(dot);
    }
  }
  return box;
}

// ================= 校验选中态有效性 =================
function syncSelectionValidity() {
  if (!selected) return;
  if (selected.zone === 'bag') {
    const found = session.bag.items.find((it) => it.uid === selected.uid);
    if (!found) {
      selected = null;
    } else {
      selected.itemId = found.itemId;
      selected.rot = found.rot;
    }
  } else if (selected.zone === 'tray') {
    const slot = session.tray[selected.index];
    if (!slot) {
      selected = null;
    } else {
      selected.uid = slot.uid;
      selected.itemId = slot.itemId;
      selected.rot = slot.rot || 0;
    }
  } else if (selected.zone === 'shop') {
    const s = session.shop[selected.slotIndex];
    if (!s || s.sold) {
      selected = null;
    } else {
      selected.itemId = s.itemId;
    }
  }
}

function getCurrentSynergies() {
  if (session.synergies && session.synergies.itemStats) {
    return session.synergies;
  }
  return computeBagSynergies(session.bag, session.hero?.bonuses || {});
}

// ================= 全量 UI 渲染 =================
function renderAll() {
  syncSelectionValidity();
  const syn = getCurrentSynergies();
  renderTopBar();
  renderArenaPrep(syn);
  renderInspectorAndTray(syn);
  renderWorkshop(syn);
}

function renderTopBar() {
  const hero = session.hero || HEROES[0];
  if (hero) {
    els.heroBadgeImg.src = hero.portrait;
    els.heroBadgeName.textContent = (hero.passiveName || hero.name).slice(0, 4);
  }
  const hearts = Math.max(0, session.hearts ?? INITIAL_HEARTS);
  const maxH = session.maxHearts || INITIAL_HEARTS;
  els.heartsDisplay.textContent = '❤️'.repeat(hearts) + '🖤'.repeat(Math.max(0, maxH - hearts));
  els.goldDisplay.textContent = `${session.gold ?? 0}`;
  els.roundDisplay.textContent = `第 ${session.round || 1}/${MAX_ROUNDS} 轮`;
  els.btnMute.textContent = audio.muted ? '🔇' : '🔊';
}

function renderStatusChips(containerEl, { poison = 0, chill = 0, thorns = 0, dodgePct = 0, reviveAvailable = false }) {
  containerEl.innerHTML = '';
  if (poison > 0) {
    const chip = document.createElement('span');
    chip.className = 'status-chip is-poison';
    chip.textContent = `☠️毒${poison}`;
    containerEl.appendChild(chip);
  }
  if (chill > 0) {
    const chip = document.createElement('span');
    chip.className = 'status-chip is-chill';
    chip.textContent = `❄️冰${chill}`;
    containerEl.appendChild(chip);
  }
  if (thorns > 0) {
    const chip = document.createElement('span');
    chip.className = 'status-chip is-thorns';
    chip.textContent = `🌵反${thorns}`;
    containerEl.appendChild(chip);
  }
  if (dodgePct > 0) {
    const chip = document.createElement('span');
    chip.className = 'status-chip';
    chip.textContent = `💨闪${Math.round(dodgePct)}%`;
    containerEl.appendChild(chip);
  }
  if (reviveAvailable) {
    const chip = document.createElement('span');
    chip.className = 'status-chip is-revive';
    chip.textContent = '💖1UP';
    containerEl.appendChild(chip);
  }
}

function renderArenaPrep(syn) {
  if (session.status === 'combat' && activeSimulator) return;

  const round = session.round || 1;
  const bgList = Array.isArray(ARENA_BACKGROUNDS) && ARENA_BACKGROUNDS.length > 0
    ? ARENA_BACKGROUNDS
    : [DEFAULT_BG];
  const bgUrl = bgList[(round - 1) % bgList.length] || DEFAULT_BG;
  els.arenaBg.style.backgroundImage = `url("${bgUrl}")`;

  const hero = session.hero || HEROES[0];
  const enemy = getEnemyByRound(round);

  const totals = syn?.totals || {
    estimatedDps: 0,
    bonusMaxHp: 0,
    startShield: 0,
    bonusDodgePct: 0,
    bonusThorns: 0,
  };

  els.powerSummaryChip.textContent = `⚔️ 秒伤 ${Number(totals.estimatedDps || 0).toFixed(1)} · 🛡️ 盾 ${totals.startShield || 0}`;
  els.frenzyBadge.hidden = true;
  els.battleClock.textContent = '整备阶段';

  if (hero) {
    const maxHp = hero.baseHp + (round - 1) * hero.hpPerRound + (totals.bonusMaxHp || 0);
    els.playerPortrait.src = hero.portrait;
    els.playerPortrait.style.setProperty('--sprite-boost', getSpriteBoostForPortrait(hero.portrait));
    els.playerFighter.classList.remove('is-hit');
    els.playerName.textContent = hero.name;
    els.playerHpFill.style.inlineSize = '100%';
    const shPct = Math.min(100, ((totals.startShield || 0) / Math.max(1, maxHp)) * 100);
    els.playerShieldFill.style.inlineSize = `${shPct.toFixed(1)}%`;
    els.playerHpText.textContent = `${maxHp} / ${maxHp}`;
    els.playerShieldBadge.hidden = !(totals.startShield > 0);
    els.playerShieldBadge.textContent = `🛡️${totals.startShield || 0}`;

    const hasRevive = session.bag.items.some((it) => (getItemById(it.itemId)?.combat?.revivePct || 0) > 0);
    renderStatusChips(els.playerStatusRow, {
      thorns: totals.bonusThorns || 0,
      dodgePct: Math.min(60, totals.bonusDodgePct || 0),
      reviveAvailable: hasRevive,
    });
  }

  if (enemy) {
    els.enemyWaveChip.textContent = `第${round}轮 · ${enemy.isBoss ? '👑首领 · ' : ''}${enemy.title || enemy.name}`;
    els.enemyWaveChip.classList.toggle('is-boss', Boolean(enemy.isBoss));
    els.enemyPortrait.src = enemy.portrait;
    els.enemyPortrait.style.setProperty('--sprite-boost', getSpriteBoostForPortrait(enemy.portrait));
    els.enemyFighter.classList.remove('is-hit');
    els.enemyName.textContent = enemy.name;
    els.enemyHpFill.style.inlineSize = '100%';
    const eShield = enemy.startShield || 0;
    const eShPct = Math.min(100, (eShield / Math.max(1, enemy.maxHp)) * 100);
    els.enemyShieldFill.style.inlineSize = `${eShPct.toFixed(1)}%`;
    els.enemyHpText.textContent = `${enemy.maxHp} / ${enemy.maxHp}`;
    els.enemyShieldBadge.hidden = !(eShield > 0);
    els.enemyShieldBadge.textContent = `🛡️${eShield}`;

    renderStatusChips(els.enemyStatusRow, {
      thorns: enemy.bonusThorns || 0,
      dodgePct: enemy.bonusDodgePct || 0,
    });

    // 渲染敌方可见装备预览栏
    els.enemyLoadoutBar.innerHTML = '';
    const enemyItems = Array.isArray(enemy.items) ? enemy.items : [];
    enemyItems.forEach((rawEntry, idx) => {
      const entry = typeof rawEntry === 'string' ? { itemId: rawEntry, rot: 0 } : rawEntry;
      const def = getItemById(entry?.itemId);
      if (!def) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'enemy-equip-chip';
      btn.setAttribute('role', 'listitem');
      btn.dataset.enemyIdx = `${idx}`;
      btn.dataset.uid = entry.uid || `enemy_itm_${idx + 1}`;
      btn.title = `${def.name}：${def.desc}`;
      btn.setAttribute('aria-label', `查看敌方装备 ${def.name}`);

      const cdFill = document.createElement('div');
      cdFill.className = 'enemy-equip-cd';
      const img = document.createElement('img');
      img.src = def.icon;
      img.alt = def.name;
      btn.appendChild(cdFill);
      btn.appendChild(img);

      btn.addEventListener('click', () => {
        audio.unlock();
        audio.playSfx('click');
        selected = { zone: 'enemy', index: idx, itemId: entry.itemId, rot: entry.rot || 0 };
        renderAll();
      });

      els.enemyLoadoutBar.appendChild(btn);
    });
  }
}

function renderInspectorAndTray(syn) {
  const isPrep = session.status === 'prep';
  els.btnAutoSort.disabled = !isPrep;

  // 1. 检视器详情
  if (!selected) {
    els.inspectorInfo.innerHTML = `
      <span class="inspector-hint">💡 按住拖拽或点击选中物品摆包；按 <strong>R</strong> 旋转 90°，同款叠合进化，相邻配对觉醒★神话！</span>
    `;
    els.btnRotate.disabled = true;
    els.btnSell.disabled = true;
    els.btnSell.textContent = '💰 出售';
  } else {
    const def = getItemById(selected.itemId);
    if (def) {
      const stats = selected.zone === 'bag' && selected.uid ? syn?.itemStats?.[selected.uid] : null;
      const cdVal = stats ? stats.effectiveCd : def.cooldown || 0;
      const cdText = cdVal > 0 ? `⏱️${cdVal.toFixed(2)}s` : '常驻光环';
      const dpsText = stats && stats.dps > 0 ? ` · ⚔️${stats.dps}/s` : '';
      const isMythic = def.category === 'mythic' || def.tier === 5 || def.mythic;

      // 查找是否存在跨物品神话配方提示
      const relatedRecipe = Array.isArray(MYTHIC_RECIPES)
        ? MYTHIC_RECIPES.find(
            (rc) => rc.ingredientA?.includes(def.id) || rc.ingredientB?.includes(def.id),
          )
        : null;
      let recipeHint = '';
      if (relatedRecipe) {
        const partnerIds = relatedRecipe.ingredientA?.includes(def.id)
          ? relatedRecipe.ingredientB
          : relatedRecipe.ingredientA;
        const partnerDef = partnerIds?.[0] ? getItemById(partnerIds[0]) : null;
        const resDef = getItemById(relatedRecipe.resultId);
        if (partnerDef && resDef) {
          recipeHint = ` 🌟配【${partnerDef.name}】合${formatMythicName(resDef.name)}`;
        }
      }

      const buffText =
        stats && stats.buffSources?.length > 0
          ? ` [${stats.buffSources.map((b) => b.label).join(', ')}]`
          : '';

      els.inspectorInfo.innerHTML = '';
      const iconBox = document.createElement('div');
      iconBox.className = 'insp-icon-box';
      const img = document.createElement('img');
      img.src = def.icon;
      img.alt = def.name;
      iconBox.appendChild(img);

      const miniShape = createShapeMiniMatrix(def.id, selected.rot || 0);

      const body = document.createElement('div');
      body.className = 'insp-body';
      const lvLabel = isMythic ? '★神话' : def.upgradesTo || def.level > 1 ? `Lv.${def.level || 1}` : `T${def.tier || 1}`;
      body.innerHTML = `
        <div class="insp-head">
          <strong>${def.name}</strong>
          <span class="insp-pill${isMythic ? ' is-mythic' : ''}">${lvLabel}</span>
          <span class="insp-pill">${cdText}${dpsText}</span>
        </div>
        <p class="insp-desc-text">${def.desc}${buffText}${recipeHint}</p>
      `;

      els.inspectorInfo.appendChild(iconBox);
      els.inspectorInfo.appendChild(miniShape);
      els.inspectorInfo.appendChild(body);

      const canRotate = isPrep && (selected.zone === 'bag' || selected.zone === 'tray' || selected.zone === 'shop');
      const canSell = isPrep && (selected.zone === 'bag' || selected.zone === 'tray');
      els.btnRotate.disabled = !canRotate;
      els.btnSell.disabled = !canSell;
      els.btnSell.textContent = canSell ? `💰 出售 +${getSellPriceForItem(def)}` : '💰 出售';
    }
  }

  // 2. 渲染 4 格暂存托盘
  const traySlots = els.holdingTray.querySelectorAll('.tray-slot');
  let trayUsed = 0;
  traySlots.forEach((slotEl, idx) => {
    const entry = session.tray?.[idx] || null;
    slotEl.innerHTML = '';
    slotEl.className = 'tray-slot';
    if (entry) {
      trayUsed += 1;
      const def = getItemById(entry.itemId);
      slotEl.classList.add('has-item');
      slotEl.dataset.uid = entry.uid;

      if (selected?.zone === 'tray' && selected.index === idx) {
        slotEl.classList.add('is-selected');
      } else if (selected && selected.itemId && !(selected.zone === 'tray' && selected.index === idx)) {
        const compat = checkMergeCompatibility(selected.itemId, entry.itemId);
        if (compat?.kind === 'upgrade') slotEl.classList.add('is-merge-upgrade');
        if (compat?.kind === 'mythic') slotEl.classList.add('is-merge-mythic');
      }

      if (def) {
        const img = document.createElement('img');
        img.src = def.icon;
        img.alt = def.name;
        slotEl.appendChild(img);

        const tag = document.createElement('span');
        tag.className = 'tray-lv-tag';
        tag.textContent = def.category === 'mythic' || def.tier === 5 ? '★' : `L${def.level || 1}`;
        slotEl.appendChild(tag);
      }
    }
  });
  els.trayCountText.textContent = `${trayUsed}/4`;
}

// 计算选中光环物品的受惠网格坐标集
function getSelectedAuraHighlightCells() {
  const set = new Set();
  if (!selected || selected.zone !== 'bag' || !selected.uid) return set;
  const bagItem = session.bag.items.find((it) => it.uid === selected.uid);
  if (!bagItem) return set;
  const def = getItemById(bagItem.itemId);
  if (!def?.aura) return set;

  const occ = getOccupiedCells(bagItem.itemId, bagItem.row, bagItem.col, bagItem.rot);
  const occSet = new Set(occ.map(([r, c]) => `${r},${c}`));
  const dirs =
    def.aura.pattern === 'star8'
      ? [
          [-1, -1], [-1, 0], [-1, 1],
          [0, -1],           [0, 1],
          [1, -1],  [1, 0],  [1, 1],
        ]
      : [
          [-1, 0], [1, 0], [0, -1], [0, 1],
        ];

  for (const [r, c] of occ) {
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < GRID_ROWS && nc >= 0 && nc < GRID_COLS && !occSet.has(`${nr},${nc}`)) {
        set.add(`${nr},${nc}`);
      }
    }
  }
  return set;
}

function renderWorkshop(syn) {
  const isPrep = session.status === 'prep';

  // 统计已解锁格数
  let unlockedCount = 0;
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (session.bag.unlocked[r]?.[c]) unlockedCount += 1;
    }
  }
  els.bagCellsCount.textContent = `${unlockedCount}/${GRID_ROWS * GRID_COLS}`;
  const linkCount = syn?.links?.length || 0;
  els.synergyCountPill.textContent = `✨ 光环 ×${linkCount}`;

  // 扩建横幅
  const expPts = session.expandPoints || 0;
  els.expandBanner.hidden = !(isPrep && expPts > 0 && unlockedCount < GRID_ROWS * GRID_COLS);
  els.expandPointsText.textContent = `🔓 可扩格 +${expPts}`;

  // 1. 渲染 7×5 底层网格
  const expandableSet = new Set();
  if (isPrep && expPts > 0) {
    for (const [er, ec] of getExpandableCells(session.bag)) {
      expandableSet.add(`${er},${ec}`);
    }
  }
  const auraCellSet = getSelectedAuraHighlightCells();

  els.backpackGrid.innerHTML = '';
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const cell = document.createElement('div');
      const isUnlocked = Boolean(session.bag.unlocked[r]?.[c]);
      const isExpandable = !isUnlocked && expandableSet.has(`${r},${c}`);
      cell.className = `bag-cell ${isUnlocked ? 'is-unlocked' : isExpandable ? 'is-expandable' : 'is-locked'}`;
      if (isUnlocked && auraCellSet.has(`${r},${c}`)) {
        cell.classList.add('is-aura-highlight');
      }
      cell.dataset.row = `${r}`;
      cell.dataset.col = `${c}`;
      cell.setAttribute('role', 'gridcell');

      if (isExpandable) {
        cell.tabIndex = 0;
        cell.setAttribute('aria-label', `点击扩建解锁第${r + 1}行第${c + 1}列背包格`);
        const plus = document.createElement('span');
        plus.className = 'cell-expand-plus';
        plus.textContent = '➕';
        cell.appendChild(plus);
      } else if (!isUnlocked) {
        const lockImg = document.createElement('img');
        lockImg.className = 'cell-lock-icon';
        lockImg.src = ICON_LOCK_CELL;
        lockImg.alt = '';
        lockImg.setAttribute('aria-hidden', 'true');
        cell.appendChild(lockImg);
      } else {
        cell.tabIndex = 0;
      }

      els.backpackGrid.appendChild(cell);
    }
  }

  // 2. 渲染背包内异形多格物品
  const buffedNeighborUids = new Set();
  if (selected?.zone === 'bag' && selected.uid && syn?.links) {
    for (const lk of syn.links) {
      if (lk.fromUid === selected.uid) buffedNeighborUids.add(lk.toUid);
      if (lk.toUid === selected.uid) buffedNeighborUids.add(lk.fromUid);
    }
  }

  els.backpackItemsLayer.innerHTML = '';
  for (const placed of session.bag.items) {
    const def = getItemById(placed.itemId);
    if (!def) continue;
    const fp = getItemFootprint(placed.itemId, placed.rot);

    const wrap = document.createElement('div');
    const tierNum = def.category === 'mythic' || def.mythic ? 5 : def.tier || 1;
    wrap.className = `placed-item tier-${tierNum}`;
    wrap.dataset.uid = placed.uid;
    wrap.style.left = `calc(${placed.col} * (var(--cell-size) + var(--grid-gap)))`;
    wrap.style.top = `calc(${placed.row} * (var(--cell-size) + var(--grid-gap)))`;
    wrap.style.width = `calc(${fp.width} * var(--cell-size) + ${fp.width - 1} * var(--grid-gap))`;
    wrap.style.height = `calc(${fp.height} * var(--cell-size) + ${fp.height - 1} * var(--grid-gap))`;
    wrap.style.gridTemplateColumns = `repeat(${fp.width}, var(--cell-size))`;
    wrap.style.gridTemplateRows = `repeat(${fp.height}, var(--cell-size))`;

    if (selected?.zone === 'bag' && selected.uid === placed.uid) {
      wrap.classList.add('is-selected');
    } else if (selected && selected.itemId && !(selected.zone === 'bag' && selected.uid === placed.uid)) {
      const compat = checkMergeCompatibility(selected.itemId, placed.itemId);
      if (compat?.kind === 'upgrade') wrap.classList.add('is-merge-upgrade');
      if (compat?.kind === 'mythic') wrap.classList.add('is-merge-mythic');
    }
    if (buffedNeighborUids.has(placed.uid)) {
      wrap.classList.add('is-buffed-neighbor');
    }

    // 仅在真实占用的子格渲染底板与事件热区（完美镂空 L3 拐角空缺格！）
    let sumR = 0;
    let sumC = 0;
    for (const [dr, dc] of fp.cells) {
      sumR += dr + 0.5;
      sumC += dc + 0.5;
      const sub = document.createElement('div');
      sub.className = 'item-subcell';
      sub.style.gridRow = `${dr + 1}`;
      sub.style.gridColumn = `${dc + 1}`;
      sub.dataset.uid = placed.uid;
      sub.dataset.dr = `${dr}`;
      sub.dataset.dc = `${dc}`;

      const cdFill = document.createElement('div');
      cdFill.className = 'item-cd-fill';
      sub.appendChild(cdFill);
      wrap.appendChild(sub);
    }

    // 图标置于实占格几何中心并随旋转角呈现
    const centerR = (sumR / fp.cells.length / fp.height) * 100;
    const centerC = (sumC / fp.cells.length / fp.width) * 100;
    const holder = document.createElement('div');
    holder.className = 'item-art-holder';
    holder.style.left = `${centerC}%`;
    holder.style.top = `${centerR}%`;
    holder.style.width = `${Math.min(100, (1.35 / fp.width) * 100)}%`;
    holder.style.height = `${Math.min(100, (1.35 / fp.height) * 100)}%`;
    holder.style.transform = 'translate(-50%, -50%)';

    const img = document.createElement('img');
    img.className = 'item-art-img';
    img.src = def.icon;
    img.alt = def.name;
    if (fp.cells.length > 1 && placed.rot) {
      img.style.transform = `rotate(${placed.rot * 90}deg)`;
    }
    holder.appendChild(img);
    wrap.appendChild(holder);

    // 左上角锚点子格贴等级角标
    const firstCell = fp.cells[0];
    const lvBadge = document.createElement('span');
    const isMythic = tierNum === 5;
    lvBadge.className = `item-badge-lv${isMythic ? ' is-mythic' : ''}`;
    lvBadge.style.left = `calc(${(firstCell[1] / fp.width) * 100}% + 2px)`;
    lvBadge.style.top = `calc(${(firstCell[0] / fp.height) * 100}% + 2px)`;
    lvBadge.textContent = isMythic ? '★神话' : def.upgradesTo || def.level > 1 ? `Lv${def.level || 1}` : '';
    if (lvBadge.textContent) {
      wrap.appendChild(lvBadge);
    }

    // 右下角显示光环加速或附毒汇总角标
    const itemStat = syn?.itemStats?.[placed.uid];
    if (itemStat && (itemStat.hastePct > 0 || itemStat.poison > (def.combat?.poison || 0))) {
      const lastCell = fp.cells[fp.cells.length - 1];
      const buffBadge = document.createElement('span');
      buffBadge.className = 'item-badge-buff';
      buffBadge.style.left = `calc(${(lastCell[1] / fp.width) * 100}% + 2px)`;
      buffBadge.style.bottom = `calc(${((fp.height - 1 - lastCell[0]) / fp.height) * 100}% + 2px)`;
      buffBadge.textContent = itemStat.hastePct > 0 ? `+${itemStat.hastePct}%速` : `+☠️${itemStat.poison}`;
      wrap.appendChild(buffBadge);
    }

    els.backpackItemsLayer.appendChild(wrap);
  }

  // 3. 绘制光环与★神话配对 SVG 连线
  renderSynergySvg(syn);

  // 4. 商店面板与底部按钮栏
  const hideShop = !isPrep || shopCollapsed;
  els.shopPanel.hidden = hideShop;
  els.workshopZone.classList.toggle('is-shop-collapsed', hideShop);

  els.btnToggleShop.setAttribute('aria-expanded', String(!shopCollapsed));
  els.toggleShopLabel.textContent = shopCollapsed ? '🛒 展开店' : '🛒 收起店';
  els.toggleShopSub.textContent = shopCollapsed ? '购买新装备' : '放大背包';

  els.streakChip.hidden = !(session.winStreak >= 2);
  els.streakChip.textContent = `🔥 ${session.winStreak}连胜 +${Math.min(3, session.winStreak)}金`;

  if (isPrep) {
    renderShopCards();
    const cost = getRerollCost(session);
    els.rerollCostLabel.textContent = cost === 0 ? '🎁 本次免费' : `消耗 ${cost} 金`;
    els.btnReroll.disabled = session.gold < cost;

    const unsold = (session.shop || []).filter((s) => !s.sold);
    const allLocked = unsold.length > 0 && unsold.every((s) => s.locked);
    els.btnLockShop.setAttribute('aria-pressed', String(allLocked));
    els.lockShopLabel.textContent = allLocked ? '❄️ 已锁店' : '❄️ 锁店';
    els.lockShopSub.textContent = allLocked ? '点击全解锁' : '保留未买货';

    els.startCombatSub.textContent =
      expPts > 0 ? `自动扩${expPts}格并开战` : `迎战第 ${session.round} 轮`;
  }

  els.prepControls.hidden = !isPrep;
  els.combatControls.hidden = isPrep;
}

function getPlacedItemVisualCenterInSvg(placed) {
  const fp = getItemFootprint(placed.itemId, placed.rot);
  let sr = 0;
  let sc = 0;
  for (const [dr, dc] of fp.cells) {
    sr += placed.row + dr + 0.5;
    sc += placed.col + dc + 0.5;
  }
  return {
    x: (sc / fp.cells.length / GRID_COLS) * 700,
    y: (sr / fp.cells.length / GRID_ROWS) * 500,
  };
}

function renderSynergySvg(syn) {
  els.synergySvg.innerHTML = '';
  const links = syn?.links || [];
  if (links.length === 0) return;

  const byUid = new Map(session.bag.items.map((it) => [it.uid, it]));
  for (const lk of links) {
    const a = byUid.get(lk.fromUid);
    const b = byUid.get(lk.toUid);
    if (!a || !b) continue;
    const pa = getPlacedItemVisualCenterInSvg(a);
    const pb = getPlacedItemVisualCenterInSvg(b);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const focused =
      selected?.zone === 'bag' && (selected.uid === lk.fromUid || selected.uid === lk.toUid);
    line.setAttribute('x1', pa.x.toFixed(1));
    line.setAttribute('y1', pa.y.toFixed(1));
    line.setAttribute('x2', pb.x.toFixed(1));
    line.setAttribute('y2', pb.y.toFixed(1));
    line.setAttribute(
      'class',
      `synergy-line type-${lk.effectType || 'haste'}${focused ? ' is-focused' : ''}`,
    );
    els.synergySvg.appendChild(line);
  }
}

function findMergeHintAgainstOwned(shopItemId) {
  let hasUpgrade = false;
  let hasMythic = false;
  const owned = [
    ...session.bag.items.map((it) => it.itemId),
    ...(session.tray || []).filter(Boolean).map((t) => t.itemId),
  ];
  for (const oid of owned) {
    const compat = checkMergeCompatibility(shopItemId, oid);
    if (compat?.kind === 'mythic') hasMythic = true;
    if (compat?.kind === 'upgrade') hasUpgrade = true;
  }
  if (hasMythic) return { kind: 'mythic', text: '★配神话' };
  if (hasUpgrade) return { kind: 'upgrade', text: '⬆️二合一' };
  return null;
}

function renderShopCards() {
  els.shopCardsRow.innerHTML = '';
  const slots = session.shop || [];
  slots.forEach((slot, idx) => {
    const def = getItemById(slot.itemId);
    const card = document.createElement('div');
    const tierNum = def ? (def.category === 'mythic' ? 5 : def.tier || 1) : 1;
    card.className = `shop-card tier-${tierNum}${slot.sold ? ' is-sold' : ''}${slot.locked ? ' is-locked' : ''}`;
    card.dataset.shopSlot = `${idx}`;
    card.setAttribute('role', 'listitem');

    if (!slot.sold && selected?.zone === 'shop' && selected.slotIndex === idx) {
      card.classList.add('is-selected');
    }

    if (slot.sold || !def) {
      card.innerHTML = `<span class="shop-item-name" style="margin:auto 0;">已售罄</span>`;
      els.shopCardsRow.appendChild(card);
      return;
    }

    card.tabIndex = 0;
    const head = document.createElement('div');
    head.className = 'shop-card-head';
    head.appendChild(
      createShapeMiniMatrix(
        def.id,
        selected?.zone === 'shop' && selected.slotIndex === idx ? selected.rot || 0 : 0,
      ),
    );

    const lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = `shop-lock-mini${slot.locked ? ' is-on' : ''}`;
    lockBtn.textContent = slot.locked ? '🔒' : '🔓';
    lockBtn.title = slot.locked ? '取消锁定该商品' : '锁定保留到下回合';
    lockBtn.setAttribute('aria-label', slot.locked ? `解锁 ${def.name}` : `锁定 ${def.name}`);
    lockBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      audio.unlock();
      audio.playSfx('click');
      toggleShopSlotLock(session, idx);
      renderAll();
    });
    head.appendChild(lockBtn);
    card.appendChild(head);

    const hint = findMergeHintAgainstOwned(def.id);
    if (hint) {
      const badge = document.createElement('span');
      badge.className = `shop-merge-tag is-${hint.kind}`;
      badge.textContent = hint.text;
      card.appendChild(badge);
    }

    const icon = document.createElement('img');
    icon.className = 'shop-item-icon';
    icon.src = def.icon;
    icon.alt = def.name;
    card.appendChild(icon);

    const nameEl = document.createElement('span');
    nameEl.className = 'shop-item-name';
    nameEl.textContent = def.name;
    card.appendChild(nameEl);

    const price = document.createElement('span');
    price.className = `shop-price-pill${session.gold < slot.cost ? ' is-unaffordable' : ''}`;
    price.innerHTML = `<img src="${ICON_GOLD}" alt="" aria-hidden="true">${slot.cost}`;
    card.appendChild(price);

    els.shopCardsRow.appendChild(card);
  });
}

// ================= 智能落点解析与操作执行 =================
function clearGridPreviewClasses() {
  const cells = els.backpackGrid.querySelectorAll('.bag-cell');
  for (const c of cells) {
    c.classList.remove(
      'is-preview-ok',
      'is-preview-upgrade',
      'is-preview-mythic',
      'is-preview-bad',
    );
  }
}

/**
 * 评估将 itemId (rot) 放到锚点 (anchorRow, anchorCol) 的预览状态
 */
function evaluateBagDropPreview(itemId, anchorRow, anchorCol, rot = 0, ignoreUid = null) {
  const check = checkPlacement(session.bag, itemId, anchorRow, anchorCol, rot, ignoreUid);
  if (check.valid) {
    return { status: 'ok', cells: check.cells, targetUid: null };
  }
  if (check.overlappingUids.length === 1) {
    const targetUid = check.overlappingUids[0];
    const targetItem = session.bag.items.find((it) => it.uid === targetUid);
    if (targetItem) {
      const compat = checkMergeCompatibility(itemId, targetItem.itemId);
      if (compat?.kind === 'mythic') {
        return {
          status: 'mythic',
          cells: getOccupiedCells(targetItem.itemId, targetItem.row, targetItem.col, targetItem.rot),
          targetItem,
          compat,
        };
      }
      if (compat?.kind === 'upgrade') {
        return {
          status: 'upgrade',
          cells: getOccupiedCells(targetItem.itemId, targetItem.row, targetItem.col, targetItem.rot),
          targetItem,
          compat,
        };
      }
      // 若不越界且不占锁格，仅与单件物品重叠，引擎可能支持交换腾挪
      if (check.reason === 'overlap') {
        return { status: 'ok', cells: check.cells, targetItem };
      }
    }
  }
  return { status: 'bad', cells: check.cells };
}

function paintBagPreview(itemId, anchorRow, anchorCol, rot = 0, ignoreUid = null) {
  clearGridPreviewClasses();
  const res = evaluateBagDropPreview(itemId, anchorRow, anchorCol, rot, ignoreUid);
  const cls =
    res.status === 'mythic'
      ? 'is-preview-mythic'
      : res.status === 'upgrade'
        ? 'is-preview-upgrade'
        : res.status === 'ok'
          ? 'is-preview-ok'
          : 'is-preview-bad';

  for (const [r, c] of res.cells) {
    if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) continue;
    const cellEl = els.backpackGrid.querySelector(`.bag-cell[data-row="${r}"][data-col="${c}"]`);
    if (cellEl) cellEl.classList.add(cls);
  }
  return res;
}

/**
 * 点选模式下，若玩家点击格子 (clickR, clickC)，智能寻找包含该格或以该格为锚点的最佳落点
 */
function resolveSmartAnchorForClick(itemId, clickR, clickC, rot = 0, ignoreUid = null) {
  // 1. 若点击的格子里本来就有可合成的目标物品，直接返回目标物品锚点！
  const hitItem = getItemAtCell(session.bag, clickR, clickC);
  if (hitItem && hitItem.uid !== ignoreUid) {
    const compat = checkMergeCompatibility(itemId, hitItem.itemId);
    if (compat) {
      return { row: hitItem.row, col: hitItem.col };
    }
  }

  // 2. 直接作为左上锚点合法
  if (checkPlacement(session.bag, itemId, clickR, clickC, rot, ignoreUid).valid) {
    return { row: clickR, col: clickC };
  }

  // 3. 尝试让物品的任意一个子格覆盖 (clickR, clickC) 且整体合法（方便点击边缘列放置 2x1/1x3）
  const fp = getItemFootprint(itemId, rot);
  for (const [dr, dc] of fp.cells) {
    const ar = clickR - dr;
    const ac = clickC - dc;
    if (checkPlacement(session.bag, itemId, ar, ac, rot, ignoreUid).valid) {
      return { row: ar, col: ac };
    }
  }

  return { row: clickR, col: clickC };
}

function handleOperationFeedback(res, fallbackSuccessToast = '') {
  if (!res || !res.ok) {
    const reasonMap = {
      not_enough_gold: '金币不足！可出售闲置装备或先开战赚金',
      no_space: '背包与暂存区均无足够空位，请先整理或扩格！',
      no_space_for_mythic: '背包空间不足以容纳合成后的神话大件，请腾出空位！',
      locked_cell: '该区域包含未解锁格！',
      out_of_bounds: '超出背包网格边界！按 R 键试试旋转方向',
      overlap: '与已有装备位置冲突！',
      sold_out: '该商品已售出！',
    };
    audio.playSfx('close');
    showToast(reasonMap[res?.reason] || '无法放置在该位置，请尝试旋转或腾挪');
    return false;
  }

  if (res.action === 'merged' || res.merged || res.mergeKind) {
    const kind = res.mergeKind || res.kind;
    if (kind === 'mythic') {
      runStats.mythicsCrafted += 1;
      audio.playSfx('mythic');
      showMythicCelebration(res.resultId);
    } else {
      runStats.upgradesDone += 1;
      audio.playSfx('upgrade');
      const nextDef = getItemById(res.resultId);
      showToast(`⬆️ 二合一进化！升阶为【${nextDef ? nextDef.name : '高阶装备'}】！`);
    }
    if (res.uid) {
      const inBag = session.bag.items.find((it) => it.uid === res.uid);
      if (inBag) {
        selected = { zone: 'bag', uid: inBag.uid, itemId: inBag.itemId, rot: inBag.rot };
      } else {
        selected = null;
      }
    } else {
      selected = null;
    }
  } else {
    audio.playSfx(res.bought ? 'buy' : 'place');
    if (fallbackSuccessToast) showToast(fallbackSuccessToast);
    if (res.uid) {
      const inBag = session.bag.items.find((it) => it.uid === res.uid);
      if (inBag) {
        selected = { zone: 'bag', uid: inBag.uid, itemId: inBag.itemId, rot: inBag.rot };
      } else {
        const trayIdx = (session.tray || []).findIndex((t) => t && t.uid === res.uid);
        if (trayIdx !== -1) {
          selected = {
            zone: 'tray',
            index: trayIdx,
            uid: session.tray[trayIdx].uid,
            itemId: session.tray[trayIdx].itemId,
            rot: session.tray[trayIdx].rot || 0,
          };
        }
      }
    }
  }

  renderAll();
  return true;
}

function executeDropToBag(source, targetRow, targetCol, rot) {
  if (session.status !== 'prep') return false;
  if (source.zone === 'shop') {
    const res = buyShopItem(session, source.slotIndex, {
      zone: 'bag',
      row: targetRow,
      col: targetCol,
      rot,
    });
    if (res?.ok) res.bought = true;
    return handleOperationFeedback(res);
  }
  if (source.zone === 'bag') {
    const res = moveItem(
      session,
      { zone: 'bag', uid: source.uid },
      { zone: 'bag', row: targetRow, col: targetCol, rot },
    );
    return handleOperationFeedback(res);
  }
  if (source.zone === 'tray') {
    const res = moveItem(
      session,
      { zone: 'tray', index: source.index },
      { zone: 'bag', row: targetRow, col: targetCol, rot },
    );
    return handleOperationFeedback(res);
  }
  return false;
}

function executeDropToTray(source, trayIndex) {
  if (session.status !== 'prep') return false;
  if (source.zone === 'shop') {
    const res = buyShopItem(session, source.slotIndex, {
      zone: 'tray',
      index: trayIndex,
      rot: source.rot || 0,
    });
    if (res?.ok) res.bought = true;
    return handleOperationFeedback(res, '已购入暂存托盘！');
  }
  if (source.zone === 'bag') {
    const res = moveItem(
      session,
      { zone: 'bag', uid: source.uid },
      { zone: 'tray', index: trayIndex },
    );
    return handleOperationFeedback(res);
  }
  if (source.zone === 'tray') {
    if (source.index === trayIndex) return false;
    const res = moveItem(
      session,
      { zone: 'tray', index: source.index },
      { zone: 'tray', index: trayIndex },
    );
    return handleOperationFeedback(res);
  }
  return false;
}

// ================= Pointer 拖拽状态机（兼容手机触屏与桌面鼠标） =================
function buildDragGhostDom(itemId, rot = 0) {
  const def = getItemById(itemId);
  const fp = getItemFootprint(itemId, rot);
  const sampleCell = els.backpackGrid.querySelector('.bag-cell');
  const cellRect = sampleCell ? sampleCell.getBoundingClientRect() : null;
  const squareSize = cellRect && cellRect.width > 0 ? cellRect.width : 48;
  const gapPx = 3;

  els.dragGhost.innerHTML = '';
  els.dragGhost.style.width = `${fp.width * squareSize + (fp.width - 1) * gapPx}px`;
  els.dragGhost.style.height = `${fp.height * squareSize + (fp.height - 1) * gapPx}px`;
  els.dragGhost.style.gridTemplateColumns = `repeat(${fp.width}, ${squareSize}px)`;
  els.dragGhost.style.gridTemplateRows = `repeat(${fp.height}, ${squareSize}px)`;

  for (const [dr, dc] of fp.cells) {
    const c = document.createElement('div');
    c.className = 'drag-ghost-cell';
    c.style.gridRow = `${dr + 1}`;
    c.style.gridColumn = `${dc + 1}`;
    els.dragGhost.appendChild(c);
  }

  if (def) {
    const img = document.createElement('img');
    img.className = 'drag-ghost-icon';
    img.src = def.icon;
    img.alt = '';
    if (fp.cells.length > 1 && rot) {
      img.style.transform = `rotate(${rot * 90}deg)`;
    }
    els.dragGhost.appendChild(img);
  }
  els.dragGhost.dataset.cellW = `${squareSize}`;
  els.dragGhost.dataset.cellH = `${squareSize}`;
}

function positionDragGhost(clientX, clientY, grabDr = 0, grabDc = 0) {
  const cellW = Number(els.dragGhost.dataset.cellW || 44);
  const cellH = Number(els.dragGhost.dataset.cellH || 44);
  const left = clientX - (grabDc + 0.5) * cellW;
  const top = clientY - (grabDr + 0.5) * cellH;
  els.dragGhost.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
}

function getBoardGridCoordFromPoint(clientX, clientY) {
  const rect = els.backpackGrid.getBoundingClientRect();
  if (
    clientX < rect.left - 8 ||
    clientX > rect.right + 8 ||
    clientY < rect.top - 8 ||
    clientY > rect.bottom + 8
  ) {
    return null;
  }
  const col = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(((clientX - rect.left) / rect.width) * GRID_COLS)));
  const row = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(((clientY - rect.top) / rect.height) * GRID_ROWS)));
  return { row, col };
}

function getTraySlotFromPoint(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const slot = el?.closest?.('.tray-slot');
  if (!slot) return null;
  return Number(slot.dataset.trayIndex);
}

function isPointOverSellBtn(clientX, clientY) {
  const r = els.btnSell.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

function setupPointerInteractions() {
  // 1. 按下启动潜在拖拽（背包物品、托盘槽、商店卡）
  els.appShell.addEventListener('pointerdown', (ev) => {
    audio.unlock();
    if (ev.button !== 0 || session.status !== 'prep') return;
    if (ev.target.closest('.shop-lock-mini')) return;

    const subcell = ev.target.closest('.item-subcell');
    if (subcell) {
      const uid = subcell.dataset.uid;
      const bagItem = session.bag.items.find((it) => it.uid === uid);
      if (!bagItem) return;
      dragState = {
        pointerId: ev.pointerId,
        startX: ev.clientX,
        startY: ev.clientY,
        lastX: ev.clientX,
        lastY: ev.clientY,
        active: false,
        source: { zone: 'bag', uid: bagItem.uid, itemId: bagItem.itemId, rot: bagItem.rot },
        grabDr: Number(subcell.dataset.dr || 0),
        grabDc: Number(subcell.dataset.dc || 0),
      };
      return;
    }

    const traySlot = ev.target.closest('.tray-slot.has-item');
    if (traySlot) {
      const idx = Number(traySlot.dataset.trayIndex);
      const entry = session.tray?.[idx];
      if (!entry) return;
      dragState = {
        pointerId: ev.pointerId,
        startX: ev.clientX,
        startY: ev.clientY,
        lastX: ev.clientX,
        lastY: ev.clientY,
        active: false,
        source: { zone: 'tray', index: idx, uid: entry.uid, itemId: entry.itemId, rot: entry.rot || 0 },
        grabDr: 0,
        grabDc: 0,
      };
      return;
    }

    const shopCard = ev.target.closest('.shop-card:not(.is-sold)');
    if (shopCard) {
      const slotIdx = Number(shopCard.dataset.shopSlot);
      const slot = session.shop?.[slotIdx];
      if (!slot || slot.sold) return;
      const currentRot =
        selected?.zone === 'shop' && selected.slotIndex === slotIdx ? selected.rot || 0 : 0;
      dragState = {
        pointerId: ev.pointerId,
        startX: ev.clientX,
        startY: ev.clientY,
        lastX: ev.clientX,
        lastY: ev.clientY,
        active: false,
        source: { zone: 'shop', slotIndex: slotIdx, itemId: slot.itemId, rot: currentRot },
        grabDr: 0,
        grabDc: 0,
      };
    }
  });

  window.addEventListener('pointermove', (ev) => {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    dragState.lastX = ev.clientX;
    dragState.lastY = ev.clientY;

    const dist = Math.hypot(ev.clientX - dragState.startX, ev.clientY - dragState.startY);
    if (!dragState.active) {
      if (dist < 6) return;
      dragState.active = true;
      selected = { ...dragState.source };
      renderAll();

      if (dragState.source.zone === 'bag') {
        const srcDom = els.backpackItemsLayer.querySelector(`[data-uid="${dragState.source.uid}"]`);
        if (srcDom) srcDom.classList.add('is-dragging-source');
      }
      buildDragGhostDom(dragState.source.itemId, dragState.source.rot);
      els.dragGhost.hidden = false;
    }

    positionDragGhost(ev.clientX, ev.clientY, dragState.grabDr, dragState.grabDc);

    const gridPos = getBoardGridCoordFromPoint(ev.clientX, ev.clientY);
    if (gridPos) {
      const anchorR = gridPos.row - dragState.grabDr;
      const anchorC = gridPos.col - dragState.grabDc;
      paintBagPreview(
        dragState.source.itemId,
        anchorR,
        anchorC,
        dragState.source.rot,
        dragState.source.zone === 'bag' ? dragState.source.uid : null,
      );
    } else {
      clearGridPreviewClasses();
    }
  });

  const finishDrag = (ev, cancelled = false) => {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    const st = dragState;
    dragState = null;

    els.dragGhost.hidden = true;
    clearGridPreviewClasses();
    const draggingDom = els.backpackItemsLayer.querySelector('.is-dragging-source');
    if (draggingDom) draggingDom.classList.remove('is-dragging-source');

    if (!st.active || cancelled) return;
    suppressNextClickUntil = performance.now() + 180;

    // 1. 拖到出售按钮上
    if ((st.source.zone === 'bag' || st.source.zone === 'tray') && isPointOverSellBtn(ev.clientX, ev.clientY)) {
      const def = getItemById(st.source.itemId);
      const ref = st.source.zone === 'bag' ? { zone: 'bag', uid: st.source.uid } : { zone: 'tray', index: st.source.index };
      const res = sellItem(session, ref);
      if (res?.ok) {
        audio.playSfx('sell');
        selected = null;
        showToast(`💰 已出售【${def?.name || '装备'}】`);
        renderAll();
      }
      return;
    }

    // 2. 拖到暂存托盘槽位上
    const trayIdx = getTraySlotFromPoint(ev.clientX, ev.clientY);
    if (trayIdx !== null && Number.isInteger(trayIdx)) {
      executeDropToTray(st.source, trayIdx);
      return;
    }

    // 3. 拖到背包网格上
    const gridPos = getBoardGridCoordFromPoint(ev.clientX, ev.clientY);
    if (gridPos) {
      const anchorR = gridPos.row - st.grabDr;
      const anchorC = gridPos.col - st.grabDc;
      // 若直接落在了单个可合成目标物品上，自动对齐目标物品锚点以便合成
      const preview = evaluateBagDropPreview(
        st.source.itemId,
        anchorR,
        anchorC,
        st.source.rot,
        st.source.zone === 'bag' ? st.source.uid : null,
      );
      if ((preview.status === 'upgrade' || preview.status === 'mythic') && preview.targetItem) {
        executeDropToBag(st.source, preview.targetItem.row, preview.targetItem.col, st.source.rot);
      } else {
        executeDropToBag(st.source, anchorR, anchorC, st.source.rot);
      }
    } else {
      renderAll();
    }
  };

  window.addEventListener('pointerup', (ev) => finishDrag(ev, false));
  window.addEventListener('pointercancel', (ev) => finishDrag(ev, true));
}

// ================= 无障碍点选交互与快捷键绑定 =================
function triggerRotateAction() {
  if (session.status !== 'prep') return;

  // 若正在拖拽途中按 R 键，实时旋转拖拽中的物品！
  if (dragState && dragState.active) {
    dragState.source.rot = ((dragState.source.rot || 0) + 1) % 4;
    dragState.grabDr = 0;
    dragState.grabDc = 0;
    audio.playSfx('rotate');
    buildDragGhostDom(dragState.source.itemId, dragState.source.rot);
    positionDragGhost(dragState.lastX, dragState.lastY, 0, 0);
    const gridPos = getBoardGridCoordFromPoint(dragState.lastX, dragState.lastY);
    if (gridPos) {
      paintBagPreview(
        dragState.source.itemId,
        gridPos.row,
        gridPos.col,
        dragState.source.rot,
        dragState.source.zone === 'bag' ? dragState.source.uid : null,
      );
    }
    return;
  }

  if (!selected) return;
  if (selected.zone === 'shop') {
    selected.rot = ((selected.rot || 0) + 1) % 4;
    audio.playSfx('rotate');
    renderAll();
    return;
  }
  if (selected.zone === 'bag' || selected.zone === 'tray') {
    const ref =
      selected.zone === 'bag'
        ? { zone: 'bag', uid: selected.uid }
        : { zone: 'tray', index: selected.index };
    const res = rotateItem(session, ref);
    if (res?.ok) {
      audio.playSfx('rotate');
      renderAll();
    } else {
      audio.playSfx('close');
      showToast('当前位置空间局促无法直接旋转，可先拖入右侧暂存区旋转！');
    }
  }
}

function setupClickAndControlHandlers() {
  // 背包棋盘点击（扩格 / 点选物品 / 点格放置或合成）
  els.backpackBoard.addEventListener('click', (ev) => {
    if (performance.now() < suppressNextClickUntil) return;
    audio.unlock();

    const subcell = ev.target.closest('.item-subcell');
    const cellEl = ev.target.closest('.bag-cell');

    if (session.status !== 'prep') {
      if (subcell) {
        const hit = session.bag.items.find((it) => it.uid === subcell.dataset.uid);
        if (hit) {
          selected = { zone: 'bag', uid: hit.uid, itemId: hit.itemId, rot: hit.rot };
          renderInspectorAndTray(getCurrentSynergies());
        }
      }
      return;
    }

    // 1. 点击了待扩建虚线格 -> 立即扩建解锁！
    if (cellEl && cellEl.classList.contains('is-expandable')) {
      const r = Number(cellEl.dataset.row);
      const c = Number(cellEl.dataset.col);
      const res = expandBagCell(session, r, c);
      if (res?.ok) {
        audio.playSfx('expand');
        showToast(
          session.expandPoints > 0
            ? `✨ 解锁新背包格！还剩 ${session.expandPoints} 点扩建额度`
            : '🎒 本轮背包扩建已完成！',
        );
        renderAll();
      }
      return;
    }

    // 2. 点击了背包已有物品子格
    if (subcell) {
      const hitItem = session.bag.items.find((it) => it.uid === subcell.dataset.uid);
      if (!hitItem) return;

      // 若已选中另一件物品，检查是否可与被点击物品直接合成！
      if (selected && !(selected.zone === 'bag' && selected.uid === hitItem.uid) && selected.zone !== 'enemy') {
        const compat = checkMergeCompatibility(selected.itemId, hitItem.itemId);
        if (compat) {
          executeDropToBag(selected, hitItem.row, hitItem.col, selected.rot || 0);
          return;
        }
      }

      // 切换选中该背包物品
      audio.playSfx('click');
      if (selected?.zone === 'bag' && selected.uid === hitItem.uid) {
        selected = null;
      } else {
        selected = { zone: 'bag', uid: hitItem.uid, itemId: hitItem.itemId, rot: hitItem.rot };
      }
      renderAll();
      return;
    }

    // 3. 点击了已解锁空背包格 -> 若当前持有待放置物品则智能放置
    if (cellEl && cellEl.classList.contains('is-unlocked')) {
      const r = Number(cellEl.dataset.row);
      const c = Number(cellEl.dataset.col);
      if (selected && (selected.zone === 'shop' || selected.zone === 'tray' || selected.zone === 'bag')) {
        const anchor = resolveSmartAnchorForClick(
          selected.itemId,
          r,
          c,
          selected.rot || 0,
          selected.zone === 'bag' ? selected.uid : null,
        );
        executeDropToBag(selected, anchor.row, anchor.col, selected.rot || 0);
      } else {
        selected = null;
        renderAll();
      }
    }
  });

  // 暂存托盘点击
  els.holdingTray.addEventListener('click', (ev) => {
    if (performance.now() < suppressNextClickUntil) return;
    audio.unlock();
    if (session.status !== 'prep') return;

    const slotEl = ev.target.closest('.tray-slot');
    if (!slotEl) return;
    const idx = Number(slotEl.dataset.trayIndex);
    const entry = session.tray?.[idx] || null;

    if (selected && selected.zone !== 'enemy') {
      if (selected.zone === 'tray' && selected.index === idx) {
        selected = null;
        audio.playSfx('click');
        renderAll();
        return;
      }
      if (!entry || checkMergeCompatibility(selected.itemId, entry.itemId)) {
        executeDropToTray(selected, idx);
        return;
      }
    }

    if (entry) {
      audio.playSfx('click');
      selected = { zone: 'tray', index: idx, uid: entry.uid, itemId: entry.itemId, rot: entry.rot || 0 };
      renderAll();
    }
  });

  // 商店卡片点击（首击选中预览/可旋转，再击同一张直接快速购买入包！）
  els.shopCardsRow.addEventListener('click', (ev) => {
    if (performance.now() < suppressNextClickUntil) return;
    audio.unlock();
    if (session.status !== 'prep') return;
    if (ev.target.closest('.shop-lock-mini')) return;

    const card = ev.target.closest('.shop-card:not(.is-sold)');
    if (!card) return;
    const slotIdx = Number(card.dataset.shopSlot);
    const slot = session.shop?.[slotIdx];
    if (!slot || slot.sold) return;

    if (selected?.zone === 'shop' && selected.slotIndex === slotIdx) {
      const res = buyShopItem(session, slotIdx);
      if (res?.ok) res.bought = true;
      handleOperationFeedback(res, `已购入【${getItemById(slot.itemId)?.name || '装备'}】！`);
    } else {
      audio.playSfx('click');
      selected = { zone: 'shop', slotIndex: slotIdx, itemId: slot.itemId, rot: 0 };
      renderAll();
    }
  });

  // 中腰按钮：旋转 / 出售 / 一键智能整理 / 一键扩格
  els.btnRotate.addEventListener('click', () => {
    audio.unlock();
    triggerRotateAction();
  });

  els.btnSell.addEventListener('click', () => {
    audio.unlock();
    if (session.status !== 'prep' || !selected) return;
    if (selected.zone !== 'bag' && selected.zone !== 'tray') return;
    const def = getItemById(selected.itemId);
    const ref =
      selected.zone === 'bag'
        ? { zone: 'bag', uid: selected.uid }
        : { zone: 'tray', index: selected.index };
    const res = sellItem(session, ref);
    if (res?.ok) {
      audio.playSfx('sell');
      selected = null;
      showToast(`💰 出售【${def?.name || '装备'}】获得金币！`);
      renderAll();
    }
  });

  els.btnAutoSort.addEventListener('click', () => {
    audio.unlock();
    if (session.status !== 'prep') return;
    const res = autoArrangeBag(session);
    audio.playSfx('reward');
    selected = null;
    if (res?.mythicsMerged > 0) {
      runStats.mythicsCrafted += res.mythicsMerged;
    }
    if (res?.upgradesMerged > 0) {
      runStats.upgradesDone += res.upgradesMerged;
    }
    showToast('✨ 已自动扩格、合成并按最大化光环重排背包！');
    renderAll();
  });

  els.btnAutoExpand.addEventListener('click', () => {
    audio.unlock();
    if (session.status !== 'prep') return;
    autoExpandBag(session);
    audio.playSfx('expand');
    showToast('🔓 已自动解锁中心外围背包格！');
    renderAll();
  });

  // 底部按钮：收起/展开商店、刷新、锁店、塞满开战
  els.btnToggleShop.addEventListener('click', () => {
    audio.unlock();
    audio.playSfx('click');
    shopCollapsed = !shopCollapsed;
    renderAll();
  });

  els.btnReroll.addEventListener('click', () => {
    audio.unlock();
    if (session.status !== 'prep') return;
    const res = rerollShop(session);
    if (res?.ok) {
      audio.playSfx('reroll');
      if (selected?.zone === 'shop') selected = null;
      renderAll();
    } else {
      audio.playSfx('close');
      showToast('金币不足，无法刷新商店！');
    }
  });

  els.btnLockShop.addEventListener('click', () => {
    audio.unlock();
    if (session.status !== 'prep') return;
    toggleShopAllLock(session);
    audio.playSfx('click');
    renderAll();
  });

  els.btnStartCombat.addEventListener('click', () => {
    audio.unlock();
    startCombatPlayback();
  });

  // 战斗倍速与瞬时结算
  els.btnSpeed.addEventListener('click', () => {
    audio.unlock();
    audio.playSfx('click');
    battleSpeed = battleSpeed === 1 ? 2 : battleSpeed === 2 ? 3 : 1;
    els.speedBtnLabel.textContent = `⏩ 倍速 ×${battleSpeed}`;
  });

  els.btnSkipCombat.addEventListener('click', () => {
    audio.unlock();
    audio.playSfx('click');
    battleSkipRequested = true;
  });

  // 顶部栏按钮：勇者被动 / 图鉴 / 规则 / 静音
  els.heroBadge.addEventListener('click', () => {
    audio.unlock();
    audio.playSfx('click');
    if (session.hero) {
      showToast(`🛡️ ${session.hero.name} · 【${session.hero.passiveName}】${session.hero.passiveDesc}`);
    }
  });

  els.btnCatalog.addEventListener('click', () => {
    audio.unlock();
    audio.playSfx('click');
    renderCatalogModal();
    openModalSafe(els.catalogDialog);
  });

  els.catalogTabs.addEventListener('click', (ev) => {
    const tabBtn = ev.target.closest('.tab-chip');
    if (!tabBtn) return;
    audio.playSfx('click');
    activeCatalogTab = tabBtn.dataset.tab || 'mythic';
    for (const b of els.catalogTabs.querySelectorAll('.tab-chip')) {
      b.classList.toggle('is-active', b === tabBtn);
    }
    renderCatalogModal();
  });

  els.btnHelp.addEventListener('click', () => {
    audio.unlock();
    audio.playSfx('click');
    openModalSafe(els.helpDialog);
  });

  els.btnMute.addEventListener('click', () => {
    const muted = audio.toggleMute();
    els.btnMute.textContent = muted ? '🔇' : '🔊';
    if (!muted) audio.playSfx('click');
  });

  els.btnRestart.addEventListener('click', () => {
    audio.unlock();
    audio.playSfx('click');
    closeModalSafe(els.resultDialog);
    resetToHeroSelect();
  });

  // 键盘快捷键 R 顺时针旋转
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'r' || ev.key === 'R') {
      if (document.querySelector('dialog[open]')) return;
      ev.preventDefault();
      triggerRotateAction();
    }
  });
}

// ================= 1v1 实时战斗逐帧播放器 =================
function pulseElementClass(el, className, durationMs = 220) {
  if (!el) return;
  el.classList.add(className);
  clearTimeout(el._pulseTimer);
  el._pulseTimer = setTimeout(() => {
    el.classList.remove(className);
  }, durationMs);
}

function handleCombatEventsForVisuals(events) {
  for (const ev of events) {
    if (ev.type === 'item_fire') {
      const def = ev.itemId ? getItemById(ev.itemId) : null;
      const isMythic = Boolean(def && (def.category === 'mythic' || def.tier === 5));
      if (ev.side === 'player' && ev.sourceUid) {
        const bagEl = els.backpackItemsLayer.querySelector(`[data-uid="${ev.sourceUid}"]`);
        pulseElementClass(bagEl, 'is-firing', 230);
      } else if (ev.side === 'enemy' && ev.sourceUid) {
        const eqEl = els.enemyLoadoutBar.querySelector(`[data-uid="${ev.sourceUid}"]`);
        pulseElementClass(eqEl, 'is-firing', 230);
      }

      const projKey = ev.projectile || def?.projectile;
      if (projKey || (def?.combat?.damage || 0) > 0 || (def?.combat?.poison || 0) > 0) {
        fx.spawnProjectile({
          side: ev.side,
          targetSide: ev.side === 'player' ? 'enemy' : 'player',
          sourceUid: ev.sourceUid,
          projectile: projKey || 'sword',
          speedMult: battleSpeed,
          isMythic,
        });
      }
      if (ev.sfx || def?.sfx) {
        audio.playSfx(ev.sfx || def.sfx, { volume: 0.44, minIntervalMs: 68 });
      }
    } else if (ev.type === 'damage') {
      fx.spawnBitmapNumber({
        targetSide: ev.targetSide || (ev.side === 'player' ? 'enemy' : 'player'),
        prefix: ev.isCrit ? 'BJ_' : 'PT_',
        rawText: `${Math.round(ev.amount || 0)}`,
        isCrit: Boolean(ev.isCrit),
      });
    } else if (ev.type === 'thorns') {
      fx.spawnBitmapNumber({
        targetSide: ev.targetSide || 'enemy',
        prefix: 'FS_',
        rawText: `${Math.round(ev.amount || 0)}`,
      });
    } else if (ev.type === 'poison_tick') {
      fx.spawnBitmapNumber({
        targetSide: ev.targetSide || 'enemy',
        prefix: 'ZD_',
        rawText: `-${Math.round(ev.amount || 0)}`,
      });
    } else if (ev.type === 'heal') {
      if ((ev.amount || 0) >= 2) {
        fx.spawnBitmapNumber({
          targetSide: ev.targetSide || ev.side || 'player',
          prefix: 'HX_',
          rawText: `+${Math.round(ev.amount)}`,
        });
      }
    } else if (ev.type === 'shield') {
      if ((ev.amount || 0) >= 4) {
        fx.spawnBitmapNumber({
          targetSide: ev.targetSide || ev.side || 'player',
          prefix: 'FS_',
          rawText: `+${Math.round(ev.amount)}`,
        });
      }
    } else if (ev.type === 'dodge') {
      fx.spawnDodge(ev.targetSide || 'player');
    } else if (ev.type === 'revive') {
      audio.playSfx('reward');
      fx.spawnTagPopup(ev.targetSide || ev.side || 'player', '💖 不死复活!');
    } else if (ev.type === 'frenzy_start') {
      audio.playSfx('bossWarn');
      fx.spawnTagPopup('enemy', '🔥 疲劳狂暴!');
    }
  }
}

function updateCombatSnapshotDom(snap) {
  if (!snap) return;

  els.battleClock.textContent = `${snap.elapsed.toFixed(1)}s`;
  if (snap.frenzyMult > 1.01) {
    els.frenzyBadge.hidden = false;
    els.frenzyBadge.textContent = `🔥 狂暴 ×${snap.frenzyMult.toFixed(2)}`;
  } else {
    els.frenzyBadge.hidden = true;
  }

  // 1. 更新我方血条、护盾、受击颜艺 _st.png 与状态芯片
  const p = snap.player;
  const pHpPct = Math.max(0, Math.min(100, (p.hp / Math.max(1, p.maxHp)) * 100));
  const pShPct = Math.max(0, Math.min(100, (p.shield / Math.max(1, p.maxHp)) * 100));
  els.playerHpFill.style.inlineSize = `${pHpPct.toFixed(1)}%`;
  els.playerShieldFill.style.inlineSize = `${pShPct.toFixed(1)}%`;
  els.playerHpText.textContent = `${Math.max(0, Math.ceil(p.hp))} / ${p.maxHp}`;
  els.playerShieldBadge.hidden = !(p.shield > 0);
  els.playerShieldBadge.textContent = `🛡️${Math.ceil(p.shield)}`;

  const pHit = (p.hitStunTimer || 0) > 0;
  els.playerFighter.classList.toggle('is-hit', pHit);
  const pTargetSrc = pHit && p.hitPortrait ? p.hitPortrait : p.portrait;
  if (pTargetSrc && els.playerPortrait.dataset.curSrc !== pTargetSrc) {
    els.playerPortrait.src = pTargetSrc;
    els.playerPortrait.dataset.curSrc = pTargetSrc;
    els.playerPortrait.style.setProperty('--sprite-boost', getSpriteBoostForPortrait(p.portrait || pTargetSrc));
  }
  renderStatusChips(els.playerStatusRow, p);

  // 2. 更新敌方血条、护盾、受击颜艺 _st.png 与状态芯片
  const e = snap.enemy;
  const eHpPct = Math.max(0, Math.min(100, (e.hp / Math.max(1, e.maxHp)) * 100));
  const eShPct = Math.max(0, Math.min(100, (e.shield / Math.max(1, e.maxHp)) * 100));
  els.enemyHpFill.style.inlineSize = `${eHpPct.toFixed(1)}%`;
  els.enemyShieldFill.style.inlineSize = `${eShPct.toFixed(1)}%`;
  els.enemyHpText.textContent = `${Math.max(0, Math.ceil(e.hp))} / ${e.maxHp}`;
  els.enemyShieldBadge.hidden = !(e.shield > 0);
  els.enemyShieldBadge.textContent = `🛡️${Math.ceil(e.shield)}`;

  const eHit = (e.hitStunTimer || 0) > 0;
  els.enemyFighter.classList.toggle('is-hit', eHit);
  const eTargetSrc = eHit && e.hitPortrait ? e.hitPortrait : e.portrait;
  if (eTargetSrc && els.enemyPortrait.dataset.curSrc !== eTargetSrc) {
    els.enemyPortrait.src = eTargetSrc;
    els.enemyPortrait.dataset.curSrc = eTargetSrc;
    els.enemyPortrait.style.setProperty('--sprite-boost', getSpriteBoostForPortrait(e.portrait || eTargetSrc));
  }
  renderStatusChips(els.enemyStatusRow, e);

  // 3. 更新下半屏每件背包装备的实时 CD 充能遮罩
  for (const slot of p.slots || []) {
    const itemWrap = els.backpackItemsLayer.querySelector(`[data-uid="${slot.uid}"]`);
    if (!itemWrap) continue;
    const prog = slot.cooldown > 0 ? Math.max(0, Math.min(1, slot.progress || 0)) : 0;
    const fills = itemWrap.querySelectorAll('.item-cd-fill');
    for (const f of fills) {
      f.style.transform = `scaleY(${prog.toFixed(3)})`;
    }
  }

  // 4. 更新敌方预览栏装备实时 CD 遮罩
  const enemyChips = els.enemyLoadoutBar.querySelectorAll('.enemy-equip-chip');
  (e.slots || []).forEach((slot, idx) => {
    const chip =
      els.enemyLoadoutBar.querySelector(`[data-uid="${slot.uid}"]`) || enemyChips[idx];
    if (!chip) return;
    if (slot.uid) chip.dataset.uid = slot.uid;
    const fill = chip.querySelector('.enemy-equip-cd');
    if (fill) {
      const prog = slot.cooldown > 0 ? Math.max(0, Math.min(1, slot.progress || 0)) : 0;
      fill.style.transform = `scaleY(${prog.toFixed(3)})`;
    }
  });
}

function startCombatPlayback() {
  if (session.status !== 'prep') return;
  if (session.bag.items.length === 0) {
    showToast('⚠️ 背包里还没有任何装备！先把武器塞进背包再开战吧');
    audio.playSfx('close');
    return;
  }

  selected = null;
  battleSkipRequested = false;
  fx.clearAll();

  const prevMergeCount = Array.isArray(session.lastMergeEvents) ? session.lastMergeEvents.length : 0;
  const sim = beginCombatPhase(session);
  activeSimulator = sim;

  // 若开战前触发了相邻跨物品★神话自动觉醒，给玩家华丽提示！
  const newlyMerged = Array.isArray(session.lastMergeEvents)
    ? session.lastMergeEvents.slice(prevMergeCount)
    : [];
  if (newlyMerged.length > 0) {
    audio.playSfx('mythic');
    showMythicCelebration(newlyMerged[0].resultId, '🌟 战前相邻觉醒！');
  }

  const enemy = getEnemyByRound(session.round);
  if (enemy?.isBoss) {
    audio.playSfx('bossWarn');
  }
  audio.playBgm('battle');

  renderAll();
  updateCombatSnapshotDom(sim.getState());

  let lastTs = performance.now();
  let accumulator = 0;
  const FIXED_DT = 0.05;

  const stepLoop = (now) => {
    if (!activeSimulator) return;

    if (battleSkipRequested) {
      let guard = 0;
      while (!activeSimulator.getState().finished && guard < 1000) {
        activeSimulator.step(FIXED_DT);
        guard += 1;
      }
      const endSnap = activeSimulator.getState();
      updateCombatSnapshotDom(endSnap);
      concludeCombatRound(endSnap, 80);
      return;
    }

    const rawDt = Math.min(0.12, Math.max(0, (now - lastTs) / 1000));
    lastTs = now;
    accumulator += rawDt * battleSpeed;

    let stepsThisFrame = 0;
    while (accumulator >= FIXED_DT && stepsThisFrame < 8) {
      const res = activeSimulator.step(FIXED_DT);
      accumulator -= FIXED_DT;
      stepsThisFrame += 1;
      handleCombatEventsForVisuals(res.events || []);
      if (res.finished) break;
    }

    const snap = activeSimulator.getState();
    updateCombatSnapshotDom(snap);

    if (snap.finished) {
      concludeCombatRound(snap, 460);
      return;
    }

    combatRafId = requestAnimationFrame(stepLoop);
  };

  combatRafId = requestAnimationFrame(stepLoop);
}

function concludeCombatRound(finalSnap, delayMs = 420) {
  cancelAnimationFrame(combatRafId);
  combatRafId = null;
  const winner = finalSnap.winner || 'player';
  audio.playSfx(winner === 'player' ? 'win' : 'loss');

  setTimeout(() => {
    activeSimulator = null;
    fx.clearAll();
    els.playerPortrait.dataset.curSrc = '';
    els.enemyPortrait.dataset.curSrc = '';

    settleCombatResult(session, {
      winner,
      elapsed: finalSnap.elapsed,
      playerHpLeft: Math.max(0, Math.round(finalSnap.player.hp)),
      enemyHpLeft: Math.max(0, Math.round(finalSnap.enemy.hp)),
    });

    if (session.status === 'victory' || session.status === 'defeat') {
      renderAll();
      openResultModal(session.status === 'victory');
      return;
    }

    audio.playBgm('prep');
    if (winner === 'player') {
      showToast(`🏆 战斗大捷！进入第 ${session.round} 轮，获得金币与扩包额度！`);
    } else {
      showToast(`💔 惜败扣 1 心！已发放逆风扩包保护，重整背包再战！`);
    }
    renderAll();
  }, delayMs);
}

// ================= 勇者选择、图鉴秘典与终局结算弹窗 =================
function renderHeroPickModal() {
  els.heroPickGrid.innerHTML = '';
  for (const h of HEROES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hero-pick-card';
    btn.innerHTML = `
      <img class="hero-pick-avatar" src="${h.portrait}" width="58" height="58" alt="${h.name}">
      <strong>${h.name}</strong>
      <span class="hero-passive-tag">${h.passiveName}</span>
      <p>${h.passiveDesc}</p>
    `;
    btn.addEventListener('click', () => {
      audio.unlock();
      audio.playSfx('reward');
      selectHero(session, h.id);
      selected = null;
      shopCollapsed = false;
      runStats = { upgradesDone: 0, mythicsCrafted: 0 };
      closeModalSafe(els.heroDialog);
      audio.playBgm('prep');
      renderAll();
      showToast(`⚔️ ${h.name}出战！拖拽商店武器塞进背包开始冒险吧！`);
    });
    els.heroPickGrid.appendChild(btn);
  }
}

function renderCatalogModal() {
  els.catalogBody.innerHTML = '';

  if (activeCatalogTab === 'mythic') {
    for (const rc of MYTHIC_RECIPES || []) {
      const defA = getItemById(rc.ingredientA?.[0]);
      const defB = getItemById(rc.ingredientB?.[0]);
      const resDef = getItemById(rc.resultId);
      if (!defA || !defB || !resDef) continue;

      const card = document.createElement('div');
      card.className = 'recipe-card';
      card.innerHTML = `
        <div class="recipe-formula-row">
          <span class="recipe-part"><img src="${defA.icon}" alt="">${defA.name}</span>
          <strong>➕</strong>
          <span class="recipe-part"><img src="${defB.icon}" alt="">${defB.name}</span>
          <strong>➡️</strong>
          <span class="recipe-part is-result"><img src="${resDef.icon}" alt="">${formatMythicName(resDef.name)}</span>
        </div>
        <p class="insp-desc-text">${resDef.desc}</p>
      `;
      els.catalogBody.appendChild(card);
    }
    return;
  }

  const allItems = Object.values(ITEMS || {});
  const filtered =
    activeCatalogTab === 'weapons'
      ? allItems.filter((it) => it.category === 'weapon')
      : allItems.filter((it) => it.category !== 'weapon' && it.category !== 'mythic');

  for (const it of filtered) {
    const card = document.createElement('div');
    card.className = 'catalog-item-card';
    const row = document.createElement('div');
    row.className = 'catalog-item-row';

    const img = document.createElement('img');
    img.src = it.icon;
    img.alt = it.name;

    const info = document.createElement('div');
    info.className = 'catalog-item-text';
    const cdLabel = it.cooldown > 0 ? `CD ${it.cooldown}s` : '常驻光环';
    info.innerHTML = `
      <div><strong>${it.name}</strong> <span class="insp-pill">${cdLabel} · ${it.cost}金</span></div>
      <p class="insp-desc-text">${it.desc}</p>
    `;

    row.appendChild(img);
    row.appendChild(createShapeMiniMatrix(it.id, 0));
    row.appendChild(info);
    card.appendChild(row);
    els.catalogBody.appendChild(card);
  }
}

function openResultModal(isVictory) {
  els.resultDialogTitle.textContent = isVictory
    ? '🏆 十轮制霸 · 塞包之神！'
    : '💔 征途暂歇 · 重整行囊再战';
  const cleared = (session.history || []).filter((h) => h.winner === 'player').length;
  els.resultDialogSub.textContent = isVictory
    ? `恭喜使用【${session.hero?.name || '勇者'}】击败第 10 轮终极魔王，完美通关！`
    : `本次闯至第 ${session.round} 轮，累计击败 ${cleared} 波强敌。试试围绕齿轮/毒瓶构建神话连携吧！`;

  const totalUpgrades = session.stats?.upgradesDone ?? runStats.upgradesDone;
  const totalMythics = session.stats?.mythicsCrafted ?? runStats.mythicsCrafted;
  els.resultStatsGrid.innerHTML = `
    <div class="result-stat-box">胜场波次<strong>${cleared}/${MAX_ROUNDS}</strong></div>
    <div class="result-stat-box">进化升阶<strong>${totalUpgrades}次</strong></div>
    <div class="result-stat-box">★神话觉醒<strong>${totalMythics}件</strong></div>
  `;

  els.resultBagShowcase.innerHTML = '';
  for (const placed of session.bag.items) {
    const def = getItemById(placed.itemId);
    if (!def) continue;
    const isMythic = def.category === 'mythic' || def.tier === 5;
    const chip = document.createElement('span');
    chip.className = `showcase-chip${isMythic ? ' is-mythic' : ''}`;
    chip.innerHTML = `<img src="${def.icon}" alt="">${isMythic ? formatMythicName(def.name) : def.name}`;
    els.resultBagShowcase.appendChild(chip);
  }

  openModalSafe(els.resultDialog);
}

function resetToHeroSelect() {
  cancelAnimationFrame(combatRafId);
  activeSimulator = null;
  fx.clearAll();
  session = createSession();
  selected = null;
  renderAll();
  renderHeroPickModal();
  openModalSafe(els.heroDialog);
}

// ================= 启动入口 =================
function bootstrap() {
  setupDialogs();
  setupPointerInteractions();
  setupClickAndControlHandlers();
  renderHeroPickModal();
  renderAll();
  openModalSafe(els.heroDialog);
}

bootstrap();
