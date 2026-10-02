# AI 智能翻译（Chrome 扩展）

基于 OpenAI 兼容协议的 AI 网页翻译插件，支持 **全页面翻译**、**划词翻译**、**网页总结**，原生支持中英互译。

## 功能

| 功能 | 说明 | 入口 |
| --- | --- | --- |
| 全页面翻译 | 整页文本逐段翻译，保留 URL / 邮箱 / 占位符，带进度条可取消，可一键恢复原文 | Popup「翻译本页」、右键菜单、`Alt+Shift+T` |
| 划词翻译 | 选中文字后出现悬浮按钮，弹出结果卡片（含原文对照、一键复制） | 选中文本、右键菜单、`Alt+Shift+S` |
| 网页总结 | 自动提取正文，右侧面板输出「概要 + 核心要点」结构化总结 | Popup「网页总结」、右键菜单、`Alt+Shift+G` |
| 恢复原文 | 还原页面所有已翻译内容 | Popup「恢复原文」、`Alt+Shift+R` |

其他能力：多目标语言（中/英/日/韩/法/德/西/俄）、批量并发翻译、结果缓存、暗色模式自适应。

## 安装

1. 打开 Chrome / Edge，进入 `chrome://extensions/`（Edge 为 `edge://extensions/`）；
2. 打开右上角「开发者模式」；
3. 点击「加载已解压的扩展程序」，选择本项目根目录（含 `manifest.json`）。

## 配置

点击工具栏图标打开弹窗，填写（兼容任意 OpenAI Chat Completions 协议服务）：

- **BaseUrl**：如 `https://api.deepseek.com`、`https://api.openai.com/v1`、`http://localhost:11434/v1`
- **API Key**
- **模型**：如 `deepseek-chat`、`deepseek-v4-flash`、`gpt-4o-mini` 等

点击「测试连接」验证，「高级设置」中可调整温度、最大输出、总结风格、快捷键等。

## 开发 / 测试

```powershell
npm install          # 安装测试依赖（playwright-core）
npm test             # AI 客户端单测 + 真实接口联调（需先配置 tests/config.local.json）
npm run test:e2e     # 用 Edge 加载扩展做端到端测试（全页翻译/划词/总结/弹窗/设置页）
```

`tests/config.local.json`（已被 gitignore）格式：

```json
{ "apiKey": "sk-...", "baseUrl": "https://api.deepseek.com", "model": "deepseek-chat" }
```

## 目录结构

```
manifest.json              扩展清单（MV3）
background/service-worker  后台：AI 请求路由、缓存、右键菜单、快捷键、脚本注入
content/content.js         内容脚本：全页翻译、划词翻译、总结面板（Shadow DOM）
shared/ai-client.js        纯逻辑 AI 客户端（可在 Node 中测试）
shared/config.js           配置读写（chrome.storage.local）
shared/markdown.js         极简 Markdown 渲染器（XSS 安全转义）
popup/                     弹窗页面（快捷操作 + 接口配置）
options/                   高级设置页
tools/gen-icons.ps1        图标生成脚本
tests/                     Node 单测与 Edge 端到端测试
```

## 隐私

配置仅保存在浏览器本地（`chrome.storage.local`），请求只发往用户自己填写的接口地址。
