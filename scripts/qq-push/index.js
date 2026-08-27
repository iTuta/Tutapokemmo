'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.json');
const SEEN_PATH = path.join(ROOT, 'seen.json');
const PENDING_PATH = path.join(ROOT, 'pending.json');
const BOSS_LAST_PATH = path.join(ROOT, 'boss-last.json');
const OUTAGE_PATH = path.join(ROOT, 'outage.json');
const LAST_SENT_PATH = path.join(ROOT, 'last-sent.json');
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
// 故障播报标记文件必须始终存在：workflow 的 git add 列表包含它，缺失会导致整轮任务失败
if (!fs.existsSync(OUTAGE_PATH)) saveJson(OUTAGE_PATH, { notified: false });
// 最近推送状态：记录上一次推送时的活跃明雷 sourceId 与最新头目时间，用于只在有新增时才推送
if (!fs.existsSync(LAST_SENT_PATH)) saveJson(LAST_SENT_PATH, { swarmIds: [], bossTime: '' });

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
  saveJson(SEEN_PATH, { ids: Array.from(seen) });
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

async function sendMessage(content) {
  if (channel === 'wechat') {
    const res = await fetch(wechatWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.errcode !== 0) {
      throw new Error('微信推送失败 HTTP ' + res.status + ' ' + JSON.stringify(data));
    }
    return data;
  }
  return sendGroupMessage(config.groupOpenid, content);
}

function formatMessage(item, title) {
  const info = nameById.get(item.monsterId) || {};
  const name = info.name || item.pokemon || ('#' + item.monsterId);
  const region = REGION_NAMES[item.region] || item.region || '未知地区';
  const remain = Math.max(0, (item.despawnTimestamp || 0) - Math.floor(Date.now() / 1000));
  const minutes = Math.floor(remain / 60);
  const seconds = remain % 60;
  const timeText = minutes > 0 ? minutes + ' 分 ' + seconds + ' 秒' : seconds + ' 秒';
  const despawnText = item.despawnTimestamp
    ? new Date(item.despawnTimestamp * 1000).toLocaleTimeString('zh-CN', {
        hour12: false,
        timeZone: 'Asia/Shanghai',
      })
    : '未知';
  const valuable = item.hasValuable ? '（有价值）' : '';
  return [
    (title || '【明雷报点】') + name + ' #' + item.monsterId + valuable,
    '地区：' + region,
    '地点：' + translateLocation(item.location),
    '剩余：' + timeText + '（' + despawnText + ' 消失）',
  ].join('\n');
}

function formatActiveLine(item, now) {
  const info = nameById.get(item.monsterId) || {};
  const name = info.name || item.pokemon || ('#' + item.monsterId);
  const region = REGION_NAMES[item.region] || item.region || '';
  const remain = Math.max(0, (item.despawnTimestamp || 0) - now);
  const minutes = Math.round(remain / 60);
  const despawnText = item.despawnTimestamp
    ? new Date(item.despawnTimestamp * 1000).toLocaleTimeString('zh-CN', {
        hour12: false,
        timeZone: 'Asia/Shanghai',
      })
    : '';
  return (
    '• ' + name + ' #' + item.monsterId +
    (region ? ' ' + region : '') +
    (item.location ? ' ' + translateLocation(item.location) : '') +
    '（约 ' + minutes + ' 分钟）' +
    (despawnText ? '（' + despawnText + ' 消失）' : '')
  );
}

const BOSS_SEPARATOR = '\n\n\n\n';

function buildPushMessage(item, others) {
  const lines = [formatMessage(item)];
  const now = Math.floor(Date.now() / 1000);
  const sorted = (others || [])
    .slice()
    .sort((a, b) => (a.despawnTimestamp || 0) - (b.despawnTimestamp || 0));
  lines.push('', '');
  lines.push('【当前其他明雷】');
  if (sorted.length) {
    sorted.forEach((other) => lines.push(formatActiveLine(other, now)));
  } else {
    lines.push('当前暂无其它明雷');
  }
  return lines.join('\n');
}

function otherActiveItems(item, list) {
  return (list || []).filter(
    (other) =>
      other &&
      other.sourceId != null &&
      String(other.sourceId) !== String(item.sourceId) &&
      passesFilter(other)
  );
}

function passesFilter(item) {
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
  const monsterIds = envOrConfig(
    'SWARM_MONSTER_IDS',
    Array.isArray(config.monsterIds) ? config.monsterIds.join(',') : ''
  )
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '')
    .map(Number)
    .filter((value) => Number.isFinite(value));
  if (monsterIds.length && !monsterIds.includes(item.monsterId)) {
    return false;
  }
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

function parseSwarmCards(html) {
  const cards = [...html.matchAll(/<article class="swarm-region-card[^"]*">([\s\S]*?)<\/article>/g)].map((m) => m[1]);
  const now = Math.floor(Date.now() / 1000);
  const items = [];
  cards.forEach((card) => {
    const pokemon = (card.match(/data-pokemon="([^"]+)"/) || [])[1] || '';
    const region = (card.match(/data-region="([^"]+)"/) || [])[1] || '';
    const location = (card.match(/data-location="([^"]+)"/) || [])[1] || '';
    const pokedexId = (card.match(/\/pokedex\/(\d+)/) || [])[1];
    const ts = (card.match(/timestamp=(\d+)/) || [])[1];
    const despawnIn = (card.match(/data-timedelta="(\d+)"/) || [])[1];
    if (!pokemon || !pokedexId || !ts) return;
    const despawnTimestamp = despawnIn ? now + Number(despawnIn) : null;
    if (!despawnTimestamp || despawnTimestamp <= now) return; // 只保留未消失的活跃明雷
    items.push({
      monsterId: Number(pokedexId),
      pokemon,
      region,
      location,
      sourceId: Number(ts),
      despawnTimestamp,
      hasValuable: false,
      timestampUtc: new Date(Number(ts) * 1000).toISOString(),
      publishedBy: '',
    });
  });
  return items;
}

function parseLatestAlpha(payload) {
  const name = String(payload.latest_ping_value || '').trim();
  if (!name || !payload.latest_ping_has_data) return null;
  const det = String(payload.latest_ping_details_html || '');
  const region = (det.match(/data-region="([^"]+)"/) || [])[1] || '';
  const location = (det.match(/data-location="([^"]+)"/) || [])[1] || '';
  const ts = (det.match(/timestamp=(\d+)/) || [])[1];
  const pokedexId = (det.match(/\/pokedex\/(\d+)/) || [])[1];
  const calledBy = (det.match(/publisher-name[^>]*>([^<]+)</) || [])[1] || '';
  if (!ts || !pokedexId) return null;
  const pingTs = Number(ts);
  return {
    monsterId: Number(pokedexId),
    pokemon: name,
    region,
    location,
    sourceId: pingTs,
    despawnTimestamp: alphaDespawnTimestamp(pingTs),
    hasValuable: false,
    timestampUtc: new Date(pingTs * 1000).toISOString(),
    timestampRaw: new Date(pingTs * 1000).toISOString(),
    publishedBy: calledBy,
  };
}

// 拉取 alphapedia 首页实时状态：活跃明雷 + 最新头目
async function fetchAlphapediaStatus() {
  const page = await fetchRetry(ALPHAPEDIA_BASE + '/', 3, 2000, { Accept: 'text/html', 'User-Agent': BROWSER_UA });
  const html = await page.text();
  const cookie = (page.headers.get('set-cookie') || '').split(';')[0];
  const token = (html.match(/name="landing-status-token"[^>]*content="([^"]+)"/) || [])[1];
  const res = await fetchRetry(ALPHAPEDIA_BASE + '/api/landing-status', 3, 2000, {
    Accept: 'application/json',
    Cookie: cookie,
    'X-Landing-Status-Token': token,
    Origin: ALPHAPEDIA_BASE,
    Referer: ALPHAPEDIA_BASE + '/',
    'User-Agent': BROWSER_UA,
  });
  if (res.status === 204 || !res.ok) throw new Error('HTTP ' + res.status);
  const payload = await res.json();
  return {
    swarms: parseSwarmCards(String(payload.swarm_section_html || '')),
    alpha: parseLatestAlpha(payload || {}),
  };
}

async function pushItem(item, others) {
  const message = buildPushMessage(item, others || []);
  log('推送新明雷：', item.pokemon || item.monsterId, item.region, item.location);
  await sendMessage(message);
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

function buildBossLastBody(item) {
  const info = nameById.get(item.monsterId) || {};
  const name = info.name || item.pokemon || ('#' + item.monsterId);
  const region = REGION_NAMES[item.region] || item.region || '';
  const loc = item.location ? translateLocation(item.location) : '';
  const appear = new Date(item.timestampUtc || item.timestampRaw || 0);
  const appearText = !isNaN(appear.getTime())
    ? appear.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
    : '未知';
  const end = item.despawnTimestamp
    ? new Date(item.despawnTimestamp * 1000).toLocaleTimeString('zh-CN', {
        hour12: false,
        timeZone: 'Asia/Shanghai',
      })
    : '未知';
  return (
    '上次头目：' + name + ' #' + item.monsterId +
    (region ? ' ' + region : '') + (loc ? ' ' + loc : '') + '\n' +
    '上次出现：' + appearText + '\n' +
    '结束时间：' + end
  );
}

function buildBossLastLine(item) {
  return '【头目报点】当前无活跃头目\n' + buildBossLastBody(item);
}

function buildBossActiveSection(active) {
  const latest = active
    .slice()
    .sort((a, b) => new Date(b.timestampUtc || 0) - new Date(a.timestampUtc || 0))[0];
  const info = nameById.get(latest.monsterId) || {};
  const name = info.name || latest.pokemon || ('#' + latest.monsterId);
  const region = REGION_NAMES[latest.region] || latest.region || '';
  const loc = latest.location ? translateLocation(latest.location) : '';
  const remain = Math.max(0, (latest.despawnTimestamp || 0) - Math.floor(Date.now() / 1000));
  const minutes = Math.floor(remain / 60);
  const seconds = remain % 60;
  const timeText = minutes > 0 ? minutes + ' 分 ' + seconds + ' 秒' : seconds + ' 秒';
  const despawnText = latest.despawnTimestamp
    ? new Date(latest.despawnTimestamp * 1000).toLocaleTimeString('zh-CN', {
        hour12: false,
        timeZone: 'Asia/Shanghai',
      })
    : '未知';
  const lines = [
    '【头目报点】' + name + ' #' + latest.monsterId +
      (region ? ' ' + region : '') + (loc ? ' ' + loc : ''),
    '地区：' + (region || '未知'),
    '地点：' + (loc || '未知'),
    '剩余：' + timeText + '（' + despawnText + ' 消失）',
  ];
  const saved = loadJson(BOSS_LAST_PATH, null);
  if (saved) {
    lines.push('', '', '');
    lines.push(buildBossLastBody(saved));
  }
  return lines.join('\n');
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
  const alpha = status && status.alpha;
  const saved = loadJson(BOSS_LAST_PATH, null);

  // alphapedia 只提供「最新头目」；未消失则视为活跃，否则作为最近一次出现记录
  let latest = alpha || null;
  const savedTime = saved ? Date.parse(saved.timestampUtc || '') || 0 : 0;
  const latestTime = latest ? Date.parse(latest.timestampUtc || '') || 0 : 0;
  if (latest && latestTime > savedTime) {
    saveJson(BOSS_LAST_PATH, latest);
  }

  let text;
  if (latest && (!latest.despawnTimestamp || latest.despawnTimestamp > now)) {
    text = buildBossActiveSection([latest]);
  } else if (latest) {
    text = buildBossLastLine(latest);
  } else if (saved) {
    text = buildBossLastLine(saved);
  } else {
    text = '';
  }
  // 返回展示文本 + 最新一条记录的时间戳（用于“有新头目才推送”的判定）
  return { text, latestTs: (latest || saved || null) ? String((latest || saved).timestampUtc || '') : '' };
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
  if (!pushAllActive) {
    const fresh = list.filter((item) => {
      if (!item || item.sourceId == null || !passesFilter(item)) return false;
      return !seen.has(String(item.sourceId));
    });
    for (const item of fresh) {
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
    return;
  }

  const active = list.filter(
    (item) =>
      item &&
      item.sourceId != null &&
      passesFilter(item) &&
      (!item.despawnTimestamp || item.despawnTimestamp > now)
  );
  // 头目段复用同一份 alphapedia 状态（避免二次请求）
  const boss = await buildBossSection(status).catch((err) => {
    fail('头目报点处理失败：', err.message);
    return { text: '', latestTs: '' };
  });

  // 只在「有新增明雷」或「出现新头目」时才推送，避免每轮 cron 重复轰炸同一批活跃明雷
  const lastSent = loadJson(LAST_SENT_PATH, { swarmIds: [], bossTime: '' });
  const fresh = active.filter((item) => !lastSent.swarmIds.includes(String(item.sourceId)));
  const newBoss = Boolean(boss.latestTs && boss.latestTs !== lastSent.bossTime);
  if (!fresh.length && !newBoss) {
    log('无新增明雷/头目，跳过本轮推送');
    return;
  }

  let message;
  if (!fresh.length) {
    message = '【明雷报点】当前无活跃明雷' + (boss.text ? BOSS_SEPARATOR + boss.text : '');
    log('无新增明雷，仅因新头目推送');
  } else {
    const featured = fresh
      .slice()
      .sort((a, b) => new Date(b.timestampUtc || 0) - new Date(a.timestampUtc || 0))[0];
    const others = active.filter(
      (other) => String(other.sourceId) !== String(featured.sourceId)
    );
    message =
      buildPushMessage(featured, others) +
      (boss.text ? BOSS_SEPARATOR + boss.text : '');
    log('推送新增明雷：', featured.pokemon || featured.monsterId, '（新增', fresh.length, '条，活跃共', active.length, '条）');
  }
  try {
    await sendMessage(message);
    lastSent.swarmIds = active.map((item) => String(item.sourceId));
    lastSent.bossTime = boss.latestTs || lastSent.bossTime;
    saveJson(LAST_SENT_PATH, lastSent);
    log('推送成功，已记录本轮状态。');
  } catch (err) {
    // 推送失败不更新状态：下轮会把未送达的明雷/头目视为新增重试
    fail('推送失败（下轮自动重试）：', err.message);
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
    const item = (list.find((x) => x && passesFilter(x))) || list[0];
    const content = item
      ? formatMessage(item)
      : '【明雷报点测试】\n当前没有正在报点的明雷，机器人通道工作正常。';
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
    if (loadJson(OUTAGE_PATH, { notified: false }).notified) {
      saveJson(OUTAGE_PATH, { notified: false });
      log('上游已恢复，清除故障标记。');
    }
    return 0;
  } catch (err) {
    // 上游临时故障（重试耗尽仍 5xx/429/断网）不算失败：本轮跳过，下轮定时检查会补上
    if (err && err.transient) {
      const state = loadJson(OUTAGE_PATH, { notified: false });
      if (!state.notified) {
        try {
          await sendMessage('【明雷报点】⚠️ 本轮检查失败：上游接口持续不可用（' + err.message + '），已自动重试仍未恢复，本轮报点暂停，恢复后自动继续。');
          state.notified = true;
          saveJson(OUTAGE_PATH, state);
          log('已向群内播报本轮故障。');
        } catch (sendErr) {
          fail('故障通知发送失败：', sendErr.message);
        }
      } else {
        log('上游仍不可用（' + err.message + '），本轮跳过（故障已播报过）。');
      }
      return 0;
    }
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
