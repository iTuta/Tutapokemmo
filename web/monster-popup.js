window.MonsterPopup = (function () {
  var F = {};
  var spriteBase = null;
  var typeColors = {};
  var recordsById = new Map();
  var hordeByLocation = new Map();
  var experienceSortDirection = '';
  var experienceSortSingleRecord = false;

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function spriteUrl(id, form) {
    var inlineSprites = window.INLINE_SPRITES;
    if (inlineSprites) {
      return inlineSprites[id + '-' + form] || inlineSprites[id + '-0'] || '';
    }
    return spriteBase ? spriteBase + id + '-' + form + '.png' : '';
  }

  function hordeBadge(h) {
    if (h === 3) return '<span class="lp-badge lp-badge-3">3群怪</span>';
    if (h === 5) return '<span class="lp-badge lp-badge-5">5群怪</span>';
    return '<span class="lp-badge lp-badge-none">普通</span>';
  }

  function seasonBadge(s) {
    if (s === '任意') return '<span class="lp-badge lp-badge-any">任意</span>';
    return '<span class="lp-badge lp-badge-season">' + esc(s) + '</span>';
  }

  function timeTags(r) {
    return [
      ['晨', 'morning', r[F.MORNING], r[F.R_MORNING]],
      ['昼', 'day', r[F.DAY], r[F.R_DAY]],
      ['夜', 'night', r[F.NIGHT], r[F.R_NIGHT]],
    ].map(function (item) {
      var label = item[0], timeKey = item[1], active = item[2], rate = item[3];
      if (!active) {
        return '<span class="lp-time lp-time-off" title="该时段无遭遇">' + label + '</span>';
      }

      var attrs =
        ' data-time="' + timeKey + '"' +
        ' data-region="' + escAttr(r[F.REGION]) + '"' +
        ' data-loc="' + escAttr(r[F.LOC]) + '"' +
        ' data-terrain="' + escAttr(r[F.TERRAIN]) + '"' +
        ' data-season="' + escAttr(r[F.SEASON]) + '"' +
        ' data-source-id="' + escAttr(r[F.ID]) + '"' +
        ' data-source-level="' + escAttr(r[F.LEVEL]) + '"' +
        ' data-source-horde="' + escAttr(r[F.HORDE]) + '"' +
        ' data-source-rate="' + escAttr(rate) + '"';
      return '<span class="lp-time lp-time-on mp-time-clickable" role="button" tabindex="0"' + attrs +
        ' title="点击查看该地点该时段的全部遭遇">' +
        label + (active ? ' ' + esc(rate) : '') + '</span>';
    }).join('');
  }

  function ensureModal() {
    if (document.getElementById('monsterPopup')) return;
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="monsterPopup" class="lp-overlay" hidden>' +
        '<div class="lp-dialog mp-dialog" role="dialog" aria-modal="true">' +
          '<div class="lp-header">' +
            '<div class="mp-header-main">' +
              '<div class="mp-header-sprite"></div>' +
              '<div><h2 class="lp-title mp-title"></h2><p class="lp-subtitle mp-subtitle"></p></div>' +
            '</div>' +
            '<button type="button" class="lp-close" aria-label="关闭">&times;</button>' +
          '</div>' +
          '<div class="lp-summary mp-summary"></div>' +
          '<div class="lp-body mp-body"></div>' +
        '</div>' +
      '</div>'
    );

    var overlay = document.getElementById('monsterPopup');
    overlay.querySelector('.lp-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlay.hidden) close();
    });
  }

  function close() {
    var overlay = document.getElementById('monsterPopup');
    if (overlay) overlay.hidden = true;
  }

  function show() {
    var overlay = document.getElementById('monsterPopup');
    if (overlay) overlay.hidden = false;
  }

  function init(fieldMap, options) {
    options = options || {};
    F = fieldMap;
    spriteBase = options.spriteBase || null;
    typeColors = options.typeColors || {};
    buildHordeIndex(options.records);
    ensureModal();
  }

  // 混群点索引：按 地区+地点+地形 归组 5 群怪记录，用于按闪战分级排序时取混群成员
  function buildHordeIndex(records) {
    hordeByLocation.clear();
    if (!records) return;
    records.forEach(function (r) {
      if (r[F.HORDE] !== 5) return;
      var key = r[F.REGION] + '\u0000' + r[F.LOC] + '\u0000' + r[F.TERRAIN];
      if (!hordeByLocation.has(key)) hordeByLocation.set(key, []);
      hordeByLocation.get(key).push(r);
    });
  }

  // 点位闪战分数序列：混群点取组内所有成员分级分数（降序），逐位比较决定排序，
  // 高分精灵越多越靠前，序列相同时成员更多者靠前；非混群点只有自身一档分数
  function tierSortScore(record) {
    var own = window.TierDisplay ? TierDisplay.get(record[F.ID]) : null;
    var ownScore = own ? own[1] : -1;
    if (record[F.HORDE] !== 5) return { scores: [ownScore] };
    var key = record[F.REGION] + '\u0000' + record[F.LOC] + '\u0000' + record[F.TERRAIN];
    var members = (hordeByLocation.get(key) || []).filter(function (m) {
      return m[F.SEASON] === '任意' || record[F.SEASON] === '任意' || m[F.SEASON] === record[F.SEASON];
    });
    if (!members.length) return { scores: [ownScore] };
    var scores = members.map(function (m) {
      var t = window.TierDisplay ? TierDisplay.get(m[F.ID]) : null;
      return t ? t[1] : -1;
    });
    scores.sort(function (a, b) { return b - a; });
    return { scores: scores };
  }

  function compareTierScores(a, b) {
    var sa = a.scores;
    var sb = b.scores;
    var len = Math.max(sa.length, sb.length);
    for (var i = 0; i < len; i++) {
      var va = i < sa.length ? sa[i] : -Infinity;
      var vb = i < sb.length ? sb[i] : -Infinity;
      if (va !== vb) return vb - va;
    }
    return 0;
  }

  function setRecordsById(map) {
    recordsById = map;
  }

  function setExperienceSort(direction, singleRecord) {
    experienceSortDirection = direction === 'asc' || direction === 'desc' ? direction : '';
    experienceSortSingleRecord = Boolean(singleRecord);
  }

  function bindRoot(root) {
    if (!root || root._mpBound) return;
    root._mpBound = true;
    root.addEventListener('click', function (e) {
      var timeTag = e.target.closest('.mp-time-clickable');
      if (timeTag) {
        e.preventDefault();
        openLocationFromTag(timeTag);
        return;
      }

      var el = e.target.closest('.mon-name-link');
      if (!el) return;
      e.preventDefault();
      open(parseInt(el.dataset.id, 10));
    });
    root.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var timeTag = e.target.closest('.mp-time-clickable');
      if (!timeTag) return;
      e.preventDefault();
      openLocationFromTag(timeTag);
    });
  }

  function openLocationFromTag(tag) {
    if (!window.LocationPopup || typeof window.LocationPopup.open !== 'function') return;
    close();
    var options = { onBack: show };
    var purePointToggle = document.getElementById('purePointToggle');
    if (purePointToggle && purePointToggle.checked) {
      options.filterMode = 'purePoint';
    }
    if (tag.dataset.sourceId != null) options.sourceId = parseInt(tag.dataset.sourceId, 10);
    if (tag.dataset.sourceLevel != null) options.sourceLevel = tag.dataset.sourceLevel;
    if (tag.dataset.sourceHorde != null) options.sourceHorde = parseInt(tag.dataset.sourceHorde, 10);
    if (tag.dataset.sourceRate != null) options.sourceRate = tag.dataset.sourceRate;
    window.LocationPopup.open(
      tag.dataset.region,
      tag.dataset.loc,
      tag.dataset.terrain,
      tag.dataset.season,
      tag.dataset.time,
      options
    );
  }

  function open(id) {
    var records = (recordsById.get(id) || []).slice();
    records = dedupeExact(records);
    var overlay = document.getElementById('monsterPopup');
    if (!records.length) {
      overlay.querySelector('.mp-title').textContent = '未找到分布';
      overlay.querySelector('.mp-subtitle').textContent = '';
      overlay.querySelector('.mp-summary').innerHTML = '';
      overlay.querySelector('.mp-body').innerHTML = '<div class="lp-empty">没有分布记录</div>';
      overlay.querySelector('.mp-header-sprite').innerHTML = '';
      overlay.hidden = false;
      return;
    }

    var r0 = records[0];
    var idNum = r0[F.ID];
    var form = r0[F.FORM] != null ? r0[F.FORM] : 0;

    overlay.querySelector('.mp-title').textContent = r0[F.BASE];
    overlay.querySelector('.mp-subtitle').textContent = '#' + idNum + ' · ' + r0[F.NAME];

    var spriteHtml = '';
    if (spriteBase) {
      var spriteSrc = spriteUrl(idNum, form);
      if (spriteSrc) {
        spriteHtml = '<img class="mp-sprite" src="' + spriteSrc + '" alt=""' +
          ' onerror="this.style.visibility=\'hidden\'">';
      }
    }
    overlay.querySelector('.mp-header-sprite').innerHTML = spriteHtml;

    var h3 = records.filter(function (r) { return r[F.HORDE] === 3; }).length;
    var h5 = records.filter(function (r) { return r[F.HORDE] === 5; }).length;
    var normal = records.filter(function (r) { return r[F.HORDE] === 0; }).length;

    overlay.querySelector('.mp-summary').innerHTML =
      (window.TierDisplay ? TierDisplay.badgeHtml(idNum, 'mp-tier tier-badge') : '') +
      '<span class="lp-stat">共 ' + records.length + ' 处分布</span>' +
      '<span class="lp-stat">普通 ' + normal + '</span>' +
      (h3 ? '<span class="lp-stat lp-stat-3">3群怪 ' + h3 + '</span>' : '') +
      (h5 ? '<span class="lp-stat lp-stat-5">5群怪 ' + h5 + '</span>' : '');

    records.sort(function (a, b) {
      if (experienceSortDirection && window.HordeYield) {
        var scoreA = HordeYield.mixedExperienceScore(a, F, experienceSortSingleRecord ? [a] : undefined);
        var scoreB = HordeYield.mixedExperienceScore(b, F, experienceSortSingleRecord ? [b] : undefined);
        if (scoreB !== scoreA) {
          return experienceSortDirection === 'desc' ? scoreB - scoreA : scoreA - scoreB;
        }
      } else {
        var cmpTier = compareTierScores(tierSortScore(a), tierSortScore(b));
        if (cmpTier !== 0) return cmpTier;
      }
      var ra = a[F.REGION] + a[F.LOC];
      var rb = b[F.REGION] + b[F.LOC];
      return ra.localeCompare(rb, 'zh-CN');
    });

    overlay.querySelector('.mp-body').innerHTML =
      '<div class="mp-list">' +
      records.map(function (r) {
        return (
          '<div class="mp-row' + (r[F.HORDE] ? ' mp-row-horde' : '') + '">' +
            '<div class="mp-row-loc">' +
              '<strong>' + esc(r[F.REGION]) + '</strong>' +
              '<span>' + esc(r[F.LOC]) + '</span>' +
            '</div>' +
            '<div class="mp-row-meta">' +
              '<span class="lp-badge mp-terrain">' + esc(r[F.TERRAIN]) + '</span>' +
              '<span class="lp-badge mp-level">Lv.' + esc(r[F.LEVEL]) + '</span>' +
              seasonBadge(r[F.SEASON]) +
              hordeBadge(r[F.HORDE]) +
              '<span class="mp-times">' + timeTags(r) + '</span>' +
            '</div>' +
            (window.HordeYield ? HordeYield.render(r, F, experienceSortSingleRecord ? [r] : undefined) : '') +
          '</div>'
        );
      }).join('') +
      '</div>';

    overlay.hidden = false;
  }

  function dedupeRecords(records) {
    var map = new Map();
    records.forEach(function (r) {
      var id = r[F.ID];
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(r);
    });
    return Array.from(map.entries()).map(function (entry) {
      return { id: entry[0], rep: entry[1][0], count: entry[1].length, records: entry[1] };
    }).sort(function (a, b) {
      return a.rep[F.BASE].localeCompare(b.rep[F.BASE], 'zh-CN');
    });
  }

  // 同一地点名可能合并多个区域而产生完全相同的记录（如罗斯山隧道冬季的几何雪花），
  // 精灵详情只展示一条；混群分组与收益仍使用全部记录。
  function dedupeExact(records) {
    var seen = new Set();
    return records.filter(function (r) {
      var sig = [
        r[F.ID], r[F.LOC], r[F.TERRAIN], r[F.LEVEL], r[F.SEASON], r[F.HORDE],
        r[F.MORNING], r[F.DAY], r[F.NIGHT],
        r[F.R_MORNING], r[F.R_DAY], r[F.R_NIGHT], r[F.FORM],
      ].join('\u0000');
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
  }

  function buildRecordsById(records) {
    var map = new Map();
    records.forEach(function (r) {
      var id = r[F.ID];
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(r);
    });
    return map;
  }

  return {
    init: init,
    bindRoot: bindRoot,
    setRecordsById: setRecordsById,
    setExperienceSort: setExperienceSort,
    buildRecordsById: buildRecordsById,
    dedupeRecords: dedupeRecords,
    open: open,
    close: close,
  };
})();
