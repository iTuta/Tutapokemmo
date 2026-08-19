const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const searchDataPath = path.join(root, 'web', 'search-data.js');
const monstersPath = path.join(root, 'web', 'info', 'monsters.json');

const TYPE_MAP = {
  NORMAL: '一般', FIRE: '火', WATER: '水', ELECTRIC: '电', GRASS: '草',
  ICE: '冰', FIGHTING: '格斗', POISON: '毒', GROUND: '地面', FLYING: '飞行',
  PSYCHIC: '超能', BUG: '虫', ROCK: '岩石', GHOST: '幽灵', DRAGON: '龙',
  DARK: '恶', STEEL: '钢', FAIRY: '妖精',
};

const src = fs.readFileSync(searchDataPath, 'utf8');
const data = JSON.parse(src.slice(src.indexOf('=') + 1).replace(/;\s*$/, ''));
const oldRows = data.r;
const monsters = JSON.parse(fs.readFileSync(monstersPath, 'utf8'));

const pureName = (name) => {
  const i = name.indexOf("'");
  return i === -1 ? name : name.slice(0, i);
};

const levelText = (min, max) => (min === max ? String(min) : min + '-' + max);

const hordeCode = (loc) => (loc.is_horde_5x ? 5 : loc.is_horde_3x ? 3 : 0);

const zhTypes = (m) => (m.types || []).map((t) => TYPE_MAP[t] || t);

function buildFormMap(oldRowsForId) {
  const counts = new Map();
  for (const r of oldRowsForId || []) {
    counts.set(r[16], (counts.get(r[16]) || 0) + 1);
  }
  const best = counts.size ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] : 0;
  const m = new Map();
  m.set(-1, best);
  for (const key of counts.keys()) m.set(key, key);
  return m;
}

function buildRows(monster, formMap) {
  return (monster.locations || []).map((loc) => [
    monster.id,
    monster.name,
    pureName(monster.name),
    zhTypes(monster),
    loc.region_name,
    loc.location_name,
    loc.type,
    levelText(loc.min_level, loc.max_level),
    loc.season,
    hordeCode(loc),
    loc.rarity_morning !== '--',
    loc.rarity_day !== '--',
    loc.rarity_night !== '--',
    loc.rarity_morning,
    loc.rarity_day,
    loc.rarity_night,
    formMap.has(loc.form) ? formMap.get(loc.form) : (loc.form === -1 ? 0 : loc.form),
  ]);
}

const oldById = new Map();
for (const r of oldRows) {
  if (!oldById.has(r[0])) oldById.set(r[0], []);
  oldById.get(r[0]).push(r);
}

const newRows = [];
for (const m of monsters) newRows.push(...buildRows(m, buildFormMap(oldById.get(m.id))));

const newM = {};
for (const m of monsters) newM[m.id] = [pureName(m.name), zhTypes(m)];

data.r = newRows;
data.m = newM;

fs.writeFileSync(searchDataPath, `window.POKEMON_DATA=${JSON.stringify(data)};\n`, 'utf8');
console.log(
  'rows:', oldRows.length, '->', newRows.length,
  '| monsters:', Object.keys(newM).length,
  '| bytes:', fs.statSync(searchDataPath).size.toLocaleString('en-US')
);