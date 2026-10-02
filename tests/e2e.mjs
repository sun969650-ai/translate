/**
 * 端到端测试：用 Edge（Chromium）加载扩展，真实调用 AI 接口验证全部功能。
 * 运行：node tests/e2e.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const config = JSON.parse(fs.readFileSync(path.join(here, 'config.local.json'), 'utf8'));

const TEST_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>AI Translate E2E Test</title></head>
<body>
  <article id="main">
    <h1>Artificial Intelligence and Software Engineering</h1>
    <p id="sel-target">Machine translation has improved dramatically with large language models.</p>
    <p>Developers around the world use AI tools to write, review and test code every day.</p>
    <p>However, human engineers are still essential for system design and security audits.</p>
    <p>Studies suggest that AI assistance reduces repetitive coding time by about thirty-five percent.</p>
    <p>Contact us at support@example.com or visit https://example.com/docs for more information.</p>
  </article>
</body>
</html>`;

let pass = 0;
let fail = 0;
const results = [];

function check(name, condition, extra) {
  if (condition) {
    pass++;
    results.push(`  ✓ ${name}`);
  } else {
    fail++;
    results.push(`  ✗ ${name}${extra ? ' -> ' + extra : ''}`);
  }
}

function waitFor(predicate, timeout, label) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        if (await predicate()) return resolve(true);
      } catch (_) {
        /* ignore */
      }
      if (Date.now() - started > timeout) return reject(new Error('超时: ' + label));
      setTimeout(tick, 400);
    };
    tick();
  });
}

async function main() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(TEST_PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const pageUrl = `http://127.0.0.1:${port}/`;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ait-e2e-'));
  console.log('启动 Edge（加载扩展）…');

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: true,
    args: [
      `--disable-extensions-except=${root}`,
      `--load-extension=${root}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
    ],
  });

  try {
    let sw =
      context.serviceWorkers().find((w) => w.url().includes('service-worker')) ||
      (await context.waitForEvent('serviceworker', { timeout: 20000 }));
    console.log('Service Worker:', sw.url());
    const extId = new URL(sw.url()).host;

    // 写入用户配置
    await sw.evaluate((cfg) => new Promise((r) => chrome.storage.local.set({ config: cfg }, r)), config);
    console.log('已写入插件配置\n');

    /* ---------- 1. 全页面翻译 ---------- */
    console.log('▶ 全页面翻译');
    const page = await context.newPage();
    await page.goto(pageUrl, { waitUntil: 'load' });
    await page.waitForSelector('#ait-host', { timeout: 15000 });

    const runAction = (action) =>
      sw.evaluate(
        ({ action, pattern }) =>
          new Promise(async (resolve) => {
            try {
              const [tab] = await chrome.tabs.query({ url: pattern });
              if (!tab) return resolve({ ok: false, message: '未找到标签页' });
              const res = await chrome.tabs.sendMessage(tab.id, { type: 'ait.action', action });
              resolve(res);
            } catch (err) {
              resolve({ ok: false, message: err.message });
            }
          }),
        { action, pattern: `http://127.0.0.1:${port}/*` }
      );

    const tr = await runAction('translatePage');
    console.log('   translatePage:', JSON.stringify(tr).slice(0, 120));
    check('translatePage 返回成功', tr && tr.ok, JSON.stringify(tr));

    await waitFor(async () => {
      const text = await page.evaluate(() => document.body.innerText);
      return /[一-龥]/.test(text) && !/Machine translation/.test(text);
    }, 60000, '页面翻译完成').catch(() => {});

    const zhText = await page.evaluate(() => document.body.innerText);
    check('正文已翻译为中文', /[一-龥]/.test(zhText), zhText.slice(0, 80));
    check('英文原文被替换', !/Machine translation has improved/.test(zhText));
    check('邮箱/URL 保留', zhText.includes('support@example.com') && zhText.includes('https://example.com/docs'));
    const ping1 = await runAction('state');
    check('翻译状态标记', ping1 && ping1.translated === true, JSON.stringify(ping1));

    /* ---------- 2. 恢复原文 ---------- */
    console.log('▶ 恢复原文');
    const rs = await runAction('restore');
    const enText = await page.evaluate(() => document.body.innerText);
    check('restore 返回成功', rs && rs.ok, JSON.stringify(rs));
    check('正文恢复英文', /Machine translation has improved/.test(enText), enText.slice(0, 80));
    const ping2 = await runAction('state');
    check('状态复位', ping2 && ping2.translated === false, JSON.stringify(ping2));

    /* ---------- 3. 划词翻译 ---------- */
    console.log('▶ 划词翻译');
    await page.evaluate(() => {
      const p = document.querySelector('#sel-target');
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.waitForTimeout(400);
    const hasFloat = await page.evaluate(() => {
      const host = document.querySelector('#ait-host');
      return Boolean(host && host.shadowRoot && host.shadowRoot.querySelector('.ait-float'));
    });
    check('悬浮翻译按钮出现', hasFloat);

    const selRes = await runAction('translateSelection');
    console.log('   translateSelection:', JSON.stringify(selRes).slice(0, 120));
    check('划词翻译请求成功', selRes && selRes.ok && /[一-龥]/.test(String(selRes.translations && selRes.translations[0])), JSON.stringify(selRes));

    await waitFor(async () => {
      const out = await page.evaluate(() => {
        const host = document.querySelector('#ait-host');
        const card = host && host.shadowRoot.querySelector('.ait-card .ait-out');
        return card ? card.innerText : '';
      });
      return /[一-龥]/.test(out) && !out.includes('翻译中');
    }, 60000, '划词结果卡片渲染').catch(() => {});

    const cardText = await page.evaluate(() => {
      const host = document.querySelector('#ait-host');
      const card = host && host.shadowRoot.querySelector('.ait-card');
      return card ? card.innerText : '';
    });
    check('结果卡片展示译文', /[一-龥]/.test(cardText), cardText.slice(0, 100));
    check('结果卡片包含原文对照', cardText.includes('Machine translation'));

    /* ---------- 4. 网页总结 ---------- */
    console.log('▶ 网页总结');
    const sumRes = await runAction('summarize');
    console.log('   summarize:', JSON.stringify(sumRes).slice(0, 120));
    check('总结请求成功', sumRes && sumRes.ok && String(sumRes.summary || '').length > 30, JSON.stringify(sumRes).slice(0, 200));

    await waitFor(async () => {
      const out = await page.evaluate(() => {
        const host = document.querySelector('#ait-host');
        const body = host && host.shadowRoot.querySelector('.ait-panel .ait-out');
        return body && !body.classList.contains('ait-skel') ? body.innerText : '';
      });
      return out.length > 40;
    }, 90000, '总结面板渲染').catch(() => {});

    const panelText = await page.evaluate(() => {
      const host = document.querySelector('#ait-host');
      const body = host && host.shadowRoot.querySelector('.ait-panel .ait-out');
      return body ? body.innerText : '';
    });
    check('总结面板展示内容', panelText.length > 40, panelText.slice(0, 100));
    check('总结为中文且结构化', /[一-龥]/.test(panelText) && /概要|要点|##|-/.test(panelText));

    /* ---------- 5. Popup 弹窗 ---------- */
    console.log('▶ Popup 弹窗');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'load' });
    check('弹窗加载', (await popup.title()).length > 0);
    check('四个功能按钮存在', (await popup.locator('.action').count()) === 4);
    check('接口配置表单存在', (await popup.locator('#baseUrl').inputValue()) === config.baseUrl);
    check('目标语言默认中文', (await popup.locator('#targetLang').inputValue()) === 'zh');
    check('状态徽标为已配置', (await popup.locator('#statusPill').innerText()).includes('已配置'));

    await popup.click('#testBtn');
    await waitFor(async () => {
      const msg = await popup.locator('#message').innerText();
      return msg.includes('连接成功') || msg.includes('失败');
    }, 40000, '测试连接返回').catch(() => {});
    const testMsg = await popup.locator('#message').innerText();
    check('弹窗内测试连接成功', testMsg.includes('连接成功'), testMsg);

    // 切换目标语言为英文并保存
    await popup.selectOption('#targetLang', 'en');
    await popup.click('#saveBtn');
    await popup.waitForTimeout(500);
    const saved = await sw.evaluate(() => new Promise((r) => chrome.storage.local.get('config', (s) => r(s.config))));
    check('弹窗保存配置生效', saved.targetLang === 'en', JSON.stringify(saved).slice(0, 120));
    // 还原
    await popup.selectOption('#targetLang', 'zh');
    await popup.click('#saveBtn');

    /* ---------- 6. 设置页 ---------- */
    console.log('▶ 设置页');
    const opt = await context.newPage();
    await opt.goto(`chrome-extension://${extId}/options/options.html`, { waitUntil: 'load' });
    check('设置页表单回填', (await opt.locator('#model').inputValue()) === saved.model);
    check('设置页偏好开关', await opt.locator('#floatButton').isChecked());

    /* ---------- 汇总 ---------- */
    console.log('\n========== E2E 结果 ==========');
    results.forEach((r) => console.log(r));
    console.log(`通过 ${pass}，失败 ${fail}`);
  } finally {
    await context.close().catch(() => {});
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E 运行失败:', err);
  process.exit(1);
});
