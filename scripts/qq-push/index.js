'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.json');
const SEEN_PATH = path.join(ROOT, 'seen.json');
const PENDING_PATH = path.join(ROOT, 'pending.json');
const BOSS_LAST_PATH = path.join(ROOT, 'boss-last.json');
// 关注名单：QQ 群只报这些精灵的明雷，其它精灵一律不报点（名单随仓库走，Actions 上也能读到）
const WATCHLIST_PATH = path.join(ROOT, 'watchlist.json');
const DATA_FILE = path.join(ROOT, '..', '..', 'web', 'search-data.js');
const TOKEN_URL = 'https://api.bot.qq.com/app/getAppAccessToken';
const REGION_NAMES = {
  Kanto: '关都',
  Johto: '城都',
  Hoenn: '丰缘',
  Sinnoh: '神奥',
  Unova: '合众',
};

const args = process.argv.slice(2);
const config = loadJson(CONFIG_PATH, {});
const wechatWebhook = process.env.WECHAT_WEBHOOK || config.wechatWebhook || '';
// Qmsg 酱（免费第三方 QQ 群推送）：配了 key + 群号就额外推一份到 QQ 群。
// 它是别人的机器人替我们发，所以不占 QQ 官方机器人的「主动消息」额度、也不需要上架/IP 白名单。
const qmsgKey = process.env.QMSG_KEY || config.qmsgKey || '';
const qmsgGroup = process.env.QMSG_GROUP || config.qmsgGroup || '';
const channel = wechatWebhook ? 'wechat' : 'qq';

const API_BASE = config.sandbox
  ? 'https://sandbox.api.sgroup.qq.com'
  : 'https://api.sgroup.qq.com';
const WS_URL = config.sandbox
  ? 'wss://sandbox.api.sgroup.qq.com/websocket'
  : 'wss://api.sgroup.qq.com/websocket';

let tokenCache = { token: null, expiresAt: 0 };
let lastSeq = null;
let ws = null;
let heartbeatTimer = null;
let heartbeatInterval = 30000;
let reconnectDelay = 1000;
let stopping = false;
let nameById = new Map();
let seen = new Set(loadJson(SEEN_PATH, {}).ids || []);
let pending = loadJson(PENDING_PATH, []);

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function saveSeen() {
  // 只留最近 500 条：明雷和头目都记在里面，长期积累会把仓库里的 seen.json 撑大
  const ids = Array.from(seen);
  saveJson(SEEN_PATH, { ids: ids.slice(-500) });
}

function savePending() {
  saveJson(PENDING_PATH, pending);
}

function log() {
  console.log(new Date().toLocaleString('zh-CN', { hour12: false }), ...arguments);
}

function fail() {
  console.error(new Date().toLocaleString('zh-CN', { hour12: false }), ...arguments);
}

function loadNames() {
  try {
    const src = fs.readFileSync(DATA_FILE, 'utf8');
    const start = src.indexOf('{');
    const end = src.lastIndexOf(';');
    const data = JSON.parse(src.slice(start, end === -1 ? undefined : end));
    (data.r || []).forEach((record) => {
      if (!nameById.has(record[0])) {
        nameById.set(record[0], {
          name: record[2] || String(record[0]),
          types: record[3] || [],
        });
      }
    });
  } catch (err) {
    fail('加载图鉴数据失败（不影响推送，将显示英文名）：', err.message);
  }
  try {
    const MONSTERS_FILE = path.join(ROOT, '..', '..', 'web', 'data', 'monsters.json');
    const monsters = JSON.parse(fs.readFileSync(MONSTERS_FILE, 'utf8'));
    (Array.isArray(monsters) ? monsters : []).forEach((monster) => {
      if (!monster || monster.id == null || !monster.name) return;
      if (nameById.has(monster.id)) return;
      nameById.set(monster.id, {
        name: String(monster.name).split("'")[0] || String(monster.id),
        types: [],
      });
    });
  } catch (err) {
    fail('加载补充图鉴数据失败（不影响推送，将显示英文名）：', err.message);
  }
  log('已加载本地图鉴数据，共', nameById.size, '种宝可梦');
  buildLocationMap();
}

const LOCATION_DIRECTIONS = {
  East: '东侧',
  West: '西侧',
  North: '北侧',
  South: '南侧',
};

const LOCATION_SUFFIXES = {
  '???': '未知区域',
  'Back Room': '后室',
  Cave: '洞窟',
  Center: '中央区域',
  'Center Area': '中央区',
  'Cold Room': '寒冷房间',
  Depths: '深处',
  'Dining Room': '餐厅',
  East: '东侧',
  'East Area': '东区',
  Entrance: '入口',
  Entryway: '入口通道',
  Forest: '森林',
  Gate: '关卡',
  'Hidden Room': '隐藏房间',
  Inner: '内部',
  Interior: '内部',
  'Lower Interior': '下层内部',
  'Lower Mountainside': '低山腰',
  Mountainside: '山腰',
  North: '北侧',
  'North Area': '北区',
  'North Mountainside': '北侧山腰',
  'Northeast Area': '东北区',
  'Northern Room': '北侧房间',
  'Northwest Area': '西北区',
  'Northwest Room': '西北侧房间',
  Outer: '外围',
  Outside: '外部',
  Rooftop: '屋顶',
  South: '南侧',
  'South Area': '南区',
  'South Mountainside': '南侧山腰',
  'Southeast Area': '东南区',
  'Southern Room': '南侧房间',
  'Southwest Area': '西南区',
  Summit: '山顶',
  Tunnel: '隧道',
  'Upper Interior': '上层内部',
  'Upper Mountainside': '高山腰',
  West: '西侧',
  'West Area': '西区',
};

function normalizeLocationName(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function translateSuffix(suffix) {
  const floor = suffix.match(/^(\d+)F(?: (East|West|North|South))?$/);
  if (floor) {
    return floor[1] + '楼' + (floor[2] ? LOCATION_DIRECTIONS[floor[2]] : '');
  }
  const basement = suffix.match(/^B(\d+)F(?: (East|West|North|South))?$/);
  if (basement) {
    return '地下' + basement[1] + '楼' + (basement[2] ? LOCATION_DIRECTIONS[basement[2]] : '');
  }
  const towerFloor = suffix.match(/^Tower (\d+)F$/);
  if (towerFloor) return '塔' + towerFloor[1] + '楼';
  const numberedArea = suffix.match(/^Area (\d+)$/);
  if (numberedArea) return numberedArea[1] + '区';
  return LOCATION_SUFFIXES[suffix] || null;
}

let locationByEnglish = new Map();

function buildLocationMap() {
  try {
    const src = fs.readFileSync(DATA_FILE, 'utf8');
    const start = src.indexOf('{');
    const end = src.lastIndexOf(';');
    const data = JSON.parse(src.slice(start, end === -1 ? undefined : end));
    (data.r || []).forEach((record) => {
      const raw = record && record[5];
      if (!raw) return;
      const m = String(raw).match(/^([^(]*)\(([^)]*)\)/);
      if (!m) return;
      const zh = m[1].trim();
      const en = normalizeLocationName(m[2]);
      if (en && zh && !locationByEnglish.has(en)) {
        locationByEnglish.set(en, zh);
      }
      // 形如 212号道路(最自豪的后院)(Route 212) (North) 的地点，括号内的道路名也映射到中文主干
      const routeM = String(raw).match(/\((Route \d+)\)/i);
      if (routeM) {
        const rEn = normalizeLocationName(routeM[1]);
        if (rEn && zh && !locationByEnglish.has(rEn)) {
          locationByEnglish.set(rEn, zh);
        }
      }
    });
    log('已加载地点中文名映射，共', locationByEnglish.size, '个地点');
  } catch (err) {
    fail('加载地点映射失败（地点将显示英文）：', err.message);
  }
}

function translateLocation(location) {
  if (!location) return '未知';
  const str = String(location).trim();
  const parts = [];
  let rest = str;
  for (;;) {
    const m = rest.match(/ \(([^()]*)\)$/);
    if (!m) break;
    parts.unshift(m[1]);
    rest = rest.slice(0, m.index);
  }
  const zh = locationByEnglish.get(normalizeLocationName(rest.trim()));
  if (!zh) return str;
  if (!parts.length) return zh;
  const translated = parts.map((p) => translateSuffix(p) || p);
  return zh + '（' + translated.join('，') + '）';
}

function validateConfig() {
  if (wechatWebhook) return true;
  const missing = [];
  if (!config.appId) missing.push('appId（机器人 AppID）');
  if (!config.appSecret) missing.push('appSecret（机器人密钥）');
  if (missing.length) {
    fail('请先在 scripts/qq-push/config.json 中填写推送通道：wechatWebhook（微信机器人 webhook 地址）或 ' + missing.join('、'));
    return false;
  }
  return true;
}

async function getToken(force) {
  const now = Date.now();
  if (!force && tokenCache.token && tokenCache.expiresAt > now + 60000) {
    return tokenCache.token;
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId: config.appId, clientSecret: config.appSecret }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) {
    throw new Error('获取 access_token 失败：' + JSON.stringify(data));
  }
  const expiresIn = Number(data.expires_in) || 7200;
  tokenCache = { token: data.access_token, expiresAt: now + expiresIn * 1000 };
  return data.access_token;
}

async function sendGroupMessage(groupOpenid, content, msgId) {
  if (!groupOpenid) throw new Error('未配置目标群（groupOpenid 为空）');
  const body = { msg_type: 0, content };
  if (msgId) {
    body.msg_id = msgId;
    body.msg_seq = 1;
  }
  const doSend = async (token) => {
    const res = await fetch(
      API_BASE + '/v2/groups/' + encodeURIComponent(groupOpenid) + '/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'QQBot ' + token,
        },
        body: JSON.stringify(body),
      }
    );
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  };

  let result = await doSend(await getToken());
  if (!result.ok && result.status === 401) {
    result = await doSend(await getToken(true));
  }
  if (!result.ok) {
    throw new Error('发送失败 HTTP ' + result.status + ' ' + result.text);
  }
  try {
    return JSON.parse(result.text);
  } catch (err) {
    return {};
  }
}

async function sendQmsg(content) {
  const url = 'https://qmsg.zendee.cn/v3/send/' + encodeURIComponent(qmsgKey);
  // Qmsg 单条上限 1000 字符，超了截断（报点正文远短于它，留个兜底）
  const msg = content.length > 1000 ? content.slice(0, 999) + '…' : content;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ msg, group: String(qmsgGroup) }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) {
    throw new Error('Qmsg 推送失败 HTTP ' + res.status + ' ' + JSON.stringify(data));
  }
  return data;
}

// 附加通道：失败只记日志，不影响主通道的成败（否则整条消息会被塞进 pending 反复重试主通道）
async function sendQmsgSafely(content) {
  if (!qmsgKey || !qmsgGroup) return;
  try {
    await sendQmsg(content);
    log('[qmsg] 已推送到 QQ 群 ' + qmsgGroup);
  } catch (err) {
    log('[qmsg] 推送失败（不影响主通道）：' + (err && err.message));
  }
}

async function sendMessage(content, qqContent) {
  // 两个通道两套内容：微信（主通道）看全量；QQ 群只看关注名单。
  // qqContent 省略时两个通道发同一份；显式传 null / '' 表示这条不发 QQ 群。
  const qqText = qqContent === undefined ? content : qqContent;
  if (channel === 'wechat') {
    if (content) {
      const res = await fetch(wechatWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.errcode !== 0) {
        throw new Error('微信推送失败 HTTP ' + res.status + ' ' + JSON.stringify(data));
      }
      if (qqText) await sendQmsgSafely(qqText);
      return data;
    }
    if (qqText) await sendQmsgSafely(qqText);
    return {};
  }
  // 没有配微信 webhook：官方 QQ 机器人本身就是「QQ 群」，也只报名单内的
  if (!qqText) return {};
  const result = await sendGroupMessage(config.groupOpenid, qqText);
  await sendQmsgSafely(qqText);
  return result;
}

function formatMessage(item, title) {
  const info = nameById.get(item.monsterId) || {};
  const name = info.name || item.pokemon || ('#' + item.monsterId);
  const region = REGION_NAMES[item.region] || item.region || '未知地区';
  const now = Math.floor(Date.now() / 1000);
  const valuable = item.hasValuable ? '（有价值）' : '';
  return [
    (title || '【明雷报点】') + name + ' #' + item.monsterId + valuable,
    '  ' + region + ' · ' + translateLocation(item.location),
    '  剩 ' + remainText(item, now) + '（' + (clockText(item.despawnTimestamp) || '未知') + ' 消失）',
  ].join('\n');
}

const BOSS_SEPARATOR = '\n\n\n';

// 推送模板：按地区分组展示明雷（合众/城都/关都/丰缘/神奥），无则显示暂无
const REGION_ORDER = ['Unova', 'Johto', 'Kanto', 'Hoenn', 'Sinnoh'];

// 地区小标题前缀（纯装饰，QQ / 微信都能正常显示）
const REGION_MARK = '▎';

// 推送头部时间（HH:MM）
function clockHm(date) {
  return (date || new Date()).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Shanghai',
  });
}

// 剩余时间：秒 -> "X分Y秒" / "Y秒"
function remainText(item, now) {
  const remain = Math.max(0, (item.despawnTimestamp || 0) - now);
  const minutes = Math.floor(remain / 60);
  const seconds = remain % 60;
  return minutes > 0 ? minutes + '分' + seconds + '秒' : seconds + '秒';
}

// 剩余时间（长版）：头目一场 4 小时 45 分，"270分0秒" 读起来太别扭
function remainLongText(item, now) {
  const remain = Math.max(0, (item.despawnTimestamp || 0) - now);
  const hours = Math.floor(remain / 3600);
  if (!hours) return remainText(item, now);
  const minutes = Math.floor((remain % 3600) / 60);
  return hours + '小时' + minutes + '分';
}

// 消失时刻（HH:MM:SS）
function clockText(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleTimeString('zh-CN', {
    hour12: false,
    timeZone: 'Asia/Shanghai',
  });
}

// 推送头部：顶部显示 GitHub Actions 运行次数（第 N 次检查）；非 Actions 环境（本地测试）不显示
// 注：现在只在新报点时才发消息，所以这个数字是「检查次数」，不是「发消息次数」
function nextPushHeader() {
  const runNumber = Number(process.env.GITHUB_RUN_NUMBER);
  if (Number.isFinite(runNumber) && runNumber > 0) {
    return '【第' + runNumber + '次检查】';
  }
  return null;
}

// active / lastSeen 由调用方先过滤好；watchOnly 只影响「上次明雷」要不要按名单筛
// （微信通道全量，watchOnly=false；QQ 群只报名单内的，watchOnly=true）
function buildSwarmMessage(active, lastSeen, watchOnly) {
  const now = Math.floor(Date.now() / 1000);
  const onlyWatched = watchOnly !== false;
  const header = nextPushHeader();
  const lines = ['【明雷报点】' + clockHm()];
  if (header) lines.push(header);
  lines.push('');
  const byRegion = {};
  (active || []).forEach((item) => {
    const key = item.region || '未知';
    (byRegion[key] = byRegion[key] || []).push(item);
  });
  const lastByRegion = {};
  (lastSeen || []).forEach((item) => {
    // 只报关注名单时，「上次明雷」也只认名单里的精灵
    if (onlyWatched && !passesWatchlist(item)) return;
    const key = item.region || '未知';
    if (!lastByRegion[key]) lastByRegion[key] = item;
  });
  const regions = REGION_ORDER.concat(
    Object.keys(byRegion).filter((r) => REGION_ORDER.indexOf(r) === -1)
  );
  // 每个地区生成一个「块」，块之间空一行；既没活跃明雷、也没有关注精灵上次明雷的地区合并成一行
  const blocks = [];
  const emptyRegions = [];
  regions.forEach((region) => {
    const zh = REGION_NAMES[region] || region;
    const items = (byRegion[region] || [])
      .slice()
      .sort((a, b) => (a.despawnTimestamp || 0) - (b.despawnTimestamp || 0));
    if (!items.length) {
      // 无活跃明雷：显示该地区上次明雷（精灵名、地点、距离上次出现多久）
      const last = lastByRegion[region];
      if (!last) {
        emptyRegions.push(zh);
        return;
      }
      const info = nameById.get(last.monsterId) || {};
      const name = info.name || last.pokemon || ('#' + last.monsterId);
      const ago = formatAgo(last.secondsAgo);
      blocks.push([
        REGION_MARK +
          zh +
          ' · 无明雷（上次：' +
          name +
          ' #' +
          last.monsterId +
          ' · ' +
          translateLocation(last.location) +
          (ago ? ' · ' + ago + '前' : '') +
          '）',
      ]);
      return;
    }
    const block = [REGION_MARK + zh];
    items.forEach((item) => {
      const info = nameById.get(item.monsterId) || {};
      const name = info.name || item.pokemon || ('#' + item.monsterId);
      const valuable = item.hasValuable ? '（有价值）' : '';
      block.push(name + ' #' + item.monsterId + valuable);
      block.push(
        '  ' +
          translateLocation(item.location) +
          ' · 剩 ' +
          remainText(item, now) +
          '（' +
          (clockText(item.despawnTimestamp) || '未知') +
          ' 消失）'
      );
    });
    blocks.push(block);
  });
  if (emptyRegions.length) {
    blocks.push([REGION_MARK + emptyRegions.join('、') + ' · 无明雷']);
  }
  blocks.forEach((block, idx) => {
    lines.push(...block);
    if (idx < blocks.length - 1) lines.push('');
  });
  return lines.join('\n');
}

// 距今格式化：secondsAgo -> "X小时Y分" / "X分" / "X秒"
function formatAgo(secondsAgo) {
  const s = Number(secondsAgo);
  if (!Number.isFinite(s) || s < 0) return '';
  if (s < 60) return Math.floor(s) + '秒';
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return minutes + '分';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours + '小时' + (mins ? mins + '分' : '');
}

// ---------- 明雷关注名单 ----------
// 顺序：环境变量 SWARM_MONSTER_IDS > config.json 的 monsterIds > watchlist.json（仓库内的正式名单）
let watchlistCache = null;
let watchlistBroken = false;
function watchlist() {
  if (watchlistCache) return watchlistCache;
  const parse = (value) =>
    String(value)
      .split(',')
      .map((v) => Number(String(v).trim()))
      .filter((v) => Number.isFinite(v) && v > 0);
  let ids = [];
  let from = '';
  const envVal = process.env.SWARM_MONSTER_IDS;
  if (envVal && String(envVal).trim()) {
    ids = parse(envVal);
    from = '环境变量 SWARM_MONSTER_IDS';
  } else if (Array.isArray(config.monsterIds) && config.monsterIds.length) {
    ids = parse(config.monsterIds.join(','));
    from = 'config.json 的 monsterIds';
  } else {
    const file = loadJson(WATCHLIST_PATH, null);
    if (file && Array.isArray(file.monsterIds)) {
      ids = parse(file.monsterIds.join(','));
      from = 'watchlist.json';
    } else {
      // 文件丢了（比如忘了一起提交到仓库）：宁可一条都不报，也不能把全部精灵刷进群
      watchlistBroken = true;
      from = 'watchlist.json（缺失或格式不对）';
    }
  }
  watchlistCache = ids;
  if (watchlistBroken) {
    fail('关注名单读不到（' + from + '）：本轮不报任何明雷，请检查 watchlist.json 是否已提交');
  } else if (ids.length) {
    log('明雷关注名单（' + from + '）：共', ids.length, '种 →', ids.join(','));
  } else {
    log('明雷关注名单为空：将推送所有精灵的明雷');
  }
  return ids;
}

// 只看精灵是否在关注名单里（不含「有价值」「地区」这两个额外过滤）
function passesWatchlist(item) {
  const ids = watchlist();
  if (watchlistBroken) return false;
  if (!ids.length) return true;
  return ids.includes(Number(item && item.monsterId));
}

// 同一批活跃明雷里，除它自己以外的其它（不再看关注名单，微信通道要全量）
function otherActiveItems(item, list) {
  const now = Math.floor(Date.now() / 1000);
  return (list || []).filter(
    (other) =>
      other &&
      other.sourceId != null &&
      String(other.sourceId) !== String(item.sourceId) &&
      (!other.despawnTimestamp || other.despawnTimestamp > now) &&
      passesBase(other)
  );
}

function passesFilter(item) {
  if (!passesWatchlist(item)) return false;
  return passesBase(item);
}

// 只看「有价值」「地区」这两个通用过滤（微信通道全量报点用，不看关注名单）
function passesBase(item) {
  const onlyValuable = envOrConfig('SWARM_ONLY_VALUABLE', config.onlyValuable);
  if ((onlyValuable === true || onlyValuable === 'true') && !item.hasValuable) {
    return false;
  }
  const regions = envOrConfig(
    'SWARM_REGIONS',
    Array.isArray(config.regions) ? config.regions.join(',') : ''
  )
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  if (regions.length && !regions.includes(item.region)) return false;
  return true;
}

function envOrConfig(name, fallback) {
  const value = process.env[name];
  return value == null || value === '' ? fallback : value;
}

async function fetchRetry(url, retries, baseDelay, extraHeaders) {
  const max = retries || 3;
  const delay = baseDelay || 2000;
  const headers = Object.assign({ Accept: 'application/json' }, extraHeaders || {});
  let lastErr;
  for (let attempt = 0; attempt < max; attempt++) {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        headers,
      });
      // 5xx 与 429 属于上游临时故障，同样退避重试；其余状态码直接返回
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      lastErr = new Error('HTTP ' + res.status);
      lastErr.transient = true;
    } catch (err) {
      lastErr = err;
      lastErr.transient = true;
    }
    if (attempt < max - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay * (attempt + 1)));
    }
  }
  throw lastErr;
}

// ---------- alphapedia 数据源 ----------
const ALPHAPEDIA_BASE = 'https://alpha.pokemmotools.org';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// 头目按时间段出现：00:00-04:45 / 06:00-10:45 / 12:00-16:45 / 18:00-22:45 (UTC)
const ALPHA_SLOT_END_MINUTES = [285, 645, 1005, 1365];
function alphaDespawnTimestamp(pingTs) {
  const d = new Date(pingTs * 1000);
  const minute = d.getUTCHours() * 60 + d.getUTCMinutes();
  for (const endMin of ALPHA_SLOT_END_MINUTES) {
    if (minute < endMin) {
      return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000) + endMin * 60;
    }
  }
  // 22:45 之后的出现归入次日 04:45 段
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000) + ALPHA_SLOT_END_MINUTES[0] * 60;
}

// 解析 alphapedia 明雷卡片：返回 { active: 活跃明雷[], lastSeen: 各地区上次明雷信息[] }
// lastSeen 项含 region / pokemon / monsterId / location / secondsAgo（出现距今秒数，即卡片 data-timedelta）
function parseSwarmCards(html) {
  const cards = [...html.matchAll(/<article class="swarm-region-card[^"]*">([\s\S]*?)<\/article>/g)].map((m) => m[0]);
  const now = Math.floor(Date.now() / 1000);
  const active = [];
  const lastSeen = [];
  cards.forEach((card) => {
    // 头目卡片（class 含 card-alpha-override / 链接 alpha-list）不算明雷
    if (/card-alpha-override/.test(card) || /alpha-list\?/.test(card)) return;
    const pokemon = (card.match(/data-pokemon="([^"]+)"/) || [])[1] || '';
    const region = (card.match(/data-region="([^"]+)"/) || [])[1] || '';
    const location = (card.match(/data-location="([^"]+)"/) || [])[1] || '';
    const pokedexId = (card.match(/\/pokedex\/(\d+)/) || [])[1];
    if (!pokemon || !pokedexId) return;
    const activeFlag = /card-active-swarm/.test(card);
    const despawnIn = (card.match(/swarm-card-despawn[^>]*>[\s\S]*?data-timedelta="(\d+)"/) || [])[1];
    const ts = (card.match(/timestamp=(\d+)/) || [])[1];
    if (activeFlag && despawnIn) {
      // 活跃明雷：despawn 行 data-timedelta = 剩余秒数
      const despawnTimestamp = now + Number(despawnIn);
      const appearTs = ts ? Number(ts) : despawnTimestamp - Number(despawnIn);
      if (despawnTimestamp > now) {
        active.push({
          monsterId: Number(pokedexId),
          pokemon,
          region,
          location,
          sourceId: appearTs,
          despawnTimestamp,
          hasValuable: false,
          timestampUtc: new Date(appearTs * 1000).toISOString(),
          publishedBy: '',
        });
      }
    } else {
      // 非活跃：swarm-card-age 行 data-timedelta = 出现距今秒数（上次明雷）
      const agoIn = (card.match(/data-timedelta="(\d+)"/) || [])[1];
      if (agoIn) {
        lastSeen.push({
          monsterId: Number(pokedexId),
          pokemon,
          region,
          location,
          secondsAgo: Number(agoIn),
          sourceId: ts ? Number(ts) : now - Number(agoIn),
        });
      }
    }
  });
  return { active, lastSeen };
}

function parseLatestAlpha(payload) {
  const name = String(payload.latest_ping_value || '').trim();
  if (!name) return null;
  const det = String(payload.latest_ping_details_html || '');
  const region = (det.match(/data-region="([^"]+)"/) || [])[1] || '';
  const location = (det.match(/data-location="([^"]+)"/) || [])[1] || '';
  // latest_pokedex_href 形如 "/pokedex/28"
  const pokedexId = (String(payload.latest_pokedex_href || '').match(/\/pokedex\/(\d+)/) || [])[1] ||
    (det.match(/\/pokedex\/(\d+)/) || [])[1];
  // timestamp= 在 alpha-list 链接里 = 消失时间戳
  const ts = (det.match(/timestamp=(\d+)/) || [])[1];
  const calledBy = (det.match(/publisher-name[^>]*>([^<]+)</) || [])[1] || '';
  if (!ts || !pokedexId) return null;
  const despawnTs = Number(ts);
  const ALPHA_SLOT_SECONDS = 285 * 60;
  const appearTs = despawnTs - ALPHA_SLOT_SECONDS;
  return {
    monsterId: Number(pokedexId),
    pokemon: name,
    region,
    location,
    sourceId: appearTs,
    despawnTimestamp: despawnTs,
    hasValuable: false,
    timestampUtc: new Date(appearTs * 1000).toISOString(),
    timestampRaw: new Date(appearTs * 1000).toISOString(),
    publishedBy: calledBy,
  };
}

// 解析 swarm 区里的头目卡片（class 含 card-alpha-override / 链接 alpha-list）。
// 卡片数据：timestamp= 消失时间戳；data-timedelta= 剩余秒数；出现时间 = 消失 - 头目时段时长。
function parseAlphaCard(html) {
  const cards = [...String(html).matchAll(/<article class="swarm-region-card[^"]*">([\s\S]*?)<\/article>/g)].map((m) => m[0]);
  const card = cards.find((c) => /card-alpha-override/.test(c) || /alpha-list\?/.test(c)) || null;
  if (!card) return null;
  const name = (card.match(/data-pokemon="([^"]+)"/) || [])[1] || '';
  const region = (card.match(/data-region="([^"]+)"/) || [])[1] || '';
  const location = (card.match(/data-location="([^"]+)"/) || [])[1] || '';
  const pokedexId = (card.match(/\/pokedex\/(\d+)/) || [])[1];
  // timestamp= 在 alpha-list 链接里 = 消失时间戳；data-timedelta = 剩余秒数
  const ts = (card.match(/timestamp=(\d+)/) || [])[1];
  const despawnIn = (card.match(/data-timedelta="(\d+)"/) || [])[1];
  if (!name || !pokedexId) return null;
  const now = Math.floor(Date.now() / 1000);
  // 出现时间：若卡片给消失时间戳则用它减时段时长；否则用 now - 剩余 + 已过时间反推
  const ALPHA_SLOT_SECONDS = 285 * 60; // 头目时段 4 小时 45 分
  let despawnTs = ts ? Number(ts) : (despawnIn ? now + Number(despawnIn) : null);
  const appearTs = despawnTs ? despawnTs - ALPHA_SLOT_SECONDS : (despawnIn ? now - Number(despawnIn) + ALPHA_SLOT_SECONDS : null);
  return {
    monsterId: Number(pokedexId),
    pokemon: name,
    region,
    location,
    sourceId: appearTs,
    despawnTimestamp: despawnTs,
    hasValuable: false,
    timestampUtc: appearTs ? new Date(appearTs * 1000).toISOString() : '',
    timestampRaw: appearTs ? new Date(appearTs * 1000).toISOString() : '',
    publishedBy: '',
  };
}

// 解析 jina 渲染后的首页 markdown 中的活跃明雷卡片
function parseJinaSwarms(markdown) {
  const now = Math.floor(Date.now() / 1000);
  const section = (String(markdown).split('## Swarms')[1] || '').split('## Phenos')[0] || '';
  const cards = section.split(/!\[Image \d+: /).slice(1);
  const items = [];
  cards.forEach((block) => {
    // 混入的头目卡片（标注 Alpha / 链接 alpha-list）不算明雷
    if (block.includes('Alpha Active') || /alpha-list\?/.test(block)) return;
    const pm = block.match(/\[([^\]]+)\]\(https:\/\/alpha\.pokemmotools\.org\/pokedex\/(\d+)\)/);
    if (!pm) return;
    // 地区是图片行后的首个非空行（部分卡片图片行后有空行）
    const lines = block.split('\n').map((l) => l.trim());
    let region = '';
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]) { region = lines[i]; break; }
    }
    const lm = block.match(/\[([^\]]+)\]\(https:\/\/alpha\.pokemmotools\.org\/route\/[^)]+\)/);
    const despawnM = block.match(/Despawns in (\d+) minute/);
    const tsM = block.match(/timestamp=(\d+)/);
    const despawnTimestamp = despawnM ? now + Number(despawnM[1]) * 60 : null;
    if (!despawnTimestamp || despawnTimestamp <= now) return; // 只保留未消失的活跃明雷
    const ts = tsM ? Number(tsM[1]) : null;
    items.push({
      monsterId: Number(pm[2]),
      pokemon: pm[1],
      region,
      location: lm ? lm[1] : '',
      sourceId: ts,
      despawnTimestamp,
      hasValuable: false,
      timestampUtc: ts ? new Date(ts * 1000).toISOString() : '',
      publishedBy: '',
    });
  });
  return items;
}

// 解析 jina 渲染后的"上次明雷"（非活跃卡片：显示 "X ago"）
function parseJinaLastSeen(markdown) {
  const now = Math.floor(Date.now() / 1000);
  const section = (String(markdown).split('## Swarms')[1] || '').split('## Phenos')[0] || '';
  const cards = section.split(/!\[Image \d+: /).slice(1);
  const lastSeen = [];
  cards.forEach((block) => {
    if (block.includes('Alpha Active') || /alpha-list\?/.test(block)) return;
    const pm = block.match(/\[([^\]]+)\]\(https:\/\/alpha\.pokemmotools\.org\/pokedex\/(\d+)\)/);
    if (!pm) return;
    const lines = block.split('\n').map((l) => l.trim());
    let region = '';
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]) { region = lines[i]; break; }
    }
    // 非活跃卡片有 "ago" 文本；尝试提取 "X hours/minutes ago"
    if (!/\bago\b/i.test(block)) return;
    const lm = block.match(/\[([^\]]+)\]\(https:\/\/alpha\.pokemmotools\.org\/route\/[^)]+\)/);
    const hourM = block.match(/(\d+)\s*hours?/i);
    const minM = block.match(/(\d+)\s*minutes?/i);
    const secM = block.match(/(\d+)\s*seconds?/i);
    const secondsAgo = hourM ? Number(hourM[1]) * 3600 : minM ? Number(minM[1]) * 60 : secM ? Number(secM[1]) : 0;
    const tsM = block.match(/timestamp=(\d+)/);
    lastSeen.push({
      monsterId: Number(pm[2]),
      pokemon: pm[1],
      region,
      location: lm ? lm[1] : '',
      secondsAgo,
      sourceId: tsM ? Number(tsM[1]) : now - secondsAgo,
    });
  });
  return lastSeen;
}

// 解析 jina 渲染后的最新头目（页面显示时间行 = 出现时间；链接 timestamp= 是消失时间）
function parseJinaAlpha(markdown) {
  const section = (String(markdown).split('## Latest Alpha')[1] || '').split('## Alpha Time Slots')[0] || '';
  const nameM = section.match(/\[([^\]]+)\]\(https:\/\/alpha\.pokemmotools\.org\/pokedex\/(\d+)\)/);
  const regionM = section.match(/Region:\s*([A-Za-z]+)/);
  const locM = section.match(/Location:\s*\[([^\]]+)\]/);
  const calledM = section.match(/Called by\s*([^\n]+)/);
  if (!nameM) return null;
  // 出现时间：Latest Alpha 标题下方的时间行，如 "2026-08-27 09:17:46 UTC (UTC+00:00)"
  const appearM = section.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
  const appearTs = appearM ? Math.floor(Date.parse(appearM[1].replace(' ', 'T') + 'Z') / 1000) : null;
  if (!appearTs) return null;
  return {
    monsterId: Number(nameM[2]),
    pokemon: nameM[1],
    region: regionM ? regionM[1] : '',
    location: locM ? locM[1] : '',
    sourceId: appearTs,
    despawnTimestamp: alphaDespawnTimestamp(appearTs),
    hasValuable: false,
    timestampUtc: new Date(appearTs * 1000).toISOString(),
    timestampRaw: new Date(appearTs * 1000).toISOString(),
    publishedBy: calledM ? calledM[1].trim() : '',
  };
}

// 直连 alphapedia API；被 Cloudflare 挑战时返回 null（并保存原始响应供诊断）
async function tryDirectAlphapediaStatus() {
  const page = await fetchRetry(ALPHAPEDIA_BASE + '/', 3, 2000, {
    Accept: 'text/html,application/xhtml+xml',
    'User-Agent': BROWSER_UA,
  });
  const html = await page.text();
  if (!html || html.includes('Just a moment') || html.includes('Enable JavaScript')) {
    fail('直连诊断: 首页被拦截 HTTP ' + page.status + ' 长度 ' + (html || '').length + ' 片段: ' + String(html || '').slice(0, 120).replace(/\s+/g, ' '));
    try {
      require('fs').writeFileSync(
        path.join(__dirname, 'debug-direct-fail.txt'),
        '时间: ' + new Date().toISOString() + '\n状态: CF挑战/异常页\nHTTP: ' + page.status + '\n长度: ' + (html || '').length + '\n' + String(html || '').slice(0, 1000)
      );
    } catch (e) { /* 忽略 */ }
    return null;
  }
  const cookie = (page.headers.get('set-cookie') || '').split(';')[0];
  const token = (html.match(/name="landing-status-token"[^>]*content="([^"]+)"/) || [])[1];
  if (!token) {
    fail('直连诊断: 首页无 token，HTTP ' + page.status + ' 长度 ' + html.length + ' 片段: ' + html.slice(0, 120).replace(/\s+/g, ' '));
    try {
      require('fs').writeFileSync(
        path.join(__dirname, 'debug-direct-fail.txt'),
        '时间: ' + new Date().toISOString() + '\n状态: 首页无 token\n长度: ' + html.length + '\n' + html.slice(0, 1000)
      );
    } catch (e) { /* 忽略 */ }
    return null;
  }
  const res = await fetchRetry(ALPHAPEDIA_BASE + '/api/landing-status', 3, 2000, {
    Accept: 'application/json',
    Cookie: cookie,
    'X-Landing-Status-Token': token,
    Origin: ALPHAPEDIA_BASE,
    Referer: ALPHAPEDIA_BASE + '/',
    'User-Agent': BROWSER_UA,
  });
  if (res.status === 204 || !res.ok) {
    fail('直连诊断: API 非 200（HTTP ' + res.status + '）');
    try {
      require('fs').writeFileSync(
        path.join(__dirname, 'debug-direct-fail.txt'),
        '时间: ' + new Date().toISOString() + '\n状态: API 非 200 (' + res.status + ')'
      );
    } catch (e) { /* 忽略 */ }
    return null;
  }
  const payload = await res.json();
  const swarmHtml = String(payload.swarm_section_html || '');
  // 诊断：活跃明雷解析为空时保存原始 HTML 片段，便于排查格式变化
  const parsed = parseSwarmCards(swarmHtml);
  if (!parsed.active.length && swarmHtml.length > 100) {
    try {
      const fsx = require('fs');
      fsx.writeFileSync(
        path.join(__dirname, 'debug-swarm-html.txt'),
        '时间: ' + new Date().toISOString() + '\nHTML 长度: ' + swarmHtml.length + '\n' + swarmHtml.slice(0, 3000)
      );
    } catch (e) { /* 忽略 */ }
  }
  return {
    swarms: parsed.active,
    lastSeen: parsed.lastSeen,
    alpha: parseAlphaCard(swarmHtml) || parseLatestAlpha(payload || {}),
  };
}

// 通过 r.jina.ai 渲染首页（能过 Cloudflare 挑战）；配置 JINA_API_KEY 可避开共享 IP 限流
async function fetchAlphapediaViaJina() {
  const headers = {
    Accept: 'text/plain, text/markdown, */*',
    'User-Agent': BROWSER_UA,
    // 禁用 jina 缓存：默认会返回旧页面导致报点数据滞后
    'X-No-Cache': 'true',
  };
  const apiKey = process.env.JINA_API_KEY || config.jinaApiKey || '';
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
  const res = await fetchRetry('https://r.jina.ai/' + ALPHAPEDIA_BASE + '/', 2, 3000, headers);
  const markdown = await res.text();
  if (
    !markdown ||
    markdown.includes('Just a moment') ||
    markdown.includes('Enable JavaScript') ||
    markdown.length < 500 ||
    (!markdown.includes('## Latest Alpha') && !markdown.includes('## Swarms'))
  ) {
    const snippet = String(markdown || '').slice(0, 200).replace(/\s+/g, ' ');
    fail('jina 诊断: HTTP ' + res.status + ' 长度 ' + (markdown || '').length + ' 片段: ' + snippet);
    try {
      const fsx = require('fs');
      fsx.writeFileSync(
        path.join(__dirname, 'debug-jina-fail.txt'),
        '时间: ' + new Date().toISOString() + '\nHTTP: ' + res.status + '\n长度: ' + (markdown || '').length + '\n' + String(markdown || '').slice(0, 2000)
      );
    } catch (e) { /* 忽略 */ }
    throw new Error('jina 渲染失败（返回异常页面）');
  }
  const status = {
    swarms: parseJinaSwarms(markdown),
    lastSeen: parseJinaLastSeen(markdown),
    alpha: parseJinaAlpha(markdown),
  };
  // 诊断：明雷解析为空时保存原始 markdown 片段
  if (!status.swarms.length) {
    try {
      const fsx = require('fs');
      fsx.writeFileSync(
        path.join(__dirname, 'debug-jina.md'),
        '时间: ' + new Date().toISOString() + '\n长度: ' + markdown.length + '\n' + markdown.slice(0, 4000)
      );
    } catch (e) { /* 忽略 */ }
  }
  return status;
}

// Playwright 真浏览器兜底：自动通过 CF "Just a moment" JS 挑战（直连被挑战时的主兜底）。
// 页面内 fetch API（同源自带 cookie），只把 JSON 结果带出来，解析复用直连逻辑。
async function fetchAlphapediaViaBrowser() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (err) {
    fail('浏览器兜底不可用（未安装 playwright）：', err.message);
    return null;
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ userAgent: BROWSER_UA, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(ALPHAPEDIA_BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    let passed = false;
    for (let i = 0; i < 25; i++) {
      const title = await page.title();
      if (!/just a moment|请稍候/i.test(title)) { passed = true; break; }
      await page.waitForTimeout(1000);
    }
    if (!passed) throw new Error('CF 挑战 25 秒未通过');
    const body = await page.evaluate(async () => {
      const meta = document.querySelector('meta[name="landing-status-token"]');
      if (!meta) return null;
      const res = await fetch('/api/landing-status', {
        headers: { 'X-Landing-Status-Token': meta.content, Accept: 'application/json' },
      });
      return { status: res.status, text: await res.text() };
    });
    if (!body) throw new Error('浏览器页面无 landing-status-token');
    if (body.status !== 200) throw new Error('浏览器内 API HTTP ' + body.status);
    const payload = JSON.parse(body.text);
    const swarmHtml = String(payload.swarm_section_html || '');
    const parsed = parseSwarmCards(swarmHtml);
    log('浏览器兜底成功，活跃明雷', parsed.active.length, '条');
    return {
      swarms: parsed.active,
      lastSeen: parsed.lastSeen,
      alpha: parseAlphaCard(swarmHtml) || parseLatestAlpha(payload || {}),
    };
  } catch (err) {
    fail('浏览器兜底失败：', err.message);
    try {
      require('fs').writeFileSync(
        path.join(__dirname, 'debug-browser-fail.txt'),
        '时间: ' + new Date().toISOString() + '\n' + String(err && err.message || err)
      );
    } catch (e) { /* 忽略 */ }
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// 拉取 alphapedia 首页实时状态：直连优先 → Playwright 浏览器过 CF 挑战 → jina 渲染兜底
async function fetchAlphapediaStatus() {
  // SWARM_SKIP_DIRECT=1 时跳过直连（本地调试浏览器/jina 兜底用）
  const skipDirect = process.env.SWARM_SKIP_DIRECT === '1';
  if (!skipDirect) {
    let direct = null;
    // 直连可能被 Cloudflare 临时挑战：失败后等待再重试一轮
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        direct = await tryDirectAlphapediaStatus();
      } catch (err) {
        fail('alphapedia 直连失败：', err.message);
      }
      if (direct) return recordSwarmStatus(direct);
      if (attempt === 0) {
        fail('直连返回空（可能被 Cloudflare 挑战），5 秒后重试…');
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    fail('直连两轮均失败，回退浏览器过 CF 挑战');
  } else {
    fail('SWARM_SKIP_DIRECT=1，跳过直连，走浏览器兜底');
  }
  const viaBrowser = await fetchAlphapediaViaBrowser();
  if (viaBrowser) return recordSwarmStatus(viaBrowser);
  fail('浏览器兜底失败，回退 jina 渲染');
  try {
    return recordSwarmStatus(await fetchAlphapediaViaJina());
  } catch (err) {
    fail('jina 渲染失败：', err.message);
    try {
      require('fs').writeFileSync(
        path.join(__dirname, 'debug-jina-fail.txt'),
        '时间: ' + new Date().toISOString() + '\n' + String(err && err.message || err)
      );
    } catch (e) { /* 忽略 */ }
  }
  throw new Error('alphapedia 数据获取失败（直连、浏览器与 jina 均不可用）');
}

// 每次成功抓取后落盘当前状态快照（workflow 提交进仓库，供网页版明雷面板读取）
function recordSwarmStatus(status) {
  try {
    saveJson(path.join(__dirname, 'swarm-status.json'), {
      fetchedAt: new Date().toISOString(),
      swarms: status.swarms || [],
      lastSeen: status.lastSeen || [],
      alpha: status.alpha || null,
    });
  } catch (e) { /* 忽略 */ }
  return status;
}

async function pushItem(item, others) {
  const list = [item].concat(others || []);
  const watched = list.filter(passesWatchlist);
  log('推送新明雷：', item.pokemon || item.monsterId, item.region, item.location);
  // 微信：全量；QQ 群：只有名单内的精灵才发（这条不在名单里就干脆不发 QQ）
  await sendMessage(
    buildSwarmMessage(list, null, false),
    passesWatchlist(item) && watched.length
      ? buildSwarmMessage(watched, null, true)
      : null
  );
}

async function processPending(list) {
  if (!pending.length) return;
  const now = Math.floor(Date.now() / 1000);
  const remaining = [];
  for (const entry of pending) {
    const item = entry.item;
    if (entry.retries >= 5 || !item.despawnTimestamp || item.despawnTimestamp <= now) {
      continue;
    }
    try {
      await pushItem(item, otherActiveItems(item, list));
      seen.add(String(item.sourceId));
    } catch (err) {
      entry.retries += 1;
      remaining.push(entry);
    }
  }
  pending = remaining;
  saveSeen();
  savePending();
}

// ---------- 头目报点：只在「收到头目出现」的那一轮发一次 ----------
// 一次头目 = 一个 4h45m 时段，只发一条消息；之后不再重复，也不再发「当前无活跃头目」。

// 去重键：用「这场头目的消失时刻」（alpha-list 链接里的 timestamp=，一场 4h45m 内不变），
// 精确到分钟，既好读又不会因为解析出几秒误差就把同一场头目重复报出去。
function bossDedupeKey(item) {
  if (!item) return null;
  const despawn = Number(item.despawnTimestamp) || 0;
  if (!despawn) return null;
  return 'alpha:' + new Date(despawn * 1000).toISOString().slice(0, 16) + 'Z';
}

function buildBossText(item) {
  const info = nameById.get(item.monsterId) || {};
  const name = info.name || item.pokemon || ('#' + item.monsterId);
  const region = REGION_NAMES[item.region] || item.region || '';
  const loc = item.location ? translateLocation(item.location) : '未知地点';
  const now = Math.floor(Date.now() / 1000);
  return [
    '【头目报点】' + name + ' #' + item.monsterId + (region ? ' · ' + region : ''),
    '  ' + loc +
      ' · 剩 ' + remainLongText(item, now) +
      '（' + (clockText(item.despawnTimestamp) || '未知') + ' 消失）',
  ].join('\n');
}

async function buildBossSection(statusArg) {
  const now = Math.floor(Date.now() / 1000);
  let status = statusArg;
  if (!status) {
    try {
      status = await fetchAlphapediaStatus();
    } catch (err) {
      fail('拉取头目报点失败：', err.message);
      status = null;
    }
  }
  // 自记录：从卡片解析的活跃头目（alpha）与本地记录对比，较新则覆盖保存
  const alpha = status && status.alpha;
  let saved = loadJson(BOSS_LAST_PATH, null);
  // 防御：历史记录出现未来时间戳（解析污染）时视为无效并清除，避免阻塞更新
  const savedTimeRaw = saved ? Date.parse(saved.timestampUtc || '') || 0 : 0;
  if (savedTimeRaw > Date.now() + 5 * 60 * 1000) {
    fail('boss-last 时间戳异常（未来时间），已清除：', String(saved.timestampUtc || ''));
    saveJson(BOSS_LAST_PATH, {});
    saved = null;
  }
  const savedTime = saved ? Date.parse(saved.timestampUtc || '') || 0 : 0;
  const alphaTime = alpha ? Date.parse(alpha.timestampUtc || '') || 0 : 0;
  // 本地只留「最新一场头目」的记录（boss-last.json），比现有记录更新就覆盖；
  // 是否要推送不看这里，只看下面 seen 里有没有这条去重键。
  const isNew = Boolean(alpha) && alphaTime > savedTime;
  if (isNew) {
    saveJson(BOSS_LAST_PATH, alpha);
    saved = alpha;
  }

  const latest = saved || null;
  if (!latest || !latest.despawnTimestamp) {
    return { text: '', key: '' };
  }
  const key = bossDedupeKey(latest);
  const active = latest.despawnTimestamp > now;
  // 这场已经结束 / 拿不到去重键 / 已经报过 → 本轮不发头目段。
  // 是否报过只看 seen（发成功才写入），所以发送失败下一轮还能补报。
  if (!active || !key || seen.has(key)) {
    return { text: '', key: '' };
  }
  return { text: buildBossText(latest), key };
}

async function pollOnce(pushAllActive) {
  // 数据源统一走 alphapedia：一次请求同时拿到活跃明雷与最新头目
  let status = null;
  try {
    status = await fetchAlphapediaStatus();
  } catch (err) {
    fail('拉取报点数据失败：', err.message);
  }
  const list = status ? status.swarms : [];
  const now = Math.floor(Date.now() / 1000);
  // 两套口径：微信看全量（只过「有价值/地区」），QQ 群只看关注名单
  const activeAll = list.filter(
    (item) =>
      item &&
      item.sourceId != null &&
      passesBase(item) &&
      (!item.despawnTimestamp || item.despawnTimestamp > now)
  );
  const activeWatched = activeAll.filter(passesWatchlist);
  // 本轮新出现的才报点：同一条明雷只报一次，之后不再刷屏
  const freshAll = activeAll.filter((item) => !seen.has(String(item.sourceId)));
  const freshWatched = freshAll.filter(passesWatchlist);
  // 头目段复用同一份 alphapedia 状态（避免二次请求）；只有「收到头目出现」的那一轮才有文本
  const boss = status
    ? await buildBossSection(status).catch((err) => {
        fail('头目报点处理失败：', err.message);
        return { text: '', key: '' };
      })
    : { text: '', key: '' };

  if (!pushAllActive) {
    for (const item of freshAll) {
      try {
        await pushItem(item, otherActiveItems(item, list));
        seen.add(String(item.sourceId));
      } catch (err) {
        fail('推送失败（稍后自动重试）：', err.message);
        pending.push({ item, retries: 1 });
      }
    }
    saveSeen();
    savePending();
    await processPending(list);
    if (boss.text) {
      try {
        await sendMessage(boss.text);
        if (boss.key) seen.add(boss.key);
        saveSeen();
        log('头目报点已推送。');
      } catch (err) {
        fail('头目推送失败：', err.message);
      }
    }
    return;
  }

  // 定时模式（cron / 外部调度）：本轮没有任何「该发的东西」→ 一条消息都不发
  // （微信全量，所以任何新明雷都算；只有 QQ 通道时，只有名单内的新明雷才算）
  const hasNews = channel === 'wechat' ? freshAll.length > 0 : freshWatched.length > 0;
  if (!hasNews && !boss.text) {
    log(
      status
        ? '本轮无新报点（活跃明雷 ' + activeAll.length + ' 条，其中名单内 ' + activeWatched.length + ' 条），不推送。'
        : '本轮数据源获取失败，不推送。'
    );
    return;
  }
  // 微信：当前所有活跃明雷（含刚出现的）；QQ 群：只列名单内的，没有就不发这一条
  const lastSeen = status && status.lastSeen;
  let primaryMsg = freshAll.length ? buildSwarmMessage(activeAll, lastSeen, false) : '';
  let qqMsg = freshWatched.length ? buildSwarmMessage(activeWatched, lastSeen, true) : '';
  if (boss.text) {
    primaryMsg = primaryMsg ? primaryMsg + BOSS_SEPARATOR + boss.text : boss.text;
    qqMsg = qqMsg ? qqMsg + BOSS_SEPARATOR + boss.text : boss.text;
  }
  try {
    await sendMessage(primaryMsg, qqMsg || null);
    // 微信收到全量；没有微信通道时官方 QQ 机器人只收到名单内的
    const delivered = channel === 'wechat' ? freshAll : freshWatched;
    delivered.forEach((item) => seen.add(String(item.sourceId)));
    if (boss.key) seen.add(boss.key);
    saveSeen();
    log(
      '推送成功（微信新增 ' + freshAll.length + ' 条 / QQ 群新增 ' + freshWatched.length + ' 条，活跃 ' +
        activeAll.length + ' 条，其中名单内 ' + activeWatched.length + ' 条）。'
    );
  } catch (err) {
    fail('推送失败：', err.message);
  }
}

function startPoller() {
  const interval = Number(config.pollIntervalMs) || 15000;
  log('开始监听明雷报点，每', Math.round(interval / 1000), '秒检查一次');
  const loop = async () => {
    if (stopping) return;
    try {
      await pollOnce(false);
    } catch (err) {
      fail('拉取报点失败：', err.message);
    }
    if (!stopping) setTimeout(loop, interval);
  };
  loop();
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ op: 1, d: lastSeq }));
    }
  }, heartbeatInterval);
}

function handleGatewayMessage(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    return;
  }
  if (payload.s != null) lastSeq = payload.s;

  if (payload.op === 10) {
    const interval = payload.d && payload.d.heartbeat_interval;
    if (Number.isFinite(interval) && interval > 0) heartbeatInterval = interval;
    startHeartbeat();
    return;
  }
  if (payload.op === 7) {
    log('收到重连指令，重新连接');
    if (ws) {
      ws.close();
    }
    return;
  }
  if (payload.op !== 0 || !payload.t) return;

  const d = payload.d || {};
  if (payload.t === 'READY') {
    log('QQ 事件网关已就绪（session_id: ' + (d.session_id || '?') + '）');
    return;
  }

  if (payload.t === 'GROUP_ADD_ROBOT') {
    const gid = d.group_openid;
    if (gid && !config.groupOpenid) {
      config.groupOpenid = gid;
      saveJson(CONFIG_PATH, config);
      log('检测到机器人入群，已自动绑定目标群：', gid);
    }
    return;
  }

  if (payload.t === 'GROUP_AT_MESSAGE_CREATE' || payload.t === 'GROUP_MSG_RECEIVE') {
    const gid = d.group_openid;
    const content = d.content || '';
    if (gid && config.autoBindCommand && content.includes(config.autoBindCommand)) {
      config.groupOpenid = gid;
      saveJson(CONFIG_PATH, config);
      log('收到绑定指令，目标群已设为：', gid);
      sendGroupMessage(gid, '明雷报点推送已绑定本群，之后有新明雷会自动推送到这里。', d.id)
        .catch((err) => fail('回复绑定成功消息失败：', err.message));
    }
  }
}

function startGateway() {
  getToken()
    .then((token) => {
      if (stopping) return;
      log('连接 QQ 事件网关…');
      ws = new WebSocket(WS_URL, {
        headers: { Authorization: 'QQBot ' + token },
      });
      ws.onopen = () => {
        reconnectDelay = 1000;
        log('QQ 事件网关已连接');
      };
      ws.onmessage = (event) => handleGatewayMessage(event.data);
      ws.onerror = () => fail('QQ 事件网关连接出错');
      ws.onclose = () => {
        stopHeartbeat();
        if (stopping) return;
        log('QQ 事件网关已断开，' + Math.round(reconnectDelay / 1000) + ' 秒后重连');
        setTimeout(startGateway, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 60000);
      };
    })
    .catch((err) => {
      fail('获取网关凭证失败：', err.message, '（15 秒后重试）');
      setTimeout(startGateway, 15000);
    });
}

async function runTest() {
  if (!validateConfig()) return 1;
  loadNames();
  try {
    const list = await fetchAlphapediaStatus().then((s) => s.swarms).catch(() => []);
    const target = channel === 'wechat' ? wechatWebhook : config.groupOpenid;
    if (!target) {
      fail('测试推送需要目标群。请把机器人拉进群后 @它发送「' + (config.autoBindCommand || '绑定') + '」，或手动填写 config.json 的 groupOpenid。');
      return 1;
    }
    const item = list.find((x) => x && passesFilter(x));
    const content = item
      ? formatMessage(item)
      : '【明雷报点测试】\n当前关注名单里没有正在报点的明雷，机器人通道工作正常。';
    log('发送测试消息…');
    await sendMessage(content);
    log('测试消息已发送。');
    return 0;
  } catch (err) {
    fail('测试推送失败：', err.message);
    return 1;
  }
}

async function runOnce() {
  if (!validateConfig()) return 1;
  loadNames();
  if (channel === 'qq' && !config.groupOpenid) {
    fail('单次模式需要已配置 groupOpenid（先跑常驻模式让机器人绑定群）。');
    return 1;
  }
  try {
    await pollOnce(true);
    log('单次检查完成。');
    return 0;
  } catch (err) {
    fail('单次检查失败：', err.message);
    return 1;
  }
}

async function main() {
  if (args.includes('--test')) {
    process.exitCode = await runTest();
    return;
  }
  if (args.includes('--once')) {
    process.exitCode = await runOnce();
    return;
  }
  if (!validateConfig()) {
    process.exitCode = 1;
    return;
  }

  loadNames();
  startPoller();
  if (channel === 'qq') startGateway();

  process.on('SIGINT', () => {
    stopping = true;
    log('正在退出…');
    if (ws) ws.close();
    process.exitCode = 0;
  });
  process.on('SIGTERM', () => {
    stopping = true;
    if (ws) ws.close();
    process.exitCode = 0;
  });
}

main();
