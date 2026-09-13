/**
 * =============================================================================
 *  怪物难度调节器 · Mob Difficulty Tuner
 *  基岩版行为包 / Minecraft Bedrock Behavior Pack
 * -----------------------------------------------------------------------------
 *  功能：在设置界面中实时调节
 *        ① 怪物移动速度倍率  ② 怪物伤害倍率
 *        ③ 怪物生命值倍率    ④ 怪物刷新数量倍率
 *
 *  两种设置方式（任选其一）：
 *    ▸ 外部配置：用记事本编辑包内 scripts/config.js，重新进服即生效
 *    ▸ 游戏内 UI：聊天输入 !难度（或 /scriptevent dt:open）呼出面板，直接填数字提交
 *      · 备用：手持「怪物难度调节器」物品 / 指南针 右键也可呼出面板
 *    · /scriptevent dt:reset  让外部 config.js 重新生效
 *    · /scriptevent dt:info   查看当前设置
 * =============================================================================
 */

import { world, system, EntityComponentTypes, ItemStack } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";

// 外部配置文件 config.js 是可选的；若加载失败则使用下面这组内置默认值。
// 这样即使文件缺失/导入异常，脚本也不会整体崩溃。
const DEFAULT_CONFIG = {
  enabled: true,
  speed: 1,
  damage: 1,
  health: 1,
  spawn: 1,
  affectBoss: false,
  affectNeutral: false
};
let CONFIG = DEFAULT_CONFIG;
let configLoaded = false;

/* ========================================================================== */
/* 一、常量配置                                                                */
/* ========================================================================== */

const KEY_SETTINGS = "dt:settings";   // 世界级设置存档
const KEY_STAMP = "dt:stamp";         // 实体上记录"已按哪套配置调整过"
const KEY_RESID = "dt:residual";      // 生命值精确补偿系数
const KEY_CLONE = "dt:clone";         // 标记为补充刷出的怪物(自身不再增殖)
const KEY_BASE_HP = "dt:baseHp";      // 记录原版基础生命值
const KEY_BASE_MV = "dt:baseMv";      // 记录原版基础移动速度
const KEY_MV_DIRECT = "dt:mvDirect";  // 该生物是否支持直接写入移动速度
const KEY_HINTED = "dt:hinted";       // 是否已提示过打开方式
const TRIGGER_ITEM = "minecraft:clock";
const TRIGGER_ITEM_NAME = "怪物难度调节器"; // 进服发放、右键打开面板的专用物品名

const DEFAULT_SETTINGS = {
  enabled: true,
  speed: 1,
  damage: 1,
  health: 1,
  spawn: 1,
  affectBoss: false,
  affectNeutral: false
};

/** 四项倍率的取值范围（与界面滑条一致） */
const LIMIT = {
  speed: { min: 0.1, max: 4, step: 0.05 },
  damage: { min: 0, max: 6, step: 0.05 },
  health: { min: 0.1, max: 8, step: 0.05 },
  spawn: { min: 0, max: 6, step: 0.05 }
};

/** 预设方案 */
const PRESETS = [
  { label: "§a简单 §8· 轻松探索", speed: 0.85, damage: 0.6, health: 0.7, spawn: 0.7 },
  { label: "§e普通 §8· 原版体验", speed: 1.0, damage: 1.0, health: 1.0, spawn: 1.0 },
  { label: "§6困难 §8· 需要小心", speed: 1.15, damage: 1.5, health: 1.8, spawn: 1.5 },
  { label: "§c噩梦 §8· 步步惊心", speed: 1.35, damage: 2.2, health: 3.0, spawn: 2.2 },
  { label: "§4地狱 §8· 请自备棺材", speed: 1.6, damage: 3.5, health: 5.0, spawn: 3.0 }
];

/** Boss 默认不参与调节 */
const BOSS_TYPES = new Set([
  "minecraft:ender_dragon",
  "minecraft:wither",
  "minecraft:warden",
  "minecraft:elder_guardian"
]);

/** 常见中立生物（开启"影响中立生物"后生效） */
const NEUTRAL_TYPES = new Set([
  "minecraft:wolf",
  "minecraft:polar_bear",
  "minecraft:piglin",
  "minecraft:piglin_brute",
  "minecraft:iron_golem",
  "minecraft:goat",
  "minecraft:panda",
  "minecraft:llama",
  "minecraft:trader_llama",
  "minecraft:camel",
  "minecraft:enderman",
  "minecraft:bee",
  "minecraft:zombified_piglin"
]);

/** 补充刷怪时的防卡顿保护：附近怪物达到该数量则不再补充 */
const DENSITY_LIMIT = 26;
const DENSITY_RADIUS = 20;
const MAX_EXTRA_PER_SPAWN = 6;

const DIMENSIONS = ["overworld", "nether", "the_end"];
const EFFECT_DURATION = 200000; // 约 2.7 小时，配合定期巡检自动续期

/* ========================================================================== */
/* 二、小工具                                                                  */
/* ========================================================================== */

const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round2 = (v) => Math.round(v * 100) / 100;

/** 把错误信息同时写到内容日志和聊天栏，方便排查"点了没反应" */
function logError(ctx, err) {
  const msg = "§c[难度调节器] " + ctx + "\n§8" + (err && err.message ? err.message : String(err));
  try {
    console.warn("[DifficultyTuner] " + ctx + ": " + String(err));
  } catch (e) {
    /* 忽略 */
  }
  try {
    world.sendMessage(msg);
  } catch (e) {
    /* 世界未加载时发不了消息 */
  }
}

/**
 * 容错订阅：某个事件在当前模块版本不存在时跳过，
 * 绝不让单个订阅失败拖垮整个脚本（导致"全无反应"）。
 */
function safeSubscribe(signal, cb) {
  try {
    if (signal && typeof signal.subscribe === "function") signal.subscribe(cb);
  } catch (e) {
    try {
      console.warn("[DifficultyTuner] subscribe skipped: " + String(e));
    } catch (e2) {
      /* 忽略 */
    }
  }
}

/* ========================================================================== */
/* 三、设置的读取 / 保存                                                       */
/* ========================================================================== */

let settings = normalize(DEFAULT_SETTINGS); // 先给默认值，等 worldLoad 后再读存档
let stamp = "";
let forceRescan = true;
let healthBoostSupported = true;
let worldReady = false; // 世界是否已加载完成

function normalize(p) {
  const s = Object.assign({}, DEFAULT_SETTINGS, p || {});
  return {
    enabled: !!s.enabled,
    speed: clamp(num(s.speed, 1), LIMIT.speed.min, LIMIT.speed.max),
    damage: clamp(num(s.damage, 1), LIMIT.damage.min, LIMIT.damage.max),
    health: clamp(num(s.health, 1), LIMIT.health.min, LIMIT.health.max),
    spawn: clamp(num(s.spawn, 1), LIMIT.spawn.min, LIMIT.spawn.max),
    affectBoss: !!s.affectBoss,
    affectNeutral: !!s.affectNeutral
  };
}

function loadSettings() {
  try {
    const raw = world.getDynamicProperty(KEY_SETTINGS);
    if (typeof raw === "string" && raw.length > 0) {
      return normalize(JSON.parse(raw));
    }
  } catch (e) {
    /* 存档损坏时回退到外部 config.js */
  }
  // 没有游戏内存档时，使用行为包里的外部配置文件 config.js
  return normalize(CONFIG);
}

function saveSettings() {
  try {
    world.setDynamicProperty(KEY_SETTINGS, JSON.stringify(settings));
  } catch (e) {
    /* 忽略写入失败，内存中仍然生效 */
  }
  refreshStamp();
  forceRescan = true;
}

function refreshStamp() {
  stamp = [
    settings.enabled ? 1 : 0,
    settings.speed.toFixed(3),
    settings.damage.toFixed(3),
    settings.health.toFixed(3),
    settings.spawn.toFixed(3),
    settings.affectBoss ? 1 : 0,
    settings.affectNeutral ? 1 : 0
  ].join("|");
}

/**
 * 世界加载后再读取动态属性 / 外部配置。
 * Script API 2.0+ 默认在 world load 之前执行，顶层调用 world.getDynamicProperty 可能失败。
 */
async function loadExternalConfig() {
  try {
    const mod = await import("./config.js");
    if (mod && mod.CONFIG) {
      CONFIG = mod.CONFIG;
      configLoaded = true;
    }
  } catch (e) {
    CONFIG = DEFAULT_CONFIG;
    configLoaded = false;
  }
}

function bootstrap() {
  if (worldReady) return;
  worldReady = true;
  try {
    settings = loadSettings();
    refreshStamp();
    forceRescan = true;
    try {
      world.sendMessage(
        "§6[难度调节器] §a已加载 ✔  §7输入 §f!难度 §7或 §f/scriptevent dt:open §7呼出设置面板\n§8" + summary()
      );
    } catch (e) {
      /* 忽略 */
    }
  } catch (e) {
    logError("初始化设置失败", e);
  }
}

// 优先用 worldLoad；若不存在则退而求其次用 system.runTimeout
if (world.afterEvents && typeof world.afterEvents.worldLoad !== "undefined") {
  world.afterEvents.worldLoad.subscribe(() => {
    loadExternalConfig().then(bootstrap).catch(bootstrap);
  });
} else {
  system.runTimeout(() => {
    loadExternalConfig().then(bootstrap).catch(bootstrap);
  }, 5);
}

function describe(s) {
  return [
    "§7┌──────────────────────────────",
    "§7│ §6怪物难度调节器 §7当前设置" + (s.enabled ? "" : "  §c[已停用]"),
    "§7│ §b移动速度 §f×" + s.speed.toFixed(2),
    "§7│ §c伤害     §f×" + s.damage.toFixed(2),
    "§7│ §a生命值   §f×" + s.health.toFixed(2),
    "§7│ §e刷新数量 §f×" + s.spawn.toFixed(2),
    "§7│ §8Boss: " + (s.affectBoss ? "§a影响" : "§c不影响") + "  §8中立生物: " + (s.affectNeutral ? "§a影响" : "§c不影响"),
    "§7└──────────────────────────────"
  ].join("\n§r");
}

/* ========================================================================== */
/* 四、目标判定                                                                */
/* ========================================================================== */

function isTarget(entity) {
  if (!entity || !entity.isValid) return false;
  if (entity.typeId === "minecraft:player") return false;
  if (!settings.affectBoss && BOSS_TYPES.has(entity.typeId)) return false;

  let isMonster = false;
  try {
    const fam = entity.getComponent(EntityComponentTypes.TypeFamily);
    if (fam) isMonster = !!fam.hasTypeFamily("monster");
  } catch (e) {
    /* 某些实体没有族群组件 */
  }
  if (isMonster) return true;

  if (settings.affectNeutral) {
    if (NEUTRAL_TYPES.has(entity.typeId)) return true;
    // 兜底：带近战攻击组件的生物也算作可调节目标
    try {
      if (entity.getComponent("minecraft:attack")) return true;
    } catch (e) {
      /* 忽略 */
    }
  }
  return false;
}

/* ========================================================================== */
/* 五、生命值倍率                                                              */
/* ========================================================================== */

/**
 * 实现方式：
 *  1) 用 health_boost 状态效果把血条真正拉长（每级 +4 点，玩家肉眼可见）；
 *  2) 4 点一档无法整除的部分，用"受伤减免"精确补偿，保证有效血量 = 基础血量 × 倍率；
 *  3) 若当前版本 health_boost 对生物无效，则整体退化为纯受伤减免，效果依然准确。
 */
function applyHealth(entity) {
  const hp = entity.getComponent(EntityComponentTypes.Health);
  if (!hp) return;

  let base = entity.getDynamicProperty(KEY_BASE_HP);
  if (typeof base !== "number" || base <= 0) {
    base = num(hp.defaultValue, 0);
    if (!(base > 0)) base = num(hp.effectiveMax, 20);
    if (!(base > 0)) base = 20;
    try {
      entity.setDynamicProperty(KEY_BASE_HP, base);
    } catch (e) {
      /* 忽略 */
    }
  }

  const m = settings.health;
  const targetTotal = base * m; // 期望的"有效生命值"

  let realMax = base; // 血条上真实存在的最高值
  let boostLevel = 0;

  try {
    entity.removeEffect("health_boost");
  } catch (e) {
    /* 忽略 */
  }

  if (m > 1.001 && healthBoostSupported) {
    boostLevel = clamp(Math.floor((targetTotal - base) / 4), 0, 255);
    if (boostLevel > 0) {
      try {
        entity.addEffect("health_boost", EFFECT_DURATION, {
          amplifier: boostLevel - 1,
          showParticles: false
        });
        realMax = base + 4 * boostLevel;
      } catch (e) {
        healthBoostSupported = false;
        boostLevel = 0;
        realMax = base;
      }
    }
  }

  // 精确补偿系数：>1 表示还需要减免伤害；=1 表示血条本身就够了
  const residual = m >= 1 ? targetTotal / realMax : 1;
  try {
    entity.setDynamicProperty(KEY_RESID, residual);
  } catch (e) {
    /* 忽略 */
  }

  // 让当前血量落到新上限（降倍率时把血量砍到目标值）
  try {
    if (m >= 1) {
      hp.resetToMaxValue();
    } else {
      hp.setCurrentValue(Math.max(1, Math.round(targetTotal)));
    }
  } catch (e) {
    /* 越界时忽略 */
  }
}

/* ========================================================================== */
/* 六、移动速度倍率                                                            */
/* ========================================================================== */

function getMovementComponent(entity) {
  let mv = null;
  try {
    mv = entity.getComponent(EntityComponentTypes.Movement);
  } catch (e) {
    mv = null;
  }
  if (!mv) {
    // 幻翼、恶魂等使用通用移动组件
    try {
      mv = entity.getComponent("minecraft:movement.generic");
    } catch (e) {
      mv = null;
    }
  }
  return mv;
}

function applySpeedEffect(entity, ratio) {
  try {
    entity.removeEffect("speed");
    entity.removeEffect("slowness");
  } catch (e) {
    /* 忽略 */
  }
  try {
    if (ratio > 1.02) {
      // 速度效果每级 +20%
      const level = clamp(Math.round((ratio - 1) / 0.2), 1, 255);
      entity.addEffect("speed", EFFECT_DURATION, { amplifier: level - 1, showParticles: false });
    } else if (ratio < 0.98) {
      // 缓慢效果每级 -15%
      const level = clamp(Math.round((1 / ratio - 1) / 0.15), 1, 255);
      entity.addEffect("slowness", EFFECT_DURATION, { amplifier: level - 1, showParticles: false });
    }
  } catch (e) {
    /* 忽略 */
  }
}

function applySpeed(entity) {
  const mv = getMovementComponent(entity);
  if (!mv) return;

  let base = entity.getDynamicProperty(KEY_BASE_MV);
  if (typeof base !== "number" || base <= 0) {
    base = num(mv.defaultValue, 0);
    if (!(base > 0)) base = num(mv.currentValue, 0);
    if (!(base > 0)) return;
    try {
      entity.setDynamicProperty(KEY_BASE_MV, base);
    } catch (e) {
      /* 忽略 */
    }
  }

  const target = base * settings.speed;
  let ok = false;
  try {
    mv.setCurrentValue(target);
    ok = Math.abs(num(mv.currentValue, 0) - target) < Math.max(0.0001, target * 0.02);
  } catch (e) {
    ok = false; // 超过组件上限（部分生物的移动速度被锁定）
  }

  try {
    entity.setDynamicProperty(KEY_MV_DIRECT, ok);
  } catch (e) {
    /* 忽略 */
  }

  if (!ok) {
    applySpeedEffect(entity, settings.speed);
  } else {
    try {
      entity.removeEffect("speed");
      entity.removeEffect("slowness");
    } catch (e) {
      /* 忽略 */
    }
  }
}

/** 巡检时顺手维持速度（有些 AI / 维度切换会把速度重置） */
function maintainSpeed(entity) {
  if (Math.abs(settings.speed - 1) < 1e-6) return;
  if (entity.getDynamicProperty(KEY_MV_DIRECT) !== true) return;
  const mv = getMovementComponent(entity);
  if (!mv) return;
  const base = entity.getDynamicProperty(KEY_BASE_MV);
  if (typeof base !== "number" || base <= 0) return;
  const target = base * settings.speed;
  try {
    if (Math.abs(num(mv.currentValue, 0) - target) > target * 0.05) {
      mv.setCurrentValue(target);
    }
  } catch (e) {
    /* 忽略 */
  }
}

/* ========================================================================== */
/* 七、把当前配置套用到一只生物                                                 */
/* ========================================================================== */

function tuneEntity(entity, force) {
  if (!entity || !entity.isValid) return;
  if (!settings.enabled) return;
  if (!isTarget(entity)) return;

  if (!force && entity.getDynamicProperty(KEY_STAMP) === stamp) {
    maintainSpeed(entity);
    return;
  }

  applyHealth(entity);
  applySpeed(entity);

  try {
    entity.setDynamicProperty(KEY_STAMP, stamp);
  } catch (e) {
    /* 忽略 */
  }
}

/* ========================================================================== */
/* 八、伤害：怪物打人更疼 / 怪物更耐打                                          */
/* ========================================================================== */

/** 解析真正的攻击方（投射物要回溯到射手） */
function resolveAttacker(source) {
  if (!source) return undefined;
  let e = undefined;
  try {
    e = source.damagingEntity;
  } catch (err) {
    e = undefined;
  }
  if (e && e.isValid) {
    try {
      const proj = e.getComponent(EntityComponentTypes.Projectile);
      const owner = proj ? proj.owner : undefined;
      if (owner && owner.isValid) return owner;
    } catch (err) {
      /* 不是投射物 */
    }
    return e;
  }
  return undefined;
}

safeSubscribe(world.beforeEvents && world.beforeEvents.entityHurt, (ev) => {
  if (!settings.enabled) return;

  let dmg = num(ev.damage, 0);
  if (dmg <= 0) return;

  // ① 怪物造成的伤害 × 伤害倍率
  const attacker = resolveAttacker(ev.damageSource);
  if (attacker && isTarget(attacker) && Math.abs(settings.damage - 1) > 1e-6) {
    dmg *= settings.damage;
  }

  // ② 怪物受到的伤害 ÷ 补偿系数（= 生命值倍率的精确部分）
  const victim = ev.hurtEntity;
  if (victim && victim.isValid && isTarget(victim)) {
    const r = num(victim.getDynamicProperty(KEY_RESID), 1);
    if (r > 0 && Math.abs(r - 1) > 1e-6) {
      dmg /= r;
    }
  }

  if (dmg !== num(ev.damage, 0)) {
    try {
      ev.damage = Math.max(0, dmg);
    } catch (e) {
      /* 某些版本下该字段不可写，忽略即可，其余功能不受影响 */
    }
  }
});

/* ========================================================================== */
/* 九、刷新数量倍率                                                            */
/* ========================================================================== */

safeSubscribe(world.afterEvents && world.afterEvents.entitySpawn, (ev) => {
  const e = ev.entity;
  if (!e || !e.isValid) return;

  // 自己补充刷出来的怪：只做属性调整，不再继续增殖
  if (e.getDynamicProperty(KEY_CLONE) === true) {
    tuneEntity(e, false);
    return;
  }

  if (!isTarget(e)) return;

  if (!settings.enabled) return;
  tuneEntity(e, false);

  const m = settings.spawn;
  if (Math.abs(m - 1) < 1e-6) return;

  // 减少刷新：按概率直接移除
  if (m < 1) {
    if (Math.random() > m) {
      try {
        e.remove();
      } catch (err) {
        try {
          e.kill();
        } catch (err2) {
          /* 忽略 */
        }
      }
    }
    return;
  }

  // 增加刷新
  let extra = Math.floor(m) - 1;
  if (Math.random() < m - Math.floor(m)) extra += 1;
  extra = Math.min(extra, MAX_EXTRA_PER_SPAWN);
  if (extra <= 0) return;

  const dimension = e.dimension;
  const origin = e.location;

  // 密度保护：附近已经很挤就不再补
  try {
    const nearby = dimension.getEntities({
      location: origin,
      maxDistance: DENSITY_RADIUS,
      families: ["monster"]
    });
    if (nearby.length >= DENSITY_LIMIT) return;
  } catch (err) {
    /* 查询失败时不阻拦 */
  }

  for (let i = 0; i < extra; i++) {
    try {
      const loc = {
        x: origin.x + (Math.random() - 0.5) * 2.5,
        y: origin.y + 0.1,
        z: origin.z + (Math.random() - 0.5) * 2.5
      };
      const clone = dimension.spawnEntity(e.typeId, loc);
      if (clone) {
        clone.setDynamicProperty(KEY_CLONE, true);
      }
    } catch (err) {
      /* 单个刷怪失败不影响其他 */
    }
  }
});

/* ========================================================================== */
/* 十、定期巡检：覆盖设置改动前就已存在的怪物                                    */
/* ========================================================================== */

function scan() {
  if (!settings.enabled) return;

  for (const id of DIMENSIONS) {
    let dim;
    try {
      dim = world.getDimension(id);
    } catch (e) {
      continue;
    }

    let list = [];
    try {
      list = dim.getEntities({ families: ["monster"] });
    } catch (e) {
      list = [];
    }
    if (settings.affectNeutral) {
      try {
        const more = dim.getEntities({ families: ["mob"] });
        if (more.length > list.length) list = more;
      } catch (e) {
        /* 忽略 */
      }
    }

    for (const mob of list) {
      try {
        tuneEntity(mob, forceRescan);
      } catch (e) {
        /* 单只出错不中断整体 */
      }
    }
  }

  forceRescan = false;
}

system.runInterval(() => {
  try {
    scan();
  } catch (e) {
    /* 忽略 */
  }
}, 60);

/* ========================================================================== */
/* 十一、设置界面                                                              */
/* ========================================================================== */

/**
 * @minecraft/server-ui 在不同版本上有两套签名：
 *   旧版（1.x）：slider(label, min, max, step, default)
 *   新版（2.x）：slider(label, min, max, { valueStep, defaultValue })
 * 这里自动探测并在失败时切换，避免"点了没反应"。
 */
let uiStyle = 0; // 0 = 未探测, 1 = 位置参数, 2 = 选项对象

function detectUiStyle() {
  try {
    const proto = Object.getPrototypeOf(new ModalFormData());
    const fn = proto && proto.slider;
    if (typeof fn === "function" && typeof fn.length === "number") {
      // 新版签名 (label, min, max, options = null) 的 length 为 3
      return fn.length <= 3 ? 2 : 1;
    }
  } catch (e) {
    /* 探测失败则默认位置参数 */
  }
  return 1;
}

function addToggle(f, label, def) {
  if (uiStyle === 2) f.toggle(label, { defaultValue: def });
  else f.toggle(label, def);
}

function addDropdown(f, label, items, defIndex) {
  if (uiStyle === 2) f.dropdown(label, items, { defaultValueIndex: defIndex });
  else f.dropdown(label, items, defIndex);
}

/**
 * 数字输入框兼容：
 *   旧版：textField(label, placeholderText, defaultValue)
 *   新版：textField(label, placeholderText, { defaultValue })
 * 先用位置参数试，报错再切选项对象。
 */
let textFieldStyle = 0; // 0=未探测, 1=位置参数, 2=选项对象

function addNumberField(f, label, def) {
  if (textFieldStyle === 0) {
    try {
      const test = new ModalFormData();
      test.textField("x", "y", "z");
      textFieldStyle = 1;
    } catch (e) {
      textFieldStyle = 2;
    }
  }
  if (textFieldStyle === 2) {
    f.textField(label, "输入数字，例如 1.5", { defaultValue: String(def) });
  } else {
    f.textField(label, "输入数字，例如 1.5", String(def));
  }
}

function buildSettingsForm() {
  const f = new ModalFormData();
  f.title("§l§6怪物难度调节器");
  addToggle(f, "§7启用本调节器的全部功能", settings.enabled);
  addNumberField(
    f,
    "§b移动速度倍率 §8(0.1–4.0，1.00 = 原版速度)",
    settings.speed
  );
  addNumberField(
    f,
    "§c伤害倍率 §8(0–6，1.00 = 原版伤害，0 = 完全无伤)",
    settings.damage
  );
  addNumberField(
    f,
    "§a生命值倍率 §8(0.1–8，1.00 = 原版血量)",
    settings.health
  );
  addNumberField(
    f,
    "§e刷新数量倍率 §8(0–6，1.00 = 原版刷怪量，0 = 不刷怪)",
    settings.spawn
  );
  addToggle(f, "§7同时影响 Boss §8(末影龙 / 凋灵 / 监守者 / 远古守卫者)", settings.affectBoss);
  addToggle(f, "§7同时影响中立生物 §8(狼 / 铁傀儡 / 猪灵 / 末影人 等)", settings.affectNeutral);
  addDropdown(
    f,
    "§d快速预设 §8(选择后前四项数字会被覆盖)",
    ["§8— 不使用预设 —"].concat(PRESETS.map((p) => p.label)),
    0
  );
  return f;
}

function openSettings(player, retry) {
  if (!worldReady) {
    player.sendMessage("§c[难度调节器] 世界尚未加载完成，请稍后再试。");
    return;
  }
  if (uiStyle === 0) uiStyle = detectUiStyle();

  let f;
  try {
    f = buildSettingsForm();
  } catch (e) {
    if (!retry) {
      uiStyle = uiStyle === 2 ? 1 : 2;
      textFieldStyle = textFieldStyle === 2 ? 1 : 2;
      openSettings(player, true);
      return;
    }
    logError("构建界面失败", e);
    player.sendMessage("§c[难度调节器] 构建界面失败：§8" + e);
    return;
  }

  f.show(player)
    .then((res) => {
      if (!res || res.canceled) {
        player.sendMessage("§7[难度调节器] 已取消，设置未更改。");
        return;
      }
      const v = res.formValues || [];

      let speed = num(v[1], settings.speed);
      let damage = num(v[2], settings.damage);
      let health = num(v[3], settings.health);
      let spawn = num(v[4], settings.spawn);

      const presetIndex = num(v[7], 0);
      if (presetIndex > 0) {
        const p = PRESETS[presetIndex - 1];
        if (p) {
          speed = p.speed;
          damage = p.damage;
          health = p.health;
          spawn = p.spawn;
        }
      }

      settings = normalize({
        enabled: !!v[0],
        speed,
        damage,
        health,
        spawn,
        affectBoss: !!v[5],
        affectNeutral: !!v[6]
      });
      saveSettings();

      player.sendMessage("§a[难度调节器] 设置已保存并应用到全场怪物。");
      player.sendMessage(describe(settings));
      try {
        world.sendMessage("§6[难度调节器] §f" + player.name + " §7调整了怪物难度：" + summary());
      } catch (e) {
        /* 忽略 */
      }
    })
    .catch((e) => {
      // 换一种签名再试一次
      if (!retry) {
        uiStyle = uiStyle === 2 ? 1 : 2;
        openSettings(player, true);
        return;
      }
      player.sendMessage(
        "§c[难度调节器] 无法打开设置界面。\n§7请确认世界设置 → §f实验性 §7中已开启 §f「测试版 API」§7。\n§8" + e
      );
    });
}

function summary() {
  return (
    "§b速度×" + round2(settings.speed) +
    " §c伤害×" + round2(settings.damage) +
    " §a生命×" + round2(settings.health) +
    " §e刷新×" + round2(settings.spawn)
  );
}

/* ========================================================================== */
/* 十二、打开方式                                                              */
/* ========================================================================== */

const OPEN_WORDS = new Set(["!难度", "!难度调节", "!设置", "!difficulty", "!nd", "!dt", "#难度"]);

safeSubscribe(world.beforeEvents && world.beforeEvents.chatSend, (ev) => {
  const text = (ev.message || "").trim();
  if (text.length === 0) return;
  if (OPEN_WORDS.has(text.toLowerCase()) || OPEN_WORDS.has(text)) {
    ev.cancel = true;
    try {
      openSettings(ev.sender);
    } catch (e) {
      ev.sender.sendMessage("§c[难度调节器] 打开失败：§8" + e);
    }
  }
});

safeSubscribe(world.afterEvents && world.afterEvents.itemUse, (ev) => {
  const item = ev.itemStack;
  if (!item) return;
  const isTrigger =
    item.typeId === TRIGGER_ITEM && (item.nameTag || "") === TRIGGER_ITEM_NAME;
  const isCompass = item.typeId === "minecraft:compass";
  if (!isTrigger && !isCompass) return;
  const p = ev.source;
  if (!p || p.typeId !== "minecraft:player") return;
  try {
    openSettings(p);
  } catch (e) {
    /* 忽略 */
  }
});

/** 进服自动发放「怪物难度调节器」物品，丢失后再次进服会补发 */
function giveTriggerItem(player) {
  try {
    const inv = player.getComponent("minecraft:inventory");
    if (!inv || !inv.container) return;
    const container = inv.container;
    for (let i = 0; i < container.size; i++) {
      const it = container.getItem(i);
      if (it && it.typeId === TRIGGER_ITEM && (it.nameTag || "") === TRIGGER_ITEM_NAME) {
        return; // 已经有了，不重复发
      }
    }
    const item = new ItemStack(TRIGGER_ITEM, 1);
    item.nameTag = TRIGGER_ITEM_NAME;
    container.addItem(item);
  } catch (e) {
    /* 忽略（例如创造模式或无背包） */
  }
}

function onScriptEvent(ev) {
  const id = (ev.id || "").toLowerCase();
  if (id === "dt:open") {
    for (const p of world.getAllPlayers()) openSettings(p);
    return;
  }
  if (id === "dt:debug") {
    const src = ev.sourceEntity && ev.sourceEntity.typeId === "minecraft:player" ? ev.sourceEntity : null;
    const target = src || world;
    try {
      target.sendMessage([
        "§7┌────────── §6难度调节器 诊断 §7──────────",
        "§7│ worldReady: §f" + worldReady,
        "§7│ configLoaded: §f" + configLoaded,
        "§7│ uiStyle: §f" + uiStyle,
        "§7│ textFieldStyle: §f" + textFieldStyle,
        "§7│ players: §f" + world.getAllPlayers().length,
        "§7│ current: §f" + summary(),
        "§7└────────────────────────────────"
      ].join("\n§r"));
    } catch (e) {
      /* 忽略 */
    }
    return;
  }
  if (id === "dt:reset") {
    try {
      world.setDynamicProperty(KEY_SETTINGS, undefined);
    } catch (e) {
      /* 忽略 */
    }
    settings = normalize(CONFIG);
    refreshStamp();
    forceRescan = true;
    try {
      world.sendMessage("§6[难度调节器] §7已重置为外部 §fconfig.js§7 的设置：" + summary());
    } catch (e) {
      /* 忽略 */
    }
    return;
  }
  if (id === "dt:info") {
    const msg = describe(settings);
    if (ev.sourceEntity && ev.sourceEntity.typeId === "minecraft:player") {
      ev.sourceEntity.sendMessage(msg);
    } else {
      try {
        world.sendMessage(msg);
      } catch (e) {
        /* 忽略 */
      }
    }
    return;
  }
  if (id === "dt:preset") {
    const idx = clamp(Math.floor(num(ev.message, 1)), 0, PRESETS.length - 1);
    const p = PRESETS[idx];
    settings = normalize({
      enabled: settings.enabled,
      speed: p.speed,
      damage: p.damage,
      health: p.health,
      spawn: p.spawn,
      affectBoss: settings.affectBoss,
      affectNeutral: settings.affectNeutral
    });
    saveSettings();
    try {
      world.sendMessage("§6[难度调节器] §7已套用预设：§r" + p.label + "\n" + summary());
    } catch (e) {
      /* 忽略 */
    }
    return;
  }
  if (id === "dt:set") {
    const parts = String(ev.message || "").trim().split(/[\s,]+/);
    settings = normalize({
      enabled: settings.enabled,
      speed: num(parts[0], settings.speed),
      damage: num(parts[1], settings.damage),
      health: num(parts[2], settings.health),
      spawn: num(parts[3], settings.spawn),
      affectBoss: settings.affectBoss,
      affectNeutral: settings.affectNeutral
    });
    saveSettings();
    try {
      world.sendMessage("§6[难度调节器] §7设置已更新：\n" + summary());
    } catch (e) {
      /* 忽略 */
    }
  }
}

// 1.26+ 脚本事件在 system.afterEvents 下；旧版在 world.afterEvents 下，两边都订阅确保兼容
if (system.afterEvents && typeof system.afterEvents.scriptEventReceive !== "undefined") {
  system.afterEvents.scriptEventReceive.subscribe(onScriptEvent);
}
if (world.afterEvents && typeof world.afterEvents.scriptEventReceive !== "undefined") {
  world.afterEvents.scriptEventReceive.subscribe(onScriptEvent);
}

/* ========================================================================== */
/* 十三、首次进服提示                                                          */
/* ========================================================================== */

safeSubscribe(world.afterEvents && world.afterEvents.playerSpawn, (ev) => {
  if (ev.initialSpawn === false) return;
  const p = ev.player;
  if (!p) return;
  // 进服即发放/补发专用物品
  try {
    giveTriggerItem(p);
  } catch (e) {
    /* 忽略 */
  }
  try {
    if (p.getDynamicProperty(KEY_HINTED) === true) return;
    p.setDynamicProperty(KEY_HINTED, true);
  } catch (e) {
    return;
  }
  p.sendMessage("§6[难度调节器] §7两种方式设置难度：① 改包内 §fconfig.js §7（记事本编辑，进服生效）；② 聊天输入 §f!难度 §7或手持「怪物难度调节器」右键呼出面板直接填数字。");
  p.sendMessage("§8当前：" + summary());
});
