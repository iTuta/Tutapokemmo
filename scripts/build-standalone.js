const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const webDir = path.join(root, 'web');
const outputPath = path.join(root, 'PokeMMO-spawn-query-standalone.html');

function read(relativePath) {
  return fs.readFileSync(path.join(webDir, relativePath), 'utf8');
}

function safeInlineScript(source) {
  return source.replace(/<\/script/gi, '<\\/script');
}

function safeInlineStyle(source) {
  return source.replace(/<\/style/gi, '<\\/style');
}

let html = read('index-sprites.html');

[
  ['location-popup.css', 'location-popup.css'],
  ['evolution-chain.css', 'evolution-chain.css'],
].forEach(([href, file]) => {
  const tag = `<link rel="stylesheet" href="${href}">`;
  const style = `<style data-source="${file}">\n${safeInlineStyle(read(file))}\n</style>`;
  if (!html.includes(tag)) throw new Error(`Missing stylesheet tag: ${tag}`);
  html = html.replace(tag, style);
});

const spriteDir = path.join(root, 'sprites', 'monstericons');
const sprites = {};
fs.readdirSync(spriteDir)
  .filter((file) => file.toLowerCase().endsWith('.png'))
  .sort()
  .forEach((file) => {
    const key = file.slice(0, -4);
    const base64 = fs.readFileSync(path.join(spriteDir, file)).toString('base64');
    sprites[key] = `data:image/png;base64,${base64}`;
  });

const spriteData = safeInlineScript(
  `window.INLINE_SPRITES=${JSON.stringify(sprites)};`
);
const firstScriptTag = '<script src="search-data.js"></script>';
if (!html.includes(firstScriptTag)) throw new Error(`Missing script tag: ${firstScriptTag}`);
html = html.replace(firstScriptTag, `<script data-source="inline-sprites">${spriteData}</script>\n  ${firstScriptTag}`);

[
  'search-data.js',
  'data/game-data.js',
  'tier-display.js',
  'horde-yield.js',
  'location-name.js',
  'location-popup.js',
  'monster-popup.js',
  'evolution-chain.js',
  'swarm-live.js',
].forEach((file) => {
  const tag = `<script src="${file}"></script>`;
  const script = `<script data-source="${file}">\n${safeInlineScript(read(file))}\n</script>`;
  if (!html.includes(tag)) throw new Error(`Missing script tag: ${tag}`);
  html = html.replace(tag, script);
});

html = html.replace(
  /<a href="index\.html">[^<]*<\/a>/,
  '<span>\u79bb\u7ebf\u5355\u6587\u4ef6\u7248</span>'
);

const inlineScripts = Array.from(
  html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi),
  (match) => match[1]
);
inlineScripts.forEach((source, index) => {
  try {
    new Function(source);
  } catch (error) {
    throw new Error(`Inline script ${index + 1} failed to compile: ${error.message}`);
  }
});

fs.writeFileSync(outputPath, html, 'utf8');
console.log(
  `${outputPath}\n` +
  `${Buffer.byteLength(html).toLocaleString('en-US')} bytes\n` +
  `${Object.keys(sprites).length} sprites\n` +
  `${inlineScripts.length} inline scripts compiled`
);
