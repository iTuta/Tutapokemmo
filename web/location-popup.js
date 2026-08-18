window.LocationPopup = (function () {
  const TIME_LABELS = { morning: '早晨', day: '白天', night: '夜晚' };
  const HORDE_LABELS = { 0: '普通', 3: '3群怪', 5: '5群怪' };
  const GROUP_LABELS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
  const GROUP_COLORS = ['#fbbf24', '#4ade80', '#60a5fa', '#f472b6', '#a78bfa', '#fb923c', '#2dd4bf', '#f87171'];

  let F = {};
  let locationIndex = new Map();
  let spriteBase = null;
  let typeColors = {};
  let popupState = null;
  let hordeFilter = '';

  function locKey(region, loc, terrain) {
    return region + '\0' + loc + '\0' + terrain;
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function escAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function seasonMatch(a, b) {
    if (a === '任意' || b === '任意') return true;
    return a === b;
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

  function typeBadges(types) {
    return types.map(function (t) {
      var c = typeColors[t] || '#607d8b';
      return '<span class="lp-type" style="background:' + c + '">' + esc(t) + '</span>';
    }).join('');
  }

  function spriteHtml(id, form) {
    if (!spriteBase) return '';
    var src = spriteUrl(id, form);
    if (!src) return '';
    return (
      '<img class="lp-sprite" src="' + src + '" alt="" loading="lazy"' +
      ' data-id="' + id + '" data-form="' + form + '"' +
      ' onerror="LocationPopup.fallbackSprite(this)">'
    );
  }

  function ensureModal() {
    if (document.getElementById('locationPopup')) return;
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="locationPopup" class="lp-overlay" hidden>' +
        '<div class="lp-dialog" role="dialog" aria-modal="true">' +
          '<div class="lp-header">' +
            '<div class="lp-header-content">' +
              '<button type="button" class="lp-back" aria-label="返回地点列表" title="返回地点列表" hidden>&larr;</button>' +
              '<div class="lp-heading"><h2 class="lp-title"></h2><p class="lp-subtitle"></p></div>' +
            '</div>' +
            '<button type="button" class="lp-close" aria-label="关闭">&times;</button>' +
          '</div>' +
          '<div class="lp-time-switch" role="group" aria-label="切换时间段"></div>' +
          '<div class="lp-summary"></div>' +
          '<div class="lp-body"></div>' +
        '</div>' +
      '</div>'
    );

    var overlay = document.getElementById('locationPopup');
    overlay.querySelector('.lp-back').addEventListener('click', goBack);
    overlay.querySelector('.lp-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    overlay.querySelector('.lp-time-switch').addEventListener('click', function (e) {
      var btn = e.target.closest('.lp-time-option');
      if (!btn || btn.disabled || !popupState || btn.dataset.time === popupState.timeKey) return;
      switchTime(btn.dataset.time, true);
    });
    overlay.querySelector('.lp-summary').addEventListener('click', function (e) {
      var btn = e.target.closest('.lp-filter');
      if (!btn || !popupState) return;
      var filter = btn.dataset.horde;
      if (filter === hordeFilter) return;
      hordeFilter = filter;
      renderPopupContent();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlay.hidden) close();
    });
  }

  function close() {
    var overlay = document.getElementById('locationPopup');
    if (overlay) overlay.hidden = true;
    popupState = null;
    hordeFilter = '';
  }

  function spriteUrl(id, form) {
    var inlineSprites = window.INLINE_SPRITES;
    if (inlineSprites) {
      return inlineSprites[id + '-' + form] || inlineSprites[id + '-0'] || '';
    }
    return spriteBase ? spriteBase + id + '-' + form + '.png' : '';
  }

  function goBack() {
    if (!popupState || typeof popupState.onBack !== 'function') return;
    var onBack = popupState.onBack;
    close();
    onBack();
  }

  function countByHorde(matches) {
    return {
      all: matches.length,
      0: matches.filter(function (r) { return r[F.HORDE] === 0; }).length,
      3: matches.filter(function (r) { return r[F.HORDE] === 3; }).length,
      5: matches.filter(function (r) { return r[F.HORDE] === 5; }).length,
    };
  }

  function renderSummary(counts) {
    var filters = [
      { key: '', label: '全部', count: counts.all, cls: 'lp-filter-all' },
      { key: '0', label: '普通', count: counts[0], cls: 'lp-filter-none' },
      { key: '3', label: '3群怪', count: counts[3], cls: 'lp-filter-3' },
      { key: '5', label: '5群怪', count: counts[5], cls: 'lp-filter-5' },
    ];
    return filters.map(function (f) {
      var active = hordeFilter === f.key ? ' lp-filter-active' : '';
      var disabled = f.count === 0 && f.key !== '' ? ' lp-filter-disabled' : '';
      return (
        '<button type="button" class="lp-filter ' + f.cls + active + disabled + '"' +
        ' data-horde="' + f.key + '"' +
        (f.count === 0 && f.key !== '' ? ' disabled' : '') + '>' +
        esc(f.label) + ' <span class="lp-filter-count">' + f.count + '</span>' +
        '</button>'
      );
    }).join('');
  }

  function timeFields(timeKey) {
    if (timeKey === 'morning') return { active: F.MORNING, rate: F.R_MORNING };
    if (timeKey === 'day') return { active: F.DAY, rate: F.R_DAY };
    return { active: F.NIGHT, rate: F.R_NIGHT };
  }

  function renderTimeSwitch() {
    var times = [
      { key: 'morning', label: '早晨' },
      { key: 'day', label: '白天' },
      { key: 'night', label: '夜晚' },
    ];
    return times.map(function (time) {
      var fields = timeFields(time.key);
      // 无论是否纯点模式，只要该时段有遭遇即可切换
      var available = popupState.candidates.some(function (r) { return r[fields.active]; });
      var active = popupState.timeKey === time.key;
      return (
        '<button type="button" class="lp-time-option' + (active ? ' lp-time-option-active' : '') + '"' +
        ' data-time="' + time.key + '"' +
        ' aria-pressed="' + active + '"' +
        (!available ? ' disabled title="该时段无遭遇"' : '') + '>' +
        time.label +
        '</button>'
      );
    }).join('');
  }

  function renderRow(r, rateField, groupIndex, encounterRecords) {
    var form = r[F.FORM] != null ? r[F.FORM] : 0;
    var rate = r[rateField];
    var groupHtml = '';
    if (groupIndex != null && popupState.groups && popupState.groups.length > 1) {
      var color = GROUP_COLORS[groupIndex % GROUP_COLORS.length];
      groupHtml = '<span class="lp-horde-badge" style="color:' + color + ';border-color:' + color + '">混群' + GROUP_LABELS[groupIndex % GROUP_LABELS.length] + '</span>';
    }
    return (
      '<div class="lp-row' + (r[F.HORDE] ? ' lp-row-horde' : '') + '">' +
        (spriteBase ? '<div class="lp-sprite-wrap">' + spriteHtml(r[F.ID], form) + '</div>' : '') +
        '<div class="lp-row-main">' +
          '<div class="lp-row-title">' +
            '<strong>' + esc(r[F.BASE]) + '</strong>' +
              '<small>#' + r[F.ID] + '</small>' +
              (window.TierDisplay ? TierDisplay.badgeHtml(r[F.ID], 'lp-tier tier-badge') : '') +
              typeBadges(r[F.TYPES]) +
          '</div>' +
'<div class="lp-row-meta">' +
            '<span>Lv.' + esc(r[F.LEVEL]) + '</span>' +
            (window.SelfHarm ? SelfHarm.badgeHtml(r[F.ID], r[F.LEVEL]) : '') +
            seasonBadge(r[F.SEASON]) +
            hordeBadge(r[F.HORDE]) +
            groupHtml +
            '<span class="lp-rate">遭遇率 ' + esc(rate) + '</span>' +
          '</div>' +
          (window.HordeYield ? HordeYield.render(r, F, encounterRecords) : '') +
        '</div>' +
      '</div>'
    );
  }

  function renderList(matches, rateField, groups) {
    var filtered = hordeFilter === ''
      ? matches
      : matches.filter(function (r) { return String(r[F.HORDE]) === hordeFilter; });

    if (filtered.length === 0) {
      return '<div class="lp-empty">该分类下没有遭遇记录</div>';
    }

    // 同一档位存在多组混群（如不归之穴合并了多层未知区域）时，按组醒目标注
    if (groups && groups.length > 1) {
      return (
        '<div class="lp-list lp-list-groups">' +
        groups.map(function (group, gi) {
          var color = GROUP_COLORS[gi % GROUP_COLORS.length];
          var label = GROUP_LABELS[gi % GROUP_LABELS.length];
          var rows = group.filter(function (r) { return filtered.indexOf(r) !== -1; });
          return (
            '<div class="lp-horde-group">' +
              '<div class="lp-horde-group-head" style="color:' + color + ';border-color:' + color + ';background:' + color + '14">' +
                '混群' + label + ' <span>同一组</span>' +
              '</div>' +
              rows.map(function (r) { return renderRow(r, rateField, gi, group); }).join('') +
            '</div>'
          );
        }).join('') +
        '</div>'
      );
    }

    return (
      '<div class="lp-list">' +
      filtered.map(function (r) { return renderRow(r, rateField, null, matches); }).join('') +
      '</div>'
    );
  }

  function renderPopupContent() {
    if (!popupState) return;
    var s = popupState;
    var counts = countByHorde(s.matches);
    var overlay = document.getElementById('locationPopup');

    overlay.querySelector('.lp-time-switch').innerHTML = renderTimeSwitch();
    overlay.querySelector('.lp-summary').innerHTML = renderSummary(counts);

    var body = overlay.querySelector('.lp-body');
    var note = String(s.loc).indexOf('???') !== -1
      ? '<div class="lp-note">该地点在游戏内各区域均显示为“未知区域(???)”，无法区分具体楼层；此处按概率拆分出不同的混群组合，可凭组合成员与遭遇率对照识别。</div>'
      : '';
    if (s.matches.length === 0) {
      body.innerHTML = note + '<div class="lp-empty">该地点在此时间段没有其他遭遇</div>';
    } else {
      body.innerHTML = note + renderList(s.matches, s.rateField, s.groups);
    }
  }

  function buildIndex(records) {
    locationIndex.clear();
    records.forEach(function (r) {
      var key = locKey(r[F.REGION], r[F.LOC], r[F.TERRAIN]);
      if (!locationIndex.has(key)) locationIndex.set(key, []);
      locationIndex.get(key).push(r);
    });
  }

  function init(records, fieldMap, options) {
    options = options || {};
    F = fieldMap;
    spriteBase = options.spriteBase || null;
    typeColors = options.typeColors || {};
    buildIndex(records);
    ensureModal();
  }
  function timeTag(label, timeKey, active, rate, ctx, filterMode) {
    if (!active) {
      return (
        '<span class="time-tag inactive" title="该时段无遭遇">' + esc(label) + '</span>'
      );
    }
    return (
      '<span class="time-tag active clickable" role="button" tabindex="0"' +
      ' data-time="' + timeKey + '"' +
      ' data-region="' + escAttr(ctx.region) + '"' +
      ' data-loc="' + escAttr(ctx.loc) + '"' +
      ' data-terrain="' + escAttr(ctx.terrain) + '"' +
      ' data-season="' + escAttr(ctx.season) + '"' +
      (ctx.id != null ? ' data-source-id="' + escAttr(ctx.id) + '"' : '') +
      (ctx.level != null ? ' data-source-level="' + escAttr(ctx.level) + '"' : '') +
      (ctx.horde != null ? ' data-source-horde="' + escAttr(ctx.horde) + '"' : '') +
      (rate ? ' data-source-rate="' + escAttr(rate) + '"' : '') +
      (filterMode ? ' data-filter-mode="' + escAttr(filterMode) + '"' : '') +
      ' title="点击查看该地点' + esc(TIME_LABELS[timeKey] || label) + '的所有遭遇">' +
      esc(label) + (rate ? ' ' + esc(rate) : '') +
      '</span>'
    );
  }

  function bindRoot(root) {
    if (!root || root._lpBound) return;
    root._lpBound = true;
    root.addEventListener('click', onTagClick);
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        var tag = e.target.closest('.time-tag.clickable');
        if (tag) {
          e.preventDefault();
          openFromTag(tag);
        }
      }
    });
  }

  function onTagClick(e) {
    var tag = e.target.closest('.time-tag.clickable');
    if (tag) openFromTag(tag);
  }

  function openFromTag(tag) {
    var opts = {};
    if (tag.dataset.filterMode) {
      opts.filterMode = tag.dataset.filterMode;
    } else {
      var purePointToggle = document.getElementById('purePointToggle');
      if (purePointToggle && purePointToggle.checked) {
        opts.filterMode = 'purePoint';
      }
    }
    if (tag.dataset.sourceId != null) opts.sourceId = parseInt(tag.dataset.sourceId, 10);
    if (tag.dataset.sourceLevel != null) opts.sourceLevel = tag.dataset.sourceLevel;
    if (tag.dataset.sourceHorde != null) opts.sourceHorde = parseInt(tag.dataset.sourceHorde, 10);
    if (tag.dataset.sourceRate != null) opts.sourceRate = tag.dataset.sourceRate;
    open(
      tag.dataset.region,
      tag.dataset.loc,
      tag.dataset.terrain,
      tag.dataset.season,
      tag.dataset.time,
      opts
    );
  }

  function selectHordeFilter(matches, preserveCurrent) {
    if (preserveCurrent && (
      hordeFilter === '' ||
      matches.some(function (r) { return String(r[F.HORDE]) === hordeFilter; })
    )) {
      return;
    }
    hordeFilter = matches.some(function (r) { return r[F.HORDE] === 5; })
      ? '5'
      : matches.some(function (r) { return r[F.HORDE] === 3; })
        ? '3'
        : '';
  }

  function switchTime(timeKey, preserveFilter) {
    if (!popupState) return;
    var fields = timeFields(timeKey);
    // 展示该地点当前时段全部遭遇；多组混群时按概率合计≈5%拆分并标注
    var matches = popupState.candidates.filter(function (r) {
      return r[fields.active];
    });

    matches.sort(function (a, b) {
      if (b[F.HORDE] !== a[F.HORDE]) return b[F.HORDE] - a[F.HORDE];
      return a[F.BASE].localeCompare(b[F.BASE], 'zh-CN');
    });

    popupState.timeKey = timeKey;
    popupState.matches = matches;
    popupState.rateField = fields.rate;
    popupState.groups = buildHordeGroups(matches, fields.rate);
    selectHordeFilter(matches, preserveFilter);

    var overlay = document.getElementById('locationPopup');
    overlay.querySelector('.lp-subtitle').textContent =
      popupState.region + ' · ' + popupState.terrain + ' · ' +
      (popupState.season === '任意' ? '全季节' : popupState.season + '季') +
      ' · ' + TIME_LABELS[timeKey];
    renderPopupContent();
    overlay.querySelector('.lp-body').scrollTop = 0;
  }

  function isPurePointRate(rate) {
    return /^5(?:\.0+)?%$/.test(String(rate || '').trim());
  }

  function isPurePointRecord(r) {
    var h = r[F.HORDE];
    if (h !== 3 && h !== 5) return false;
    return isPurePointRate(r[F.R_MORNING]) ||
           isPurePointRate(r[F.R_DAY]) ||
           isPurePointRate(r[F.R_NIGHT]);
  }

  function numericRate(rate) {
    var value = parseFloat(String(rate || '').replace('%', ''));
    return Number.isFinite(value) ? value : null;
  }

  // 只对群怪记录按档位拆分组合（5群怪与3群怪分开），普通遭遇不参与分组
  function buildHordeGroups(members, rateField) {
    var result = [];
    [5, 3].forEach(function (h) {
      var groupList = partitionHordeGroups(
        members.filter(function (r) { return r[F.HORDE] === h; }),
        rateField
      );
      if (groupList) result = result.concat(groupList);
    });
    return result.length >= 2 ? result : null;
  }

  // 同一档位里可能存在多组混群（例如不归之穴把多层“未知区域”合并成一个地点名）。
  // 按概率合计≈5% 把成员拆成若干组；拆不出完整组合时返回 null，由调用方按单组展示。
  function partitionHordeGroups(members, rateField) {
    if (!members || members.length < 2) return null;
    var scored = members.map(function (m) {
      return { m: m, rate: numericRate(m[rateField]) };
    });
    if (scored.some(function (x) { return x.rate == null; })) return null;
    scored.sort(function (a, b) { return b.rate - a.rate; });

    function search(remaining) {
      if (!remaining.length) return [];
      var first = remaining[0];
      var others = remaining.slice(1);
      var combos = [];
      var i, mask;
      for (mask = 0; mask < (1 << others.length); mask++) {
        var sum = first.rate;
        var combo = [first];
        var bits = 0;
        for (i = 0; i < others.length; i++) {
          if (mask & (1 << i)) {
            sum += others[i].rate;
            combo.push(others[i]);
            bits++;
          }
        }
        if (bits > 4) continue; // 群怪最多 5 只
        if (Math.abs(sum - 5) < 0.001) combos.push(combo);
      }
      combos.push([first]); // 单只成组兜底
      for (var c = 0; c < combos.length; c++) {
        var used = new Set(combos[c]);
        var rest = remaining.filter(function (x) { return !used.has(x); });
        var result = search(rest);
        if (result) return [combos[c]].concat(result);
      }
      return null;
    }

    var result = search(scored);
    if (!result) return null;
    // 只有每组都正好凑成 5%（含单只 5%）才认为是可靠分组，否则按单组展示
    var clean = result.every(function (group) {
      var total = group.reduce(function (sum, x) { return sum + x.rate; }, 0);
      return Math.abs(total - 5) < 0.001;
    });
    if (!clean || result.length < 2) return null;
    return result.map(function (group) {
      return group.map(function (x) { return x.m; });
    });
  }

  function open(region, loc, terrain, season, timeKey, options) {
    options = options || {};
    var key = locKey(region, loc, terrain);
    var candidates = (locationIndex.get(key) || []).filter(function (r) {
      return seasonMatch(r[F.SEASON], season);
    });
    popupState = {
      region: region,
      loc: loc,
      terrain: terrain,
      season: season,
      candidates: candidates,
      filterMode: options.filterMode || '',
      sourceId: Number.isFinite(options.sourceId) ? options.sourceId : null,
      sourceLevel: options.sourceLevel || '',
      sourceHorde: options.sourceHorde === 3 || options.sourceHorde === 5 ? options.sourceHorde : null,
      sourceRate: options.sourceRate || '',
      onBack: typeof options.onBack === 'function' ? options.onBack : null,
    };

    var overlay = document.getElementById('locationPopup');
    overlay.querySelector('.lp-title').textContent = loc;
    overlay.querySelector('.lp-back').hidden = !popupState.onBack;
    hordeFilter = '';
    switchTime(timeKey, false);
    overlay.hidden = false;
  }

  function fallbackSprite(img) {
    var id = img.dataset.id;
    var form = parseInt(img.dataset.form, 10);
    if (form !== 0) {
      img.dataset.form = '0';
      img.src = spriteUrl(id, 0);
      img.onerror = function () { img.remove(); };
    } else {
      img.remove();
    }
  }

  return { init: init, timeTag: timeTag, bindRoot: bindRoot, open: open, close: close, fallbackSprite: fallbackSprite };
})();

