window.EvolutionChain = (function () {
  let meta = {};
  let families = [];
  let fi = {};
  let edges = [];
  let idToBase = {};
  let nameToIds = {};
  let spriteBase = null;
  let typeColors = {};

  function init(data, options) {
    options = options || {};
    meta = data.m || {};
    families = data.f || [];
    fi = data.fi || {};
    edges = data.e || [];
    spriteBase = options.spriteBase || null;
    typeColors = options.typeColors || {};
    idToBase = {};
    nameToIds = {};

    Object.keys(meta).forEach(function (id) {
      var bn = meta[id][0];
      idToBase[id] = bn.toLowerCase();
      if (!nameToIds[bn.toLowerCase()]) nameToIds[bn.toLowerCase()] = [];
      if (nameToIds[bn.toLowerCase()].indexOf(parseInt(id, 10)) === -1) {
        nameToIds[bn.toLowerCase()].push(parseInt(id, 10));
      }
    });
  }

  function getFamilyIds(id) {
    var idx = fi[String(id)];
    if (idx == null) return new Set([id]);
    return new Set(families[idx]);
  }

  function getFamilyIdsForQuery(nameQ) {
    var q = nameQ.trim().toLowerCase();
    if (!q) return new Set();

    var ids = new Set();
    Object.keys(idToBase).forEach(function (id) {
      var bn = idToBase[id];
      var full = meta[id][0].toLowerCase();
      if (bn.includes(q) || full.includes(q)) ids.add(parseInt(id, 10));
    });

    var result = new Set();
    ids.forEach(function (id) {
      getFamilyIds(id).forEach(function (fid) { result.add(fid); });
    });
    return result;
  }

  function getMatchedIds(nameQ) {
    var q = nameQ.trim().toLowerCase();
    var ids = new Set();
    if (!q) return ids;
    Object.keys(idToBase).forEach(function (id) {
      var bn = idToBase[id];
      if (bn.includes(q) || meta[id][0].toLowerCase().includes(q)) {
        ids.add(parseInt(id, 10));
      }
    });
    return ids;
  }

  function buildTree(familyIds) {
    var fam = new Set(familyIds);
    var famEdges = edges.filter(function (e) { return fam.has(e[0]) && fam.has(e[1]); });
    var hasParent = new Set(famEdges.map(function (e) { return e[1]; }));
    var roots = familyIds.filter(function (id) { return !hasParent.has(id); }).sort(function (a, b) { return a - b; });

    function childrenOf(pid) {
      return famEdges
        .filter(function (e) { return e[0] === pid; })
        .sort(function (a, b) { return a[1] - b[1]; });
    }

    function walk(id, depth) {
      var node = { id: id, depth: depth, children: [] };
      childrenOf(id).forEach(function (e) {
        node.children.push({ edge: e[2], node: walk(e[1], depth + 1) });
      });
      return node;
    }

    return roots.map(function (r) { return walk(r, 0); });
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function spriteHtml(id) {
    if (!spriteBase) return '';
    var inlineSprites = window.INLINE_SPRITES;
    var src = inlineSprites ? inlineSprites[id + '-0'] : spriteBase + id + '-0.png';
    if (!src) return '';
    return '<img class="ec-sprite" src="' + src + '" alt="" loading="lazy"' +
      ' onerror="this.style.visibility=\'hidden\'">';
  }

  function typeBadges(types) {
    return types.map(function (t) {
      var c = typeColors[t] || '#607d8b';
      return '<span class="ec-type" style="background:' + c + '">' + esc(t) + '</span>';
    }).join('');
  }

  function renderNode(node, highlightIds) {
    var info = meta[node.id];
    if (!info) return '';
    var hl = highlightIds.has(node.id) ? ' ec-node-highlight' : '';
    var html =
      '<div class="ec-node' + hl + '">' +
        (spriteBase ? '<div class="ec-sprite-wrap">' + spriteHtml(node.id) + '</div>' : '') +
        '<div class="ec-node-info">' +
          '<strong>' + esc(info[0]) + '</strong>' +
          '<small>#' + node.id + '</small>' +
          (window.TierDisplay ? TierDisplay.badgeHtml(node.id, 'ec-tier') : '') +
          typeBadges(info[1]) +
        '</div>' +
      '</div>';

    if (node.children.length === 0) return html;

    var branches = node.children.map(function (c) {
      return (
        '<div class="ec-branch">' +
          '<span class="ec-arrow" title="' + esc(c.edge) + '">→ ' + esc(c.edge) + '</span>' +
          renderNode(c.node, highlightIds) +
        '</div>'
      );
    }).join('');

    return html + '<div class="ec-branches">' + branches + '</div>';
  }

  function renderPanel(nameQ) {
    var matched = getMatchedIds(nameQ);
    if (matched.size === 0) {
      return '<div class="ec-panel ec-panel-empty">输入宝可梦名称以查看进化链</div>';
    }

    var familyIds = getFamilyIdsForQuery(nameQ);
    if (familyIds.size <= 1) {
      return '<div class="ec-panel ec-panel-empty">该宝可梦无进化链，或进化链仅含自身</div>';
    }

    var trees = buildTree(Array.from(familyIds));
    var names = Array.from(familyIds).map(function (id) { return meta[id] ? meta[id][0] : id; }).join('、');

    return (
      '<div class="ec-panel">' +
        '<div class="ec-panel-head">' +
          '<span class="ec-panel-title">进化链</span>' +
          '<span class="ec-panel-count">' + familyIds.size + ' 种 · ' + esc(names) + '</span>' +
        '</div>' +
        '<div class="ec-tree">' +
          trees.map(function (t) { return renderNode(t, matched); }).join('') +
        '</div>' +
      '</div>'
    );
  }

  function hasChain(nameQ) {
    return getFamilyIdsForQuery(nameQ).size > 1;
  }

  return {
    init: init,
    getFamilyIdsForQuery: getFamilyIdsForQuery,
    getMatchedIds: getMatchedIds,
    renderPanel: renderPanel,
    hasChain: hasChain,
  };
})();
