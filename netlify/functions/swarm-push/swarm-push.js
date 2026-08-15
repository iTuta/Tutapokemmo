import { getStore } from '@netlify/blobs';
import monsterNames from '../_data/monster-names.js';

const POKEMOYU_API = 'https://pokemoyu.com/api/swarm-pings/current';
const SEEN_KEY = 'seen';
const SEEN_TTL_DAYS = 2;

const REGION_NAMES = {
  Kanto: '关都',
  Johto: '城都',
  Hoenn: '丰缘',
  Sinnoh: '神奥',
  Unova: '合众',
};

function configValue(name, fallback) {
  const value = process.env[name];
  return value == null || value === '' ? fallback : value;
}

function passesFilter(item) {
  if (configValue('SWARM_ONLY_VALUABLE', '') === 'true' && !item.hasValuable) return false;
  const regions = configValue('SWARM_REGIONS', '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (regions.length && !regions.includes(item.region)) return false;
  const monsterIds = configValue('SWARM_MONSTER_IDS', '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '')
    .map(Number)
    .filter((value) => Number.isFinite(value));
  if (monsterIds.length && !monsterIds.includes(item.monsterId)) return false;
  return true;
}

function formatMessage(item) {
  const name = monsterNames[item.monsterId] || item.pokemon || ('#' + item.monsterId);
  const region = REGION_NAMES[item.region] || item.region || '未知地区';
  const remain = Math.max(0, (item.despawnTimestamp || 0) - Math.floor(Date.now() / 1000));
  const minutes = Math.floor(remain / 60);
  const seconds = remain % 60;
  const timeText = minutes > 0 ? minutes + ' 分 ' + seconds + ' 秒' : seconds + ' 秒';
  const despawnText = item.despawnTimestamp
    ? new Date(item.despawnTimestamp * 1000).toLocaleTimeString('zh-CN', { hour12: false })
    : '未知';
  const valuable = item.hasValuable ? '（有价值）' : '';
  return [
    '【明雷报点】' + name + ' #' + item.monsterId + valuable,
    '地区：' + region,
    '地点：' + (item.location || '未知'),
    '剩余：' + timeText + '（' + despawnText + ' 消失）',
    '报点：' + (item.publishedBy || '匿名'),
  ].join('\n');
}

async function sendWechat(webhook, content) {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'text', text: { content } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errcode !== 0) {
    throw new Error('微信推送失败 HTTP ' + res.status + ' ' + JSON.stringify(data));
  }
}

async function fetchCurrent() {
  const res = await fetch(POKEMOYU_API, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export default async (req) => {
  const webhook = process.env.WECHAT_WEBHOOK;
  if (!webhook) {
    console.error('缺少环境变量 WECHAT_WEBHOOK，请先在 Netlify 站点设置中添加。');
    return new Response('missing WECHAT_WEBHOOK', { status: 500 });
  }

  let store = null;
  try {
    store = getStore('swarm-push-seen');
  } catch (err) {
    console.error('无法访问云端存储（Netlify 环境自动注入，本地运行属正常）：', err.message);
  }
  const seen = {};
  if (store) {
    try {
      const saved = await store.get(SEEN_KEY, { type: 'json' });
      if (saved && typeof saved === 'object') Object.assign(seen, saved);
    } catch (err) {
      console.error('读取已推送记录失败：', err.message);
    }
  }

  const cutoff = Math.floor(Date.now() / 1000) - SEEN_TTL_DAYS * 86400;
  for (const key of Object.keys(seen)) {
    if (Number(seen[key]) < cutoff) delete seen[key];
  }

  let list = [];
  try {
    list = await fetchCurrent();
  } catch (err) {
    console.error('拉取报点失败：', err.message);
    return new Response('fetch failed', { status: 500 });
  }

  const fresh = list.filter(
    (item) =>
      item &&
      item.sourceId != null &&
      !(String(item.sourceId) in seen) &&
      passesFilter(item)
  );

  let pushed = 0;
  for (const item of fresh) {
    try {
      await sendWechat(webhook, formatMessage(item));
      seen[String(item.sourceId)] = item.despawnTimestamp || Math.floor(Date.now() / 1000);
      pushed += 1;
    } catch (err) {
      console.error('推送失败（下次运行自动重试）：', err.message);
    }
  }

  if (store) {
    try {
      await store.setJSON(SEEN_KEY, seen);
    } catch (err) {
      console.error('保存已推送记录失败：', err.message);
    }
  }

  console.log('本轮新增明雷：' + pushed + ' 条，当前记录：' + Object.keys(seen).length + ' 条');
  return new Response('ok', { status: 200 });
};

export const config = {
  schedule: '*/2 * * * *',
};
