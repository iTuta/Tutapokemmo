window.SelfHarm = (function () {
  const SELF_HARM_MOVES = ['大爆炸', '玉石俱碎', '大闹一番', '花瓣舞', '逆鳞', '挣扎'];
  // 野生宝可梦使用后立即逃离战斗（无法捕捉）的技能
  const FLEE_MOVES = ['瞬间移动'];

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

  // 与自伤不同：只要学会（等级≤上限）就会一直带着，逃走风险始终存在，不做“最近4个”截断
  function fleeMoves(id, levelText) {
    const moves = (window.LEVEL_MOVES || {})[String(id)];
    if (!moves || !moves.length) return [];
    const max = parseMaxLevel(levelText);
    if (max == null) return [];
    const hits = moves.filter((m) => m[0] <= max && FLEE_MOVES.includes(m[1])).map((m) => m[1]);
    return [...new Set(hits)];
  }

  function badgeHtml(id, levelText) {
    // 自伤与逃跑（瞬间移动类）合并为同一处危险技能警示展示
    const hits = hitMoves(id, levelText).concat(fleeMoves(id, levelText));
    if (!hits.length) return '';
    const unique = [...new Set(hits)];
    return '<span class="badge badge-selfharm" title="该等级携带自伤/逃跑技能 ' + unique.join('、') + '：会对自己/友方造成伤害或立即逃离战斗，请注意闪宠安危">' +
      '⚠' + unique.join('、') + '</span>';
  }

  return { hitMoves: hitMoves, fleeMoves: fleeMoves, badgeHtml: badgeHtml };
})();