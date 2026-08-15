window.TierDisplay = (function () {
  var tiers = {};

  var TIER_SCORES = {
    T0: 50, T1: 45, T2: 40, T3: 30, T4: 15, T5: 10, T6: 5, T7: 3,
  };

  var TIER_LIST = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  var TIER_COLORS = {
    T0: '#ffd700', T1: '#c0c0c0', T2: '#cd7f32', T3: '#66bb6a',
    T4: '#42a5f5', T5: '#ab47bc', T6: '#78909c', T7: '#546e7a',
  };

  // Entries on continuation rows in 2026闪战优化.csv were omitted from ti.
  // IDs 331 and 304 also cover the CSV aliases 沙漠奈亚 and 可拉可拉.
  var MISSING_TIER_SEEDS = {
    T3: [331, 434, 441, 443, 453, 456, 554, 556, 561, 615],
    T6: [304, 459, 504, 517, 522, 524, 527, 535, 540, 572, 574, 577, 582, 599, 605, 618, 621, 629, 632],
    T7: [422, 431, 436, 550, 551, 562, 585, 592, 607, 619, 622],
  };

  function init(data) {
    tiers = Object.assign({}, data.ti || {});

    Object.keys(MISSING_TIER_SEEDS).forEach(function (tier) {
      MISSING_TIER_SEEDS[tier].forEach(function (id) {
        var familyIndex = data.fi && data.fi[String(id)];
        var familyIds = familyIndex == null || !data.f
          ? [id]
          : (data.f[familyIndex] || [id]);

        familyIds.forEach(function (familyId) {
          var key = String(familyId);
          if (!tiers[key]) tiers[key] = [tier, TIER_SCORES[tier]];
        });
      });
    });
  }

  function get(id) {
    return tiers[String(id)] || null;
  }

  function matchesFilter(id, tierFilter) {
    if (!tierFilter) return true;
    var t = get(id);
    return t && t[0] === tierFilter;
  }

  function optionLabel(tier) {
    return tier + '（' + TIER_SCORES[tier] + '分）';
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function badgeHtml(id, cls) {
    cls = cls || 'tier-badge';
    var t = get(id);
    if (!t) return '';
    var tier = t[0];
    var score = t[1];
    var color = TIER_COLORS[tier] || '#607d8b';
    return (
      '<span class="' + cls + '" style="background:' + color + '22;border-color:' + color + ';color:' + color + '"' +
      ' title="闪战分级">' + esc(tier) + ' · ' + score + '分</span>'
    );
  }

  return {
    init: init,
    get: get,
    matchesFilter: matchesFilter,
    optionLabel: optionLabel,
    badgeHtml: badgeHtml,
    TIER_LIST: TIER_LIST,
    TIER_SCORES: TIER_SCORES,
  };
})();
