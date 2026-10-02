/**
 * 内容脚本：全页面翻译、划词翻译、网页总结。
 * UI 全部渲染在 Shadow DOM 中，避免与页面样式冲突。
 */
(function () {
  if (window.__AIT_CONTENT_LOADED__) return;
  window.__AIT_CONTENT_LOADED__ = true;

  const MAX_UNIT = 1200; // 单条文本最大长度
  const MAX_CHARS = 2400; // 单批次最大字符数
  const MAX_COUNT = 60; // 单批次最大条目数
  const CONCURRENCY = 3; // 并发批次数

  const state = {
    config: null,
    translating: false,
    cancelFlag: false,
    translated: false,
    originals: new Map(),
    lastSelection: '',
    lastRect: null,
  };

  /* ---------------------------------------------------------------- */
  /* Shadow DOM 与样式                                                 */
  /* ---------------------------------------------------------------- */

  const CSS = `
:host {
  all: initial;
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483000 !important;
  pointer-events: none !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif !important;
}
.ait-root { all: initial; font-family: inherit; }
.ait-root *, .ait-root *::before, .ait-root *::after {
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}
:root { color-scheme: light dark; }
.ait-card, .ait-panel, .ait-progress, .ait-toast, .ait-float {
  --ait-bg: rgba(255,255,255,.96);
  --ait-fg: #1f2328;
  --ait-sub: #6b7280;
  --ait-border: rgba(15,23,42,.10);
  --ait-accent: #4f7cff;
  --ait-accent-2: #7c4dff;
  --ait-shadow: 0 12px 32px rgba(15,23,42,.16), 0 2px 8px rgba(15,23,42,.08);
  color: var(--ait-fg);
  background: var(--ait-bg);
  border: 1px solid var(--ait-border);
  border-radius: 14px;
  box-shadow: var(--ait-shadow);
  pointer-events: auto;
  backdrop-filter: blur(12px) saturate(1.4);
}
@media (prefers-color-scheme: dark) {
  .ait-card, .ait-panel, .ait-progress, .ait-toast, .ait-float {
    --ait-bg: rgba(28,30,36,.96);
    --ait-fg: #e8eaed;
    --ait-sub: #9aa1ab;
    --ait-border: rgba(255,255,255,.12);
    --ait-shadow: 0 12px 32px rgba(0,0,0,.5);
  }
}
.ait-float {
  position: fixed;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 6px 9px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--ait-accent), var(--ait-accent-2));
  color: #fff;
  border: none;
  user-select: none;
  transition: transform .12s ease, opacity .12s ease;
}
.ait-float:hover { transform: translateY(-1px) scale(1.03); }
.ait-float svg { width: 15px; height: 15px; }
.ait-card {
  position: fixed;
  width: 380px;
  max-width: calc(100vw - 24px);
  padding: 0;
  overflow: hidden;
  font-size: 14px;
  animation: ait-pop .16s ease;
}
@keyframes ait-pop { from { opacity: 0; transform: translateY(6px) scale(.98); } to { opacity: 1; transform: none; } }
.ait-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--ait-border);
  font-size: 13px; font-weight: 600;
}
.ait-head .ait-actions { display: flex; gap: 6px; }
.ait-btn {
  pointer-events: auto;
  border: 1px solid var(--ait-border);
  background: transparent;
  color: var(--ait-sub);
  border-radius: 8px;
  padding: 4px 9px;
  font-size: 12px;
  cursor: pointer;
  transition: all .15s ease;
}
.ait-btn:hover { color: var(--ait-accent); border-color: var(--ait-accent); background: rgba(79,124,255,.08); }
.ait-btn.primary { background: linear-gradient(135deg, var(--ait-accent), var(--ait-accent-2)); color: #fff; border: none; }
.ait-body { padding: 12px; max-height: 46vh; overflow: auto; line-height: 1.65; }
.ait-src {
  font-size: 12.5px; color: var(--ait-sub);
  border-left: 3px solid var(--ait-accent); padding: 4px 0 4px 8px; margin: 0 0 10px;
  max-height: 92px; overflow: auto; white-space: pre-wrap; word-break: break-word;
}
.ait-out { font-size: 14.5px; white-space: pre-wrap; word-break: break-word; }
.ait-out p { margin: 0 0 10px; }
.ait-out h1, .ait-out h2, .ait-out h3, .ait-out h4 { margin: 14px 0 8px; font-size: 15px; }
.ait-out ul, .ait-out ol { margin: 0 0 10px; padding-left: 20px; }
.ait-out li { margin: 4px 0; }
.ait-out code { background: rgba(127,127,127,.16); padding: 1px 5px; border-radius: 5px; font-size: 12.5px; }
.ait-out pre { background: rgba(127,127,127,.12); padding: 10px; border-radius: 8px; overflow: auto; }
.ait-out a { color: var(--ait-accent); }
.ait-out hr { border: none; border-top: 1px solid var(--ait-border); margin: 12px 0; }
.ait-foot { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-top: 1px solid var(--ait-border); font-size: 12px; color: var(--ait-sub); }
.ait-skel { display: flex; flex-direction: column; gap: 8px; }
.ait-skel i {
  display: block; height: 12px; border-radius: 6px;
  background: linear-gradient(90deg, rgba(127,127,127,.16), rgba(127,127,127,.32), rgba(127,127,127,.16));
  background-size: 200% 100%;
  animation: ait-shimmer 1.2s infinite linear;
}
@keyframes ait-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.ait-progress {
  position: fixed; right: 20px; bottom: 20px; width: 260px; padding: 12px 14px;
}
.ait-progress .title { font-size: 13px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
.ait-bar { margin: 9px 0 10px; height: 6px; border-radius: 999px; background: rgba(127,127,127,.22); overflow: hidden; }
.ait-bar span { display: block; height: 100%; width: 0%; border-radius: 999px; background: linear-gradient(90deg, var(--ait-accent), var(--ait-accent-2)); transition: width .2s ease; }
.ait-panel {
  position: fixed; top: 0; right: 0; height: 100vh; width: 400px; max-width: 92vw;
  border-radius: 0; border-top: none; border-right: none; border-bottom: none;
  display: flex; flex-direction: column;
  animation: ait-slide .2s ease;
}
@keyframes ait-slide { from { transform: translateX(30px); opacity: 0; } to { transform: none; opacity: 1; } }
.ait-panel .ait-body { flex: 1; max-height: none; }
.ait-toast {
  position: fixed; left: 50%; top: 18px; transform: translateX(-50%);
  padding: 9px 16px; font-size: 13px; border-radius: 999px; max-width: 80vw;
}
.ait-toast.error { border-color: rgba(239,68,68,.5); color: #ef4444; }
.ait-toast.success { border-color: rgba(34,197,94,.5); color: #16a34a; }
.ait-badge {
  display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600;
  padding: 2px 8px; border-radius: 999px; background: rgba(79,124,255,.12); color: var(--ait-accent);
}
`;

  const host = document.createElement('div');
  host.id = 'ait-host';
  host.style.cssText =
    'all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
  (document.documentElement || document.body).appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  const rootEl = document.createElement('div');
  rootEl.className = 'ait-root';
  shadow.appendChild(styleEl);
  shadow.appendChild(rootEl);

  function h(tag, className, html) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (html != null) el.innerHTML = html;
    return el;
  }

  function isOwnEvent(e) {
    return e.target === host || (e.composedPath && e.composedPath().includes(host));
  }

  let toastTimer = null;
  function showToast(text, kind) {
    const old = rootEl.querySelector('.ait-toast');
    if (old) old.remove();
    const el = h('div', 'ait-toast' + (kind ? ' ' + kind : ''), escapeHtml(text));
    rootEl.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 3200);
  }

  const escapeHtml = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  /* ---------------------------------------------------------------- */
  /* 与后台通信                                                        */
  /* ---------------------------------------------------------------- */

  function bg(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (res) => {
          const err = chrome.runtime.lastError;
          if (err) resolve({ ok: false, message: err.message });
          else resolve(res);
        });
      } catch (err) {
        resolve({ ok: false, message: err && err.message });
      }
    });
  }

  async function getConfig(force) {
    if (!state.config || force) {
      const cfg = await bg({ type: 'config.get' });
      state.config = cfg && cfg.apiKey !== undefined ? cfg : null;
    }
    return state.config || {};
  }

  /* ---------------------------------------------------------------- */
  /* 文本节点收集                                                      */
  /* ---------------------------------------------------------------- */

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'IFRAME', 'CANVAS',
    'SVG', 'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'HEAD', 'TITLE', 'META', 'LINK', 'MATH',
  ]);

  function isVisible(el) {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (cs.opacity && parseFloat(cs.opacity) === 0) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    return true;
  }

  function translatable(text) {
    if (!text || !text.trim()) return false;
    return /[\p{L}]/u.test(text);
  }

  function collectTextNodes() {
    const nodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
        if (
          parent.closest(
            '[translate="no"], .notranslate, .ait-host, #ait-host, [data-ait-ignore]'
          )
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        if (!translatable(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        if (!isVisible(parent)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function splitLongText(text, max) {
    if (!text || text.length <= max) return [text || ''];
    const pieces = String(text).match(/([^.!?。！？；;\n]+[.!?。！？；;]*|\s+)/g) || [text];
    const parts = [];
    let buf = '';
    for (const piece of pieces) {
      if (buf && buf.length + piece.length > max) {
        parts.push(buf);
        buf = '';
      }
      if (piece.length > max) {
        let rest = piece;
        while (rest.length > max) {
          if (buf) {
            parts.push(buf);
            buf = '';
          }
          parts.push(rest.slice(0, max));
          rest = rest.slice(max);
        }
        buf += rest;
      } else {
        buf += piece;
      }
    }
    if (buf) parts.push(buf);
    return parts;
  }

  /* ---------------------------------------------------------------- */
  /* 全页面翻译                                                        */
  /* ---------------------------------------------------------------- */

  let progressEl = null;

  function showProgress(done, total) {
    if (!progressEl) {
      progressEl = h('div', 'ait-progress');
      progressEl.innerHTML =
        '<div class="title"><span>AI 正在翻译页面…</span><button class="ait-btn" data-act="cancel">取消</button></div>' +
        '<div class="ait-bar"><span></span></div>' +
        '<div class="ait-foot" style="border:none;padding:0"><span class="count"></span></div>';
      progressEl.querySelector('[data-act="cancel"]').addEventListener('click', () => {
        state.cancelFlag = true;
        showToast('已取消翻译', 'error');
      });
      rootEl.appendChild(progressEl);
    }
    const pct = total ? Math.round((done / total) * 100) : 0;
    progressEl.querySelector('.ait-bar span').style.width = pct + '%';
    progressEl.querySelector('.count').textContent = `${done} / ${total} 段（${pct}%）`;
  }

  function hideProgress() {
    if (progressEl) {
      progressEl.remove();
      progressEl = null;
    }
  }

  function buildUnits() {
    const nodes = collectTextNodes();
    const metas = [];
    const units = [];
    nodes.forEach((node) => {
      const raw = node.nodeValue;
      const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
      const prefix = m ? m[1] : '';
      const core = m ? m[2] : raw;
      const suffix = m ? m[3] : '';
      if (!core.trim()) return;
      const parts = splitLongText(core, MAX_UNIT);
      const meta = {
        node,
        orig: raw,
        prefix,
        suffix,
        results: new Array(parts.length).fill(''),
        done: 0,
        applied: false,
      };
      const index = metas.length;
      metas.push(meta);
      parts.forEach((text, partIndex) => {
        units.push({ index, partIndex, text });
      });
    });
    return { metas, units };
  }

  function applyMeta(meta) {
    if (meta.applied) return;
    const value = meta.prefix + meta.results.join('') + meta.suffix;
    if (value === meta.orig) {
      meta.applied = true;
      return;
    }
    state.originals.set(meta.node, meta.orig);
    meta.node.nodeValue = value;
    meta.applied = true;
  }

  async function translatePage() {
    if (state.translating) return { ok: false, message: '正在翻译中，请稍候' };
    if (state.translated) restorePage();

    const cfg = await getConfig(true);
    const { metas, units } = buildUnits();
    if (!units.length) return { ok: false, message: '当前页面没有可翻译的文本' };

    state.translating = true;
    state.cancelFlag = false;
    showProgress(0, units.length);

    const batches = [];
    let current = [];
    let chars = 0;
    for (const unit of units) {
      const len = unit.text.length;
      if (current.length && (chars + len > MAX_CHARS || current.length >= MAX_COUNT)) {
        batches.push(current);
        current = [];
        chars = 0;
      }
      current.push(unit);
      chars += len;
    }
    if (current.length) batches.push(current);

    const queue = batches.slice();
    let done = 0;
    let failures = 0;

    async function worker() {
      while (queue.length) {
        if (state.cancelFlag) return;
        const batch = queue.shift();
        let ok = false;
        try {
          const res = await bg({
            type: 'ai.translate',
            texts: batch.map((u) => u.text),
            targetLang: cfg.targetLang,
            sourceLang: cfg.sourceLang,
          });
          if (res && res.ok && Array.isArray(res.translations)) {
            batch.forEach((u, i) => {
              const meta = metas[u.index];
              if (!meta.results[u.partIndex]) meta.done++;
              meta.results[u.partIndex] = res.translations[i] || u.text;
            });
            ok = true;
          } else if (res && res.message) {
            failures++;
            showToast(res.message, 'error');
          } else {
            failures++;
          }
        } catch (err) {
          failures++;
        }
        if (!ok) {
          batch.forEach((u) => {
            const meta = metas[u.index];
            if (!meta.results[u.partIndex]) meta.done++;
            meta.results[u.partIndex] = u.text;
          });
        }
        done += batch.length;
        showProgress(done, units.length);
        metas.forEach((meta) => {
          if (meta.done === meta.results.length) applyMeta(meta);
        });
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    hideProgress();
    state.translating = false;
    state.translated = state.originals.size > 0;

    if (state.cancelFlag) return { ok: false, message: '已取消翻译' };
    if (failures) {
      showToast(`已翻译 ${state.originals.size} 段，${failures} 个批次失败`, 'error');
      return { ok: false, message: `部分内容翻译失败（${failures} 个批次）` };
    }
    showToast(`翻译完成，共 ${state.originals.size} 段`, 'success');
    return { ok: true, translated: state.originals.size };
  }

  function restorePage() {
    let count = 0;
    state.originals.forEach((orig, node) => {
      node.nodeValue = orig;
      count++;
    });
    state.originals.clear();
    state.translated = false;
    if (count) showToast(`已恢复原文（${count} 段）`, 'success');
    hideProgress();
    return { ok: true, restored: count };
  }

  /* ---------------------------------------------------------------- */
  /* 划词翻译                                                          */
  /* ---------------------------------------------------------------- */

  let floatBtn = null;
  let selCard = null;

  const FLOAT_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h7"/><path d="M13 5h7"/><path d="M9 3v2"/><path d="M4 11h7"/><path d="M13 11h7"/><path d="M4 17h7"/><path d="M13 17h7"/><path d="M20 3v18"/></svg>';

  function ensureFloatBtn() {
    if (floatBtn) return floatBtn;
    floatBtn = h('button', 'ait-float');
    floatBtn.innerHTML = FLOAT_ICON + '<span>翻译</span>';
    floatBtn.addEventListener('mousedown', (e) => e.preventDefault());
    floatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hideFloat();
      translateSelection(state.lastSelection);
    });
    return floatBtn;
  }

  function showFloat(rect) {
    const btn = ensureFloatBtn();
    const width = 78;
    let left = rect.right + 6;
    let top = rect.top - 34;
    if (left + width > window.innerWidth - 8) left = Math.min(rect.left + 6, window.innerWidth - width - 8);
    if (top < 8) top = rect.bottom + 8;
    if (top + 34 > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 42);
    btn.style.left = Math.max(8, left) + 'px';
    btn.style.top = top + 'px';
    if (!btn.isConnected) rootEl.appendChild(btn);
  }

  function hideFloat() {
    if (floatBtn && floatBtn.isConnected) floatBtn.remove();
  }

  function onSelectionChange() {
    const sel = window.getSelection();
    const text = sel ? String(sel.toString() || '').trim() : '';
    if (!text || text.length < 1 || text.length > 6000) {
      hideFloat();
      state.lastSelection = '';
      return;
    }
    // 忽略插件自身 UI（Shadow DOM）中的选择
    const anchorRoot = sel.anchorNode && sel.anchorNode.getRootNode && sel.anchorNode.getRootNode();
    if (anchorRoot && anchorRoot !== document && anchorRoot.host === host) {
      hideFloat();
      return;
    }
    const range = sel.rangeCount ? sel.getRangeAt(0) : null;
    const rect = range ? range.getBoundingClientRect() : null;
    if (!rect || (!rect.width && !rect.height)) {
      hideFloat();
      return;
    }
    state.lastSelection = text;
    state.lastRect = rect;
    showFloat(rect);
  }

  document.addEventListener('mouseup', () => setTimeout(onSelectionChange, 10), true);
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift' || (e.shiftKey && e.key.startsWith('Arrow'))) {
      setTimeout(onSelectionChange, 10);
    }
  }, true);
  document.addEventListener('mousedown', (e) => {
    if (isOwnEvent(e)) return;
    hideFloat();
  }, true);
  window.addEventListener('scroll', hideFloat, true);

  function clampPosition(el, rect, width, height) {
    let left = rect ? rect.left : window.innerWidth - width - 20;
    let top = rect ? rect.bottom + 8 : 80;
    left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - width - 16));
    if (top + height > window.innerHeight - 16) {
      top = Math.max(16, window.innerHeight - height - 16);
    }
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function closeSelCard() {
    if (selCard) {
      selCard.remove();
      selCard = null;
    }
  }

  async function translateSelection(text) {
    const source = String(text || state.lastSelection || '').trim();
    if (!source) {
      showToast('请先选中需要翻译的文本', 'error');
      return { ok: false, message: '没有选中的文本' };
    }
    const cfg = await getConfig(true);
    closeSelCard();

    const card = h('div', 'ait-card');
    card.innerHTML =
      '<div class="ait-head"><span class="ait-badge">AI 划词翻译</span>' +
      '<span class="ait-actions"><button class="ait-btn" data-act="copy">复制</button>' +
      '<button class="ait-btn" data-act="close">关闭</button></span></div>' +
      '<div class="ait-body"><div class="ait-src"></div><div class="ait-out ait-skel">' +
      '<i style="width:100%"></i><i style="width:92%"></i><i style="width:70%"></i></div></div>' +
      '<div class="ait-foot"><span>模型 ' +
      escapeHtml(cfg.model || '') +
      '</span><span class="status">翻译中…</span></div>';

    card.querySelector('.ait-src').textContent =
      source.length > 500 ? source.slice(0, 500) + '…' : source;

    const rect = state.lastRect;
    rootEl.appendChild(card);
    selCard = card;
    clampPosition(card, rect, 380, Math.min(320, card.offsetHeight || 220));

    card.querySelector('[data-act="close"]').addEventListener('click', closeSelCard);
    card.querySelector('[data-act="copy"]').addEventListener('click', () => {
      const out = card.querySelector('.ait-out').innerText;
      copyText(out);
    });

    const res = await bg({
      type: 'ai.translate',
      texts: [source],
      targetLang: cfg.targetLang,
      sourceLang: cfg.sourceLang,
    });

    const out = card.querySelector('.ait-out');
    const status = card.querySelector('.status');
    if (res && res.ok && res.translations && res.translations[0]) {
      out.className = 'ait-out';
      out.textContent = res.translations[0];
      status.textContent = '完成';
      clampPosition(card, rect, 380, Math.min(460, card.offsetHeight || 220));
    } else {
      out.className = 'ait-out';
      out.textContent = (res && res.message) || '翻译失败，请检查接口配置';
      status.textContent = '失败';
      showToast((res && res.message) || '翻译失败', 'error');
    }
    return res || { ok: false };
  }

  function copyText(text) {
    const value = String(text || '');
    if (!value) return;
    try {
      navigator.clipboard.writeText(value).then(
        () => showToast('已复制到剪贴板', 'success'),
        () => fallbackCopy(value)
      );
    } catch (_) {
      fallbackCopy(value);
    }
  }

  function fallbackCopy(value) {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('已复制到剪贴板', 'success');
    } catch (_) {
      showToast('复制失败，请手动选择文本', 'error');
    }
    ta.remove();
  }

  /* ---------------------------------------------------------------- */
  /* 网页总结                                                          */
  /* ---------------------------------------------------------------- */

  let panel = null;

  function getMainText() {
    const selectors = ['article', 'main', '[role="main"]', '#content', '.content'];
    let text = '';
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.trim().length > 200) {
        text = el.innerText;
        break;
      }
    }
    if (!text) text = (document.body && document.body.innerText) || '';
    return text.replace(/\n{3,}/g, '\n\n').trim();
  }

  function closePanel() {
    if (panel) {
      panel.remove();
      panel = null;
    }
  }

  async function summarizePage() {
    const cfg = await getConfig(true);
    closePanel();

    panel = h('div', 'ait-panel');
    panel.innerHTML =
      '<div class="ait-head"><span class="ait-badge">AI 网页总结</span>' +
      '<span class="ait-actions"><button class="ait-btn" data-act="copy">复制</button>' +
      '<button class="ait-btn" data-act="close">关闭</button></span></div>' +
      '<div class="ait-body"><div class="ait-out ait-skel">' +
      '<i style="width:60%"></i><i style="width:100%"></i><i style="width:88%"></i>' +
      '<i style="width:94%"></i><i style="width:70%"></i></div></div>' +
      '<div class="ait-foot"><span>' +
      escapeHtml((cfg.summaryStyle === 'detailed' ? '详细总结' : '简要总结') + ' · ' + (cfg.model || '')) +
      '</span><span class="status">正在阅读网页…</span></div>';
    rootEl.appendChild(panel);

    panel.querySelector('[data-act="close"]').addEventListener('click', closePanel);
    panel.querySelector('[data-act="copy"]').addEventListener('click', () => {
      copyText(panel.querySelector('.ait-out').innerText);
    });

    const text = getMainText();
    const status = panel.querySelector('.status');
    if (!text || text.length < 30) {
      status.textContent = '失败';
      panel.querySelector('.ait-out').className = 'ait-out';
      panel.querySelector('.ait-out').textContent = '没能获取到足够的网页正文，无法总结。';
      return { ok: false, message: '网页正文不足' };
    }

    const res = await bg({
      type: 'ai.summarize',
      text,
      title: document.title,
      lang: cfg.targetLang,
      style: cfg.summaryStyle,
    });

    const out = panel.querySelector('.ait-out');
    if (res && res.ok && res.summary) {
      out.className = 'ait-out';
      const renderer = window.AITMarkdown || { render: (t) => escapeHtml(t).replace(/\n/g, '<br>') };
      out.innerHTML = renderer.render(res.summary);
      status.textContent = '完成';
    } else {
      out.className = 'ait-out';
      out.textContent = (res && res.message) || '总结失败，请检查接口配置';
      status.textContent = '失败';
    }
    return res || { ok: false };
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePanel();
      closeSelCard();
      hideFloat();
    }
  }, true);

  /* ---------------------------------------------------------------- */
  /* 消息入口                                                          */
  /* ---------------------------------------------------------------- */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const type = msg && msg.type;
    if (type === 'ait.ping') {
      sendResponse({ ok: true, translated: state.translated });
      return false;
    }
    if (type !== 'ait.action') return false;

    const action = msg.action;
    const run = async () => {
      switch (action) {
        case 'translatePage':
          return translatePage();
        case 'restore':
          return restorePage();
        case 'translateSelection':
          return translateSelection(msg.text || state.lastSelection);
        case 'summarize':
          return summarizePage();
        case 'state':
          return { ok: true, translated: state.translated };
        default:
          return { ok: false, message: '未知操作' };
      }
    };

    run().then(sendResponse).catch((err) => {
      sendResponse({ ok: false, message: (err && err.message) || '执行失败' });
    });
    return true;
  });

  /* ---------------------------------------------------------------- */
  /* 初始化                                                            */
  /* ---------------------------------------------------------------- */

  (async () => {
    const cfg = await getConfig();
    if (cfg && cfg.autoTranslate) {
      setTimeout(() => translatePage(), 500);
    }
  })();
})();
