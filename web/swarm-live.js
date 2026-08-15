window.SwarmLive = (function () {
  'use strict';

  var API_URL = 'https://pokemoyu.com/api/swarm-pings/current';
  var POLL_INTERVAL = 15 * 1000;
  var REGION_NAMES = {
    Kanto: '关都',
    Johto: '城都',
    Hoenn: '丰缘',
    Sinnoh: '神奥',
    Unova: '合众',
  };

  var root = document.getElementById('swarmPanel');
  var bodyEl = document.getElementById('swarmBody');
  var dotEl = document.getElementById('swarmDot');
  var statusEl = document.getElementById('swarmStatus');
  var updatedEl = document.getElementById('swarmUpdated');
  var refreshBtnEl = document.getElementById('swarmRefreshBtn');
  var nameById = new Map();
  var spriteBase = '../sprites/monstericons/';
  var pollTimer = null;
  var tickTimer = null;
  var items = [];
  var lastUpdate = null;
  var pageHidden = false;

  function buildNameMap() {
    var data = window.POKEMON_DATA;
    if (!data || !Array.isArray(data.r)) return;
    data.r.forEach(function (record) {
      var id = record[0];
      if (id != null && !nameById.has(id)) {
        nameById.set(id, {
          name: record[2] || String(id),
          types: record[3] || [],
        });
      }
    });
  }

  function spriteUrl(id) {
    if (window.INLINE_SPRITES) {
      return window.INLINE_SPRITES[id + '-0'] || '';
    }
    return spriteBase + id + '-0.png';
  }

  function regionLabel(region) {
    return REGION_NAMES[region] || region || '未知地区';
  }

  function formatRemaining(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    var minutes = Math.floor(seconds / 60);
    var secs = Math.floor(seconds % 60);
    return minutes + ':' + String(secs).padStart(2, '0');
  }

  function esc(value) {
    var div = document.createElement('div');
    div.textContent = String(value == null ? '' : value);
    return div.innerHTML;
  }

  function imgError(img) {
    var fallback = document.createElement('span');
    fallback.className = 'swarm-sprite-fallback';
    fallback.textContent = (img && img.alt ? img.alt : '?').charAt(0) || '?';
    if (img && img.parentNode) img.parentNode.replaceChild(fallback, img);
  }

  function render() {
    if (!bodyEl) return;
    var now = Math.floor(Date.now() / 1000);
    var active = items
      .filter(function (item) {
        return item &&
          typeof item.despawnTimestamp === 'number' &&
          item.despawnTimestamp > now;
      })
      .sort(function (a, b) {
        return a.despawnTimestamp - b.despawnTimestamp;
      });

    if (active.length === 0) {
      bodyEl.innerHTML = '<div class="swarm-empty">当前没有明雷报点</div>';
      return;
    }

    bodyEl.innerHTML = active.map(function (item) {
      var info = nameById.get(item.monsterId) || {
        name: item.pokemon || ('#' + item.monsterId),
      };
      var src = spriteUrl(item.monsterId);
      var remain = Math.max(0, item.despawnTimestamp - now);
      var valuable = item.hasValuable
        ? '<span class="swarm-valuable">有价值</span>'
        : '';
      var spriteHtml = src
        ? '<img src="' + src + '" alt="' + esc(info.name) + '" ' +
          'data-id="' + item.monsterId + '" data-form="0" ' +
          'onerror="SwarmLive.imgError(this)">'
        : '<span class="swarm-sprite-fallback">' + esc(String(info.name).charAt(0) || '?') + '</span>';

      return '' +
        '<article class="swarm-card">' +
          '<div class="swarm-sprite-wrap">' + spriteHtml + '</div>' +
          '<div class="swarm-card-body">' +
            '<div class="swarm-name-row">' +
              '<h3>' + esc(info.name) + '</h3>' +
              '<small>#' + esc(item.monsterId) + '</small>' +
              valuable +
            '</div>' +
            '<div class="swarm-loc">' +
              esc(regionLabel(item.region)) + ' · ' + esc(item.location || '?') +
            '</div>' +
            '<div class="swarm-meta-row">' +
              '<span class="swarm-time">剩余 <strong data-remain="' + item.despawnTimestamp + '">' +
                formatRemaining(remain) + '</strong></span>' +
              '<span class="swarm-reporter">报点：' + esc(item.publishedBy || '匿名') + '</span>' +
            '</div>' +
          '</div>' +
        '</article>';
    }).join('');
  }

  function updateTimes() {
    var now = Math.floor(Date.now() / 1000);
    var expired = false;
    document.querySelectorAll('.swarm-time strong[data-remain]').forEach(function (el) {
      var remain = Number(el.dataset.remain) - now;
      if (remain <= 0) {
        expired = true;
        return;
      }
      el.textContent = formatRemaining(remain);
    });
    if (expired) render();
  }

  function setStatus(state, message) {
    if (!dotEl || !statusEl) return;
    dotEl.className = 'swarm-dot ' + state;
    statusEl.textContent = message || '';
    if (state === 'live' && updatedEl && lastUpdate) {
      var time = lastUpdate.toTimeString().slice(0, 8);
      updatedEl.textContent = '更新于 ' + time;
    } else if (updatedEl) {
      updatedEl.textContent = '';
    }
  }

  function fetchSwarms() {
    fetch(API_URL, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        items = Array.isArray(data) ? data : [];
        lastUpdate = new Date();
        setStatus('live', '实时连接');
        render();
      })
      .catch(function () {
        setStatus('error', '报点服务暂不可用');
        if (items.length === 0) {
          bodyEl.innerHTML =
            '<div class="swarm-empty swarm-error">暂时无法连接报点服务，正在自动重试…</div>';
        }
      })
      .then(function () {
        if (refreshBtnEl) refreshBtnEl.disabled = false;
        schedule();
      });
  }

  function refresh() {
    if (refreshBtnEl) refreshBtnEl.disabled = true;
    setStatus('loading', '刷新中…');
    fetchSwarms();
  }

  function schedule() {
    window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(function () {
      if (!pageHidden) fetchSwarms();
    }, POLL_INTERVAL);
  }

  function onVisibilityChange() {
    pageHidden = document.hidden;
    if (pageHidden) {
      window.clearTimeout(pollTimer);
      window.clearInterval(tickTimer);
      return;
    }
    fetchSwarms();
    tickTimer = window.setInterval(updateTimes, 1000);
  }

  function init(options) {
    if (!root || !bodyEl) return;
    if (options && options.spriteBase) spriteBase = options.spriteBase;
    buildNameMap();
    setStatus('loading', '连接中…');
    fetchSwarms();
    tickTimer = window.setInterval(updateTimes, 1000);
    if (refreshBtnEl) {
      refreshBtnEl.addEventListener('click', refresh);
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  if (root && bodyEl) {
    init();
  }

  return {
    init: init,
    imgError: imgError,
    render: render,
    refresh: refresh,
  };
})();
