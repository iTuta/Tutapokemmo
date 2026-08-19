const packed = require('../../data/spawn-data.js');
const LEVEL_MOVES = require('../../data/level-moves.js');

const SELF_HARM_MOVES = ['大爆炸', '玉石俱碎', '大闹一番', '花瓣舞', '逆鳞', '挣扎'];

const F = { ID: 0, NAME: 1, BASE: 2, TYPES: 3, REGION: 4, LOC: 5, TERRAIN: 6, LEVEL: 7, SEASON: 8, HORDE: 9, MORNING: 10, DAY: 11, NIGHT: 12, R_MORNING: 13, R_DAY: 14, R_NIGHT: 15, FORM: 16 };
const PAGE_SIZE = 30;
const SEASONS = ['春', '夏', '秋', '冬'];
const TIER_LIST = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const TIER_SCORES = { T0: 50, T1: 45, T2: 40, T3: 30, T4: 15, T5: 10, T6: 5, T7: 3 };
const TIER_COLORS = { T0: '#ffd700', T1: '#c0c0c0', T2: '#cd7f32', T3: '#66bb6a', T4: '#42a5f5', T5: '#ab47bc', T6: '#78909c', T7: '#546e7a' };
const GROUP_LABELS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
const GROUP_COLORS = ['#fbbf24', '#4ade80', '#60a5fa', '#f472b6', '#a78bfa', '#fb923c', '#2dd4bf', '#f87171'];
// 2026闪战优化.csv 续行缺失的分级种子，与网页端保持一致
const MISSING_TIER_SEEDS = {
  T3: [331, 434, 441, 443, 453, 456, 554, 556, 561, 615],
  T6: [304, 459, 504, 517, 522, 524, 527, 535, 540, 572, 574, 577, 582, 599, 605, 618, 621, 629, 632],
  T7: [422, 431, 436, 550, 551, 562, 585, 592, 607, 619, 622],
};
const TYPE_COLORS = {
  '一般': '#A8A878', '火': '#F08030', '水': '#6890F0', '电': '#F8D030',
  '草': '#78C850', '冰': '#98D8D8', '格斗': '#C03028', '毒': '#A040A0',
  '地面': '#E0C068', '飞行': '#A890F0', '超能': '#F85888', '虫': '#A8B820',
  '岩石': '#B8A038', '幽灵': '#705898', '龙': '#7038F8', '恶': '#705848',
  '钢': '#B8B8D0', '妖精': '#EE99AC',
};
const EV_LABELS = ['HP', '攻击', '防御', '速度', '特攻', '特防'];
const EV_INDEX = { hp: 0, attack: 1, defense: 2, speed: 3, sp_attack: 4, sp_defense: 5 };

// 筛选选项（与网页端一致）
const SEASON_LABELS = ['全部季节', '任意', '春', '夏', '秋', '冬', '群怪四季都有', '群怪仅春季', '群怪仅夏季', '群怪仅秋季', '群怪仅冬季'];
const SEASON_VALUES = ['', '任意', '春', '夏', '秋', '冬', 'horde:all', 'only:春', 'only:夏', 'only:秋', 'only:冬'];
const TIME_LABELS = ['全部时间', '早晨', '白天', '夜晚'];
const TIME_VALUES = ['', 'morning', 'day', 'night'];
const HORDE_LABELS = ['全部', '普通（非群怪）', '3群怪', '5群怪'];
const EV_LABEL_LIST = ['全部努力值', 'HP', '攻击', '防御', '速度', '特攻', '特防'];
const EXP_LABEL_LIST = ['默认顺序', '经验从高到低', '经验从低到高'];
const TIER_LABELS = ['全部分级'].concat(TIER_LIST.map((t) => t + '（' + TIER_SCORES[t] + '分）'));
const TIME_KEYS = [
  ['早', 'morning', F.MORNING, F.R_MORNING],
  ['昼', 'day', F.DAY, F.R_DAY],
  ['夜', 'night', F.NIGHT, F.R_NIGHT],
];

// 地点后缀翻译
const DIRECTIONS = {
  East: '东侧', West: '西侧', North: '北侧', South: '南侧',
};
const SUFFIXES = {
  '???': '未知区域', 'Back Room': '后室', Cave: '洞窟', Center: '中央区域',
  'Center Area': '中央区', 'Cold Room': '寒冷房间', Depths: '深处', 'Dining Room': '餐厅',
  East: '东侧', 'East Area': '东区', Entrance: '入口', Entryway: '入口通道',
  Forest: '森林', Gate: '关卡', 'Hidden Room': '隐藏房间', Inner: '内部',
  Interior: '内部', 'Lower Interior': '下层内部', 'Lower Mountainside': '低山腰',
  Mountainside: '山腰', North: '北侧', 'North Area': '北区', 'North Mountainside': '北侧山腰',
  'Northeast Area': '东北区', 'Northern Room': '北侧房间', 'Northwest Area': '西北区',
  'Northwest Room': '西北侧房间', Outer: '外围', Outside: '外部', Rooftop: '屋顶',
  South: '南侧', 'South Area': '南区', 'South Mountainside': '南侧山腰',
  'Southeast Area': '东南区', 'Southern Room': '南侧房间', 'Southwest Area': '西南区',
  Summit: '山顶', Tunnel: '隧道', 'Upper Interior': '上层内部', 'Upper Mountainside': '高山腰',
  West: '西侧', 'West Area': '西区',
};

function text(id) { return packed.d[id] || ''; }
function decodeNum(value) { return parseInt(value, 36); }
function decodeRef(value) { return parseInt(value, 36); }
function decodeFlag(value) { return value === 't'; }
function decodeRateRef(value) { return text(parseInt(value.slice(1), 36) - 1); }
function unpackRecords() {
  return packed.rows.split(';').map((line) => {
    const t = line.split(',');
    const id = decodeNum(t[0]);
    return [
      id, text(decodeRef(t[1])), text(decodeRef(t[1])), packed.types[String(id)] || [],
      text(decodeRef(t[2])), text(decodeRef(t[3])), text(decodeRef(t[4])), text(decodeRef(t[5])), text(decodeRef(t[6])),
      decodeNum(t[7]),
      decodeFlag(t[8]), decodeFlag(t[9]), decodeFlag(t[10]),
      decodeRateRef(t[11]), decodeRateRef(t[12]), decodeRateRef(t[13]),
      decodeNum(t[14]),
    ];
  });
}
function active(value) { return value !== false && value !== null && value !== undefined && value !== '--'; }
function selfHarmMoves(id, levelText) {
  const moves = LEVEL_MOVES[String(id)];
  if (!moves || !moves.length) return [];
  const nums = String(levelText || '').match(/\d+/g) || [];
  if (!nums.length) return [];
  const max = Number(nums[nums.length - 1]);
  const learned = [];
  for (const m of moves) {
    if (m[0] > max) break;
    learned.push(m[1]);
  }
  const hits = learned.slice(-4).filter((name) => SELF_HARM_MOVES.includes(name));
  return [...new Set(hits)];
}
function five(value) { return /^5(?:\.0+)?%$/.test(String(value || '').trim()); }
function horde(record) { return record[F.HORDE] === 3 || record[F.HORDE] === 5; }
function parseLevels(value) { const n = String(value || '').match(/\d+/g) || []; return n.length ? { min: Number(n[0]), max: Number(n[n.length - 1]) } : null; }
function numericRate(rate) { const v = parseFloat(String(rate || '').replace('%', '')); return Number.isFinite(v) ? v : null; }
function seasonMatch(a, b) { return a === '任意' || b === '任意' || a === b; }
function evStat(name) { return { HP: 'hp', 攻击: 'attack', 防御: 'defense', 速度: 'speed', 特攻: 'sp_attack', 特防: 'sp_defense' }[name]; }

function translateSuffix(suffix) {
  const floor = suffix.match(/^(\d+)F(?: (East|West|North|South))?$/);
  if (floor) return floor[1] + '楼' + (floor[2] ? DIRECTIONS[floor[2]] : '');
  const basement = suffix.match(/^B(\d+)F(?: (East|West|North|South))?$/);
  if (basement) return '地下' + basement[1] + '楼' + (basement[2] ? DIRECTIONS[basement[2]] : '');
  const towerFloor = suffix.match(/^Tower (\d+)F$/);
  if (towerFloor) return '塔' + towerFloor[1] + '楼';
  const numberedArea = suffix.match(/^Area (\d+)$/);
  if (numberedArea) return numberedArea[1] + '区';
  return SUFFIXES[suffix] || suffix;
}
function displayLocation(value, english) {
  if (english) return value;
  return String(value == null ? '' : value).replace(
    /\) \(([^()]*)\)$/,
    (match, suffix) => {
      const translated = translateSuffix(suffix);
      return translated === suffix ? match : ') (' + translated + ')';
    }
  );
}

// ---------- 分级 ----------
let tiers = {};
function initTiers() {
  tiers = Object.assign({}, packed.tiers || {});
  Object.keys(MISSING_TIER_SEEDS).forEach((tier) => {
    MISSING_TIER_SEEDS[tier].forEach((id) => {
      const idx = packed.familyIndex[String(id)];
      const familyIds = idx == null || !packed.families ? [id] : (packed.families[idx] || [id]);
      familyIds.forEach((fid) => {
        const key = String(fid);
        if (!tiers[key]) tiers[key] = [tier, TIER_SCORES[tier]];
      });
    });
  });
}
function tierOf(id) {
  const t = tiers[String(id)];
  return t ? { text: t[0], score: t[1], color: TIER_COLORS[t[0]] || '#607d8b' } : null;
}

// ---------- 经验 / 努力值 / 携带道具 ----------
function expInfo(id, level, count) {
  const info = packed.game.monsters[String(id)];
  const levels = parseLevels(level);
  if (!info || !levels) return null;
  const base = Number(info[1]) || 0;
  const c = count || 5;
  return {
    min: Math.floor(base * levels.min / 7) * c,
    max: Math.floor(base * levels.max / 7) * c,
    base,
    levels,
    ev: (info[2] || []).map((v) => v * c),
    evOne: info[2] || [],
    growth: info[0] || '',
    items: (info[3] || []).map((itemId) => packed.game.itemNames[String(itemId)] || ('#' + itemId)),
  };
}
function hasEv(id, name) {
  const info = packed.game.monsters[String(id)];
  const index = EV_INDEX[evStat(name)];
  return Boolean(info && index !== undefined && info[2] && info[2][index] > 0);
}
// 每种精灵的携带道具名称（预计算，供道具搜索使用）
let heldItemsById = {};
function buildHeldItems() {
  heldItemsById = {};
  Object.keys(packed.game.monsters || {}).forEach((id) => {
    heldItemsById[id] = (packed.game.monsters[id][3] || []).map(
      (itemId) => packed.game.itemNames[String(itemId)] || ('#' + itemId)
    );
  });
}
function matchedHeldItems(id, q) {
  const names = heldItemsById[String(id)] || [];
  return q ? names.filter((n) => n.toLowerCase().includes(q)) : names;
}
function evText(values) {
  const parts = [];
  values.forEach((value, index) => { if (value) parts.push(EV_LABELS[index] + ' +' + value); });
  return parts.length ? parts.join(' / ') : '无努力值';
}
function formatRange(min, max) {
  const format = (n) => {
    if (!Number.isFinite(n)) return '';
    return Math.round(n * 100) / 100;
  };
  const minText = format(min);
  const maxText = format(max);
  return minText === maxText ? String(minText) : minText + '–' + maxText;
}

// ---------- 5群怪混合收益（按时段） ----------
let locationIndex = new Map();
function buildIndexes(records) {
  locationIndex.clear();
  records.forEach((r) => {
    const key = r[F.REGION] + '\u0000' + r[F.LOC] + '\u0000' + r[F.TERRAIN];
    if (!locationIndex.has(key)) locationIndex.set(key, []);
    locationIndex.get(key).push(r);
  });
}
function candidatesFor(region, loc, terrain, season) {
  const key = region + '\u0000' + loc + '\u0000' + terrain;
  return (locationIndex.get(key) || []).filter((r) => r[F.SEASON] === season || r[F.SEASON] === '任意');
}
// 某条记录在指定时段的混群收益：同地点/地形/季节、同群怪槽位（等级连通分组）、该时段活跃
function mixedYieldAtTime(record, timeKey) {
  if (record[F.HORDE] !== 5) return null;
  const fields = timeFields(timeKey);
  const candidates = candidatesFor(record[F.REGION], record[F.LOC], record[F.TERRAIN], record[F.SEASON]);
  const groups = cachedPartition(record[F.REGION], record[F.LOC], record[F.TERRAIN], record[F.SEASON], 5, timeKey);
  const source = {
    sourceId: record[F.ID],
    sourceLevel: record[F.LEVEL],
    sourceHorde: record[F.HORDE],
    terrain: record[F.TERRAIN],
  };
  const src = findSourceRecord(candidates, source);
  const members = groups ? (groups.find((g) => (src ? g.indexOf(src) !== -1 : true)) || groups[0]) : null;
  const group = candidates.filter((r) =>
    r[fields.active] &&
    r[F.HORDE] === 5 &&
    (!members || members.indexOf(r) !== -1));
  const yields = group.map((c) => expInfo(c[F.ID], c[F.LEVEL], 5)).filter(Boolean);
  if (!yields.length) return null;
  return {
    count: yields.length,
    expMin: yields.reduce((t, y) => t + y.min, 0),
    expMax: yields.reduce((t, y) => t + y.max, 0),
  };
}
// 取该记录所有活跃时段中平均经验最高的一档
function bestTimeMixed(record) {
  let best = null;
  TIME_KEYS.forEach((t) => {
    if (!active(record[t[2]])) return;
    const mixed = mixedYieldAtTime(record, t[1]);
    if (!mixed || !mixed.count) return;
    const score = (mixed.expMin / mixed.count + mixed.expMax / mixed.count) / 2;
    if (!best || score > best.score) {
      best = { mixed, score, timeLabel: t[0] };
    }
  });
  return best;
}
function experienceScore(record, single) {
  const info = expInfo(record[F.ID], record[F.LEVEL], 5);
  if (!info) return -1;
  if (single) return (info.min + info.max) / 2;
  const best = bestTimeMixed(record);
  return best ? best.score : -1;
}

// ---------- 群怪槽位（完整混群） ----------
function findSourceRecord(records, source) {
  if (!source || source.sourceId == null) return null;
  return records.find((r) =>
    r[F.ID] === source.sourceId &&
    r[F.HORDE] === source.sourceHorde &&
    (!source.sourceLevel || r[F.LEVEL] === source.sourceLevel)
  ) || null;
}
// 只对群怪记录按档位拆分组合（5群怪与3群怪分开），普通遭遇不参与分组
function buildHordeGroups(members, rateField) {
  const result = [];
  for (const h of [5, 3]) {
    const groupList = partitionHordeGroups(members.filter((r) => r[F.HORDE] === h), rateField);
    if (groupList) result.push(...groupList);
  }
  return result.length >= 2 ? result : null;
}
// 混群分组结果按地点/季节/时段缓存：分组只依赖候选集合与该时段活跃 flag，
// 同一地点同季节的多条记录共享同一分组，避免每条记录重复做指数级组合搜索
const partitionCache = new Map();
function cachedPartition(region, loc, terrain, season, hordeType, timeKey) {
  const key = [region, loc, terrain, season, hordeType, timeKey].join('\u0000');
  if (partitionCache.has(key)) return partitionCache.get(key);
  const fields = timeFields(timeKey);
  const candidates = candidatesFor(region, loc, terrain, season);
  const act = candidates.filter((r) => r[F.HORDE] === hordeType && r[fields.active]);
  const groups = partitionHordeGroups(act, fields.rate);
  partitionCache.set(key, groups);
  return groups;
}
// 同一档位可能包含多组混群（如不归之穴把多层“未知区域”合并成一个地点名），
// 按概率合计≈5% 拆分；拆不出完整组合时返回 null。
function partitionHordeGroups(members, rateField) {
  if (!members || members.length < 2) return null;
  if (members.length > 14) return null; // 成员过多时组合搜索会指数级爆炸，按单组展示
  const scored = members.map((m) => ({ m, rate: numericRate(m[rateField]) }));
  if (scored.some((x) => x.rate == null)) return null;
  scored.sort((a, b) => b.rate - a.rate);
  function search(remaining) {
    if (!remaining.length) return [];
    const first = remaining[0];
    const others = remaining.slice(1);
    const combos = [];
    for (let mask = 0; mask < (1 << others.length); mask++) {
      let sum = first.rate;
      const combo = [first];
      let bits = 0;
      for (let i = 0; i < others.length; i++) {
        if (mask & (1 << i)) { sum += others[i].rate; combo.push(others[i]); bits++; }
      }
      if (bits > 4) continue;
      if (Math.abs(sum - 5) < 0.001) combos.push(combo);
    }
    combos.push([first]);
    for (const combo of combos) {
      const used = new Set(combo);
      const rest = remaining.filter((x) => !used.has(x));
      const result = search(rest);
      if (result) return [combo].concat(result);
    }
    return null;
  }
  const result = search(scored);
  if (!result) return null;
  const clean = result.every((group) => {
    const total = group.reduce((sum, x) => sum + x.rate, 0);
    return Math.abs(total - 5) < 0.001;
  });
  if (!clean || result.length < 2) return null;
  return result.map((group) => group.map((x) => x.m));
}

// 游戏内同一地点名可能合并了多个区域，产生完全相同的记录（如罗斯山隧道冬季的几何雪花）。
// 列表与详情展示时只保留一条，避免重复行；混群分组与收益计算仍使用全部记录。
function dedupeExactRecords(records) {
  const seen = new Set();
  return records.filter((r) => {
    const sig = [
      r[F.ID], r[F.LOC], r[F.TERRAIN], r[F.LEVEL], r[F.SEASON], r[F.HORDE],
      r[F.MORNING], r[F.DAY], r[F.NIGHT],
      r[F.R_MORNING], r[F.R_DAY], r[F.R_NIGHT], r[F.FORM],
    ].join('\u0000');
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

// ---------- 进化链 ----------
let meta = {};
function buildMeta(records) {
  meta = {};
  records.forEach((r) => {
    const id = r[F.ID];
    if (!meta[id]) meta[id] = { name: r[F.BASE], types: r[F.TYPES].filter(Boolean) };
  });
}
function familyForQuery(query, records) {
  const q = query.trim().toLowerCase();
  if (!q) return new Set();
  const ids = new Set();
  records.forEach((row) => {
    if (row[F.BASE].toLowerCase().includes(q) || row[F.NAME].toLowerCase().includes(q)) ids.add(row[F.ID]);
  });
  const result = new Set();
  ids.forEach((id) => {
    const family = packed.families[packed.familyIndex[String(id)]] || [id];
    family.forEach((value) => result.add(value));
  });
  return result;
}
function matchedIdsForQuery(query) {
  const q = query.trim().toLowerCase();
  const ids = new Set();
  if (!q) return ids;
  Object.keys(meta).forEach((id) => {
    const info = meta[id];
    if (info.name.toLowerCase().includes(q)) ids.add(Number(id));
  });
  return ids;
}
function evoTree(chainIds, matched) {
  const edges = (packed.evolution || []).filter((e) => chainIds.has(e[0]) && chainIds.has(e[1]));
  const hasParent = new Set(edges.map((e) => e[1]));
  const roots = [...chainIds].filter((id) => !hasParent.has(id)).sort((a, b) => a - b);
  const nodes = [];
  const walk = (id, depth, method) => {
    const info = meta[id] || { name: String(id), types: [] };
    nodes.push({
      key: 'evo-' + id,
      id,
      name: info.name,
      types: info.types.map((t) => ({ name: t, color: TYPE_COLORS[t] || '#607d8b' })),
      tier: tierOf(id),
      depth,
      method,
      highlight: matched.has(id),
      image: spritePath(id),
    });
    edges.filter((e) => e[0] === id).sort((a, b) => a[1] - b[1]).forEach((e) => walk(e[1], depth + 1, e[2]));
  };
  roots.forEach((r) => walk(r, 0, ''));
  return nodes;
}

function spritePath(id) { return '/assets/monstericons/' + id + '-0.png'; }
function timeFields(timeKey) {
  if (timeKey === 'morning') return { active: F.MORNING, rate: F.R_MORNING };
  if (timeKey === 'day') return { active: F.DAY, rate: F.R_DAY };
  return { active: F.NIGHT, rate: F.R_NIGHT };
}

function makeView(record, english) {
  const info = expInfo(record[F.ID], record[F.LEVEL], 5);
  const tier = tierOf(record[F.ID]);
  const timeItems = TIME_KEYS.map((x) => ({
    label: x[0],
    key: x[1],
    enabled: active(record[x[2]]),
    text: active(record[x[2]]) ? x[0] + ' ' + (record[x[3]] || '可遇') : x[0] + ' --',
    rate: record[x[3]] || null,
  }));
  const yieldView = record[F.HORDE] === 5 && info ? buildYieldView(record, info) : null;
  return {
    key: record[F.ID] + '-' + record[F.LOC] + '-' + record[F.SEASON] + '-' + record[F.LEVEL],
    id: record[F.ID],
    form: record[F.FORM] || 0,
    name: record[F.BASE],
    fullName: record[F.NAME],
    types: record[F.TYPES].filter(Boolean).map((t) => ({ name: t, color: TYPE_COLORS[t] || '#607d8b' })),
    region: record[F.REGION],
    location: displayLocation(record[F.LOC], english),
    originalLocation: record[F.LOC],
    terrain: record[F.TERRAIN],
    level: record[F.LEVEL],
    season: record[F.SEASON],
    horde: record[F.HORDE],
    hordeText: record[F.HORDE] ? record[F.HORDE] + '群怪' : '普通',
    tier,
    timeItems,
    image: spritePath(record[F.ID]),
    exp: info ? formatRange(info.min, info.max) : '',
    ev: info ? evText(info.ev) : '',
    heldItems: info && info.items.length ? info.items.join(' / ') : '',
    selfHarm: selfHarmMoves(record[F.ID], record[F.LEVEL]).join('、'),
    yieldView,
    count: 0,
  };
}
function buildYieldView(record, info) {
  const best = bestTimeMixed(record);
  const mixed = best ? best.mixed : null;
  const cnt = mixed && mixed.count ? mixed.count : 1;
  const avgText = mixed
    ? formatRange(mixed.expMin / cnt, mixed.expMax / cnt)
    : formatRange(info.min, info.max);
  return {
    timeLabel: best ? best.timeLabel : '',
    avgLabel: mixed && mixed.count > 1 ? '平均经验（' + mixed.count + '种）' : '平均经验',
    expText: formatRange(info.min, info.max),
    avgText,
    evText: evText(info.ev),
    evOneText: evText(info.evOne),
    growth: info.growth || '未知',
    items: info.items.length ? info.items : [],
    itemsText: info.items.length ? info.items.join(' / ') : '',
    baseExp: info.base,
    levelMin: info.levels.min,
    levelMax: info.levels.max,
  };
}
function compareExperience(a, b, direction, single) {
  const sa = experienceScore(a, single);
  const sb = experienceScore(b, single);
  if (sb !== sa) return direction === 'desc' ? sb - sa : sa - sb;
  const nameDifference = a[F.BASE].localeCompare(b[F.BASE], 'zh-CN');
  if (nameDifference !== 0) return nameDifference;
  return (a[F.REGION] + a[F.LOC]).localeCompare(b[F.REGION] + b[F.LOC], 'zh-CN');
}

// 点位闪战分数序列：混群点取组内所有成员分级分数（降序），逐位比较决定排序，
// 高分精灵越多越靠前，序列相同时成员更多者靠前；非混群点只有自身一档分数
function tierSortScore(record) {
  const own = tierOf(record[F.ID]);
  const ownScore = own ? own.score : -1;
  if (record[F.HORDE] !== 5) return { scores: [ownScore] };
  const key = record[F.REGION] + '\u0000' + record[F.LOC] + '\u0000' + record[F.TERRAIN];
  const members = (locationIndex.get(key) || []).filter((m) =>
    m[F.HORDE] === 5 &&
    (m[F.SEASON] === '任意' || record[F.SEASON] === '任意' || m[F.SEASON] === record[F.SEASON]));
  if (!members.length) return { scores: [ownScore] };
  const scores = members.map((m) => {
    const t = tierOf(m[F.ID]);
    return t ? t.score : -1;
  });
  scores.sort((a, b) => b - a);
  return { scores };
}
function compareTierScores(a, b) {
  const sa = a.scores;
  const sb = b.scores;
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    const va = i < sa.length ? sa[i] : -Infinity;
    const vb = i < sb.length ? sb[i] : -Infinity;
    if (va !== vb) return vb - va;
  }
  return 0;
}
function compareTier(a, b) {
  const cmp = compareTierScores(tierSortScore(a), tierSortScore(b));
  if (cmp !== 0) return cmp;
  return (a[F.REGION] + a[F.LOC]).localeCompare(b[F.REGION] + b[F.LOC], 'zh-CN');
}

// 纯点 / 季节限定 / 群怪四季
function matchesPurePoint(record, time) {
  if (!horde(record)) return false;
  if (time === 'morning') return record[F.MORNING] && five(record[F.R_MORNING]);
  if (time === 'day') return record[F.DAY] && five(record[F.R_DAY]);
  if (time === 'night') return record[F.NIGHT] && five(record[F.R_NIGHT]);
  return (record[F.MORNING] && five(record[F.R_MORNING])) ||
         (record[F.DAY] && five(record[F.R_DAY])) ||
         (record[F.NIGHT] && five(record[F.R_NIGHT]));
}
function matchesAllTimeFive(record) {
  return record[F.HORDE] === 5 && record[F.MORNING] && five(record[F.R_MORNING]) &&
    record[F.DAY] && five(record[F.R_DAY]) && record[F.NIGHT] && five(record[F.R_NIGHT]);
}

const P = Page({
  data: {
    loading: true,
    nameInput: '',
    itemInput: '',
    regions: ['全部地区'],
    regionIndex: 0,
    seasons: SEASON_LABELS,
    seasonIndex: 0,
    times: TIME_LABELS,
    timeIndex: 0,
    hordes: HORDE_LABELS,
    hordeIndex: 0,
    evYields: EV_LABEL_LIST,
    evIndex: 0,
    expSorts: EXP_LABEL_LIST,
    expIndex: 0,
    locationLanguages: ['中文', 'English'],
    locationLanguageIndex: 0,
    tiers: TIER_LABELS,
    tierIndex: 0,
    purePoint: false,
    allTimeFive: false,
    allSeasonHorde: false,
    evoChain: false,
    dedupe: true,
    totalCount: 0,
    filteredCount: 0,
    page: 1,
    hasMore: false,
    visibleRecords: [],
    evoNodes: [],
    evoHint: '',
    showDetail: false,
    selected: null,
    detailSummary: null,
    detailRecords: [],
    detailPage: 1,
    detailTotal: 0,
    detailMaxPage: 1,
    showLocation: false,
    locationTitle: '',
    locationSubtitle: '',
    locationTimeIndex: 0,
    locationTimeOptions: [],
    locationHordeFilters: [],
    locationHordeIndex: 0,
    locationRecords: [],
    locationGroupsData: [],
    locationEmpty: false,
  },

  onLoad() {
    const saved = wx.getStorageSync('pokemmo-native-filters') || {};
    this.records = unpackRecords();
    initTiers();
    buildMeta(this.records);
    buildIndexes(this.records);
    buildHeldItems();

    const regionsSet = new Set();
    this.records.forEach((r) => regionsSet.add(r[F.REGION]));
    const regions = ['全部地区', ...[...regionsSet].sort((a, b) => a.localeCompare(b, 'zh-CN'))];

    this.setData({
      loading: false,
      totalCount: this.records.length,
      regions,
      ...saved,
      dedupe: true,
      regionIndex: Math.min(saved.regionIndex || 0, regions.length - 1),
      seasonIndex: Math.min(saved.seasonIndex || 0, SEASON_LABELS.length - 1),
      timeIndex: Math.min(saved.timeIndex || 0, TIME_LABELS.length - 1),
      hordeIndex: Math.min(saved.hordeIndex || 0, HORDE_LABELS.length - 1),
      evIndex: Math.min(saved.evIndex || 0, EV_LABEL_LIST.length - 1),
      expIndex: Math.min(saved.expIndex || 0, EXP_LABEL_LIST.length - 1),
      tierIndex: Math.min(saved.tierIndex || 0, TIER_LABELS.length - 1),
    }, () => this.applyFilters());
  },

  onNameInput(e) { this.setData({ nameInput: e.detail.value }, () => this.applyFilters()); },
  onItemInput(e) { this.setData({ itemInput: e.detail.value }, () => this.applyFilters()); },
  onPickerChange(e) {
    const field = e.currentTarget.dataset.field;
    const index = Number(e.detail.value);
    const map = {
      region: 'regionIndex',
      season: 'seasonIndex',
      time: 'timeIndex',
      horde: 'hordeIndex',
      ev: 'evIndex',
      exp: 'expIndex',
      tier: 'tierIndex',
    };
    const key = map[field];
    if (!key) return;
    const patch = { [key]: index };
    if (key === 'evIndex' || key === 'expIndex') {
      if (index > 0) patch.hordeIndex = HORDE_LABELS.indexOf('5群怪');
    }
    if (key === 'hordeIndex' && index !== HORDE_LABELS.indexOf('5群怪')) {
      patch.evIndex = 0;
      patch.expIndex = 0;
    }
    this.setData(patch, () => this.applyFilters());
  },
  onLanguageToggle(e) { this.setData({ locationLanguageIndex: e.detail.value ? 1 : 0 }, () => this.applyFilters()); },
  onToggle(e) {
    const field = e.currentTarget.dataset.field;
    const patch = { [field]: e.detail.value };
    if ((field === 'allTimeFive' || field === 'allSeasonHorde') && e.detail.value) {
      patch.hordeIndex = HORDE_LABELS.indexOf('5群怪');
    }
    this.setData(patch, () => this.applyFilters());
  },

  applyFilters() {
    const { nameInput, regionIndex, seasonIndex, timeIndex, hordeIndex, evIndex, expIndex, locationLanguageIndex, tierIndex } = this.data;
    const itemQ = this.data.itemInput.trim().toLowerCase();
    const region = this.data.regions[regionIndex];
    const seasonValue = SEASON_VALUES[seasonIndex];
    const exclusiveSeason = seasonValue.startsWith('only:') ? seasonValue.slice(5) : '';
    const allHordeSeasons = seasonValue === 'horde:all';
    const season = exclusiveSeason || allHordeSeasons ? '' : seasonValue;
    const time = TIME_VALUES[timeIndex];
    let hordeFilter = HORDE_LABELS[hordeIndex] === '5群怪' ? 5 : HORDE_LABELS[hordeIndex] === '3群怪' ? 3 : HORDE_LABELS[hordeIndex] === '普通（非群怪）' ? 0 : '';
    if ((this.data.allTimeFive || this.data.allSeasonHorde) && hordeFilter !== 5) hordeFilter = 5;
    const evName = EV_LABEL_LIST[evIndex];
    const expSort = EXP_LABEL_LIST[expIndex] === '默认顺序' ? '' : EXP_LABEL_LIST[expIndex] === '经验从高到低' ? 'desc' : 'asc';
    const tier = tierIndex > 0 ? TIER_LIST[tierIndex - 1] : '';
    const english = locationLanguageIndex === 1;

    const seasonsById = new Map();
    const hordeSeasonsByLocation = new Map();
    const seasonLocationKey = (r) => [r[F.ID], r[F.REGION], r[F.LOC], r[F.TERRAIN]].join('|');
    this.records.forEach((r) => {
      if (!horde(r)) return;
      if (!seasonsById.has(r[F.ID])) seasonsById.set(r[F.ID], new Set());
      seasonsById.get(r[F.ID]).add(r[F.SEASON]);
      if (matchesAllTimeFive(r)) {
        const k = seasonLocationKey(r);
        if (!hordeSeasonsByLocation.has(k)) hordeSeasonsByLocation.set(k, new Set());
        hordeSeasonsByLocation.get(k).add(r[F.SEASON]);
      }
    });
    const appearsOnlyInSeason = (id, s) => {
      const set = seasonsById.get(id);
      return Boolean(set && set.size === 1 && set.has(s));
    };
    const appearsInAllHordeSeasons = (id) => {
      const set = seasonsById.get(id);
      return Boolean(set && (set.has('任意') || SEASONS.every((s) => set.has(s))));
    };
    const appearsInAllHordeSeasonsAtLocation = (r) => {
      if (!matchesAllTimeFive(r)) return false;
      const set = hordeSeasonsByLocation.get(seasonLocationKey(r));
      return Boolean(set && (set.has('任意') || SEASONS.every((s) => set.has(s))));
    };

    const nameQ = nameInput.trim().toLowerCase();
    const chain = this.data.evoChain && nameQ ? familyForQuery(nameInput.trim(), this.records) : null;
    let filtered = this.records.filter((r) => {
      if (nameQ) {
        let match;
        if (chain && chain.size > 1) {
          match = chain.has(r[F.ID]);
        } else {
          match = r[F.NAME].toLowerCase().includes(nameQ) || r[F.BASE].toLowerCase().includes(nameQ);
        }
        if (!match) return false;
      }
      if (itemQ) {
        const held = heldItemsById[String(r[F.ID])] || [];
        if (!held.some((n) => n.toLowerCase().includes(itemQ))) return false;
      }
      if (region !== '全部地区' && r[F.REGION] !== region) return false;
      if (season && r[F.SEASON] !== season && r[F.SEASON] !== '任意') return false;
      if (exclusiveSeason && (!horde(r) || !appearsOnlyInSeason(r[F.ID], exclusiveSeason))) return false;
      if (allHordeSeasons && (!horde(r) || !appearsInAllHordeSeasons(r[F.ID]))) return false;
      if (time === 'morning' && !r[F.MORNING]) return false;
      if (time === 'day' && !r[F.DAY]) return false;
      if (time === 'night' && !r[F.NIGHT]) return false;
      if (hordeFilter !== '' && r[F.HORDE] !== hordeFilter) return false;
      if ((evIndex > 0 || expIndex > 0) && r[F.HORDE] !== 5) return false;
      if (evIndex > 0 && !hasEv(r[F.ID], evName)) return false;
      if (this.data.purePoint && !matchesPurePoint(r, time)) return false;
      if (this.data.allTimeFive && !matchesAllTimeFive(r)) return false;
      if (this.data.allSeasonHorde && !appearsInAllHordeSeasonsAtLocation(r)) return false;
      if (tier) {
        const t = tierOf(r[F.ID]);
        if (!t || t.text !== tier) return false;
      }
      return true;
    });

    if (expSort) {
      // 先一次性算好每条记录的经验分，避免 sort 比较器里反复重算（混群收益较昂贵）
      const scored = filtered.map((r) => ({ r, score: experienceScore(r, this.data.purePoint) }));
      scored.sort((a, b) => {
        if (b.score !== a.score) return expSort === 'desc' ? b.score - a.score : a.score - b.score;
        const nameDifference = a.r[F.BASE].localeCompare(b.r[F.BASE], 'zh-CN');
        if (nameDifference !== 0) return nameDifference;
        return (a.r[F.REGION] + a.r[F.LOC]).localeCompare(b.r[F.REGION] + b.r[F.LOC], 'zh-CN');
      });
      filtered = scored.map((x) => x.r);
    }

    filtered = dedupeExactRecords(filtered);
    this.currentFiltered = filtered;
    let display;
    if (this.data.dedupe) {
      const map = new Map();
      filtered.forEach((r) => {
        if (!map.has(r[F.ID])) map.set(r[F.ID], []);
        map.get(r[F.ID]).push(r);
      });
      display = [...map.entries()].map(([id, list]) => {
        // 未选经验排序时，卡片展示该精灵按闪战分级逐位比较的最高分点位
        if (!expSort && list.length > 1) {
          list = list.slice().sort(compareTier);
        }
        return { id, rep: list[0], count: list.length, records: list };
      });
    } else {
      display = filtered.map((r) => ({ id: r[F.ID], rep: r, count: 0 }));
    }
    this.displayed = display;

    const views = display.slice(0, PAGE_SIZE).map((item) => {
      const view = makeView(item.rep, english);
      view.count = item.count;
      if (itemQ) {
        const matched = matchedHeldItems(item.rep[F.ID], itemQ);
        view.matchedItems = matched.length ? matched.join(' / ') : '';
      }
      return view;
    });
    let evoNodes = [];
    let evoHint = '含整条进化链分布';
    if (this.data.evoChain && nameInput.trim()) {
      const matched = matchedIdsForQuery(nameInput.trim());
      if (matched.size) {
        evoNodes = evoTree(chain, matched);
        evoHint = evoNodes.length > 1 ? '已展开进化链' : '无进化链，按名称搜索';
      }
    }

    this.setData({
      filteredCount: this.data.dedupe ? `${display.length} 种（${filtered.length} 条分布）` : filtered.length,
      page: 1,
      visibleRecords: views,
      hasMore: display.length > PAGE_SIZE,
      evoNodes,
      evoHint,
    });

    wx.setStorageSync('pokemmo-native-filters', {
      nameInput: this.data.nameInput,
      itemInput: this.data.itemInput,
      regionIndex: this.data.regionIndex,
      seasonIndex: this.data.seasonIndex,
      timeIndex: this.data.timeIndex,
      hordeIndex: this.data.hordeIndex,
      evIndex: this.data.evIndex,
      expIndex: this.data.expIndex,
      locationLanguageIndex: this.data.locationLanguageIndex,
      tierIndex: this.data.tierIndex,
      purePoint: this.data.purePoint,
      allTimeFive: this.data.allTimeFive,
      allSeasonHorde: this.data.allSeasonHorde,
      evoChain: this.data.evoChain,
      dedupe: this.data.dedupe,
    });
  },

  loadMore() {
    if (!this.displayed || !this.data.hasMore) return;
    const page = this.data.page + 1;
    const english = this.data.locationLanguageIndex === 1;
    const itemQ = this.data.itemInput.trim().toLowerCase();
    const list = this.displayed.slice(0, page * PAGE_SIZE).map((item) => {
      const view = makeView(item.rep, english);
      view.count = item.count;
      if (itemQ) {
        const matched = matchedHeldItems(item.rep[F.ID], itemQ);
        view.matchedItems = matched.length ? matched.join(' / ') : '';
      }
      return view;
    });
    this.setData({ page, visibleRecords: list, hasMore: list.length < this.displayed.length });
  },

  resetFilters() {
    wx.removeStorageSync('pokemmo-native-filters');
    this.setData({
      nameInput: '',
      itemInput: '',
      regionIndex: 0,
      seasonIndex: 0,
      timeIndex: 0,
      hordeIndex: 0,
      evIndex: 0,
      expIndex: 0,
      locationLanguageIndex: 0,
      tierIndex: 0,
      purePoint: false,
      allTimeFive: false,
      allSeasonHorde: false,
      evoChain: false,
      dedupe: true,
    }, () => this.applyFilters());
  },

  openDetail(e) {
    const item = this.data.visibleRecords[Number(e.currentTarget.dataset.index)];
    if (!item) return;
    let related = (this.currentFiltered || this.records).filter((r) => r[F.ID] === item.id);
    related = dedupeExactRecords(related);
    const expIndex = this.data.expIndex;
    if (expIndex > 0) {
      const direction = EXP_LABEL_LIST[expIndex] === '经验从高到低' ? 'desc' : 'asc';
      related.sort((a, b) => compareExperience(a, b, direction, this.data.purePoint));
    } else {
      related.sort(compareTier);
    }
    const english = this.data.locationLanguageIndex === 1;
    const views = related.map((r) => makeView(r, english));
    const h3 = related.filter((r) => r[F.HORDE] === 3).length;
    const h5 = related.filter((r) => r[F.HORDE] === 5).length;
    const normal = related.filter((r) => r[F.HORDE] === 0).length;
    this._detailAll = views;
    this.setData({
      showDetail: true,
      selected: item,
      detailSummary: { total: related.length, normal, h3, h5 },
      detailRecords: views.slice(0, 10),
      detailTotal: related.length,
      detailMaxPage: Math.max(1, Math.ceil(related.length / 10)),
      detailPage: 1,
    });
  },
  detailPrev() {
    if (this.data.detailPage <= 1) return;
    const p = this.data.detailPage - 1;
    this.setData({ detailPage: p, detailRecords: this._detailAll.slice((p - 1) * 10, p * 10) });
  },
  detailNext() {
    if (this.data.detailPage >= this.data.detailMaxPage) return;
    const p = this.data.detailPage + 1;
    this.setData({ detailPage: p, detailRecords: this._detailAll.slice((p - 1) * 10, p * 10) });
  },
  closeDetail() {
    this._detailAll = [];
    this.setData({ showDetail: false, selected: null, detailRecords: [], detailPage: 1, detailTotal: 0 });
  },

  openLocation(e) {
    const item = this.data.visibleRecords[Number(e.currentTarget.dataset.card)];
    if (!item) return;
    this.openLocationPopup(item, e.currentTarget.dataset.time);
  },
  openDetailLocation(e) {
    const item = this.data.detailRecords[Number(e.currentTarget.dataset.idx)];
    if (!item) return;
    this.openLocationPopup(item, e.currentTarget.dataset.time);
  },
  openLocationPopup(source, timeKey) {
    if (!source || !timeKey) return;
    this._locState = {
      region: source.region,
      loc: source.originalLocation,
      terrain: source.terrain,
      season: source.season,
      sourceId: source.id,
      sourceLevel: source.level,
      sourceHorde: source.horde === 3 || source.horde === 5 ? source.horde : null,
      filterMode: this.data.purePoint ? 'purePoint' : '',
      hordeFilter: source.horde === 3 || source.horde === 5 ? String(source.horde) : '',
      timeKey,
    };
    // 默认筛选：有 5 群怪则选 5 群怪，否则有 3 群怪选 3 群怪，都没有才显示全部
    const candidates = this.locationCandidates();
    const fields = timeFields(timeKey);
    const active = candidates.filter((r) => r[fields.active]);
    const hordeCounts = { 3: 0, 5: 0 };
    active.forEach((r) => { if (hordeCounts[r[F.HORDE]] != null) hordeCounts[r[F.HORDE]]++; });
    const defaultHordeFilter = hordeCounts[5] > 0 ? '5' : hordeCounts[3] > 0 ? '3' : '';
    this.renderLocation(timeKey, defaultHordeFilter);
  },
  locationCandidates() {
    const s = this._locState;
    if (!s) return [];
    return candidatesFor(s.region, s.loc, s.terrain, s.season);
  },
  locationTimeAvailable(timeKey) {
    const s = this._locState;
    if (!s) return false;
    const candidates = this.locationCandidates();
    const fields = timeFields(timeKey);
    // 无论是否纯点模式，只要该时段有遭遇即可切换
    return candidates.some((r) => r[fields.active]);
  },
  renderLocation(timeKey, hordeFilter) {
    const s = this._locState;
    if (!s) return;
    s.timeKey = timeKey;
    s.hordeFilter = hordeFilter;
    const candidates = this.locationCandidates();
    const fields = timeFields(timeKey);
    // 展示该地点当前时段全部遭遇；多组混群时按概率合计≈5%拆分并标注
    const all = candidates.filter((r) => r[fields.active]);
    const counts = { 0: 0, 3: 0, 5: 0 };
    all.forEach((r) => { if (counts[r[F.HORDE]] != null) counts[r[F.HORDE]]++; });
    const filtered = hordeFilter === '' ? all : all.filter((r) => String(r[F.HORDE]) === hordeFilter);
    const english = this.data.locationLanguageIndex === 1;
    const views = filtered.map((r) => {
      const view = makeView(r, english);
      const ti = view.timeItems.find((t) => t.key === timeKey);
      view.rateText = ti ? (ti.rate || '') : '';
      if (r[F.HORDE] === 5) {
        const info = expInfo(r[F.ID], r[F.LEVEL], 5);
        const mixed = mixedYieldAtTime(r, timeKey);
        if (info) {
          view.locYield = {
            expText: formatRange(info.min, info.max),
            avgText: mixed
              ? formatRange(mixed.expMin / mixed.count, mixed.expMax / mixed.count)
              : formatRange(info.min, info.max),
            avgLabel: mixed && mixed.count > 1 ? '平均（' + mixed.count + '种）' : '平均',
            evText: evText(info.ev),
          };
        }
      }
      return view;
    });
    const groups = buildHordeGroups(filtered, fields.rate);
    let locationGroupsData = [];
    if (groups && groups.length > 1) {
      const viewOf = new Map();
      filtered.forEach((r, i) => viewOf.set(r, views[i]));
      locationGroupsData = groups.map((group, gi) => ({
        label: GROUP_LABELS[gi % GROUP_LABELS.length],
        color: GROUP_COLORS[gi % GROUP_COLORS.length],
        records: group.map((r) => {
          const v = viewOf.get(r);
          if (v) v.groupIndex = gi;
          return v;
        }).filter(Boolean),
      }));
    }
    const timeLabels = { morning: '早晨', day: '白天', night: '夜晚' };
    this.setData({
      showLocation: true,
      locationTitle: s.region + ' · ' + displayLocation(s.loc, english),
      locationSubtitle: s.terrain + ' · ' + (s.season === '任意' ? '全季节' : s.season + '季') + ' · ' + timeLabels[timeKey],
      locationUnknownArea: String(s.loc).indexOf('???') !== -1,
      locationTimeIndex: ['morning', 'day', 'night'].indexOf(timeKey),
      locationTimeOptions: ['morning', 'day', 'night'].map((tk) => ({ key: tk, label: timeLabels[tk], available: this.locationTimeAvailable(tk) })),
      locationHordeFilters: [
        { key: '', label: '全部', count: all.length },
        { key: '0', label: '普通', count: counts[0] },
        { key: '3', label: '3群怪', count: counts[3] },
        { key: '5', label: '5群怪', count: counts[5] },
      ],
      locationHordeIndex: hordeFilter === '' ? 0 : hordeFilter === '0' ? 1 : hordeFilter === '3' ? 2 : 3,
      locationRecords: views,
      locationGroupsData,
      locationEmpty: !views.length,
    });
  },
  switchLocationTime(e) {
    const timeKey = e.currentTarget.dataset.time;
    if (!this._locState || timeKey === this._locState.timeKey) return;
    this.renderLocation(timeKey, this._locState.hordeFilter || '');
  },
  onLocationHorde(e) {
    const index = Number(e.detail.value);
    const keys = ['', '0', '3', '5'];
    this.renderLocation(this._locState.timeKey, keys[index]);
  },
  onLocationHordeChip(e) {
    const key = e.currentTarget.dataset.horde;
    if (!this._locState || key === (this._locState.hordeFilter || '')) return;
    this.renderLocation(this._locState.timeKey, key);
  },
  closeLocation() {
    this._locState = null;
    this.setData({ showLocation: false, locationRecords: [], locationGroupsData: [], locationTimeOptions: [], locationHordeFilters: [] });
  },
  noop() {},
  onImgError() {},
});
