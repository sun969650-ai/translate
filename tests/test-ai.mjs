/**
 * Node 端自测：直接调用 shared/ai-client.js（纯逻辑，不依赖 chrome）。
 * 运行：node tests/test-ai.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CONFIG,
  candidateEndpoints,
  splitLongText,
  groupUnits,
  buildTranslateMessages,
  parseTranslationReply,
  translateBatch,
  summarize,
  testConnection,
  chatComplete,
} from '../shared/ai-client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const localConfigPath = path.join(here, 'config.local.json');
const config = fs.existsSync(localConfigPath)
  ? { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(localConfigPath, 'utf8')) }
  : { ...DEFAULT_CONFIG, apiKey: process.env.AIT_API_KEY || '' };

let pass = 0;
let fail = 0;

function check(name, condition, extra) {
  if (condition) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ' -> ' + extra : ''}`);
  }
}

async function run(name, fn) {
  console.log('\n▶ ' + name);
  try {
    await fn();
  } catch (err) {
    fail++;
    console.log(`  ✗ 抛出异常: ${err && err.message}`);
  }
}

async function main() {
  console.log('配置：', {
    baseUrl: config.baseUrl,
    model: config.model,
    targetLang: config.targetLang,
    apiKey: config.apiKey ? config.apiKey.slice(0, 8) + '***' : '(空)',
  });

  /* ---------------- 纯函数测试 ---------------- */
  await run('端点推导', () => {
    const a = candidateEndpoints('https://api.deepseek.com');
    check('deepseek 补 /v1', a[0] === 'https://api.deepseek.com/v1/chat/completions', a.join(','));
    const b = candidateEndpoints('https://api.openai.com/v1/');
    check('已带 /v1 不重复', b.length === 1 && b[0] === 'https://api.openai.com/v1/chat/completions', b.join(','));
    const c = candidateEndpoints('http://localhost:11434/v1');
    check('本地 v1', c[0] === 'http://localhost:11434/v1/chat/completions', c.join(','));
  });

  await run('长文本切分', () => {
    const text = Array.from({ length: 50 }, (_, i) => `这是第 ${i + 1} 句话，用于测试切分逻辑。`).join('');
    const parts = splitLongText(text, 300);
    check('切分后每片不超过上限', parts.every((p) => p.length <= 300), String(parts.length));
    check('拼接后与原文一致', parts.join('') === text);
  });

  await run('批次分组', () => {
    const units = Array.from({ length: 130 }, (_, i) => ({ index: i, text: 'x'.repeat(100) }));
    const groups = groupUnits(units, { maxChars: 2400, maxCount: 60 });
    const flat = groups.flat();
    check('条目无丢失且顺序不变', flat.length === 130 && flat[129].index === 129);
    check('每批不超过字符上限', groups.every((g) => g.reduce((s, u) => s + u.text.length, 0) <= 2400));
  });

  await run('返回结果解析容错', () => {
    const r1 = parseTranslationReply('{"translations":["你好","世界"]}', 2);
    check('标准 JSON', r1.translations.join('|') === '你好|世界' && !r1.warning);
    const r2 = parseTranslationReply('```json\n{"translations":["你好","世界"]}\n```', 2);
    check('带代码块', r2.translations.join('|') === '你好|世界');
    const r3 = parseTranslationReply('前缀说明\n{"translations":["你好","世界"]}\n后缀', 2);
    check('带前后缀文本', r3.translations.join('|') === '你好|世界');
    const r4 = parseTranslationReply('["你好","世界"]', 2);
    check('纯数组', r4.translations.join('|') === '你好|世界');
    const r5 = parseTranslationReply('1. 你好\n2. 世界', 2);
    check('退化按行解析', r5.translations.join('|') === '你好|世界', JSON.stringify(r5));
    const r6 = parseTranslationReply('{"translations":["你好"]}', 2);
    check('数量不足时补空', r6.translations.length === 2 && Boolean(r6.warning));
  });

  await run('提示词构建', () => {
    const msgs = buildTranslateMessages(['Hello world'], { sourceLang: 'auto', targetLang: 'zh' });
    check('包含 system 与 user', msgs.length === 2 && msgs[0].role === 'system');
    check('user 为 JSON 数组', JSON.parse(msgs[1].content)[0] === 'Hello world');
  });

  /* ---------------- 联网测试 ---------------- */
  if (!config.apiKey) {
    console.log('\n⚠ 未配置 API Key，跳过联网测试');
  } else {
    await run('接口连通性', async () => {
      const res = await testConnection({ config });
      check('连接成功', res.ok, res.message);
      console.log('    ' + res.message);
    });

    await run('批量翻译（英→中）', async () => {
      const texts = [
        'Hello, world!',
        'OpenAI-compatible API',
        'The quick brown fox jumps over the lazy dog.',
        'Contact us at support@example.com or visit https://example.com/docs',
        '12345',
      ];
      const res = await translateBatch({ config, texts, targetLang: 'zh', sourceLang: 'en' });
      console.log('    结果:', JSON.stringify(res.translations, null, 0));
      check('返回条目数量一致', res.translations.length === texts.length);
      check('全部非空', res.translations.every((t) => t && t.trim().length));
      check('中文输出', /[一-龥]/.test(res.translations[0]));
      check('URL 保留', res.translations[3].includes('https://example.com/docs'), res.translations[3]);
    });

    await run('批量翻译（中→英）', async () => {
      const texts = ['人工智能正在改变世界。', '请点击右上角按钮开始翻译。', '这个插件支持划词翻译与网页总结。'];
      const res = await translateBatch({ config, texts, targetLang: 'en', sourceLang: 'zh' });
      console.log('    结果:', JSON.stringify(res.translations, null, 0));
      check('返回条目数量一致', res.translations.length === texts.length);
      check('英文输出', /[A-Za-z]/.test(res.translations[0]) && !/[一-龥]/.test(res.translations[0]), res.translations[0]);
    });

    await run('大批量翻译（模拟整页 60 条）', async () => {
      const texts = Array.from({ length: 60 }, (_, i) => `Sample sentence number ${i + 1} for page translation.`);
      const started = Date.now();
      const res = await translateBatch({ config, texts, targetLang: 'zh', sourceLang: 'auto' });
      console.log(`    耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
      check('数量一致', res.translations.length === 60, String(res.translations.length));
      check('无警告', !res.warning, res.warning);
      check('条目对应正确', res.translations.every((t, i) => !t || /[一-龥]/.test(t) || t === texts[i]));
    });

    await run('网页总结', async () => {
      const article = `
人工智能（AI）正在快速改变软件行业。2025 年，超过 60% 的开发团队在日常工作中使用 AI 辅助编程工具，
代码补全、单元测试生成与缺陷检测是最常见的三个场景。研究显示，AI 辅助可以让重复性编码任务耗时降低约 35%，
但在复杂系统设计与安全审计方面仍需要资深工程师把关。专家建议：把 AI 当作结对编程的伙伴，
同时建立代码评审与安全扫描流程，避免盲目信任自动生成的代码。
`.repeat(3);
      const res = await summarize({ config, text: article, lang: 'zh', style: 'brief', title: 'AI 与软件工程' });
      console.log('    总结输出:\n' + res.split('\n').map((l) => '      ' + l).join('\n'));
      check('输出非空', Boolean(res && res.trim().length > 30));
      check('包含要点结构', /概要|要点|#|-/.test(res));
    });

    await run('错误处理（错误 Key）', async () => {
      let msg = '';
      try {
        await chatComplete({
          config: { ...config, apiKey: 'sk-invalid-key-for-test-0000000000000000' },
          messages: [{ role: 'user', content: 'hi' }],
        });
      } catch (err) {
        msg = err.message;
      }
      console.log('    错误信息:', msg);
      check('错误被捕获且可读', Boolean(msg) && msg.length > 0);
    });

    await run('错误处理（错误 BaseUrl）', async () => {
      let msg = '';
      try {
        await chatComplete({
          config: { ...config, baseUrl: 'https://api.deepseek.com/not-exist-path' },
          messages: [{ role: 'user', content: 'hi' }],
        });
      } catch (err) {
        msg = err.message;
      }
      console.log('    错误信息:', msg);
      check('错误被捕获且可读', Boolean(msg) && msg.length > 0);
    });
  }

  console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
  process.exit(fail ? 1 : 0);
}

main();
