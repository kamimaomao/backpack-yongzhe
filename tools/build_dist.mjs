// 构建自包含静态发布包 backpack/dist/（自动归集实际引用的《闯关勇者》立绘/_st颜艺帧/装备图标/Hud位图数字/字体/音效）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ARENA_BACKGROUNDS,
  AUDIO_TRACKS,
  ENEMY_WAVES,
  HEROES,
  ITEMS,
  PROJECTILES,
  UI_ASSETS,
} from '../src/engine/catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKPACK_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(BACKPACK_ROOT, '..');
const SRC_ASSETS = path.join(REPO_ROOT, 'assets');
const DIST_DIR = path.join(BACKPACK_ROOT, 'dist');

fs.rmSync(DIST_DIR, { recursive: true, force: true });
fs.mkdirSync(DIST_DIR, { recursive: true });

// 1. 归集全部实际引用的静态资源相对路径（相对于 assets/ 根目录）
const assetRels = new Set([
  'fonts/fz.ttf',
  'sprites/UI_界面/ui/Common/img_gezi_bag.png',
  'sprites/UI_界面/ui/Common/jinbi.png',
  'sprites/UI_界面/ui/Common/suo.png',
  'sprites/UI_界面/ui/Common/suo_da.png',
  'sprites/UI_界面/ui/Common/xin.png',
  'sprites/UI_界面/ui/Game/img_dizuo_sy.png',
  'sprites/UI_界面/ui/TavernFight/img_duijue_jgzq.png',
  'sprites/UI_界面/ui/Loading/logo.png',
  'sprites/UI_界面/ui/Hud/boom.png',
  'sprites/UI_界面/ui/Hud/SB.png',
  'sprites/UI_界面/ui/Hud/shouji.png',
]);

function addAssetUrl(u) {
  if (!u || typeof u !== 'string' || u.startsWith('data:')) return;
  const clean = u.replace(/^\.\.\/assets\//, '').replace(/^\.\/assets\//, '');
  if (clean && !clean.includes('${')) {
    assetRels.add(clean);
  }
}

for (const v of Object.values(UI_ASSETS)) addAssetUrl(v);
for (const bg of ARENA_BACKGROUNDS) addAssetUrl(bg);
for (const proj of Object.values(PROJECTILES)) addAssetUrl(proj);
for (const track of Object.values(AUDIO_TRACKS)) addAssetUrl(track);

for (const h of HEROES) {
  addAssetUrl(h.portrait);
  addAssetUrl(h.hitPortrait);
}

for (const it of Object.values(ITEMS)) {
  addAssetUrl(it.icon);
}

for (const w of ENEMY_WAVES) {
  addAssetUrl(w.portrait);
  addAssetUrl(w.hitPortrait);
}

// 原版 Hud 位图数字与磁盘真实存在的符号帧
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
    assetRels.add(`sprites/UI_界面/ui/Hud/${pfx}${d}.png`);
  }
  for (const sg of signs) {
    assetRels.add(`sprites/UI_界面/ui/Hud/${pfx}${sg}.png`);
  }
}

// 扫描 audio.js 中的原生音效集合与 fx_renderer.js 中的飞弹兜底表，确保零遗漏
const audioRaw = fs.readFileSync(path.join(BACKPACK_ROOT, 'src/audio.js'), 'utf8');
const validAudioBlock = audioRaw.match(/VALID_AUDIO_FILES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
if (validAudioBlock) {
  for (const m of validAudioBlock[1].matchAll(/'([^']+)'/g)) {
    assetRels.add(`audio/${m[1]}.mp3`);
  }
}

const fxRaw = fs.readFileSync(path.join(BACKPACK_ROOT, 'src/fx_renderer.js'), 'utf8');
for (const m of fxRaw.matchAll(/\$\{BULLET_DIR\}([^`'"\s)]+\.png)/g)) {
  assetRels.add(`sprites/UI_界面/ui/Bullets/${m[1]}`);
}

const codeFilesToCopy = [
  'index.html',
  'styles.css',
  'src/audio.js',
  'src/fx_renderer.js',
  'src/main.js',
  'src/engine/prng.js',
  'src/engine/catalog.js',
  'src/engine/grid.js',
  'src/engine/combat.js',
  'src/engine/session.js',
];

const literalAssetRe = /(?:\.\.\/assets\/|\$\{ASSET_BASE\}\/)([^"'`\s)]+\.(?:png|jpg|jpeg|mp3|ttf))/g;
for (const relFile of codeFilesToCopy) {
  const content = fs.readFileSync(path.join(BACKPACK_ROOT, relFile), 'utf8');
  let m;
  while ((m = literalAssetRe.exec(content)) !== null) {
    if (!m[1].includes('${')) {
      assetRels.add(m[1]);
    }
  }
}

// 2. 拷贝源码并将 ../assets 重写为 ./assets
function copyAndRewrite(relPath, replacer = (s) => s) {
  const srcFile = path.join(BACKPACK_ROOT, relPath);
  const dstFile = path.join(DIST_DIR, relPath);
  fs.mkdirSync(path.dirname(dstFile), { recursive: true });
  const raw = fs.readFileSync(srcFile, 'utf8');
  fs.writeFileSync(dstFile, replacer(raw), 'utf8');
}

copyAndRewrite('index.html', (s) => s.replaceAll('../assets/', './assets/'));
copyAndRewrite('styles.css', (s) => s.replaceAll('../assets/', './assets/'));
copyAndRewrite('src/audio.js');
copyAndRewrite('src/fx_renderer.js');
copyAndRewrite('src/main.js');
copyAndRewrite('src/engine/prng.js');
copyAndRewrite('src/engine/catalog.js', (s) =>
  s.replace("export const ASSET_BASE = '../assets';", "export const ASSET_BASE = './assets';"),
);
copyAndRewrite('src/engine/grid.js');
copyAndRewrite('src/engine/combat.js');
copyAndRewrite('src/engine/session.js');

// GitHub Pages 禁用 Jekyll 处理中文与下划线目录
fs.writeFileSync(path.join(DIST_DIR, '.nojekyll'), '', 'utf8');

// 3. 拷贝静态资产并做 100% 存在性校验
let copiedAssets = 0;
let totalBytes = 0;
for (const rel of assetRels) {
  const src = path.join(SRC_ASSETS, rel);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing required asset during dist build: ${src}`);
  }
  const dst = path.join(DIST_DIR, 'assets', rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copiedAssets += 1;
  totalBytes += fs.statSync(dst).size;
}

console.log(
  JSON.stringify({
    ok: true,
    distDir: DIST_DIR,
    copiedAssets,
    totalMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
  }),
);
