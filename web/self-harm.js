window.SelfHarm = (function () {
  const SELF_HARM_MOVES = ['大爆炸', '玉石俱碎', '大闹一番', '花瓣舞', '逆鳞', '挣扎'];

  function parseMaxLevel(levelText) {
    const nums = String(levelText || '').match(/\d+/g) || [];
    return nums.length ? Number(nums[nums.length - 1]) : null;
  }

  // 群怪携带 ≤点位等级上限 的最近 4 个升级技能；返回其中会对自己/友方造成伤害的技能名
  function hitMoves(id, levelText) {
    const moves = (window.LEVEL_MOVES || {})[String(id)];
    if (!moves || !moves.length) return [];
    const max = parseMaxLevel(levelText);
    if (max == null) return [];
    const learned = [];
    for (const m of moves) {
      if (m[0] > max) break;
      learned.push(m[1]);
    }
    const hits = learned.slice(-4).filter((name) => SELF_HARM_MOVES.includes(name));
    return [...new Set(hits)];
  }

  function badgeHtml(id, levelText) {
    const hits = hitMoves(id, levelText);
    if (!hits.length) return '';
    return '<span class="badge badge-selfharm" title="该等级携带自伤技能 ' + hits.join('、') + '：会对自己/友方造成伤害，请注意闪宠安危">' +
      '⚠' + hits.join('、') + '</span>';
  }

  return { hitMoves: hitMoves, badgeHtml: badgeHtml };
})();
