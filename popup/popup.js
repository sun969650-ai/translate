import { DEFAULT_CONFIG, LANGUAGES } from '../shared/ai-client.js';
import { isConfigured } from '../shared/config.js';

const $ = (id) => document.getElementById(id);

const els = {
  statusPill: $('statusPill'),
  targetLang: $('targetLang'),
  sourceLang: $('sourceLang'),
  swapLang: $('swapLang'),
  baseUrl: $('baseUrl'),
  apiKey: $('apiKey'),
  model: $('model'),
  toggleKey: $('toggleKey'),
  saveBtn: $('saveBtn'),
  testBtn: $('testBtn'),
  message: $('message'),
  openOptions: $('openOptions'),
};

let config = { ...DEFAULT_CONFIG };

function fillLanguageSelect(select, includeAuto) {
  const html = [];
  if (includeAuto) html.push('<option value="auto">自动检测</option>');
  html.push(
    LANGUAGES.map((l) => `<option value="${l.code}">${l.label}</option>`).join('')
  );
  select.innerHTML = html.join('');
}

function showMessage(text, kind) {
  els.message.className = 'message' + (kind ? ' ' + kind : '');
  els.message.textContent = text || '';
}

function refreshStatus() {
  const ok = isConfigured(config);
  els.statusPill.textContent = ok ? '已配置' : '未配置';
  els.statusPill.classList.toggle('ok', ok);
}

function applyConfig(cfg) {
  config = { ...DEFAULT_CONFIG, ...cfg };
  els.baseUrl.value = config.baseUrl;
  els.apiKey.value = config.apiKey;
  els.model.value = config.model;
  els.targetLang.value = LANGUAGES.some((l) => l.code === config.targetLang)
    ? config.targetLang
    : 'zh';
  els.sourceLang.value = LANGUAGES.some((l) => l.code === config.sourceLang)
    ? config.sourceLang
    : 'auto';
  refreshStatus();
}

function collectForm() {
  return {
    baseUrl: els.baseUrl.value.trim(),
    apiKey: els.apiKey.value.trim(),
    model: els.model.value.trim(),
    targetLang: els.targetLang.value,
    sourceLang: els.sourceLang.value,
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

async function saveConfig(silent) {
  const patch = collectForm();
  const res = await send({ type: 'config.save', config: patch });
  if (res.ok) {
    config = { ...config, ...res.config };
    refreshStatus();
    if (!silent) showMessage('设置已保存', 'success');
    return true;
  }
  showMessage((res && res.message) || '保存失败', 'error');
  return false;
}

async function runAction(action) {
  if (!isConfigured({ ...config, ...collectForm() })) {
    showMessage('请先填写 API Key 与 BaseUrl 并保存', 'error');
    return;
  }
  await saveConfig(true);
  showMessage('正在处理，请稍候…');
  const res = await send({ type: 'tab.action', action });
  if (res && res.ok) {
    if (action === 'translatePage') showMessage('页面翻译完成', 'success');
    else if (action === 'restore') showMessage('已恢复原文', 'success');
    else if (action === 'summarize') showMessage('网页总结已在页面右侧打开', 'success');
    else if (action === 'translateSelection') showMessage('划词翻译已触发，请先选中文本', 'success');
    else showMessage('完成', 'success');
  } else {
    showMessage((res && res.message) || '操作失败', 'error');
  }
}

async function testConnection() {
  await saveConfig(true);
  els.testBtn.disabled = true;
  els.testBtn.textContent = '测试中…';
  showMessage('正在连接接口…');
  const res = await send({ type: 'ai.test' });
  els.testBtn.disabled = false;
  els.testBtn.textContent = '测试连接';
  showMessage((res && res.message) || '测试完成', res && res.ok ? 'success' : 'error');
}

function bind() {
  fillLanguageSelect(els.targetLang, false);
  fillLanguageSelect(els.sourceLang, true);

  els.swapLang.addEventListener('click', async () => {
    const next = config.targetLang === 'zh' ? 'en' : 'zh';
    els.targetLang.value = next;
    await saveConfig(true);
    refreshStatus();
    showMessage(`目标语言已切换为 ${next === 'zh' ? '中文' : 'English'}`, 'success');
  });

  els.toggleKey.addEventListener('click', () => {
    els.apiKey.type = els.apiKey.type === 'password' ? 'text' : 'password';
  });

  els.saveBtn.addEventListener('click', () => saveConfig(false));
  els.testBtn.addEventListener('click', testConnection);
  els.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

  document.querySelectorAll('.action').forEach((btn) => {
    btn.addEventListener('click', () => runAction(btn.dataset.action));
  });
}

async function init() {
  bind();
  const cfg = await send({ type: 'config.get' });
  applyConfig(cfg && cfg.apiKey !== undefined ? cfg : {});
  if (!isConfigured(config)) {
    showMessage('首次使用：请填写 BaseUrl、API Key 与模型后保存', 'error');
  }
}

init();
