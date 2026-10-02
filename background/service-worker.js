/**
 * 后台 Service Worker：
 *  - 统一处理 AI 请求（翻译 / 总结 / 连接测试）
 *  - 维护右键菜单与快捷键
 *  - 向标签页注入内容脚本并转发操作指令
 */
import { getConfig, saveConfig, isConfigured } from '../shared/config.js';
import { translateBatch, summarize, testConnection } from '../shared/ai-client.js';

const CACHE_LIMIT = 800;
const cache = new Map();

function cacheKey(cfg, text, target, source) {
  return [cfg.model, target, source, text].join('§');
}

function rememberCache(key, value) {
  if (!value) return;
  if (cache.size >= CACHE_LIMIT) {
    // 简单 FIFO 淘汰
    const first = cache.keys().next().value;
    cache.delete(first);
  }
  cache.set(key, value);
}

/* ------------------------------------------------------------------ */
/* 安装与菜单                                                          */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'ait-translate-selection',
      title: 'AI 翻译选中文本',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'ait-translate-page',
      title: 'AI 翻译本页',
      contexts: ['page', 'action'],
    });
    chrome.contextMenus.create({
      id: 'ait-summarize-page',
      title: 'AI 总结本页',
      contexts: ['page', 'action'],
    });
    chrome.contextMenus.create({
      id: 'ait-restore-page',
      title: '恢复页面原文',
      contexts: ['page', 'action'],
    });
  });

  const cfg = await getConfig();
  if (!isConfigured(cfg)) {
    chrome.runtime.openOptionsPage();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;
  const map = {
    'ait-translate-selection': 'translateSelection',
    'ait-translate-page': 'translatePage',
    'ait-summarize-page': 'summarize',
    'ait-restore-page': 'restore',
  };
  const action = map[info.menuItemId];
  if (action) await runTabAction(action, tab.id);
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  const map = {
    'translate-page': 'translatePage',
    'restore-page': 'restore',
    'translate-selection': 'translateSelection',
    'summarize-page': 'summarize',
  };
  const action = map[command];
  if (action) await runTabAction(action, tab.id);
});

/* ------------------------------------------------------------------ */
/* 内容脚本注入                                                        */
/* ------------------------------------------------------------------ */

async function ensureContentScript(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'ait.ping' });
    if (res && res.ok) return true;
  } catch (_) {
    /* 未注入，继续 */
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['shared/markdown.js', 'content/content.js'],
    });
    return true;
  } catch (err) {
    console.warn('[AI 翻译] 注入内容脚本失败:', err);
    return false;
  }
}

async function runTabAction(action, tabId) {
  const ok = await ensureContentScript(tabId);
  if (!ok) {
    return { ok: false, message: '当前页面不支持翻译（可能是浏览器内部页面）' };
  }
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'ait.action', action });
    return res || { ok: true };
  } catch (err) {
    return { ok: false, message: '与页面通信失败，请刷新页面后重试' };
  }
}

/* ------------------------------------------------------------------ */
/* AI 能力                                                             */
/* ------------------------------------------------------------------ */

async function handleTranslate({ texts, targetLang, sourceLang }) {
  const cfg = await getConfig();
  if (!isConfigured(cfg)) {
    return { ok: false, message: '请先在插件设置中填写 API Key 与 BaseUrl' };
  }
  const list = (texts || []).map((t) => String(t == null ? '' : t));
  if (!list.length) return { ok: true, translations: [] };

  const out = new Array(list.length).fill('');
  const missing = [];
  list.forEach((text, i) => {
    const hit = cache.get(cacheKey(cfg, text, targetLang, sourceLang));
    if (typeof hit === 'string' && hit) out[i] = hit;
    else missing.push(i);
  });

  if (missing.length) {
    const { translations, warning } = await translateBatch({
      config: cfg,
      texts: missing.map((i) => list[i]),
      targetLang,
      sourceLang,
    });
    missing.forEach((idx, k) => {
      const value = translations[k];
      out[idx] = value;
      rememberCache(cacheKey(cfg, list[idx], targetLang, sourceLang), value);
    });
    if (warning) console.warn('[AI 翻译] 结果解析提示:', warning);
  }
  return { ok: true, translations: out };
}

async function handleSummarize({ text, lang, style, title }) {
  const cfg = await getConfig();
  if (!isConfigured(cfg)) {
    return { ok: false, message: '请先在插件设置中填写 API Key 与 BaseUrl' };
  }
  const result = await summarize({ config: cfg, text, lang, style, title });
  return { ok: true, summary: result };
}

async function handleTest() {
  const cfg = await getConfig();
  if (!isConfigured(cfg)) {
    return { ok: false, message: '请先填写 API Key 与 BaseUrl' };
  }
  try {
    const res = await testConnection({ config: cfg });
    return { ok: true, message: res.message };
  } catch (err) {
    return { ok: false, message: err && err.message ? err.message : '连接失败' };
  }
}

/* ------------------------------------------------------------------ */
/* 消息路由                                                            */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const type = msg && msg.type;

  if (type === 'config.get') {
    getConfig().then((cfg) => sendResponse(cfg));
    return true;
  }
  if (type === 'config.save') {
    saveConfig(msg.config || {}).then((cfg) => sendResponse({ ok: true, config: cfg }));
    return true;
  }
  if (type === 'config.reset-cache') {
    cache.clear();
    sendResponse({ ok: true });
    return false;
  }
  if (type === 'ai.translate') {
    handleTranslate(msg).then(sendResponse).catch((err) => {
      sendResponse({ ok: false, message: err && err.message ? err.message : '翻译失败' });
    });
    return true;
  }
  if (type === 'ai.summarize') {
    handleSummarize(msg).then(sendResponse).catch((err) => {
      sendResponse({ ok: false, message: err && err.message ? err.message : '总结失败' });
    });
    return true;
  }
  if (type === 'ai.test') {
    handleTest().then(sendResponse);
    return true;
  }
  if (type === 'tab.action') {
    (async () => {
      let tabId = msg.tabId;
      if (!tabId) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = tab && tab.id;
      }
      if (!tabId) {
        sendResponse({ ok: false, message: '没有可用的标签页' });
        return;
      }
      sendResponse(await runTabAction(msg.action, tabId));
    })();
    return true;
  }
  if (type === 'open.options') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
