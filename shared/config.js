/** 配置读写（chrome.storage.local），仅在扩展环境中使用。 */
import { DEFAULT_CONFIG } from './ai-client.js';

const KEY = 'config';

export async function getConfig() {
  const stored = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_CONFIG, ...(stored[KEY] || {}) };
}

export async function saveConfig(patch) {
  const current = await getConfig();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export function onConfigChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) callback(changes[KEY].newValue || {});
  });
}

export function isConfigured(config) {
  return Boolean(
    config && String(config.apiKey || '').trim() && String(config.baseUrl || '').trim()
  );
}
