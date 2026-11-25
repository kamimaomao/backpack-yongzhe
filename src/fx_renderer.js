// 《勇者塞满包 · 背包合成乱斗》跨屏抛物线飞弹池 + 原版 Hud 彩色位图数字跳字渲染器

import { ASSET_BASE, PROJECTILES } from './engine/catalog.js';

const HUD_DIR = `${ASSET_BASE}/sprites/UI_界面/ui/Hud/`;
const BULLET_DIR = `${ASSET_BASE}/sprites/UI_界面/ui/Bullets/`;

// 磁盘真实存在的飞弹兜底表（零 404 保障）
const FALLBACK_PROJECTILES = {
  rock: `${BULLET_DIR}zidan_1.png`,
  hammer: `${BULLET_DIR}zidan_1.png`,
  sword: `${BULLET_DIR}zidan_2.png`,
  melee: `${BULLET_DIR}zidan_2.png`,
  axe: `${BULLET_DIR}zidan_3.png`,
  vamp: `${BULLET_DIR}zidan_4.png`,
  shield: `${BULLET_DIR}zidan_5.png`,
  holy: `${BULLET_DIR}zidan_5.png`,
  ice: `${BULLET_DIR}zidan_6.png`,
  chill: `${BULLET_DIR}zidan_6.png`,
  potion: `${BULLET_DIR}zidan_7.png`,
  poison: `${BULLET_DIR}zidan_8.png`,
  arrow: `${BULLET_DIR}zidan_9.png`,
  bow: `${BULLET_DIR}zidan_9.png`,
  fire: `${BULLET_DIR}zidan_10.png`,
  gun: `${BULLET_DIR}zidan_18.png`,
  gold: `${BULLET_DIR}zidan_18.png`,
  staff: `${BULLET_DIR}zidan_10.png`,
  mythic: `${BULLET_DIR}dazhao_1.png`,
};

// 严格按磁盘 Hud/ 实际存在文件校验符号（PT_/BJ_/HX_ 无负号，ZD_ 无正号）
const PREFIX_ALLOWED_SIGNS = {
  PT_: new Set(['+']),
  BJ_: new Set(['+']),
  HX_: new Set(['+']),
  ZD_: new Set(['-']),
  FS_: new Set(['+', '-']),
  SH_: new Set(['+', '-']),
  DZ_: new Set(['+', '-']),
  JN_: new Set(['+', '-']),
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function quadBezier(p0, p1, p2, u) {
  const inv = 1 - u;
  return {
    x: inv * inv * p0.x + 2 * inv * u * p1.x + u * u * p2.x,
    y: inv * inv * p0.y + 2 * inv * u * p1.y + u * u * p2.y,
  };
}

function hurtNumCurve(age) {
  if (age < 0 || age > 0.84) return null;
  let scale = 1.0;
  let op = 1.0;
  if (age < 0.13) {
    const u = age / 0.13;
    scale = lerp(0.26, 1.28, u);
    op = u;
  } else if (age < 0.24) {
    scale = 1.28;
  } else if (age < 0.35) {
    scale = lerp(1.28, 1.0, (age - 0.24) / 0.11);
  } else if (age < 0.56) {
    scale = 1.0;
  } else {
    scale = 1.0;
    op = 1.0 - (age - 0.56) / 0.28;
  }
  const dy = -age * 44;
  return { scale, op: clamp(op, 0, 1), dy };
}

export function resolveProjectileSprite(keyOrPath) {
  if (!keyOrPath) return FALLBACK_PROJECTILES.sword;
  if (PROJECTILES && PROJECTILES[keyOrPath]) {
    return PROJECTILES[keyOrPath];
  }
  if (keyOrPath.includes('/')) {
    return keyOrPath;
  }
  return FALLBACK_PROJECTILES[keyOrPath] || FALLBACK_PROJECTILES.sword;
}

function sanitizeBitmapChars(prefix, rawStr) {
  const allowedSigns = PREFIX_ALLOWED_SIGNS[prefix] || new Set();
  const out = [];
  for (const ch of String(rawStr)) {
    if (ch >= '0' && ch <= '9') {
      out.push(ch);
    } else if ((ch === '+' || ch === '-') && allowedSigns.has(ch)) {
      out.push(ch);
    }
  }
  return out.length > 0 ? out : ['0'];
}

export class FxRenderer {
  /**
   * @param {{
   *   overlayEl: HTMLElement,
   *   playerAnchorEl: HTMLElement,
   *   enemyAnchorEl: HTMLElement,
   *   bagItemsLayerEl: HTMLElement,
   *   enemyLoadoutEl: HTMLElement,
   * }} refs
   */
  constructor(refs) {
    this.overlayEl = refs.overlayEl;
    this.playerAnchorEl = refs.playerAnchorEl;
    this.enemyAnchorEl = refs.enemyAnchorEl;
    this.bagItemsLayerEl = refs.bagItemsLayerEl;
    this.enemyLoadoutEl = refs.enemyLoadoutEl;

    this.projLayer = document.createElement('div');
    this.projLayer.className = 'fx-proj-sublayer';
    this.overlayEl.appendChild(this.projLayer);

    this.hudLayer = document.createElement('div');
    this.hudLayer.className = 'fx-hud-sublayer';
    this.overlayEl.appendChild(this.hudLayer);

    // 复用飞弹节点池
    this.projPool = [];
    for (let i = 0; i < 32; i++) {
      const img = document.createElement('img');
      img.className = 'fx-flying-bullet';
      img.alt = '';
      img.style.display = 'none';
      this.projLayer.appendChild(img);
      this.projPool.push(img);
    }

    // 复用原版 Hud 位图数字跳字池
    this.hudPool = [];
    for (let i = 0; i < 34; i++) {
      const wrap = document.createElement('div');
      wrap.className = 'fx-hud-item';
      wrap.style.display = 'none';

      const boom = document.createElement('img');
      boom.className = 'fx-hud-boom';
      boom.src = `${HUD_DIR}boom.png`;
      boom.alt = '';
      boom.style.display = 'none';

      const dodgeImg = document.createElement('img');
      dodgeImg.className = 'fx-hud-dodge';
      dodgeImg.src = `${HUD_DIR}SB.png`;
      dodgeImg.alt = '';
      dodgeImg.style.display = 'none';

      const row = document.createElement('div');
      row.className = 'fx-hud-digits';
      const digits = [];
      for (let k = 0; k < 6; k++) {
        const d = document.createElement('img');
        d.className = 'fx-digit-img';
        d.alt = '';
        d.style.display = 'none';
        row.appendChild(d);
        digits.push(d);
      }

      const tag = document.createElement('span');
      tag.className = 'fx-hud-tag';
      tag.style.display = 'none';

      wrap.appendChild(boom);
      wrap.appendChild(dodgeImg);
      wrap.appendChild(row);
      wrap.appendChild(tag);
      this.hudLayer.appendChild(wrap);
      this.hudPool.push({ wrap, boom, dodgeImg, row, digits, tag });
    }

    this.activeProjectiles = [];
    this.activePopups = [];
    this.jitterIdx = 0;
    this.rafId = null;
    this.startLoop();
  }

  startLoop() {
    const tick = () => {
      this.renderFrame();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  clearAll() {
    this.activeProjectiles.length = 0;
    this.activePopups.length = 0;
    for (const img of this.projPool) img.style.display = 'none';
    for (const h of this.hudPool) h.wrap.style.display = 'none';
  }

  getLocalCenter(el) {
    const rootRect = this.overlayEl.getBoundingClientRect();
    if (!el) {
      return { x: (rootRect.width || 380) * 0.5, y: 120 };
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      return { x: (rootRect.width || 380) * 0.5, y: 120 };
    }
    return {
      x: r.left - rootRect.left + r.width * 0.5,
      y: r.top - rootRect.top + r.height * 0.48,
    };
  }

  getFighterPoint(side) {
    return side === 'enemy'
      ? this.getLocalCenter(this.enemyAnchorEl)
      : this.getLocalCenter(this.playerAnchorEl);
  }

  getItemLaunchPoint(side, sourceUid) {
    if (sourceUid) {
      if (side === 'player' && this.bagItemsLayerEl) {
        const itemEl = this.bagItemsLayerEl.querySelector(`[data-uid="${sourceUid}"]`);
        if (itemEl) return this.getLocalCenter(itemEl);
      } else if (side === 'enemy' && this.enemyLoadoutEl) {
        const chipEl = this.enemyLoadoutEl.querySelector(`[data-uid="${sourceUid}"]`);
        if (chipEl) return this.getLocalCenter(chipEl);
      }
    }
    return this.getFighterPoint(side);
  }

  spawnProjectile({ side = 'player', targetSide = 'enemy', sourceUid = null, projectile = 'sword', speedMult = 1, isMythic = false }) {
    const p0 = this.getItemLaunchPoint(side, sourceUid);
    const p2 = this.getFighterPoint(targetSide);
    const dist = Math.hypot(p2.x - p0.x, p2.y - p0.y);
    const baseMs = clamp(180 + dist * 0.42, 180, 380);
    const durationMs = Math.max(95, baseMs / Math.max(1, speedMult));

    const curveSign = side === 'player' ? -1 : 1;
    const midX = (p0.x + p2.x) * 0.5 + curveSign * 28;
    const midY = Math.min(p0.y, p2.y) - 42;

    this.activeProjectiles.push({
      p0,
      p1: { x: midX, y: midY },
      p2,
      sprite: resolveProjectileSprite(projectile),
      bornMs: performance.now(),
      durationMs,
      size: isMythic ? 44 : 30,
      spinDir: side === 'player' ? 1 : -1,
    });

    if (this.activeProjectiles.length > this.projPool.length) {
      this.activeProjectiles.shift();
    }
  }

  spawnBitmapNumber({ targetSide = 'enemy', prefix = 'PT_', rawText = '0', isCrit = false }) {
    const anchor = this.getFighterPoint(targetSide);
    this.jitterIdx = (this.jitterIdx + 1) % 7;
    const jx = (this.jitterIdx - 3) * 10;
    const jy = ((this.jitterIdx * 3) % 5 - 2) * 6;

    this.activePopups.push({
      mode: 'bitmap',
      bornSec: performance.now() / 1000,
      x: anchor.x + jx,
      y: anchor.y - 16 + jy,
      prefix: PREFIX_ALLOWED_SIGNS[prefix] ? prefix : 'PT_',
      chars: sanitizeBitmapChars(prefix, rawText),
      isCrit,
    });

    if (this.activePopups.length > this.hudPool.length) {
      this.activePopups.shift();
    }
  }

  spawnDodge(targetSide = 'player') {
    const anchor = this.getFighterPoint(targetSide);
    this.jitterIdx = (this.jitterIdx + 1) % 5;
    this.activePopups.push({
      mode: 'dodge',
      bornSec: performance.now() / 1000,
      x: anchor.x + (this.jitterIdx - 2) * 10,
      y: anchor.y - 20,
    });
  }

  spawnTagPopup(targetSide = 'player', text = '✨ 触发!') {
    const anchor = this.getFighterPoint(targetSide);
    this.activePopups.push({
      mode: 'tag',
      bornSec: performance.now() / 1000,
      x: anchor.x,
      y: anchor.y - 32,
      text,
    });
  }

  renderFrame() {
    const nowMs = performance.now();
    const nowSec = nowMs / 1000;

    // 1. 更新抛物线飞弹
    let pi = 0;
    for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
      const p = this.activeProjectiles[i];
      const u = (nowMs - p.bornMs) / p.durationMs;
      if (u >= 1) {
        this.activeProjectiles.splice(i, 1);
        continue;
      }
      if (pi >= this.projPool.length) continue;

      const pos = quadBezier(p.p0, p.p1, p.p2, clamp(u, 0, 1));
      const rot = u * 460 * p.spinDir;
      const sc = lerp(0.8, 1.18, Math.sin(u * Math.PI));

      const img = this.projPool[pi++];
      img.style.display = 'block';
      img.style.width = `${p.size}px`;
      img.style.height = `${p.size}px`;
      if (img.dataset.src !== p.sprite) {
        img.src = p.sprite;
        img.dataset.src = p.sprite;
      }
      img.style.transform = `translate3d(${(pos.x - p.size * 0.5).toFixed(1)}px, ${(pos.y - p.size * 0.5).toFixed(1)}px, 0) rotate(${rot.toFixed(0)}deg) scale(${sc.toFixed(2)})`;
    }
    for (let i = pi; i < this.projPool.length; i++) {
      this.projPool[i].style.display = 'none';
    }

    // 2. 更新原版位图跳字与闪避提示
    let hi = 0;
    for (let i = this.activePopups.length - 1; i >= 0; i--) {
      const pop = this.activePopups[i];
      const age = nowSec - pop.bornSec;
      const curve = hurtNumCurve(age);
      if (!curve) {
        this.activePopups.splice(i, 1);
        continue;
      }
      if (hi >= this.hudPool.length) continue;

      const slot = this.hudPool[hi++];
      slot.wrap.style.display = 'flex';
      slot.wrap.style.opacity = curve.op.toFixed(2);
      slot.wrap.style.transform = `translate3d(${pop.x.toFixed(1)}px, ${(pop.y + curve.dy).toFixed(1)}px, 0) translate(-50%, -50%) scale(${curve.scale.toFixed(2)})`;

      if (pop.mode === 'dodge') {
        slot.boom.style.display = 'none';
        slot.row.style.display = 'none';
        slot.tag.style.display = 'none';
        slot.dodgeImg.style.display = 'block';
      } else if (pop.mode === 'tag') {
        slot.boom.style.display = 'none';
        slot.row.style.display = 'none';
        slot.dodgeImg.style.display = 'none';
        slot.tag.style.display = 'inline-block';
        slot.tag.textContent = pop.text;
      } else {
        slot.dodgeImg.style.display = 'none';
        slot.tag.style.display = 'none';
        slot.boom.style.display = pop.isCrit && age < 0.36 ? 'block' : 'none';
        slot.row.style.display = 'flex';

        const digitH = pop.isCrit ? 27 : 20;
        for (let k = 0; k < slot.digits.length; k++) {
          const dEl = slot.digits[k];
          const ch = pop.chars[k];
          if (!ch) {
            dEl.style.display = 'none';
            continue;
          }
          const src = `${HUD_DIR}${pop.prefix}${ch}.png`;
          dEl.style.display = 'block';
          dEl.style.height = `${digitH}px`;
          if (dEl.dataset.src !== src) {
            dEl.src = src;
            dEl.dataset.src = src;
          }
        }
      }
    }
    for (let i = hi; i < this.hudPool.length; i++) {
      this.hudPool[i].wrap.style.display = 'none';
    }
  }
}
