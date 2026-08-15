const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'web', 'search-data.js');
const targetDir = path.join(root, 'miniprogram', 'data');
const targetPath = path.join(targetDir, 'spawn-data.js');

const source = fs.readFileSync(sourcePath, 'utf8');
const data = JSON.parse(source.slice(source.indexOf('=') + 1).replace(/;\s*$/, ''));
const gameSource = fs.readFileSync(path.join(root, 'web', 'data', 'game-data.js'), 'utf8');
const gameData = JSON.parse(gameSource.slice(gameSource.indexOf('=') + 1).replace(/;\s*$/, ''));
const dictionary = [];
const dictionaryIds = new Map();
const stringId = (value) => {
  if (!dictionaryIds.has(value)) {
    dictionaryIds.set(value, dictionary.length);
    dictionary.push(value);
  }
  return dictionaryIds.get(value);
};

// Keep only fields needed by the native list. Repeated text is stored once in d.
const rows = data.r.map((record) => [
  record[0], stringId(record[2]), stringId(record[4]), stringId(record[5]),
  stringId(record[6]), stringId(record[7]), stringId(record[8]), record[9],
  ...record.slice(10, 16).map((value) => typeof value === 'string' ? -(stringId(value) + 1) : value),
  Number(record[16]) || 0,
]);
const types = Object.fromEntries(Object.entries(data.m).map(([id, value]) => [id, value[1]]));
const heldItemIds = new Set(Object.values(gameData.m).flatMap((value) => value[3] || []));
const itemNames = Object.fromEntries([...heldItemIds].map((id) => [id, gameData.i[String(id)]?.[0] || `#${id}`]));
const game = { monsters: gameData.m, itemNames };
const encode = (value) => {
  if (value === true) return 't';
  if (value === false) return 'f';
  if (typeof value === 'number') return value < 0 ? `n${(-value).toString(36)}` : value.toString(36);
  return String(value);
};
const packedRows = rows.map((row) => row.map(encode).join(',')).join(';');
fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(
  targetPath,
  `module.exports = ${JSON.stringify({ d: dictionary, rows: packedRows, types, tiers: data.ti, families: data.f, familyIndex: data.fi, evolution: data.e, game })};\n`,
  'utf8'
);
console.log(`${targetPath}\n${fs.statSync(targetPath).size.toLocaleString('en-US')} bytes\n${data.r.length.toLocaleString('en-US')} records`);
