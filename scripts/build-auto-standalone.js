const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// This build is intended for convenient offline use. It keeps the application
// encrypted at rest, but necessarily embeds enough runtime material to unlock
// it automatically when opened in a browser.
const root = path.resolve(__dirname, '..');
const inputPath = path.join(root, 'PokeMMO-spawn-query-standalone.html');
const outputPath = path.join(root, 'PokeMMO-spawn-query-auto.html');

if (!fs.existsSync(inputPath)) {
  throw new Error('Build the standalone HTML first with: node scripts/build-standalone.js');
}

const plaintext = fs.readFileSync(inputPath);
const key = crypto.randomBytes(32);
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const payload = Buffer.concat([encrypted, cipher.getAuthTag()]);

// Do not leave the raw AES key as a readable base64 string in the source. The
// loader reconstructs it from two byte arrays at runtime.
const mask = crypto.randomBytes(key.length);
const maskedKey = Buffer.alloc(key.length);
for (let i = 0; i < key.length; i += 1) maskedKey[i] = key[i] ^ mask[i];

const metadata = {
  iv: iv.toString('base64'),
  data: payload.toString('base64'),
  maskedKey: Array.from(maskedKey),
  mask: Array.from(mask),
};

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PokeMMO 分布查询</title>
  <style>
    html, body { min-height: 100%; }
    body { margin: 0; display: grid; place-items: center; padding: 24px; color: #17202a; background: #eef1f4; font-family: system-ui, sans-serif; }
    .loading { width: min(420px, 100%); padding: 28px; border: 1px solid #cbd2d9; border-radius: 8px; background: #fff; box-shadow: 0 12px 32px rgba(23, 32, 42, .12); }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { margin: 0; color: #5c6773; line-height: 1.6; }
  </style>
</head>
<body>
  <main class="loading"><h1>PokeMMO 分布查询</h1><p id="status">正在加载数据...</p></main>
  <script>
    (() => {
      const payload = ${JSON.stringify(metadata)};
      const status = document.getElementById('status');

      function fromBase64(value) {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }

      async function unlock() {
        if (!window.crypto || !window.crypto.subtle) throw new Error('UNSUPPORTED');
        const rawKey = new Uint8Array(payload.maskedKey.length);
        for (let i = 0; i < rawKey.length; i += 1) rawKey[i] = payload.maskedKey[i] ^ payload.mask[i];
        const cryptoKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
        const source = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: fromBase64(payload.iv) },
          cryptoKey,
          fromBase64(payload.data)
        );
        return new TextDecoder().decode(source);
      }

      unlock().then((source) => {
        document.open();
        document.write(source);
        document.close();
      }).catch((error) => {
        status.textContent = error && error.message === 'UNSUPPORTED'
          ? '当前浏览器不支持本地解密，请使用新版 Chrome 或 Edge。'
          : '加载失败，请重新打开文件。';
      });
    })();
  </script>
</body>
</html>`;

// Verify the generated artifact before writing it, so a broken loader or
// accidental corruption is caught during the build.
const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(payload.subarray(payload.length - 16));
const verified = Buffer.concat([
  decipher.update(payload.subarray(0, payload.length - 16)),
  decipher.final(),
]);
if (!verified.equals(plaintext)) throw new Error('Encryption round-trip verification failed.');

const scripts = Array.from(
  html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi),
  (match) => match[1]
);
scripts.forEach((source, index) => {
  try {
    new Function(source);
  } catch (error) {
    throw new Error(`Loader script ${index + 1} failed to compile: ${error.message}`);
  }
});

fs.writeFileSync(outputPath, html, 'utf8');
console.log(
  `${outputPath}\n` +
  `${Buffer.byteLength(html).toLocaleString('en-US')} bytes\n` +
  'AES-256-GCM automatic unlock\n' +
  'Encryption round trip verified'
);
