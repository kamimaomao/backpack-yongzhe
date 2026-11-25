# 《勇者塞满包 · 背包合成乱斗》全局架构与接口契约规格书（SPEC.md）

> **版本**：v1.0（Swarm 全团队唯一权威契约）  
> **统筹角色**：`@fable-lead`（Fable Orchestrator）  
> **工程根目录**：`/Users/kamisola/Documents/ChatGPT/闯关勇者/backpack/`  
> **静态资源基准**：`export const ASSET_BASE = '../assets';`（构建 `dist/` 时由打包脚本统一重写为 `'./assets'`）

---

## 1. 产品定位与核心体验

《勇者塞满包 · 背包合成乱斗》（*Backpack Heroes: Stuff & Brawl*）是一款对标《Backpack Battles（背包乱斗）》与《袋中勇者》、深度融合《闯关勇者》原生解包立绘、`_st.png` 受击颜艺差分帧、`Bullets/` 原版飞弹、`Hud/` 彩色位图跳字及原声配乐的 **竖屏 9:16 独立 Web 策略自走对战游戏**。

### 核心乐趣支柱
1. **7×5 异形背包扩建与空间俄罗斯方块**：中心 `5×3=15` 格起步，每轮战后解锁正交相邻新格；支持 `1×1`、`1×2`、`2×1`、`1×3`、`2×2`、`L3(3格)` 异形物品与 90° 顺时针旋转，搭配 4 槽暂存托盘（Holding Tray）丝滑腾挪。
2. **双层合成爽感**：
   - **同名同阶二合一进化**：剑、斧、弓、枪、锤、法杖 6 大武器系支持 `Lv1 → Lv2 → Lv3 → Lv4` 拖拽叠合原地升阶（同系各阶保持相同占格形状，绝不卡死相邻布局）。
   - **跨物品★神话神装融合**：5 组经典跨品类二合一神话配方（如 `魔法烤鸡腿 + 法杖 = ★鸡腿法杖`），既可手动拖拽立即合成，也可正交相邻摆放于开战前自动觉醒融合！
3. **十字/星位邻接光环构筑**：发条齿轮、星辉宝石、深渊毒瓶、精锻磨刀石、圣光印章、嗜血披风通过**十字正交（4向）**或**八向星位（8向）**为周围武器/防具提供充能加速、附毒、暴击、增伤、护盾倍增与吸血连线。
4. **上半屏 1v1 实时独立 CD 狂飙对轰**：背包内每件主动装备按各自独立 CD 进度条循环充能触发，抛射原版飞弹、叠盾、回血、叠毒、寒霜减速；受击瞬间切换 `_st.png` 挨揍颜艺立绘并迸发 `Hud/` 位图跳字！

---

## 2. 目录结构与职责边界

```text
backpack/
├── SPEC.md                    # [@fable-lead] 全团队唯一权威架构与接口契约
├── index.html                 # [@ui-author] 竖屏 9:16 主界面与原生 <dialog> 弹窗结构
├── styles.css                 # [@ui-author] 响应式竖屏布局、网格底砖、CD 遮罩、连线与动效样式
├── wrangler.jsonc             # [@qa-verifier] Cloudflare Workers 静态部署配置 (name: "backpack-yongzhe")
├── README.md                  # [@qa-verifier] 项目说明、启动方式与压测报告摘要
├── src/
│   ├── engine/
│   │   ├── prng.js            # [@catalog-author] 确定性 Mulberry32 伪随机数生成器
│   │   ├── catalog.js         # [@catalog-author] 勇者、10轮Boss、全量装备/进化链/神话配方与真实资产映射
│   │   ├── grid.js            # [@engine-author] 7×5 网格矩阵、90°旋转、扩建、二合一/神话合成与邻接光环计算
│   │   ├── combat.js          # [@engine-author] 实时逐帧 BattleSimulator 与毫秒级无头 runHeadlessCombat
│   │   └── session.js         # [@engine-author] 10 轮闯关状态机、商店/托盘/背包操作 API 与启发式 AI 摆包器
│   ├── audio.js               # [@ui-author] BGM 切换、SFX 节流池与静音状态管理
│   ├── fx_renderer.js         # [@ui-author] 抛物线飞弹动画池与 Hud/ 原版彩色位图数字跳字渲染器
│   └── main.js                # [@ui-author] Pointer 拖拽 + 点选放置双模交互、战中 CD 脉冲与全局状态绑定
├── tests/
│   └── engine.test.mjs        # [@qa-verifier] 资产 100% 存在校验、网格/合成/光环单测与 200 局 AI 平衡压测
└── tools/
    └── build_dist.mjs         # [@qa-verifier] 抽取实际引用资产生成自包含静态包 backpack/dist/
```

---

## 3. 全局核心规则与数学公式

### 3.1 闯关波次、红心与商店经济
| 常量名 | 值 | 规则说明 |
|---|---|---|
| `MAX_ROUNDS` | `10` | 第 1~10 轮闯关；第 5 轮为中 Boss，第 10 轮为终极魔王 Boss；第 10 轮获胜即通关登顶（`status = 'victory'`） |
| `INITIAL_HEARTS` | `5` | 初始 5 颗不屈红心；任意一轮战败扣 `1` 心，扣至 `0` 心则本局惜败（`status = 'defeat'`） |
| `GRID_ROWS` / `GRID_COLS` | `5` / `7` | 背包总底盘为 `5 行 × 7 列 = 35 格`（行索引 `r ∈ [0..4]`，列索引 `c ∈ [0..6]`） |
| `INITIAL_UNLOCKED_RECT` | `r:1..3, c:1..5` | 初始解锁正中心 `3 行 × 5 列 = 15 格`（特定空间系勇者被动可额外初始解锁两侧格） |
| `TRAY_CAPACITY` | `4` | 暂存托盘固定 4 个独立槽位（`index ∈ [0..3]`），每槽可暂存任意形状的 1 件物品，不参与战斗与光环 |
| `SHOP_SLOT_COUNT` | `5` | 商店每轮刷出 5 件待售物品，支持单槽锁定或全局一键锁店 |
| `REROLL_COST` | `2` | 每次刷新商店消耗 `2` 金币（特定勇者每回合首次刷新免费） |

- **每轮金币发放公式**：
  - Round 1 开局初始金币：`14` 金（保证首轮可购买 3~4 件装备享受拼包乐趣）。
  - 第 `r` 轮（`r >= 2`）进入整备阶段时发放金币：`10 + r * 2 + winStreakBonus + heroGoldBonus + bagIncomeBonus`，其中连胜奖励 `winStreakBonus = Math.min(winStreak, 3)`。
- **出售价格公式**：`sellPrice = Math.max(1, Math.ceil(itemDef.cost * 0.5) + heroSellBonus)`。
- **战后背包扩建点数（Expand Points）**：
  - 第 `1 ~ 9` 轮战斗结算后（若未阵亡且未通关）：本轮**胜利**获得 `3` 点扩建点数，本轮**战败**获得 `2` 点扩建点数（逆风保护）。
  - 每消耗 `1` 点扩建点数，可解锁 **1 个与当前已解锁格正交相邻（上下左右）** 的未解锁格。
  - 若全盘 `35` 格已全部解锁，每溢出 `1` 点扩建点数自动折算为 `+2` 金币。
  - 玩家既可在整备阶段手动点击虚线待解锁格扩建，也可点击“自动扩格”；点击“塞满开战”时若仍有剩余 `expandPoints`，引擎自动按离中心 `(2, 3)` 曼哈顿距离最近优先补齐扩建，绝不浪费玩家额度。

### 3.2 异形多格矩阵与 90° 顺时针旋转算法
所有物品形状由 `SHAPE_PRESETS` 定义 `rot = 0` 时的局部相对格坐标数组 `Array<[dr, dc]>`：
- `'1x1'`：`[[0, 0]]`（宝石、毒瓶、磨刀石、齿轮、戒指、复活心、鸡腿）
- `'1x2'`：`[[0, 0], [1, 0]]`（剑系、弓系、战靴、披风、图腾、钱袋）
- `'2x1'`：`[[0, 0], [0, 1]]`（火铳系）
- `'1x3'`：`[[0, 0], [1, 0], [2, 0]]`（法杖系、★鸡腿法杖）
- `'2x2'`：`[[0, 0], [0, 1], [1, 0], [1, 1]]`（锤系、圣盾、板甲、★守护巨盾）
- `'L3'`：`[[0, 0], [1, 0], [1, 1]]`（战斧系，旋转 4 个方向呈现不同 L 拐角）

**标准 90° 顺时针旋转归一化公式**（`rot ∈ {0, 1, 2, 3}`）：
1. 从 `rot = 0` 的基准坐标集开始，重复 `((rot % 4) + 4) % 4` 次变换：`[r, c] => [c, -r]`。
2. 计算变换后所有点的 `minR = Math.min(...pts.map(p => p[0]))` 与 `minC = Math.min(...pts.map(p => p[1]))`。
3. 平移归零：`pts = pts.map(([r, c]) => [r - minR, c - minC])`，并按 `r` 升序、`c` 升序排序。
4. 包围盒尺寸：`height = Math.max(...pts.map(p => p[0])) + 1`，`width = Math.max(...pts.map(p => p[1])) + 1`。
5. 当物品锚点置于网格 `(anchorRow, anchorCol)` 时，其实际占用格为 `pts.map(([dr, dc]) => [anchorRow + dr, anchorCol + dc])`。

### 3.3 双层合成机制
1. **第一层：同名同阶二合一进化（Tier Evolution）**
   - 满足条件：`sourceItem.itemId === targetItem.itemId` 且 `ITEM_CATALOG[sourceItem.itemId].upgradesTo` 非空（即 `Lv1 → Lv2 → Lv3 → Lv4`）。
   - 合成结果：销毁 `sourceItem`，将 `targetItem.itemId` 原地替换为 `upgradesTo` 对应的新 `itemId`，保留 `targetItem` 原有的 `(row, col, rot)`（因同系武器 `Lv1~Lv4` 形状完全一致，100% 原地合法落位）。
   - 支持路径：背包内 A 拖到 B、暂存区拖到背包同款、商店购买直接拖到背包/暂存区同款！
2. **第二层：跨物品★神话神装融合（Mythic Synthesis，至少 5 组配方）**
   - 每条配方定义 `{ id, inputs: [idSetA, idSetB], resultId, name }`，其中 `idSetA` / `idSetB` 可以是单个 `itemId` 或兼容数组（例如 `['food_drumstick']` 配 `['staff_1', 'staff_2']` 均可合成 `'mythic_drumstick_staff'`，大幅提升实战合成率！）。
   - **手动拖拽合成**：将配对一方拖到另一方上时立即触发融合。移除原两件物品后，优先在目标锚点（及周围 `±1` 格微调锚点、4 个旋转角）寻找能合法放下 `resultId` 的位置；若背包内无空位可容下新形状，则将合成出的神话神装放入暂存托盘空槽；若暂存托盘也满，则拒绝本次操作并返回 `{ ok: false, reason: 'no_space_for_mythic' }`（绝不吞装备）。
   - **开战前相邻自动融合**：调用 `startCombat(session)` 时，自动执行 `resolveAdjacentMythicMerges(session)`，扫描背包内存在**十字正交相邻**的配对物品对，自动将两件材料合成为神话神装（若释放两件材料后的背包可放下新神装则直接落盘，否则放入暂存托盘空槽），并把融合记录写入 `session.lastMergeEvents` 供前端展示特效音效。

### 3.4 十字/星位邻接光环与属性汇总
- **十字正交相邻（`orthogonal`）**：两件不同实例 `A` 与 `B` 至少存在一对占用格 `(r1, c1) ∈ A, (r2, c2) ∈ B` 满足 `|r1 - r2| + |c1 - c2| === 1`。
- **八向星位相邻（`star8`）**：满足 `Math.max(|r1 - r2|, |c1 - c2|) === 1`。
- **去重原则**：同一对物品实例 `(A, B)` 即使有多格贴合，彼此的邻接关系只计算 **1 次**。
- **光环加成汇总与钳制公式**：
  - 每件物品汇总来自相邻挂件/神器的：`hastePct`（充能加速百分比）、`bonusDamage`（额外扁平伤害）、`damageMultPct`（伤害倍率百分比）、`shieldMultPct`（护盾倍率百分比）、`bonusCritPct`（额外暴击率百分比）、`bonusPoison`（每次触发额外附毒层数）、`bonusChill`（每次触发额外寒霜层数）、`bonusVampPct`（吸血百分比）、`onTriggerHeal`（每次触发额外回血）。
  - 有效冷却时间：`MIN_ITEM_CD = 0.45` 秒；总加速 `clampedHaste = Math.max(-50, Math.min(150, totalHastePct))`；
    `effectiveCd = Number(Math.max(0.45, baseCd / (1 + clampedHaste / 100)).toFixed(3))`。

### 3.5 1v1 实时战斗结算规则
- **双方属性初始化**：
  - 勇者最大生命：`hero.baseHp + (round - 1) * hero.hpPerRound + sum(bagItems.bonusMaxHp)`。
  - 开场护盾：`heroStartShield + sum(bagItems.startShield)`；开场闪避率：`Math.min(60, heroBaseDodge + sum(bagItems.bonusDodgePct))`；常驻荆棘：`heroBaseThorns + sum(bagItems.bonusThorns)`。
  - 敌方 Boss 同样拥有 `maxHp` 与真实的可见装备列表 `items`（按相同引擎规则独立跑 CD 触发！），保证机制对称透明。
- **逐帧时间步进（`FIXED_TICK = 0.05s`）**：
  - 寒霜减速因子：`chillFactor = 1 - Math.min(0.45, unit.chill * 0.018)`（每层寒霜减速 `1.8%`，上限减速 `45%`）。
  - 每件 `cooldown > 0` 的装备独立推进 `timer += dt * chillFactor`；当 `timer >= effectiveCd` 时，`timer -= effectiveCd` 并触发效果：
    1. **攻击判定**：若 `damage > 0`，先判敌方闪避 `dodgePct`（闪避成功弹出 `SB.png` 跳字事件）；未闪避则判暴击 `Math.min(85, critPct)`（暴击倍率 `1.65`），乘以疲劳狂暴倍率 `frenzyMult` 后取整 `finalDmg = Math.max(1, Math.round(rawDmg))`。
    2. **护盾与扣血**：`finalDmg` 先抵扣受击方 `shield`，溢出伤害扣减 `hp`；只要造成伤害，受击方激活 `hitStunTimer = 0.28s`（前端切换 `_st.png` 挨揍颜艺帧！）。若受击方 `thorns > 0` 且为攻击伤害，反震攻击方 `thorns` 点伤害（先扣盾）。若攻击装备带 `vampPct > 0`，按实际总伤害的 `vampPct%` 治疗自身。
    3. **护盾/治疗/毒/冰**：按装备结算后的 `shieldGain`、`healGain`、`poisonApply`、`chillApply` 即时生效并压入本帧事件队列 `events[]`。
  - **剧毒周期结算（每 `0.5s` 跳一次）**：若 `unit.poison > 0`，直接造成 `Math.round(unit.poison * frenzyMult)` 点**无视护盾**的腐蚀伤害（弹出 `ZD_` 绿色数字跳字），随后 `unit.poison = Math.max(0, unit.poison - 1)`。
  - **1UP 复活心判定**：若某方 `hp <= 0` 且其背包中存在尚未触发的 `revivePct > 0` 物品（如 `relic_1up` 不死复活心），立即消耗该次免死机会，恢复 `Math.round(maxHp * revivePct)` 生命并清除负面毒/冰层数！
  - **疲劳狂暴（Fatigue Frenzy）与硬超时**：战斗进行至 `15.0s` 起开启疲劳狂暴，`frenzyMult = 1 + Math.max(0, elapsed - 15) * 0.12`（每秒双方伤害递增 `+12%`）；至 `35.0s` 硬上限若双方仍存活，按 `hp / maxHp` 比例高者判胜（相等判玩家险胜），100% 杜绝死局。

---

## 4. 原生资产规范与真实文件防坑指南（重要！）

所有模块必须基于 `ASSET_BASE = '../assets'` 引用 `/Users/kamisola/Documents/ChatGPT/闯关勇者/assets/` 下真实存在的文件：

1. **字体**：`../assets/fonts/fz.ttf`
2. **背包与通用 UI 底图**：
   - 背包单格质感砖：`../assets/sprites/UI_界面/ui/Common/img_gezi_bag.png`
   - 金币图标：`../assets/sprites/UI_界面/ui/Common/jinbi.png`
   - 面板/标题修饰（可选）：`biaoti_bg.png`、`tankuang_bg.png`、`xiangqing_bg.png`、`btn_anniu1_sc.png`
3. **`Hud/` 位图跳字前缀真实存在性（严禁拼出 404 路径！）**：
   - 普通物理伤害 `PT_`：存在 `PT_0.png ~ PT_9.png`、`PT_+.png`（⚠️ **不存在 `PT_-.png`**！跳伤害数字直接拼纯数字位图即可，或用 `SH_-.png`）
   - 暴击大字 `BJ_`：存在 `BJ_0.png ~ BJ_9.png`、`BJ_+.png` + 暴击底纹 `boom.png`（⚠️ **不存在 `BJ_-.png`**！）
   - 治疗回血 `HX_`：存在 `HX_0.png ~ HX_9.png`、`HX_+.png`（⚠️ **不存在 `HX_-.png`**！）
   - 剧毒伤害 `ZD_`：存在 `ZD_0.png ~ ZD_9.png`、`ZD_-.png`（⚠️ **不存在 `ZD_+.png`**！）
   - 护盾/反伤 `FS_`：存在 `FS_0.png ~ FS_9.png`、`FS_+.png`、`FS_-.png`
   - 伤害/通用 `SH_`：存在 `SH_0.png ~ SH_9.png`、`SH_+.png`、`SH_-.png`
   - 闪避与受击：`SB.png`、`shouji.png`、`boom.png`
4. **飞弹切帧（`../assets/sprites/UI_界面/ui/Bullets/`）**：
   - `zidan_1.png`（巨石/重锤）、`zidan_2.png`（重拳/利剑）、`zidan_3.png`（飞斧）、`zidan_4.png`（嗜血蝠）、`zidan_5.png`（圣盾光球）、`zidan_6.png`（寒冰弹）、`zidan_7.png`（秘药瓶）、`zidan_8.png`（剧毒弹）、`zidan_9.png`（猎矢）、`zidan_10.png`（龙息火弹）、`zidan_18.png`（黄金神弹）、`dazhao_1.png`（神话光束）。
5. **角色与怪物立绘（必须 100% 同时具备 `.png` 与 `_st.png`）**：
   - 推荐 4 位初始可选勇者：`skin_8`（圣盾狂战）、`skin_12`（星辉魔导）、`skin_14`（招财竹仙）、`skin_15`（夜影猎手）或 `role_1, role_2, role_3, role_5, role_6`（注意 `role_4` 只有 `role_4_b`，切勿误用无后缀 `role_4`！）。
   - 10 轮递进敌方 Boss：从 `moster_1_14`、`moster_2_1 ~ moster_2_43`、`moster_3_1 ~ moster_3_18` 中精选 10 只造型鲜明且磁盘同时存在 `<key>.png` 与 `<key>_st.png` 的怪物。
6. **音频文件（`../assets/audio/`）**：
   - BGM：`BGM_ShangDian.mp3`（整备/商店）、`BGM_ZiDongZhanDou.mp3`（战斗）、`BGM_ZhuJieMian.mp3`（选人/标题）
   - SFX：`AnNiuDianJi.mp3`、`AnNiuGuanBi.mp3`、`ShangDianShuaXin.mp3`、`ZhuBi_HuoDe.mp3`、`ZhuBi_HuiShou.mp3`、`BaoWuHeCheng_1.mp3`（二合一进化）、`BaoWuHeCheng_2.mp3`（★神话神装诞生）、`GongXiHuoDe.mp3`、`BOSSYuJing.mp3`、`JieSuan_ShengLi.mp3`、`JieSuan_ShiBai.mp3`、`SiWang.mp3`、`ZiDan_FaShe.mp3`、`ZiDan_QuanTao.mp3`、`ZiDan_FuTou.mp3`、`ZiDan_BingKuai.mp3`、`ZiDan_XiXueGui.mp3`、`ZiDan_XueDi.mp3`、`ZiDanShuXing_BianHua.mp3`。

---

## 5. ES Module 精确导出函数签名与数据结构契约

> **铁律**：以下模块导出名称、参数顺序与核心字段名具有强制约束力，各作者可在不破坏必选字段的前提下补充辅助字段或内部函数。

### 5.1 `src/engine/prng.js`（由 `@catalog-author` 实现）
```js
/**
 * Mulberry32 确定性伪随机数生成器
 * @param {number} [seed=Date.now()]
 * @returns {{
 *   next: () => number,
 *   int: (min: number, maxInclusive: number) => number,
 *   pick: <T>(arr: T[]) => T | null,
 *   weightedPick: <T>(items: T[], weightFn: (item: T) => number) => T | null,
 *   shuffle: <T>(arr: T[]) => T[],
 *   chance: (prob0to1: number) => boolean,
 *   getState: () => number
 * }}
 */
export function createRng(seed = Date.now()) { ... }
```

### 5.2 `src/engine/catalog.js`（由 `@catalog-author` 实现）
必须导出以下常量与查询辅助函数：
```js
export const ASSET_BASE = '../assets';
export const GRID_ROWS = 5;
export const GRID_COLS = 7;
export const TRAY_CAPACITY = 4;
export const MAX_ROUNDS = 10;
export const INITIAL_HEARTS = 5;
export const SHOP_SLOT_COUNT = 5;
export const REROLL_COST = 2;

/** 形状预设表：Record<ShapeId, Array<[number, number]>> */
export const SHAPE_PRESETS = {
  '1x1': [[0, 0]],
  '1x2': [[0, 0], [1, 0]],
  '2x1': [[0, 0], [0, 1]],
  '1x3': [[0, 0], [1, 0], [2, 0]],
  '2x2': [[0, 0], [0, 1], [1, 0], [1, 1]],
  'L3':  [[0, 0], [1, 0], [1, 1]],
};

/** 场景背景图列表（至少 4 张真实存在的 ../assets/textures/背景_大图/bigimg/*.jpg） */
export const ARENA_BACKGROUNDS = [ ... ];

/** 飞弹贴图字典 Record<ProjectileKey, string> */
export const PROJECTILES = { ... };

/** 音频路径字典 Record<AudioKey, string> */
export const AUDIO_TRACKS = { ... };

/**
 * 4 位可选初始勇者数组 HEROES: HeroDef[]
 * HeroDef 结构：
 * {
 *   id: string,                  // 如 'berserker' | 'archmage' | 'fortune_panda' | 'shadow_ranger'
 *   name: string,
 *   title: string,
 *   portrait: string,            // ../assets/textures/角色/role/xxx.png
 *   hitPortrait: string,         // ../assets/textures/角色/role/xxx_st.png
 *   badgeColor: string,
 *   baseHp: number,              // 建议 155 ~ 190
 *   hpPerRound: number,          // 建议 42 ~ 52
 *   passiveName: string,
 *   passiveDesc: string,
 *   starterItems: Array<{ itemId: string, row: number, col: number, rot?: number }>, // 开局自带 2 件基础装备直接摆在中心格！
 *   bonuses: {
 *     freeFirstReroll?: boolean, // 每轮首刷免费
 *     extraRoundGold?: number,   // 每轮额外金币
 *     sellBonusGold?: number,    // 出售物品额外返金
 *     extraStartCells?: Array<[number, number]>, // 开局额外解锁格
 *     globalHastePct?: number,   // 全局装备充能加速%
 *     startShield?: number,      // 每场开局额外护盾
 *     globalCritPct?: number,    // 全局额外暴击率%
 *   }
 * }
 */
export const HEROES = [ ... ];

/**
 * 全量物品图鉴字典 ITEMS: Record<ItemId, ItemDef>
 * 覆盖：
 * - 6 条武器进化链 × 4 阶 = 24 件（sword_1..4, axe_1..4, bow_1..4, gun_1..4, hammer_1..4, staff_1..4）
 * - 防具盾牌至少 5 件（armor_shield, armor_plate, armor_helm, armor_boots, cape_vamp）
 * - 光环挂件/秘药/食物至少 10 件（gear_haste, gem_sky, gem_vital, stone_whet, seal_holy, potion_poison, food_drumstick, relic_cat, relic_pouch, relic_totem, relic_fury, relic_thorn_ring, relic_1up）
 * - ★神话合成神装至少 5 件（mythic_drumstick_staff, mythic_guardian_shield, mythic_lucky_cat, mythic_rage_totem, mythic_venom_ring，标记 mythic: true, shopWeight: 0）
 *
 * ItemDef 标准结构：
 * {
 *   id: string,
 *   name: string,
 *   category: 'weapon' | 'armor' | 'accessory' | 'gem' | 'food' | 'potion' | 'mythic',
 *   tags: string[],              // 如 ['weapon', 'melee'] / ['armor', 'shield'] / ['gem', 'aura']
 *   tier: 1 | 2 | 3 | 4 | 5,     // 品质阶数（1白 2绿 3蓝 4紫 5金神话）
 *   level: 1 | 2 | 3 | 4,        // 进化等级（普通挂件填 1，进化链填 1~4）
 *   shape: keyof typeof SHAPE_PRESETS,
 *   cost: number,                // 商店售价（建议 Lv1/挂件 3~6 金，高阶/大件 6~9 金）
 *   shopMinRound: number,        // 最早可刷新轮次（1 ~ 7）
 *   shopWeight: number,          // 商店刷新权重（Lv3/Lv4 与神话神装设为 0，仅限合成产出！）
 *   upgradesTo: string | null,   // 同名同阶二合一目标 itemId（如 'sword_1' -> 'sword_2'）
 *   icon: string,                // ../assets/textures/UI_图标/icon/xxx.png
 *   projectile: string | null,   // 对应 PROJECTILES 的 key（如 'sword' / 'axe' / 'ice' / 'poison'）
 *   sfx: string | null,          // 触发音效名（如 'ZiDan_FuTou'）
 *   cooldown: number,            // 主动触发基础秒数（纯被动挂件填 0，主动装备填 1.4 ~ 3.8）
 *   combat: {
 *     damage?: number,
 *     shield?: number,
 *     heal?: number,
 *     poison?: number,
 *     chill?: number,
 *     critPct?: number,
 *     vampPct?: number,
 *     bonusMaxHp?: number,
 *     startShield?: number,
 *     bonusDodgePct?: number,
 *     bonusThorns?: number,
 *     roundGoldBonus?: number,   // 每轮额外产出金币（如地精钱袋/招财神猫）
 *     revivePct?: number,        // 致死免死回血比例（如 relic_1up: 0.32）
 *   },
 *   aura: null | {
 *     pattern: 'orthogonal' | 'star8',
 *     targetTag: 'weapon' | 'armor' | 'any', // 作用目标类别
 *     hastePct?: number,
 *     bonusDamage?: number,
 *     damageMultPct?: number,
 *     shieldMultPct?: number,
 *     bonusCritPct?: number,
 *     bonusPoison?: number,
 *     bonusChill?: number,
 *     bonusVampPct?: number,
 *     onTriggerHeal?: number,
 *   },
 *   desc: string,                // 清晰可读的中文技能与光环描述
 * }
 */
export const ITEMS = { ... };

/**
 * 跨物品★神话合成配方数组 MYTHIC_RECIPES: MythicRecipeDef[]
 * MythicRecipeDef 结构：
 * {
 *   id: string,
 *   name: string,
 *   ingredientA: string[],       // 允许匹配的 itemId 列表，如 ['food_drumstick']
 *   ingredientB: string[],       // 允许匹配的 itemId 列表，如 ['staff_1', 'staff_2']
 *   resultId: string,            // 合成产物 itemId，如 'mythic_drumstick_staff'
 *   desc: string,
 * }
 */
export const MYTHIC_RECIPES = [ ... ];

/**
 * 10 轮递进敌方 Boss 配置 ENEMY_WAVES: EnemyWaveDef[]（长度严格为 10，对应 round 1..10）
 * EnemyWaveDef 结构：
 * {
 *   round: number,               // 1..10
 *   id: string,
 *   name: string,
 *   title: string,
 *   isBoss: boolean,             // round 5 与 round 10 为 true
 *   portrait: string,            // ../assets/textures/角色/role/xxx.png
 *   hitPortrait: string,         // ../assets/textures/角色/role/xxx_st.png
 *   maxHp: number,               // 经过平衡设计的生命梯度（建议 R1:135 -> R5:420 -> R10:980）
 *   startShield: number,
 *   bonusThorns?: number,
 *   bonusDodgePct?: number,
 *   items: Array<{ itemId: string, rot?: number }>, // 敌方携带的真实装备列表（供战斗触发与 UI 预览！）
 * }
 */
export const ENEMY_WAVES = [ ... ];

/** 辅助查询函数 */
export function getHeroById(heroId) { ... }
export function getItemById(itemId) { ... }
export function getEnemyByRound(round) { ... }
export function findMythicRecipe(itemIdA, itemIdB) { ... } // 若两件物品可跨物品合成则返回 MythicRecipeDef，否则返回 null
export function getShopPoolForRound(round) { ... }         // 返回当前轮次 shopWeight > 0 且 shopMinRound <= round 的 ItemDef[]
```

---

### 5.3 `src/engine/grid.js`（由 `@engine-author` 实现）
纯数据与几何计算层，负责网格状态、碰撞检测、合并判定与邻接光环图谱计算：

```js
/**
 * BagState 数据结构：
 * {
 *   rows: 5,
 *   cols: 7,
 *   unlocked: boolean[][],       // 5×7 布尔矩阵，true 表示已解锁格
 *   items: PlacedItem[],         // 当前摆在背包内的物品实例列表
 *   nextUid: number,
 * }
 *
 * PlacedItem 数据结构：
 * {
 *   uid: string,                 // 唯一实例 ID，如 'itm_1'
 *   itemId: string,              // 对应 ITEMS[itemId]
 *   row: number,                 // 锚点行 0..4
 *   col: number,                 // 锚点列 0..6
 *   rot: 0 | 1 | 2 | 3,          // 顺时针旋转步数（0=0°, 1=90°, 2=180°, 3=270°）
 * }
 */

export function createInitialBag(extraUnlockedCells = []) { ... }
export function cloneBag(bag) { ... }

/** 返回旋转归一化后的相对格与包围盒：{ cells: Array<[number, number]>, width: number, height: number } */
export function rotateCells(baseCells, rot = 0) { ... }
export function getItemFootprint(itemIdOrDef, rot = 0) { ... }

/** 返回某实例在网格上的绝对占用格坐标数组 Array<[row, col]> */
export function getOccupiedCells(itemIdOrDef, row, col, rot = 0) { ... }

/**
 * 校验在 (row, col, rot) 放置 itemId 是否合法
 * @param {BagState} bag
 * @param {string} itemId
 * @param {number} row
 * @param {number} col
 * @param {number} [rot=0]
 * @param {string | null} [ignoreUid=null] 移动背包内已有物品时忽略自身碰撞
 * @returns {{
 *   valid: boolean,
 *   reason?: 'out_of_bounds' | 'locked_cell' | 'overlap',
 *   cells: Array<[number, number]>,
 *   overlappingUids: string[]
 * }}
 */
export function checkPlacement(bag, itemId, row, col, rot = 0, ignoreUid = null) { ... }

/** 返回所有与已解锁区正交相邻的待扩建格坐标 Array<[row, col]> */
export function getExpandableCells(bag) { ... }
export function unlockBagCell(bag, row, col) { ... } // 返回 { ok: boolean, reason?: string }

/**
 * 判定两件 itemId 是否可以合成（优先检查同名同阶 upgradesTo，其次检查 findMythicRecipe）
 * @returns {null | { kind: 'upgrade' | 'mythic', resultId: string, recipeId?: string }}
 */
export function checkMergeCompatibility(itemIdA, itemIdB) { ... }

/** 在背包中放置、移动、旋转、移除物品的原子函数 */
export function placeItemInBag(bag, itemId, row, col, rot = 0, forcedUid = null) { ... }
export function removeItemFromBag(bag, uid) { ... }
export function findValidPlacementForItem(bag, itemId, preferredRow = 1, preferredCol = 1, preferredRot = 0, ignoreUids = []) { ... }

/**
 * 扫描背包内正交相邻且满足 MYTHIC_RECIPES 的配对物品并自动融合（战前调用）
 * @returns {{ mergedCount: number, events: Array<{ uidA: string, uidB: string, itemA: string, itemB: string, resultId: string, placedInBag: boolean, uidResult: string }> }}
 */
export function resolveAdjacentMythicMerges(bag) { ... }

/**
 * 实时计算背包内所有物品的十字/星位邻接加成与可视化连线
 * @param {BagState} bag
 * @param {object} [heroBonuses={}]
 * @returns {{
 *   itemStats: Record<string, ComputedItemStats>, // key 为 item.uid
 *   links: SynergyLink[],                         // 供 UI 绘制发光连线与选中高亮
 *   totals: {
 *     estimatedDps: number,
 *     bonusMaxHp: number,
 *     startShield: number,
 *     bonusDodgePct: number,
 *     bonusThorns: number,
 *     roundGoldBonus: number,
 *   }
 * }}
 *
 * ComputedItemStats 结构：
 * {
 *   uid: string,
 *   itemId: string,
 *   baseCd: number,
 *   effectiveCd: number,         // 计入 hastePct 后的实际冷却秒数（被动为 0）
 *   hastePct: number,
 *   damage: number,              // 计入邻接扁平增伤与倍率后的单次伤害
 *   shield: number,              // 计入邻接护盾倍率后的单次叠盾
 *   heal: number,                // 计入 onTriggerHeal 后的单次治疗
 *   poison: number,              // 计入邻接附毒后的单次叠毒层数
 *   chill: number,
 *   critPct: number,
 *   vampPct: number,
 *   dps: number,                 // 单件预估秒伤
 *   buffSources: Array<{ fromUid: string, fromItemId: string, label: string }>,
 * }
 *
 * SynergyLink 结构：
 * {
 *   fromUid: string,
 *   toUid: string,
 *   pattern: 'orthogonal' | 'star8',
 *   effectType: 'haste' | 'damage' | 'poison' | 'shield' | 'vamp' | 'mythic_ready',
 *   label: string,               // 如 '+20% 加速' / '+3 剧毒' / '★可融合神话'
 * }
 */
export function computeBagSynergies(bag, heroBonuses = {}) { ... }
```

---

### 5.4 `src/engine/combat.js`（由 `@engine-author` 实现）
同时支撑前端 60fps 实时动画渲染与 QA 200 局无头高速压测：

```js
/**
 * 构建战斗模拟器实例
 * @param {{
 *   hero: HeroDef,
 *   round: number,
 *   bag: BagState,
 *   enemy?: EnemyWaveDef,        // 默认按 getEnemyByRound(round) 获取
 *   seed?: number,
 * }} config
 * @returns {BattleSimulator}
 *
 * BattleSimulator 实例方法与属性：
 * - getState(): CombatSnapshot
 * - step(dtSec: number): { events: CombatEvent[], finished: boolean, winner: 'player' | 'enemy' | null }
 * - runToEnd(maxSimSec = 35): CombatResult
 *
 * CombatSnapshot 结构：
 * {
 *   elapsed: number,
 *   frenzyMult: number,          // 当前疲劳狂暴伤害倍率（15s 前为 1.0）
 *   finished: boolean,
 *   winner: 'player' | 'enemy' | null,
 *   player: FighterState,        // { id, name, portrait, hitPortrait, hp, maxHp, shield, poison, chill, dodgePct, thorns, hitStunTimer, reviveAvailable, slots: ActiveSlotState[] }
 *   enemy: FighterState,         // 同上，slots 对应敌方可见装备的实时 CD 进度！
 * }
 *
 * ActiveSlotState 结构（供前端渲染每件背包物品的实时 CD 遮罩与触发脉冲）：
 * {
 *   uid: string,
 *   itemId: string,
 *   row?: number,
 *   col?: number,
 *   cooldown: number,            // effectiveCd（被动物品为 0）
 *   timer: number,               // 当前已充能秒数
 *   progress: number,            // 0..1 归一化充能进度（cooldown > 0 ? timer / cooldown : 0）
 *   triggerCount: number,        // 本场累计触发次数
 *   totalDamageDealt: number,
 *   totalShieldGained: number,
 *   totalHealDone: number,
 * }
 *
 * CombatEvent 结构（供 UI 发射飞弹、播放音效与弹出 Hud 位图数字）：
 * {
 *   time: number,
 *   type: 'item_fire' | 'damage' | 'heal' | 'shield' | 'poison_tick' | 'dodge' | 'thorns' | 'revive' | 'frenzy_start' | 'battle_end',
 *   side: 'player' | 'enemy',    // 动作发起方（damage/shield/heal 同时附带 targetSide: 'player' | 'enemy'）
 *   targetSide?: 'player' | 'enemy',
 *   sourceUid?: string,          // 触发该事件的背包物品 uid（方便 UI 从该背包格位置发射飞弹并闪烁脉冲！）
 *   itemId?: string,
 *   projectile?: string | null,  // PROJECTILES key
 *   sfx?: string | null,
 *   amount?: number,             // 伤害/护盾/治疗/毒跳数值
 *   isCrit?: boolean,
 *   poisonAdded?: number,
 *   chillAdded?: number,
 * }
 */
export function createBattleSimulator(config) { ... }

/**
 * 纯无头高速战斗结算（内部直接跑完 createBattleSimulator(config).runToEnd()）
 * @returns {{
 *   winner: 'player' | 'enemy',
 *   elapsed: number,
 *   playerHpLeft: number,
 *   playerMaxHp: number,
 *   enemyHpLeft: number,
 *   enemyMaxHp: number,
 *   stats: { playerTotalDmg: number, enemyTotalDmg: number, triggers: number }
 * }}
 */
export function runHeadlessCombat(config) { ... }
```

---

### 5.5 `src/engine/session.js`（由 `@engine-author` 实现）
管理单局完整 10 轮闯关生命周期、商店、暂存托盘、拖拽合并与自动整理启发式算法：

```js
/**
 * GameSession 状态结构：
 * {
 *   seed: number,
 *   status: 'hero_select' | 'prep' | 'combat' | 'victory' | 'defeat',
 *   round: number,               // 1..10
 *   hearts: number,              // 0..5
 *   maxHearts: number,
 *   gold: number,
 *   winStreak: number,
 *   rerollsThisRound: number,
 *   expandPoints: number,        // 当前可用扩建格点数
 *   heroId: string | null,
 *   hero: HeroDef | null,
 *   bag: BagState,
 *   tray: Array<{ uid: string, itemId: string, rot: 0|1|2|3 } | null>, // 固定长度 4
 *   shop: Array<{ slotIndex: number, itemId: string, cost: number, locked: boolean, sold: boolean }>,
 *   synergies: ReturnType<typeof computeBagSynergies>,
 *   lastMergeEvents: Array<object>,
 *   lastBattleSummary: object | null,
 *   history: Array<{ round: number, enemyId: string, winner: 'player' | 'enemy', elapsed: number }>,
 * }
 */

export function createSession(seed = Date.now()) { ... }
export function selectHero(session, heroId) { ... } // 初始化勇者、中心15格+勇者额外格、放入 starterItems、生成第1轮商店并进入 'prep'

/** 背包扩建操作 */
export function expandBagCell(session, row, col) { ... }
export function autoExpandBag(session) { ... }

/** 商店操作 */
export function rerollShop(session) { ... }                 // 校验金币（含首刷免费被动），未锁定槽重抽
export function getRerollCost(session) { ... }              // 返回当次实际刷新费用（0 或 2）
export function toggleShopSlotLock(session, slotIndex) { ... }
export function toggleShopAllLock(session) { ... }

/**
 * 购买商店槽位物品：
 * - 若指定 target = { zone: 'bag', row, col, rot }：支持直接放入空位，或直接叠合到背包内同款/神话配对物品上合成！
 * - 若未指定 target：优先尝试与背包/托盘内已有同款二合一或自动寻找背包合法空位，放不下则放入暂存托盘空槽；若均满则拒绝扣款并返回 { ok: false, reason: 'no_space' }。
 */
export function buyShopItem(session, slotIndex, target = null) { ... }

/**
 * 通用物品移动与合成（支撑 Pointer 拖拽与点选放置）：
 * from: { zone: 'bag', uid: string } | { zone: 'tray', index: number }
 * to:   { zone: 'bag', row: number, col: number, rot?: number } | { zone: 'tray', index?: number }
 *
 * 行为优先级：
 * 1. 若落点恰好命中单个可二合一进化或可★神话融合的目标物品 -> 立即执行合成并返回 { ok: true, action: 'merged', mergeKind: 'upgrade' | 'mythic', resultId, uid }！
 * 2. 若落点合法无冲突 -> 移动过去并返回 { ok: true, action: 'moved' }。
 * 3. 若从托盘/背包拖到背包时只与 **1 件** 已有物品重叠，且被挤占物品可安全交换到原位置或暂存托盘空槽 -> 支持智能腾挪交换（可选增强，至少保证空位移动与单目标合成 100% 丝滑）！
 */
export function moveItem(session, from, to) { ... }

/** 旋转选中物品（在背包内原地尝试旋转 90°，若原地旋转越界/碰撞则在 ±1 格邻域寻找合法微调锚点；在托盘内直接更新 rot） */
export function rotateItem(session, ref) { ... } // ref: { zone: 'bag', uid } | { zone: 'tray', index }

/** 出售背包或托盘中的物品返还金币 */
export function sellItem(session, ref) { ... }

/** 一键智能整理背包（启发式自动扩格 + 自动合成 + 将光环挂件居中、武器围绕挂件最大化 DPS 与护盾摆放） */
export function autoArrangeBag(session) { ... }

/**
 * 开启本轮战斗：
 * 1. 若有剩余 expandPoints 自动调用 autoExpandBag(session)
 * 2. 调用 resolveAdjacentMythicMerges(session.bag) 执行相邻神话自动融合并刷新 synergies
 * 3. 将 session.status 置为 'combat'，返回 createBattleSimulator(...) 实例供前端逐帧播放或直接结算
 */
export function beginCombatPhase(session) { ... }

/**
 * 提交本轮战斗结果并推进到下一轮（或触发 victory / defeat）：
 * @param {GameSession} session
 * @param {{ winner: 'player' | 'enemy', elapsed: number, playerHpLeft: number, enemyHpLeft: number }} combatOutcome
 */
export function settleCombatResult(session, combatOutcome) { ... }

/**
 * 供 QA 200 局平衡压测直接调用的单局完整 AI 模拟函数（从选勇者一直打到第 10 轮结束或红心归零）
 * @param {{ heroId: string, seed: number }} opts
 * @returns {{
 *   victory: boolean,
 *   roundsCleared: number,
 *   finalRound: number,
 *   heartsLeft: number,
 *   mythicsCrafted: number,
 *   upgradesDone: number,
 *   history: Array<object>
 * }}
 */
export function simulateFullRunAI({ heroId, seed }) { ... }
```

---

## 6. 前端 UI 布局、交互规范与 DOM 契约（供 `@ui-author` 与 `@qa-verifier` 对接）

### 6.1 现代 Web 与竖屏 9:16 视觉铁律
1. **比例与视口**：主舞台采用 `max-width: 460px; height: 100dvh` 居中竖屏容器，严禁出现横向滚动条（`overflow-x: hidden`），所有文本与数值采用 `fz.ttf` 游戏字体。
2. **弹窗规范**：选勇者弹窗（或首屏遮罩）、图鉴弹窗（`#catalog-dialog`）、规则弹窗（`#help-dialog`）、终局结算弹窗（`#result-dialog`）优先使用原生 `<dialog closedby="any">` + `showModal()`（附 backdrop 点击坐标兜底关闭），`overscroll-behavior: contain`。
3. **显隐铁律**：在 `styles.css` 中显式声明 `[hidden] { display: none !important; }`，严禁任何 `display: flex/grid` 覆盖 `[hidden]` 属性！

### 6.2 四段式竖屏黄金分区与推荐关键 DOM ID
1. **顶部状态栏（`#top-bar`）**：
   - `#hero-badge`（当前勇者小头像与被动简称）
   - `#hearts-display`（不屈红心 `❤️ × 5`）
   - `#gold-display`（搭配 `jinbi.png` 显示当前金币）
   - `#round-display`（波次进度 `第 1 / 10 轮`）
   - 快捷图标按钮：`#btn-catalog`（📖 图鉴与合成表）、`#btn-help`（❓ 规则）、`#btn-mute`（🔊 音效开关，最小触控热区 `>= 36px`）
2. **上半屏 1v1 狂飙飞弹竞技场（`#arena-stage`）**：
   - 原版关卡大图背景（随波次轮换 `ARENA_BACKGROUNDS`）
   - 左侧我方勇者卡片 `#player-fighter`（立绘 `#player-portrait` 受击瞬间切 `hitPortrait` `_st.png` + 受击抖动、HP 进度条、护盾值徽章、毒/冰状态胶囊）
   - 右侧敌方 Boss 卡片 `#enemy-fighter`（立绘 `#enemy-portrait` 受击切 `_st.png`、HP 进度条、护盾/毒/冰胶囊，以及 **敌方装备小图标预览条 `#enemy-loadout-bar`**，战斗中同步闪烁触发！）
   - 特效层 `#fx-layer`：渲染抛物线飞弹（可从我方勇者或对应背包物品飞向敌方立绘）+ 原版 `Hud/` 彩色位图数字跳字（普通 `PT_`、暴击 `BJ_+boom`、回血 `HX_+`、剧毒 `ZD_-`、护盾/反伤 `FS_`、闪避 `SB.png`）。
3. **中腰战术检视条与 4 格暂存托盘（`#inspector-tray-bar`）**：
   - 左侧物品检视器 `#item-inspector`：展示当前选中/悬停物品的图标、名称、阶数、形状缩略、有效 CD、DPS、光环加成与合成提示；附带醒目操作按钮 **`#btn-rotate`（🔄 旋转 90°，支持键盘 `R`）**、**`#btn-sell`（💰 出售 +X金）**、**`#btn-auto-sort`（✨ 智能摆包）**。
   - 右侧暂存托盘 `#holding-tray`：4 个暂存槽（`.tray-slot[data-tray-index="0..3"]`），方便旋转腾挪大件装备。
4. **下半屏 7×5 异形网格大背包 + 商店抽屉/面板（`#workshop-zone`）**：
   - **背包网格 `#backpack-grid`**：`7 列 × 5 行`，已解锁格铺设 `img_gezi_bag.png` 底砖；未解锁格展示锁链虚线态，当 `expandPoints > 0` 时正交可扩建格高亮脉冲（点击直接调用 `expandBagCell` 解锁！顶部提示剩余可扩建格数）。
   - **异形物品层**：跨格精准对齐渲染物品图标、品质边框与等级角标（`Lv1~Lv4` 或 `★神话`）：
     - 战斗阶段实时覆盖 **半透明扇形或纵向充能遮罩（CD Progress Overlay）**，每次触发瞬间外框高亮脉冲闪光！
     - 整备阶段选中或拖拽某物品时：同款可二合一目标闪烁**金色进化光框**，可跨物品合成★神话的配对物品闪烁**紫金神话星芒框**，受十字/星位光环影响的邻居绘制**绿色/青色增益高亮或 SVG 连线**！
   - **双模丝滑操作**：
     - **Pointer 拖拽**：按住商店商品、托盘物品或背包物品直接拖动，实时在网格上投射**绿色（合法/可合成）或红色（越界/冲突）**多格预览阴影，松手即完成购买/移动/合成！
     - **无障碍点选模式**：点击选中一件商店/托盘/背包物品 → 可点 `🔄 旋转` 调整朝向 → 点击目标背包格或目标合成物品即可完成放置/购买/合成（兼顾触屏、鼠标与自动化测试点击！）。
   - **商店栏 `#shop-panel`**（5 个商品卡片 `.shop-card[data-shop-slot="0..4"]`，显示图标、迷你形状点阵、价格与单槽 `🔒` 锁按钮）與 **底部主控栏 `#bottom-controls`**：
     - 整备阶段：`#btn-toggle-shop`（🛒 商店折叠/展开，让背包整理视野更宽敞或同屏并排）、`#btn-reroll`（🔄 刷新 2金/免费）、`#btn-lock-shop`（❄️ 锁店）、`#btn-start-combat`（⚔️ 塞满开战）。
     - 战斗阶段：`#btn-speed`（⏩ 倍速 `×1 / ×2 / ×3` 循环切换）、`#btn-skip-combat`（⚡ 瞬时结算）。

---

## 7. 数值平衡基准与 QA 验收红线（供 `@catalog-author`、`@engine-author`、`@qa-verifier` 协同）

### 7.1 推荐数值锚点（确保 200 局 AI 压测落入 45% ~ 85% 黄金甜区）
- **勇者生命成长**：基础 `165 ~ 185 HP`，每轮成长 `+46 HP`（Round 1 约 `175 HP`，Round 5 约 `360 HP` + 防具加成，Round 10 约 `590 HP` + 防具/护盾加成）。
- **武器 DPS 锚点**：
  - `Lv1` 基础武器：单次伤害 `10 ~ 18`，CD `1.6s ~ 2.4s`（裸装 DPS 约 `6 ~ 9`）。
  - `Lv2` 进化武器（2 合 1）：综合战力约为单把 Lv1 的 **`1.75x ~ 1.85x`**（由于省出一半背包格子放新装备或光环，单位面积强度翻倍！）。
  - `Lv3` 精锐武器（4 合 1）：综合战力约为 Lv1 的 **`3.1x`**。
  - `Lv4` 传说武器（8 合 1）：综合战力约为 Lv1 的 **`5.2x`**。
  - `★神话神装`：综合强度对标 `Lv3.5` 并附带强力复合光环或经济收益。
- **10 轮敌方 Boss 强度梯度参考**：
  - `R1`: `130 HP`，携带 2 件 Lv1 基础装（总敌方裸 DPS ~ `11`）—— 首轮教学稳赢（胜率 > 92%）。
  - `R2`: `185 HP`，携带 3 件 Lv1 装（DPS ~ `16`）。
  - `R3`: `245 HP`，携带 3~4 件 Lv1/挂件装（DPS ~ `22`）。
  - `R4`: `320 HP`，携带 4 件含 Lv2 武器装（DPS ~ `29`）。
  - `R5 (中Boss)`: `420 HP` + `35` 开场盾，携带 5 件装备（DPS ~ `38`）。
  - `R6`: `510 HP`，携带 5 件含 Lv2+光环装（DPS ~ `47`）。
  - `R7`: `620 HP`，携带 6 件装备（DPS ~ `58`）。
  - `R8`: `740 HP`，携带 6 件含 Lv3 武器装（DPS ~ `70`）。
  - `R9`: `860 HP` + `60` 开场盾，携带 7 件精锐装（DPS ~ `84`）。
  - `R10 (终极魔王)`: `1020 HP` + `90` 开场盾，携带 7 件含 Lv3 + ★神话装备（DPS ~ `100`）。

### 7.2 交付验收硬指标
1. **零断链**：`catalog.js`、`index.html`、`styles.css`、`fx_renderer.js`、`audio.js` 引用的所有图片、位图数字、字体与 mp3 文件在磁盘 **100% 存在**，浏览器实机 `naturalWidth > 0`。
2. **零报错单测**：`node --test backpack/tests/engine.test.mjs` 全绿通过（含旋转矩阵、越界拦截、扩建解锁、同名进化、跨物品神话融合、十字/星位光环计算、实时与无头战斗一致性）。
3. **200 局 AI 平衡压测**：4 位勇者各跑 50 局完整 10 轮流程（共 200 局），**零异常崩溃**，且综合 10 轮通关率严格处于 **`45% ~ 85%`** 健康区间（每位单勇者胜率均不低于 `30%` 且不高于 `92%`）。
4. **独立构建与实机交互**：`node backpack/tools/build_dist.mjs` 顺利生成自包含 `backpack/dist/`，浏览器实机试玩选人、扩格、旋转摆包、合成、实时飞弹对轰与 `_st` 受击颜艺切换丝滑无溢出。
