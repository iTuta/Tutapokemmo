const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const dataDir = path.join(projectRoot, 'web', 'data');
const monstersSource = path.resolve(process.argv[2] || path.join(dataDir, 'monsters.json'));
const itemsSource = path.resolve(process.argv[3] || path.join(dataDir, 'items.json'));
const monstersTarget = path.join(dataDir, 'monsters.json');
const itemsTarget = path.join(dataDir, 'items.json');
const runtimeTarget = path.join(dataDir, 'game-data.js');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function copyIntoProject(source, target) {
  if (path.resolve(source) !== path.resolve(target)) {
    fs.copyFileSync(source, target);
  }
}

fs.mkdirSync(dataDir, { recursive: true });

const monsters = readJson(monstersSource);
const items = readJson(itemsSource);

copyIntoProject(monstersSource, monstersTarget);
copyIntoProject(itemsSource, itemsTarget);

const monsterIndex = {};
monsters.forEach((monster) => {
  const yields = monster.yields || {};
  monsterIndex[monster.id] = [
    monster.exp_type_name || '',
    yields.exp || 0,
    [
      yields.ev_hp || 0,
      yields.ev_attack || 0,
      yields.ev_defense || 0,
      yields.ev_speed || 0,
      yields.ev_sp_attack || 0,
      yields.ev_sp_defense || 0,
    ],
    (monster.held_items || []).map((item) => item.id),
  ];
});

const itemIndex = {};
items.forEach((item) => {
  itemIndex[item.id] = [
    item.name || '',
    item.desc || '',
    item.region_id,
    item.icon_id,
    item.name_string_id,
    item.desc_string_id,
  ];
});

const runtimeData = {
  // m: [growthName, baseExp, [hp, atk, def, speed, spAtk, spDef], heldItemIds]
  m: monsterIndex,
  // i: [name, description, regionId, iconId, nameStringId, descStringId]
  i: itemIndex,
};

fs.writeFileSync(
  runtimeTarget,
  `window.GAME_DATA=${JSON.stringify(runtimeData)};\n`,
  'utf8'
);

console.log(`Imported ${monsters.length} monsters and ${items.length} items.`);
console.log(`Generated ${path.relative(projectRoot, runtimeTarget)}.`);
