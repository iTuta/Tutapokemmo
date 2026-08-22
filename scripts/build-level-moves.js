const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const SELF_HARM_MOVES = ['大爆炸', '玉石俱碎', '大闹一番', '花瓣舞', '逆鳞', '挣扎'];
// 野生宝可梦使用后立即逃离战斗（无法捕捉）的技能
const FLEE_MOVES = ['瞬间移动'];
const TRACKED_MOVES = SELF_HARM_MOVES.concat(FLEE_MOVES);

const monsters = JSON.parse(fs.readFileSync(path.join(root, 'web', 'data', 'monsters.json'), 'utf8'));

const levelMoves = {};
monsters.forEach((m) => {
  const moves = (m.moves || [])
    .filter((x) => x.type === 'level')
    .map((x) => [x.level, x.name])
    .sort((a, b) => a[0] - b[0]);
  if (!moves.length) return;
  if (!moves.some((x) => TRACKED_MOVES.includes(x[1]))) return;
  levelMoves[String(m.id)] = moves;
});

const json = JSON.stringify(levelMoves);

const webTarget = path.join(root, 'web', 'data', 'level-moves.js');
fs.writeFileSync(webTarget, 'window.LEVEL_MOVES = ' + json + ';\n');

const miniTarget = path.join(root, 'miniprogram', 'data', 'level-moves.js');
fs.writeFileSync(miniTarget, 'module.exports = ' + json + ';\n');

console.log('monsters with tracked level moves:', Object.keys(levelMoves).length);
console.log('web ->', path.relative(root, webTarget), fs.statSync(webTarget).size, 'bytes');
console.log('mini ->', path.relative(root, miniTarget), fs.statSync(miniTarget).size, 'bytes');
