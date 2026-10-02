import { DEFAULT_CONFIG, LANGUAGES } from '../shared/ai-client.js';
import { isConfigured } from '../shared/config.js';

const $ = (id) => document.getElementById(id);

const els = {
  baseUrl: $('baseUrl'),
  apiKey: $('apiKey'),
  model: $('model'),
  temperature: $('temperature'),
  maxTokens: $('maxTokens'),
  targetLang: $('targetLang'),
  sourceLang: $('sourceLang'),
  summaryStyle: $('summaryStyle'),
  floatButton: $('floatButton'),
  autoTranslate: $('autoTranslate'),
  toggleKey: $('toggleKey'),
  saveBtn: $('saveBtn'),
  testBtn: $('testBtn'),
  clearCache: $('clearCache'),
  resetBtn: $('resetBtn'),
  message: $('message'),
};

let config = { ...DEFAULT_CONFIG };

function showMessage(text, kind) {
  els.message.className = 'message' + (kind ? ' ' + kind : '');
  els.message.textContent = text || '';
}

function fillLanguages() {
  els.targetLang.innerHTML = LANGUAGES.map(
    (l) => `<option value="${l.code}">${l.label}</option>`
  ).join('');
  els.sourceLang.innerHTML =
    '<option value="auto">自动检测</option>' +
    LANGUAGES.map((l) => `<option value="${l.code}">${l.label}</option>`).join('');
}

function applyConfig(cfg) {
  config = { ...DEFAULT_CONFIG, ...cfg };
  els.baseUrl.value = config.baseUrl || '';
  els.apiKey.value = config.apiKey || '';
  els.model.value = config.model || '';
  els.temperature.value = config.temperature;
  els.maxTokens.value = config.maxTokens;
  els.targetLang.value = config.targetLang;
  els.sourceLang.value = config.sourceLang;
  els.summaryStyle.value = config.summaryStyle;
  els.floatButton.checked = Boolean(config.floatButton);
  els.autoTranslate.checked = Boolean(config.autoTranslate);
}

function collectForm() {
  return {
    baseUrl: els.baseUrl.value.trim(),
    apiKey: els.apiKey.value.trim(),
    model: els.model.value.trim(),
    temperature: Number(els.temperature.value),
    maxTokens: Number(els.maxTokens.value),
    targetLang: els.targetLang.value,
    sourceLang: els.sourceLang.value,
    summaryStyle: els.summaryStyle.value,
    floatButton: els.floatButton.checked,
    autoTranslate: els.autoTranslate.checked,
  };
}

function send(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => resolve(res || {}));
    } catch (err) {
      resolve({ ok: false, message: err && err.message });
    }
  });
}

async function save(silent) {
  const res = await send({ type: 'config.save', config: collectForm() });
  if (res.ok) {
    config = res.config;
    if (!silent) showMessage('设置已保存', 'success');
    return true;
  }
  showMessage((res && res.message) || '保存失败', 'error');
  return false;
}

async function testConnection() {
  await save(true);
  if (!isConfigured(config)) {
    showMessage('请先填写 API Key 与 BaseUrl', 'error');
    return;
  }
  els.testBtn.disabled = true;
  els.testBtn.textContent = '测试中…';
  showMessage('正在连接接口…');
  const res = await send({ type: 'ai.test' });
  els.testBtn.disabled = false;
  els.testBtn.textContent = '测试连接';
  showMessage((res && res.message) || '测试完成', res && res.ok ? 'success' : 'error');
}

function bind() {
  fillLanguages();

  els.toggleKey.addEventListener('click', () => {
    els.apiKey.type = els.apiKey.type === 'password' ? 'text' : 'password';
  });
  els.saveBtn.addEventListener('click', () => save(false));
  els.testBtn.addEventListener('click', testConnection);

  els.clearCache.addEventListener('click', async () => {
    await send({ type: 'config.reset-cache' });
    showMessage('翻译缓存已清空', 'success');
  });

  els.resetBtn.addEventListener('click', async () => {
    const res = await send({ type: 'config.save', config: DEFAULT_CONFIG });
    if (res.ok) {
      applyConfig(res.config);
      showMessage('已恢复默认设置', 'success');
    }
  });
}

async function init() {
  bind();
  const cfg = await send({ type: 'config.get' });
  applyConfig(cfg && cfg.apiKey !== undefined ? cfg : {});
  if (!isConfigured(config)) showMessage('请先填写 BaseUrl、API Key 与模型，然后点击「测试连接」', 'error');
}

init();
