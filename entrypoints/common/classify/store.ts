// 标签页自动分类 - 本地存储（分类结果缓存 + API Key）
import { UNCLASSIFIED_ID } from './taxonomy';

export interface ClassifyRecord {
  categoryId: string;
  at: number;
}

export type ClassifyCache = Record<string, ClassifyRecord>;

export interface ClassifyConfig {
  bridgeUrl: string;
}

const CACHE_KEY: `local:${string}` = 'local:classifyCache';
const CONFIG_KEY: `local:${string}` = 'local:classifyConfig';

// 缓存上限，超出后淘汰最旧的记录
const CACHE_LIMIT = 5000;

// 本地桥接服务地址（scripts/classify-bridge.mjs）
export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787';

// 用于分类缓存的 url 归一化：去掉 hash 和常见跟踪参数
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|msclkid$|ref$|ref_src$|igshid$)/;

export function normalizeUrl(url?: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    u.hash = '';
    const keys = [...u.searchParams.keys()];
    keys.forEach(k => TRACKING_PARAMS.test(k) && u.searchParams.delete(k));
    u.host = u.host.toLowerCase();
    return u.toString();
  } catch {
    return url;
  }
}

export async function getClassifyCache(): Promise<ClassifyCache> {
  return (await storage.getItem<ClassifyCache>(CACHE_KEY)) || {};
}

export async function setClassifyCache(cache: ClassifyCache) {
  let next = cache;
  const entries = Object.entries(cache);
  if (entries.length > CACHE_LIMIT) {
    next = Object.fromEntries(
      entries.sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_LIMIT),
    );
  }
  await storage.setItem(CACHE_KEY, next);
}

// 合并新的分类结果
export async function mergeClassifyResults(results: Record<string, string>) {
  const cache = await getClassifyCache();
  const at = Date.now();
  Object.entries(results).forEach(([url, categoryId]) => {
    cache[normalizeUrl(url)] = { categoryId, at };
  });
  await setClassifyCache(cache);
  return cache;
}

export function lookupCategory(cache: ClassifyCache, url?: string): string {
  return cache[normalizeUrl(url)]?.categoryId || UNCLASSIFIED_ID;
}

export async function clearClassifyCache() {
  await storage.setItem(CACHE_KEY, {});
}

export async function getClassifyConfig(): Promise<ClassifyConfig> {
  const saved = await storage.getItem<Partial<ClassifyConfig>>(CONFIG_KEY);
  return { bridgeUrl: saved?.bridgeUrl || DEFAULT_BRIDGE_URL };
}

export async function setClassifyConfig(config: Partial<ClassifyConfig>) {
  const current = await getClassifyConfig();
  await storage.setItem(CONFIG_KEY, { ...current, ...config });
}

export const classifyCacheKey = CACHE_KEY;
export const classifyConfigKey = CONFIG_KEY;

export default { name: 'classify-store' };
