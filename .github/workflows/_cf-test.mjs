// 临时测试脚本：验证 GitHub Actions runner 上真实浏览器能否通过 CF 挑战拿到 alphapedia 数据
import { chromium } from 'playwright';

const BASE = 'https://alpha.pokemmotools.org/';

async function tryBrowser(label, launchOpts) {
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = await ctx.newPage();
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // 等挑战通过：标题不再是 "Just a moment..."，最多等 25 秒
    let passed = false;
    for (let i = 0; i < 25; i++) {
      const title = await page.title();
      if (!/just a moment|请稍候/i.test(title)) { passed = true; break; }
      await page.waitForTimeout(1000);
    }
    const title = await page.title();
    const hasToken = await page.evaluate(() => !!document.querySelector('meta[name="landing-status-token"]'));
    console.log(`[${label}] challenge passed: ${passed}, title: ${JSON.stringify(title)}, token meta: ${hasToken}`);
    if (!hasToken) return false;
    const result = await page.evaluate(async () => {
      const token = document.querySelector('meta[name="landing-status-token"]').content;
      const res = await fetch('/api/landing-status', {
        headers: { 'X-Landing-Status-Token': token, Accept: 'application/json' },
      });
      let body = '';
      try { body = await res.text(); } catch (e) { body = 'body read err: ' + e.message; }
      let swarmLen = -1, latest = '';
      try {
        const j = JSON.parse(body);
        swarmLen = (j.swarm_section_html || '').length;
        latest = j.latest_ping_value || '';
      } catch (e) { /* 非 JSON */ }
      return { status: res.status, len: body.length, swarmLen, latest };
    });
    console.log(`[${label}] API via page: HTTP ${result.status}, body ${result.len}B, swarm_html ${result.swarmLen}B, latest_ping: ${result.latest}`);
    return result.status === 200 && result.swarmLen > 0;
  } catch (err) {
    console.log(`[${label}] ERROR: ${err.message}`);
    return false;
  } finally {
    await browser.close();
  }
}

const headlessOk = await tryBrowser('headless', { headless: true });
if (headlessOk) {
  console.log('RESULT: headless OK');
} else {
  console.log('RESULT: headless failed, trying headless via xvfb…');
  console.log('NOTE: 需要 xvfb 时请看下一步测试');
}
