/**
 * 纯逻辑 AI 客户端：兼容 OpenAI Chat Completions 协议。
 * 不依赖任何 chrome API，可直接在 Node 中做单元测试。
 */

export const DEFAULT_CONFIG = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  temperature: 0.3,
  maxTokens: 4096,
  targetLang: 'zh',
  sourceLang: 'auto',
  summaryStyle: 'brief',
  floatButton: true,
  autoTranslate: false,
};

export const LANGUAGES = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'ru', label: 'Русский' },
];

export function langName(code) {
  const found = LANGUAGES.find((l) => l.code === code);
  return found ? found.label : code || '未知语言';
}

/* ------------------------------------------------------------------ */
/* URL 处理                                                            */
/* ------------------------------------------------------------------ */

export function normalizeBaseUrl(url) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

/**
 * 根据 BaseUrl 推导 chat completions 端点候选列表。
 * 已带版本号（/v1、/v4 …）的直接使用；否则优先尝试补 /v1，再退回原始路径。
 */
export function candidateEndpoints(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return [];
  const list = [];
  if (/\/(v\d+[a-z0-9]*)$/i.test(base)) {
    list.push(base + '/chat/completions');
  } else {
    list.push(base + '/v1/chat/completions');
    list.push(base + '/chat/completions');
  }
  return [...new Set(list)];
}

/* ------------------------------------------------------------------ */
/* 核心请求                                                            */
/* ------------------------------------------------------------------ */

export class AiError extends Error {
  constructor(message, { status = 0, endpoint = '' } = {}) {
    super(message);
    this.name = 'AiError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

function extractErrorMessage(data, status) {
  if (data && typeof data === 'object') {
    const msg =
      (data.error && (data.error.message || data.error.code)) ||
      data.message ||
      data.msg ||
      data.detail;
    if (msg) return String(msg);
  }
  const map = {
    401: 'API Key 无效或已过期（401）',
    403: '没有权限访问该模型（403）',
    404: '接口地址不存在（404），请检查 BaseUrl 与模型名称',
    429: '请求过于频繁或额度不足（429）',
  };
  if (map[status]) return map[status];
  return `请求失败（HTTP ${status || '未知'}）`;
}

export async function chatComplete({
  config,
  messages,
  temperature,
  maxTokens,
  signal,
  timeout = 120000,
}) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) };
  const apiKey = String(cfg.apiKey || '').trim();
  if (!apiKey) throw new AiError('尚未配置 API Key，请先在插件设置中填写');
  const endpoints = candidateEndpoints(cfg.baseUrl);
  if (!endpoints.length) throw new AiError('尚未配置 BaseUrl，请先在插件设置中填写');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  let lastError = null;
  try {
    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[i];
      let res;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + apiKey,
          },
          body: JSON.stringify({
            model: cfg.model,
            messages,
            temperature: Number.isFinite(Number(cfg.temperature))
              ? Number(cfg.temperature)
              : 0.3,
            max_tokens: Number(cfg.maxTokens) > 0 ? Number(cfg.maxTokens) : 4096,
            stream: false,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        lastError = new AiError(
          err && err.name === 'AbortError'
            ? '请求超时，请稍后重试'
            : `无法连接接口：${(err && err.message) || '网络错误'}`,
          { endpoint }
        );
        continue;
      }

      const raw = await res.text();
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch (_) {
        /* 非 JSON 响应 */
      }

      if (!res.ok) {
        lastError = new AiError(extractErrorMessage(data, res.status), {
          status: res.status,
          endpoint,
        });
        // 仅当接口地址类错误时才尝试下一个候选地址
        if (res.status === 404 || res.status === 405 || res.status === 400) continue;
        throw lastError;
      }

      const content =
        (data &&
          data.choices &&
          data.choices[0] &&
          data.choices[0].message &&
          (data.choices[0].message.content || data.choices[0].message.reasoning_content)) ||
        (data && data.choices && data.choices[0] && data.choices[0].text) ||
        (data && data.output_text) ||
        (data && data.content);

      if (typeof content !== 'string' || !content.trim()) {
        lastError = new AiError('接口返回内容为空，请检查模型名称是否正确', {
          status: res.status,
          endpoint,
        });
        continue;
      }
      return content;
    }
    throw lastError || new AiError('请求失败，请检查接口配置');
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/* ------------------------------------------------------------------ */
/* 文本切分                                                            */
/* ------------------------------------------------------------------ */

const SENTENCE_SPLIT = /([^.!?。！？；;\n]+[.!?。！？；;]*|\s+)/g;

/** 将超长文本按句子切分为不超过 max 的片段，保留所有分隔符与空白。 */
export function splitLongText(text, max = 1200) {
  if (!text || text.length <= max) return [text || ''];
  const pieces = String(text).match(SENTENCE_SPLIT) || [text];
  const parts = [];
  let buf = '';
  for (const piece of pieces) {
    if (buf && buf.length + piece.length > max) {
      parts.push(buf);
      buf = '';
    }
    if (piece.length > max) {
      // 单个句子仍过长，按长度硬切
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

/** 把待翻译单元分组为请求批次。 */
export function groupUnits(units, { maxChars = 2400, maxCount = 60 } = {}) {
  const batches = [];
  let current = [];
  let chars = 0;
  for (const unit of units) {
    const len = (unit.text || '').length;
    const oversized = current.length > 0 && (chars + len > maxChars || current.length >= maxCount);
    if (oversized) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(unit);
    chars += len;
  }
  if (current.length) batches.push(current);
  return batches;
}

/* ------------------------------------------------------------------ */
/* 翻译                                                                */
/* ------------------------------------------------------------------ */

export function buildTranslateMessages(texts, { sourceLang = 'auto', targetLang = 'zh' } = {}) {
  const target = langName(targetLang);
  const sourceHint =
    sourceLang && sourceLang !== 'auto'
      ? `原文语言为 ${langName(sourceLang)}，`
      : '请自动识别原文语言，';
  const system = [
    '你是专业的翻译引擎。',
    `${sourceHint}把用户输入 JSON 数组中的每个字符串翻译成${target}。`,
    '严格规则：',
    '1. 输出必须是合法 JSON 对象，格式为 {"translations": ["译文1", "译文2", ...]}；',
    '2. translations 的长度与顺序必须与输入数组完全一致，逐条对应，禁止合并、拆分或增删条目；',
    '3. 只输出 JSON，不要输出解释、序号、markdown 代码块；',
    '4. 保留原文的换行、首尾空格、标点风格、URL、邮箱、代码标识符、变量名与占位符（如 {name}、%s、{{var}}、<tag>）；',
    '5. 已经是目标语言、纯数字、纯符号或无需翻译的内容，原样返回。',
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(texts) },
  ];
}

function stripFences(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json|jsonc|text)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function pickArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    for (const key of ['translations', 'result', 'results', 'data', 'output', 'list']) {
      if (Array.isArray(parsed[key])) return parsed[key];
    }
    for (const value of Object.values(parsed)) {
      if (Array.isArray(value)) return value;
    }
  }
  return null;
}

/**
 * 解析模型返回的翻译结果，尽量容错。
 * 返回 { translations: string[], warning: string }
 */
export function parseTranslationReply(reply, count) {
  const fallbackOriginals = new Array(count).fill('');
  const warningFor = (msg) => ({ translations: fallbackOriginals, warning: msg });

  if (!reply) return warningFor('empty reply');

  const cleaned = stripFences(reply);
  let array = null;

  const tryParse = (text) => {
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  };

  array = pickArray(tryParse(cleaned));

  if (!array) {
    // 截取首尾花括号/方括号之间的内容再解析
    const startObj = cleaned.indexOf('{');
    const endObj = cleaned.lastIndexOf('}');
    if (startObj !== -1 && endObj > startObj) {
      array = pickArray(tryParse(cleaned.slice(startObj, endObj + 1)));
    }
  }
  if (!array) {
    const startArr = cleaned.indexOf('[');
    const endArr = cleaned.lastIndexOf(']');
    if (startArr !== -1 && endArr > startArr) {
      const parsed = tryParse(cleaned.slice(startArr, endArr + 1));
      if (Array.isArray(parsed)) array = parsed;
    }
  }

  if (!array) {
    // 退化解析：按行读取，去掉 "1. " 之类的序号
    const lines = cleaned
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*]\s*)?\d+[.、:：)）\]]?\s*/, '').trim())
      .map((line) => line.replace(/^["'“”‘’]|["'“”‘’]$/g, '').trim())
      .filter((line) => line.length > 0);
    if (lines.length === count) array = lines;
  }

  if (!array || !Array.isArray(array)) return warningFor('无法解析模型返回的 JSON');

  let list = array.map((item) => {
    if (item == null) return '';
    if (typeof item === 'string') return item;
    if (typeof item === 'object') {
      return (
        item.translation ||
        item.text ||
        item.translated ||
        item.result ||
        item.content ||
        ''
      );
    }
    return String(item);
  });

  if (list.length > count) list = list.slice(0, count);
  const warning = list.length === count ? '' : `条目数量不匹配（期望 ${count}，实际 ${list.length}）`;
  while (list.length < count) list.push('');
  return { translations: list, warning };
}

/** 翻译一个批次（内部已做长度控制由调用方保证）。 */
export async function translateBatch({ config, texts, targetLang, sourceLang, signal }) {
  const list = (texts || []).map((t) => String(t == null ? '' : t));
  if (!list.length) return { translations: [], warning: '' };
  const reply = await chatComplete({
    config,
    messages: buildTranslateMessages(list, { sourceLang, targetLang }),
    signal,
  });
  const { translations, warning } = parseTranslationReply(reply, list.length);
  const merged = translations.map((t, i) => {
    const val = String(t == null ? '' : t);
    return val.length ? val : list[i];
  });
  return { translations: merged, warning, raw: reply };
}

/* ------------------------------------------------------------------ */
/* 总结                                                                */
/* ------------------------------------------------------------------ */

export function buildSummarizeMessages(text, { lang = 'zh', style = 'brief' } = {}) {
  const target = langName(lang);
  const shape =
    style === 'detailed'
      ? [
          '## 一句话概要',
          '（一句话概括网页主题）',
          '',
          '## 核心要点',
          '- 要点 1',
          '- 要点 2',
          '- 要点 3',
          '',
          '## 关键细节',
          '- 重要数据、结论、时间、人物、操作步骤等',
          '',
          '## 延伸提示',
          '- 阅读建议或需要注意的地方',
        ].join('\n')
      : [
          '## 一句话概要',
          '（一句话概括网页主题）',
          '',
          '## 核心要点',
          '- 要点 1',
          '- 要点 2',
          '- 要点 3',
        ].join('\n');

  const system = [
    '你是网页内容分析助手，擅长提炼网页正文的信息。',
    `请阅读用户提供的网页正文，用${target}输出总结。`,
    '要求：只依据给定正文，不编造信息；条理清晰；使用 Markdown；不要复述原文大段内容。',
    '严格按下面的结构输出（可根据内容适当合并小节）：',
    shape,
  ].join('\n');

  const MAX = 14000;
  const body =
    text && text.length > MAX ? text.slice(0, MAX) + '\n……（正文过长已截断）' : text || '';
  return [
    { role: 'system', content: system },
    { role: 'user', content: `网页标题：${''}\n\n正文：\n${body}` },
  ];
}

export async function summarize({ config, text, lang, style, signal, title }) {
  const messages = buildSummarizeMessages(text, { lang, style });
  if (title) {
    messages[1].content = `网页标题：${title}\n\n正文：\n${
      text && text.length > 14000 ? text.slice(0, 14000) + '\n……（正文过长已截断）' : text || ''
    }`;
  }
  const content = await chatComplete({ config, messages, signal });
  return String(content || '').trim();
}

/* ------------------------------------------------------------------ */
/* 连接测试                                                            */
/* ------------------------------------------------------------------ */

export async function testConnection({ config, signal } = {}) {
  const started = Date.now();
  const content = await chatComplete({
    config,
    messages: [
      { role: 'system', content: 'You are a ping service.' },
      { role: 'user', content: 'Reply with exactly: OK' },
    ],
    signal,
    timeout: 30000,
  });
  return {
    ok: true,
    message: `连接成功（${((Date.now() - started) / 1000).toFixed(1)}s）：${String(content)
      .trim()
      .slice(0, 40)}`,
  };
}
