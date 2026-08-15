const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const inputPath = path.join(root, 'PokeMMO-spawn-query-standalone.html');
const outputPath = path.join(root, 'PokeMMO-spawn-query-protected.html');
const password = process.env.POKEMMO_STANDALONE_PASSWORD || process.argv[2];
const iterations = 250000;

if (!password) {
  throw new Error('Provide the password as POKEMMO_STANDALONE_PASSWORD or the first argument.');
}
if (!fs.existsSync(inputPath)) {
  throw new Error('Build the standalone HTML first with: node scripts/build-standalone.js');
}

const plaintext = fs.readFileSync(inputPath);
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const payload = Buffer.concat([encrypted, cipher.getAuthTag()]);

const metadata = {
  salt: salt.toString('base64'),
  iv: iv.toString('base64'),
  data: payload.toString('base64'),
  iterations,
};

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PokeMMO \u5206\u5e03\u67e5\u8be2 - \u5df2\u52a0\u5bc6</title>
  <style>
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      color: #17202a;
      background: #eef1f4;
      font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
    }
    .unlock-panel {
      width: min(420px, 100%);
      padding: 28px;
      border: 1px solid #cbd2d9;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 12px 32px rgba(23, 32, 42, .12);
    }
    h1 { margin: 0 0 8px; font-size: 22px; letter-spacing: 0; }
    p { margin: 0 0 22px; color: #5c6773; line-height: 1.6; }
    label { display: block; margin-bottom: 8px; font-size: 14px; font-weight: 700; }
    .password-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
    input, button {
      min-height: 44px;
      border-radius: 6px;
      font: inherit;
    }
    input { width: 100%; padding: 10px 12px; border: 1px solid #aeb7c1; }
    input:focus { outline: 2px solid #2878b5; outline-offset: 1px; border-color: #2878b5; }
    button {
      padding: 0 18px;
      border: 1px solid #1f6396;
      color: #ffffff;
      background: #2878b5;
      cursor: pointer;
      font-weight: 700;
    }
    button:disabled { cursor: wait; opacity: .65; }
    .status { min-height: 22px; margin: 12px 0 0; color: #b42318; font-size: 14px; }
  </style>
</head>
<body>
  <main class="unlock-panel">
    <h1>PokeMMO \u5206\u5e03\u67e5\u8be2</h1>
    <p>\u6b64\u6587\u4ef6\u5df2\u52a0\u5bc6\uff0c\u8bf7\u8f93\u5165\u5bc6\u7801\u89e3\u9501\u3002</p>
    <form id="unlockForm">
      <label for="password">\u5bc6\u7801</label>
      <div class="password-row">
        <input id="password" type="password" autocomplete="current-password" required autofocus>
        <button id="unlockButton" type="submit">\u89e3\u9501</button>
      </div>
      <p id="status" class="status" role="status" aria-live="polite"></p>
    </form>
  </main>
  <script>
    (() => {
      const payload = ${JSON.stringify(metadata)};
      const form = document.getElementById('unlockForm');
      const input = document.getElementById('password');
      const button = document.getElementById('unlockButton');
      const status = document.getElementById('status');

      function fromBase64(value) {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }

      async function decrypt(password) {
        if (!window.crypto || !window.crypto.subtle) {
          throw new Error('UNSUPPORTED');
        }
        const material = await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(password),
          'PBKDF2',
          false,
          ['deriveKey']
        );
        const key = await crypto.subtle.deriveKey(
          {
            name: 'PBKDF2',
            salt: fromBase64(payload.salt),
            iterations: payload.iterations,
            hash: 'SHA-256',
          },
          material,
          { name: 'AES-GCM', length: 256 },
          false,
          ['decrypt']
        );
        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: fromBase64(payload.iv) },
          key,
          fromBase64(payload.data)
        );
        return new TextDecoder().decode(decrypted);
      }

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        button.disabled = true;
        status.textContent = '\u6b63\u5728\u89e3\u5bc6...';
        try {
          const source = await decrypt(input.value);
          document.open();
          document.write(source);
          document.close();
        } catch (error) {
          status.textContent = error && error.message === 'UNSUPPORTED'
            ? '\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u652f\u6301\u672c\u5730\u89e3\u5bc6\uff0c\u8bf7\u4f7f\u7528\u65b0\u7248 Chrome \u6216 Edge\u3002'
            : '\u5bc6\u7801\u9519\u8bef\uff0c\u8bf7\u91cd\u8bd5\u3002';
          input.select();
          button.disabled = false;
        }
      });
    })();
  </script>
</body>
</html>`;

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
  `AES-256-GCM, PBKDF2-SHA256 (${iterations.toLocaleString('en-US')} iterations)\n` +
  'Encryption round trip verified'
);
