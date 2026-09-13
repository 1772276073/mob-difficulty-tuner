# 怪物难度调节器 · Mob Difficulty Tuner

> 一个 **Minecraft 基岩版行为包（Behavior Pack）**，在游戏内实时调节敌对生物的四项核心属性：
> **移动速度** · **伤害** · **生命值** · **刷新数量**。
> 纯脚本实现，零资源包依赖，支持 `1.21.90+` 与 `26.x` 年号版本。

![Minecraft](https://img.shields.io/badge/Minecraft-Bedrock%20Edition-62B47A?style=flat-square)
![Engine](https://img.shields.io/badge/min__engine-1.26.0-4C8BF5?style=flat-square)
![Script API](https://img.shields.io/badge/%40minecraft%2Fserver-2.6.0-EA6A00?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

---

## 📖 目录

- [它是什么](#-它是什么)
- [功能特性](#-功能特性)
- [目录结构](#-目录结构)
- [安装](#-安装)
- [使用](#-使用)
- [外部配置文件](#-外部配置文件)
- [实现要点](#-实现要点)
- [打包与开发](#-打包与开发)
- [常见问题](#-常见问题)
- [参考](#-参考)

---

## 🎯 它是什么

原版基岩版想调难度，只能靠 `/difficulty`（粗暴切换四档），或者装一堆模组。
这个行为包把「难度」拆成四个**连续可调**的倍率，并且可以在**游戏里随时改、立刻生效、随世界存档保存**。

一句话：*把「简单 / 普通 / 困难」变成一根根旋钮，而不是三四个开关。*

## ✨ 功能特性

| 特性 | 说明 |
| --- | --- |
| 🎛️ **四项独立倍率** | 速度 `0.1–4.0` / 伤害 `0–6.0` / 生命 `0.1–8.0` / 刷新 `0–6.0` |
| 🖥️ **游戏内设置面板** | 聊天栏输入 `!难度` 即呼出，含数字输入框 + 开关 + 快速预设 |
| 📝 **外部配置文件** | 不想进游戏？改 `scripts/config.js` 一行数值，重进世界生效 |
| 🎚️ **5 档快速预设** | 简单 / 普通 / 困难 / 噩梦 / 地狱 一键套用 |
| 🎯 **精准作用域** | 默认只影响 `monster` 族群；Boss 与中立生物用开关单独控制 |
| 🏹 **投射物溯源** | 箭 / 火球 / 龙息会自动回溯到射手再套倍率 |
| 🔁 **防指数增殖** | 刷怪倍率 > 1 时补充生成的怪会被标记，不会自我复制到爆炸 |
| ♻️ **定期巡检** | 每 3 秒扫描已加载生物，设置改动前就存在的怪也会被纠正 |
| 💾 **世界级持久化** | 设置存为世界动态属性，关服回来看还在 |
| 🚫 **不误伤玩家** | 玩家、盔甲架、村民等完全不受影响 |

## 📂 目录结构

```
我的世界难度调节器/
├── DifficultyTuner_BP/            ← 行为包源码
│   ├── manifest.json              #  清单：UUID / 模块 / API 依赖
│   ├── pack_icon.png              #  包图标
│   └── scripts/
│       ├── main.js                #  全部逻辑（事件、倍率、UI）
│       └── config.js              #  外部配置（记事本改这里）
├── DifficultyTuner.mcpack         ← 双击导入的打包成品
├── tools/
│   ├── pack.py                    #  重新打包 .mcpack（Python 标准库）
│   └── push-to-github.ps1         #  一键推送到 GitHub（仓库维护用）
├── README.md
└── .gitignore
```

## 📦 安装

### 方式 A · 手动导入（推荐，最可靠）

1. 把整个 `DifficultyTuner_BP` 文件夹复制到：

   ```
   C:\Users\<你的用户名>\AppData\Local\Packages\
     Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\
       development_behavior_packs\
   ```

2. 打开世界 → **编辑** → 左侧 **行为包** → 在「可用」里找到 **怪物难度调节器** → **启用**。
3. 该世界的 **设置 → 实验性 → 「测试版 API」** 打开。
4. 进服后按 [使用](#-使用) 一节操作。

### 方式 B · 双击 `.mcpack`

如果 `.mcpack` 文件关联正常，双击会自动导入。但**很多机器上双击没有任何提示**，
此时改用方式 A 手动复制即可。

> ⚠️ **不需要资源包**。一个行为包就够。
> ⚠️ **导入 ≠ 启用**——复制进目录后，还必须在「编辑世界 → 行为包」里启用它。

### 🩺 自检：怎么知道它真的在工作？

进世界后 **2 秒**，聊天栏会出现一条自检消息：

```
[难度调节器] 已加载 ✔  命令 !难度 或 /scriptevent dt:open 呼出设置面板；也可直接改包内 config.js
速度×1.00 伤害×1.00 生命×1.00 刷新×1.00
```

**看不到这条消息**，说明脚本没跑起来，99% 是这两个原因：

1. 世界设置里没有**启用**该行为包（导入 ≠ 启用）。
2. 世界的 **实验性 → 「测试版 API」** 没打开。

自检消息出现后再输入 `!难度`。若仍打不开界面，脚本会自动换一种 UI 签名重试一次；
两次都失败才会提示具体错误原因。

## 🎮 使用

界面中共 **7 个控件**：4 个数字输入框 + 2 个开关 + 1 个预设下拉。

| 控件 | 范围 | 说明 |
| --- | --- | --- |
| 移动速度倍率 | `0.10 – 4.00` | `1.00` 原版，`2.00` 怪物快一倍 |
| 伤害倍率 | `0 – 6.00` | `0` = 怪物无伤，`2.00` = 双倍伤害 |
| 生命值倍率 | `0.10 – 8.00` | `1.00` 原版，`3.00` = 耐打三倍 |
| 刷新数量倍率 | `0 – 6.00` | `0` = 完全不刷怪，`3.00` = 刷怪密度三倍 |
| 同时影响 Boss | 开关 | 默认**关**（不动末影龙 / 凋灵 / 监守者 / 远古守卫者） |
| 同时影响中立生物 | 开关 | 默认**关**（狼 / 铁傀儡 / 猪灵 / 末影人等不被改动） |
| 快速预设 | 下拉 | 简单 / 普通 / 困难 / 噩梦 / 地狱 |

交互细节：

- 输入框**留空**或填非法内容 → 该项保持原值；超出范围自动 clamp 到上下限。
- 设置以**世界级动态属性**保存，关掉世界再回来依然有效。

### ⌨️ 命令一览

| 方式 | 用法 |
| --- | --- |
| 聊天 | `!难度` / `!difficulty` / `!nd` / `!设置` / `#难度` |
| 物品 | 手持「怪物难度调节器」物品 或 指南针 在世界中右键 |
| 命令方块 | `/scriptevent dt:open` — 打开设置面板（对所有玩家） |
| 命令方块 | `/scriptevent dt:set 1.2 1.5 2 1.5` — 依次设置「速度 伤害 生命 刷新」 |
| 命令方块 | `/scriptevent dt:preset 3` — 套用 3 号预设（`0`简单 `1`普通 `2`困难 `3`噩梦 `4`地狱） |
| 命令方块 | `/scriptevent dt:info` — 在聊天栏显示当前设置 |
| 命令方块 | `/scriptevent dt:reset` — 清除游戏内保存的设置，回到 `config.js` 的值 |

## 📄 外部配置文件

用记事本打开 `DifficultyTuner_BP/scripts/config.js`，按注释改数值：

```js
export const CONFIG = {
  enabled: true,        // 总开关
  speed: 1,             // 移动速度倍率 0.1 – 4
  damage: 1,            // 伤害倍率 0 – 6
  health: 1,            // 生命值倍率 0.1 – 8
  spawn: 1,             // 刷新数量倍率 0 – 6
  affectBoss: false,    // 是否影响 Boss
  affectNeutral: false  // 是否影响中立生物
};
```

保存后**重新进入世界**即生效。注意：

- 游戏内用界面改过的值会存为「世界级动态属性」，会**暂时覆盖** `config.js`。
- 想让 `config.js` 重新生效：执行 `/scriptevent dt:reset`，或删掉该世界存档里本包的设置。
- 改完进服没变化，多半是游戏缓存着旧脚本 —— 把世界**完全关闭重开**一次。

## 🔧 实现要点

- **生命值倍率** = `health_boost` 状态效果（每级 +4 点，真正拉长血条）+ 精确伤害补偿：
  当目标血量不是 4 的整数倍时，对怪物受到的伤害做轻微缩放，让「有效血量」恰好等于原版 × 倍率。
- **伤害倍率** 通过 `world.beforeEvents.entityHurt` 实现 —— 攻击方是怪物就把伤害乘上倍率；
  若为投射物，自动回溯到射手。
- **移动速度倍率** 优先调用 `EntityMovementComponent.setCurrentValue()` 精确写入；
  部分生物组件被锁定时自动回落到 `speed` / `slowness` 状态效果。
- **刷新数量倍率** 通过 `world.afterEvents.entitySpawn` 实现：
  - 倍率 `< 1`：按概率移除新刷出的怪。
  - 倍率 `> 1`：补充刷出 `floor(M) - 1` 只（带密度保护，避免单点刷怪卡顿）。
  - 补充生成的怪会被标记，再次触发 `entitySpawn` 时**不再增殖**，杜绝指数级刷怪。
- **定期巡检**：每 3 秒扫描所有已加载生物，覆盖设置改动前就已存在的怪物。
- **存档隔离**：怪物自身只记录「原版基础值」，不受世界间相互影响。

## 🛠 打包与开发

源码改完后，用自带脚本重新生成 `.mcpack`（Python 3，仅标准库）：

```bash
python tools/pack.py
```

脚本会把 `DifficultyTuner_BP/` 压缩为 `DifficultyTuner.mcpack`（zip 格式，`.mcpack` 即改名的 zip）。

### 环境要求

| 项 | 版本 |
| --- | --- |
| Minecraft 基岩版 | `1.21.90+`（含 26.x 年号版本） |
| `min_engine_version` | `[1, 26, 0]` |
| `@minecraft/server` | `2.6.0` |
| `@minecraft/server-ui` | `2.1.0` |

若游戏提示模块版本不可用，把 `manifest.json` 里的版本号向下调整（最低
`@minecraft/server 1.14.0` + `@minecraft/server-ui 1.2.0` 仍能跑，但
`setCurrentValue` 与 `ModalFormData` 的可用性需要验证）。

## ❓ 常见问题

**Q1. 双击 `.mcpack` 完全没反应 / 导入了却看不到包。**
A1. 这是 Windows 上 `.mcpack` 文件关联失效导致的，用**方式 A 手动复制**即可。
另注意：**导入 ≠ 启用**，复制后还必须在「编辑世界 → 行为包」里启用。

**Q2. 进游戏后输入 `!难度` 没反应，也没有自检消息。**
A2. 说明脚本根本没跑起来。按顺序排查：
① 世界设置 → 行为包 → 是否已启用；
② 世界设置 → 实验性 → 「测试版 API」是否已开；
③ 若启用了行为包但世界仍提示「包含实验性内容」，直接确认继续即可。
两步做完还不行，把游戏完全关掉重开一次（UWP 版经常需要重启才重新加载脚本）。

**Q3. 提示「无法打开设置界面」。**
A3. 脚本已加载（能看到自检消息），但 UI 模块调用失败。脚本会自动切换另一种参数签名重试；
若两次都失败，说明该版本里 `@minecraft/server-ui 2.0.0` 不可用 —— 把 `manifest.json`
的 `"version"` 改为 `"1.4.0-beta"` 并重新进世界。

**Q4. 怎么只对某个区域生效？**
A4. 目前是「全怪物」统一生效。若想分区，可以借助 `!难度` 设置后立刻用
`/scriptevent dt:set ...` 配合命令方块按需切换；或在 `main.js` 顶部 `BOSS_TYPES`
后追加你希望排除的实体。

**Q5. 与其他增强难度的 add-on 冲突？**
A5. 本包只对 `monster` 族群生效，且只覆盖速度 / 伤害 / 生命 / 刷新四件事，一般不会与原版
行为以外的 add-on 冲突。若遇到怪血量回满这种异常，请把 `main.js` 里 `applyHealth` 的
`resetToMaxValue()` 改成 `setCurrentValue(maxHp * M)`。

**Q6. 会让装备好的玩家也变强 / 变弱吗？**
A6. 不会。玩家不参与任何倍率调整；只有 `monster` 族群（以及开启开关后的 Boss / 中立生物）受影响。

## 📚 参考

- [Minecraft 基岩版脚本 API 文档](https://learn.microsoft.com/minecraft/creator/scriptapi/)
- [`@minecraft/server` 模块参考](https://learn.microsoft.com/minecraft/creator/scriptapi/minecraft/server/minecraft-server)
- [行为包 manifest 规范](https://learn.microsoft.com/minecraft/creator/reference/content/addonsreference/examples/addonmanifest)

---

## 📝 清单摘要（`manifest.json`）

- `min_engine_version: [1, 26, 0]` — 兼容 `1.21.90` 及以上（含 26.x 年号版本）。
- 依赖 `@minecraft/server 2.6.0` + `@minecraft/server-ui 2.1.0`。
- 仅需 **1 个行为包**即可使用，**不需要资源包**。
