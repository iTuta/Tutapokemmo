import monsterNames from '../_data/monster-names.js';

const POKEMOYU_API = 'https://pokemoyu.com/api/swarm-pings/current';

const REGION_NAMES = {
  Kanto: '关都',
  Johto: '城都',
  Hoenn: '丰缘',
  Sinnoh: '神奥',
  Unova: '合众',
};

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
    '【明雷报点测试】' + name + ' #' + item.monsterId + valuable,
    '地区：' + region,
    '地点：' + (item.location || '未知'),
    '剩余：' + timeText + '（' + despawnText + ' 消失）',
    '报点：' + (item.publishedBy || '匿名'),
  ].join('\n');
}

export default async (req) => {
  const webhook = process.env.WECHAT_WEBHOOK;
  const token = process.env.SWARM_TEST_TOKEN;
  if (!webhook) {
    return new Response('missing WECHAT_WEBHOOK', { status: 500 });
  }
  const url = new URL(req.url);
  if (token && url.searchParams.get('token') !== token) {
    return new Response('forbidden', { status: 403 });
  }

  let list = [];
  try {
    const res = await fetch(POKEMOYU_API, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    list = Array.isArray(data) ? data : [];
  } catch (err) {
    return new Response('拉取报点失败：' + err.message, { status: 500 });
  }

  const item = list[0];
  const content = item
    ? formatMessage(item)
    : '【明雷报点测试】\n当前没有正在报点的明雷，机器人通道工作正常。';
  try {
    const sendRes = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content } }),
    });
    const data = await sendRes.json().catch(() => ({}));
    if (!sendRes.ok || data.errcode !== 0) {
      return new Response('微信推送失败 HTTP ' + sendRes.status + ' ' + JSON.stringify(data), {
        status: 500,
      });
    }
    return new Response('测试消息已发送。', { status: 200 });
  } catch (err) {
    return new Response('发送失败：' + err.message, { status: 500 });
  }
};
