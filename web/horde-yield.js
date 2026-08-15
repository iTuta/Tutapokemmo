window.HordeYield = (function () {
  var monsters = {};
  var items = {};
  var hordeRecordsByLocation = new Map();

  var EV_LABELS = ['HP', '攻击', '防御', '速度', '特攻', '特防'];
  var EV_INDEX = {
    hp: 0,
    attack: 1,
    defense: 2,
    speed: 3,
    sp_attack: 4,
    sp_defense: 5,
  };

  function locationKey(record, fieldMap) {
    return record[fieldMap.REGION] + '\0' + record[fieldMap.LOC] + '\0' + record[fieldMap.TERRAIN];
  }

  function seasonMatch(a, b) {
    return a === '任意' || b === '任意' || a === b;
  }

  function setRecords(records, fieldMap) {
    hordeRecordsByLocation.clear();
    if (!records || !fieldMap) return;

    records.forEach(function (record) {
      if (record[fieldMap.HORDE] !== 5) return;
      var key = locationKey(record, fieldMap);
      if (!hordeRecordsByLocation.has(key)) hordeRecordsByLocation.set(key, []);
      hordeRecordsByLocation.get(key).push(record);
    });
  }

  function init(data, records, fieldMap) {
    data = data || {};
    monsters = data.m || {};
    items = data.i || {};
    setRecords(records, fieldMap);
  }

  function esc(value) {
    var d = document.createElement('div');
    d.textContent = value == null ? '' : String(value);
    return d.innerHTML;
  }

  function escAttr(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function parseLevelRange(levelValue) {
    var levels = String(levelValue == null ? '' : levelValue).match(/\d+/g) || [];
    if (!levels.length) return null;
    var min = parseInt(levels[0], 10);
    var max = parseInt(levels[levels.length - 1], 10);
    return { min: Math.min(min, max), max: Math.max(min, max) };
  }

  function formatRange(min, max) {
    function format(value) {
      var number = Number(value);
      if (!Number.isFinite(number)) return '';
      if (Number.isInteger(number)) return number.toLocaleString('zh-CN');
      return number.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    }
    var minText = format(min);
    var maxText = format(max);
    return min === max ? minText : minText + '–' + maxText;
  }

  function calculate(id, levelValue, count) {
    count = count || 5;
    var info = monsters[String(id)];
    var levels = parseLevelRange(levelValue);
    if (!info || !levels) return null;

    var baseExp = info[1] || 0;
    var evPerMonster = info[2] || [0, 0, 0, 0, 0, 0];
    var expMin = Math.floor(baseExp * levels.min / 7) * count;
    var expMax = Math.floor(baseExp * levels.max / 7) * count;

    return {
      count: count,
      growthName: info[0] || '',
      baseExp: baseExp,
      levels: levels,
      expMin: expMin,
      expMax: expMax,
      evPerMonster: evPerMonster.slice(),
      evTotal: evPerMonster.map(function (value) { return value * count; }),
      heldItemIds: (info[3] || []).slice(),
    };
  }

  function hasEvYield(id, stat) {
    var info = monsters[String(id)];
    var index = EV_INDEX[stat];
    return Boolean(info && index != null && info[2] && info[2][index] > 0);
  }

  function heldItemNames(id) {
    var info = monsters[String(id)];
    if (!info || !info[3]) return [];
    return info[3].map(function (itemId) {
      var item = items[String(itemId)];
      return item ? item[0] : '#' + itemId;
    });
  }

  function matchesHeldItem(id, query) {
    var q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return true;
    return heldItemNames(id).some(function (name) {
      return name.toLowerCase().indexOf(q) !== -1;
    });
  }

  function matchedHeldItemNames(id, query) {
    var q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return [];
    return heldItemNames(id).filter(function (name) {
      return name.toLowerCase().indexOf(q) !== -1;
    });
  }

  function allHeldItemNames() {
    var seen = new Set();
    Object.keys(monsters).forEach(function (id) {
      heldItemNames(parseInt(id, 10)).forEach(function (name) { seen.add(name); });
    });
    return Array.from(seen).sort(function (a, b) { return a.localeCompare(b, 'zh-CN'); });
  }

  function experienceScore(id, levelValue, count) {
    var result = calculate(id, levelValue, count || 5);
    return result ? (result.expMin + result.expMax) / 2 : -1;
  }

  function evText(values) {
    var parts = [];
    values.forEach(function (value, index) {
      if (value) parts.push(EV_LABELS[index] + ' +' + value);
    });
    return parts.length ? parts.join(' / ') : '无努力值';
  }

  function heldItemsHtml(itemIds) {
    var uniqueIds = Array.from(new Set(itemIds));
    if (!uniqueIds.length) return '<span class="hy-muted">无已知道具</span>';

    return uniqueIds.map(function (id) {
      var item = items[String(id)];
      var name = item ? item[0] : '#' + id;
      var desc = item ? item[1] : '';
      return '<span class="hy-item" title="' + escAttr(desc) + '">' + esc(name) + '</span>';
    }).join('');
  }

  function mixedExperience(record, fieldMap, encounterRecords) {
    var candidates = encounterRecords || hordeRecordsByLocation.get(locationKey(record, fieldMap)) || [];
    var group = candidates.filter(function (candidate) {
      return candidate[fieldMap.HORDE] === 5 &&
        candidate[fieldMap.REGION] === record[fieldMap.REGION] &&
        candidate[fieldMap.LOC] === record[fieldMap.LOC] &&
        candidate[fieldMap.TERRAIN] === record[fieldMap.TERRAIN] &&
        seasonMatch(candidate[fieldMap.SEASON], record[fieldMap.SEASON]);
    });
    var yields = group.map(function (candidate) {
      return calculate(candidate[fieldMap.ID], candidate[fieldMap.LEVEL], 5);
    }).filter(Boolean);
    if (!yields.length) return null;

    return {
      count: yields.length,
      expMin: yields.reduce(function (total, yield) { return total + yield.expMin; }, 0),
      expMax: yields.reduce(function (total, yield) { return total + yield.expMax; }, 0),
    };
  }

  function mixedExperienceScore(record, fieldMap, encounterRecords) {
    var mixed = mixedExperience(record, fieldMap, encounterRecords);
    if (!mixed || !mixed.count) return -1;
    return (mixed.expMin + mixed.expMax) / (mixed.count * 2);
  }

  function render(record, fieldMap, encounterRecords) {
    if (!record || record[fieldMap.HORDE] !== 5) return '';
    var result = calculate(record[fieldMap.ID], record[fieldMap.LEVEL], 5);
    if (!result) return '';

    var expText = formatRange(result.expMin, result.expMax);
    var mixed = mixedExperience(record, fieldMap, encounterRecords) || {
      count: 1,
      expMin: result.expMin,
      expMax: result.expMax,
    };
    var averageExpText = formatRange(mixed.expMin / mixed.count, mixed.expMax / mixed.count);
    var averageLabel = mixed.count > 1 ? '平均经验（' + mixed.count + '种）' : '平均经验';
    var totalEvText = evText(result.evTotal);
    var singleEvText = evText(result.evPerMonster);

    return (
      '<details class="horde-yield">' +
        '<summary>' +
          '<span class="hy-summary-title">5群怪收益</span>' +
          '<span class="hy-summary-value">' + averageLabel + ' ' + esc(averageExpText) + ' · ' + esc(totalEvText) + '</span>' +
        '</summary>' +
        '<div class="hy-body">' +
          '<div class="hy-metrics">' +
            '<div class="hy-metric"><span>总经验</span><strong>' + esc(expText) + '</strong>' +
              '<small>基础经验 ' + result.baseExp + ' / 只，Lv.' + result.levels.min +
                (result.levels.min === result.levels.max ? '' : '–' + result.levels.max) + '</small></div>' +
            '<div class="hy-metric"><span>总努力值</span><strong>' + esc(totalEvText) + '</strong>' +
              '<small>单只：' + esc(singleEvText) + '</small></div>' +
          '</div>' +
          '<div class="hy-row"><span class="hy-label">经验成长</span><span>' + esc(result.growthName || '未知') + '</span></div>' +
          '<div class="hy-row"><span class="hy-label">可能携带</span><span class="hy-items">' + heldItemsHtml(result.heldItemIds) + '</span></div>' +
          '<p class="hy-note">经验按 floor(基础经验 × 等级 ÷ 7) × 5 估算；未计幸运蛋、交换、训练家、经验分享及服务器活动修正。</p>' +
        '</div>' +
      '</details>'
    );
  }

  return {
    init: init,
    calculate: calculate,
    setRecords: setRecords,
    experienceScore: experienceScore,
    mixedExperienceScore: mixedExperienceScore,
    hasEvYield: hasEvYield,
    heldItemNames: heldItemNames,
    matchesHeldItem: matchesHeldItem,
    matchedHeldItemNames: matchedHeldItemNames,
    allHeldItemNames: allHeldItemNames,
    parseLevelRange: parseLevelRange,
    render: render,
  };
})();
