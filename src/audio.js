// 《勇者塞满包 · 背包合成乱斗》原生 BGM 与节流音效池管理器

import { ASSET_BASE, AUDIO_TRACKS } from './engine/catalog.js';

const STORAGE_MUTE_KEY = 'backpack_yongzhe_muted';

const FALLBACK_BGM = {
  menu: `${ASSET_BASE}/audio/BGM_ZhuJieMian.mp3`,
  prep: `${ASSET_BASE}/audio/BGM_ShangDian.mp3`,
  battle: `${ASSET_BASE}/audio/BGM_ZiDongZhanDou.mp3`,
};

// 所有磁盘 100% 真实存在的原生音效映射
const VALID_AUDIO_FILES = new Set([
  'AnNiuDianJi',
  'AnNiuGuanBi',
  'BGM_ShangDian',
  'BGM_ShiJian',
  'BGM_ZhuJieMian',
  'BGM_ZiDongZhanDou',
  'BOSSYuJing',
  'BaoWuHeCheng_1',
  'BaoWuHeCheng_2',
  'BaoWu_BaoKu',
  'GongXiHuoDe',
  'JiNengBiaoTi',
  'JiNeng_PaiKu',
  'JiNeng_XuanZe',
  'JieSuan_ShengLi',
  'JieSuan_ShiBai',
  'LaoHuJi_1',
  'LaoHuJi_2',
  'ShangDianShuaXin',
  'ShiJianDianJi',
  'SiWang',
  'ZhuBi_HuiShou',
  'ZhuBi_HuoDe',
  'ZiDanShuXing_BianHua',
  'ZiDan_BingKuai',
  'ZiDan_FaShe',
  'ZiDan_FuTou',
  'ZiDan_NaoZi',
  'ZiDan_QuanTao',
  'ZiDan_XiXueGui',
  'ZiDan_XueDi',
]);

const SFX_ALIASES = {
  click: 'AnNiuDianJi',
  close: 'AnNiuGuanBi',
  reroll: 'ShangDianShuaXin',
  buy: 'ZhuBi_HuiShou',
  sell: 'ZhuBi_HuoDe',
  rotate: 'JiNeng_XuanZe',
  place: 'AnNiuDianJi',
  expand: 'ZiDanShuXing_BianHua',
  upgrade: 'BaoWuHeCheng_1',
  mythic: 'BaoWuHeCheng_2',
  reward: 'GongXiHuoDe',
  bossWarn: 'BOSSYuJing',
  win: 'JieSuan_ShengLi',
  loss: 'JieSuan_ShiBai',
  death: 'SiWang',
  shoot: 'ZiDan_FaShe',
  melee: 'ZiDan_QuanTao',
  axe: 'ZiDan_FuTou',
  ice: 'ZiDan_BingKuai',
  vamp: 'ZiDan_XiXueGui',
  poison: 'ZiDan_XueDi',
};

function resolveAudioUrl(keyOrPath) {
  if (!keyOrPath) return null;

  // 1. 优先检查 catalog 导出的 AUDIO_TRACKS
  if (AUDIO_TRACKS && typeof AUDIO_TRACKS === 'object' && AUDIO_TRACKS[keyOrPath]) {
    const mapped = AUDIO_TRACKS[keyOrPath];
    if (mapped.endsWith('.mp3')) return mapped;
    if (VALID_AUDIO_FILES.has(mapped)) return `${ASSET_BASE}/audio/${mapped}.mp3`;
  }

  // 2. 已是完整相对路径
  if (keyOrPath.includes('/') && keyOrPath.endsWith('.mp3')) {
    return keyOrPath;
  }

  // 3. 别名或去掉 .mp3 后缀的原生文件名
  const cleanName = keyOrPath.replace(/\.mp3$/i, '');
  const aliased = SFX_ALIASES[cleanName] || cleanName;
  if (VALID_AUDIO_FILES.has(aliased)) {
    return `${ASSET_BASE}/audio/${aliased}.mp3`;
  }
  return `${ASSET_BASE}/audio/ZiDan_FaShe.mp3`;
}

export class AudioManager {
  constructor() {
    let savedMute = false;
    try {
      savedMute = localStorage.getItem(STORAGE_MUTE_KEY) === '1';
    } catch {
      savedMute = false;
    }
    this.muted = savedMute;
    this.unlocked = false;
    this.currentBgmKey = null;
    this.bgmEl = new Audio();
    this.bgmEl.loop = true;
    this.bgmEl.volume = 0.3;
    this.lastPlayedAt = new Map();
    this.pool = new Map();
  }

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    if (!this.muted && this.currentBgmKey) {
      this.playBgm(this.currentBgmKey);
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem(STORAGE_MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      // 忽略隐私模式写入异常
    }
    if (this.muted) {
      this.bgmEl.pause();
    } else if (this.currentBgmKey) {
      this.unlocked = true;
      this.playBgm(this.currentBgmKey);
    }
    return this.muted;
  }

  playBgm(key) {
    this.currentBgmKey = key;
    if (this.muted || !this.unlocked) return;

    const catalogKeyMap = { menu: 'bgmTitle', prep: 'bgmPrep', battle: 'bgmCombat' };
    const mappedKey = catalogKeyMap[key] || key;
    const fromCatalog =
      (AUDIO_TRACKS && (AUDIO_TRACKS[mappedKey] || AUDIO_TRACKS[`bgm_${key}`] || AUDIO_TRACKS[key])) || null;
    const src = fromCatalog
      ? resolveAudioUrl(fromCatalog)
      : FALLBACK_BGM[key] || FALLBACK_BGM.prep;
    if (!src) return;

    const normalized = encodeURI(src.replace(/^\.\.?\//, ''));
    if (!this.bgmEl.src || !this.bgmEl.src.endsWith(normalized)) {
      this.bgmEl.src = src;
    }
    this.bgmEl.volume = key === 'battle' ? 0.34 : 0.26;
    this.bgmEl.play().catch(() => {});
  }

  playSfx(name, { volume = 0.58, minIntervalMs = 52 } = {}) {
    if (this.muted || !name) return;
    const src = resolveAudioUrl(name);
    if (!src) return;

    const now = performance.now();
    const prev = this.lastPlayedAt.get(src) || 0;
    if (now - prev < minIntervalMs) return;
    this.lastPlayedAt.set(src, now);

    let list = this.pool.get(src);
    if (!list) {
      list = [];
      this.pool.set(src, list);
    }
    let audio = list.find((a) => a.paused || a.ended);
    if (!audio) {
      if (list.length >= 5) {
        audio = list[0];
      } else {
        audio = new Audio(src);
        list.push(audio);
      }
    }
    audio.volume = volume;
    try {
      audio.currentTime = 0;
    } catch {
      // 忽略尚未加载元数据时的 currentTime 重置异常
    }
    audio.play().catch(() => {});
  }
}
