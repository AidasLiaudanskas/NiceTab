// 标签页自动分类 - 通过本地桥接服务调用 `claude -p` 进行分类
// 只有"归类"这一步交给模型，分批/缓存/校验都在代码里完成
import { CATEGORIES, CATEGORY_IDS, OTHER_CATEGORY_ID } from './taxonomy';
import {
  getClassifyCache,
  getClassifyConfig,
  lookupCategory,
  mergeClassifyResults,
  normalizeUrl,
} from './store';
import { UNCLASSIFIED_ID } from './taxonomy';

export interface ClassifyInput {
  url?: string;
  title?: string;
}

export interface ClassifyProgress {
  done: number;
  total: number;
}

// 单次请求携带的标签页数量
const BATCH_SIZE = 60;
// 标题过长时截断，避免浪费 token
const MAX_TITLE_LEN = 120;

export class BridgeUnreachableError extends Error {
  constructor(url: string) {
    super(`Can't reach the classify bridge at ${url}`);
    this.name = 'BridgeUnreachableError';
  }
}

const SYSTEM_PROMPT = [
  'You sort a user\'s saved browser tabs into categories so they can see what work is outstanding.',
  'Judge by what the user is trying to get done with the tab, not just the domain.',
  'A GitHub page can be Work or Learning; an Amazon page can be Shopping or Reference.',
  '',
  'Categories:',
  ...CATEGORIES.map(c => `- ${c.id}: ${c.hint}`),
  '',
  `Use "${OTHER_CATEGORY_ID}" only when nothing else is a reasonable fit.`,
  'Return exactly one assignment per numbered tab, using the same numbers you were given.',
  '',
  'Reply with JSON only — no prose, no markdown fences:',
  '{"assignments":[{"i":<tab number>,"category":"<category id>"}]}',
].join('\n');

// 把标签页渲染成紧凑的编号列表
function renderBatch(tabs: ClassifyInput[]): string {
  return tabs
    .map((tab, idx) => {
      const title = (tab.title || '').slice(0, MAX_TITLE_LEN).replace(/\s+/g, ' ').trim();
      let where = tab.url || '';
      try {
        const u = new URL(tab.url!);
        where = `${u.host}${u.pathname}`.slice(0, MAX_TITLE_LEN);
      } catch {
        // 非法 url 直接用原值
      }
      return `${idx + 1}. ${title || '(no title)'} — ${where}`;
    })
    .join('\n');
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function callBridge(bridgeUrl: string, prompt: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${bridgeUrl.replace(/\/$/, '')}/classify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ system: SYSTEM_PROMPT, prompt }),
    });
  } catch {
    // 连不上通常是桥接服务没启动
    throw new BridgeUnreachableError(bridgeUrl);
  }
  const payload = (await response.json()) as { result?: string; error?: string };
  if (!response.ok) throw new Error(payload.error || `bridge returned ${response.status}`);
  return payload.result || '';
}

// 模型偶尔会带上 markdown 围栏，取出其中的 JSON
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object in model reply');
  return body.slice(start, end + 1);
}

async function classifyBatch(
  bridgeUrl: string,
  tabs: ClassifyInput[],
): Promise<Record<string, string>> {
  const text = await callBridge(bridgeUrl, `Classify these tabs:\n\n${renderBatch(tabs)}`);

  const parsed = JSON.parse(extractJson(text)) as {
    assignments?: { i: number; category: string }[];
  };

  const results: Record<string, string> = {};
  (parsed.assignments || []).forEach(({ i, category }) => {
    const tab = tabs[i - 1];
    // 编号或分类越界时直接丢弃，不猜测
    if (!tab?.url || !CATEGORY_IDS.includes(category)) return;
    results[tab.url] = category;
  });
  return results;
}

// 桥接服务是否在运行，用于判断能否自动分类
export async function isBridgeUp(bridgeUrl?: string): Promise<boolean> {
  const { bridgeUrl: configured } = await getClassifyConfig();
  const url = (bridgeUrl || configured).replace(/\/$/, '');
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 对标签页分类，已缓存的会跳过。返回本次新增的分类结果。
 */
export async function classifyTabs(
  tabs: ClassifyInput[],
  onProgress?: (p: ClassifyProgress) => void,
): Promise<{ classified: number; skipped: number }> {
  const { bridgeUrl } = await getClassifyConfig();

  const cache = await getClassifyCache();
  const seen = new Set<string>();
  const pending: ClassifyInput[] = [];

  for (const tab of tabs) {
    const key = normalizeUrl(tab.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (lookupCategory(cache, tab.url) !== UNCLASSIFIED_ID) continue;
    pending.push(tab);
  }

  const skipped = seen.size - pending.length;
  if (!pending.length) {
    onProgress?.({ done: 0, total: 0 });
    return { classified: 0, skipped };
  }

  const batches = chunk(pending, BATCH_SIZE);
  let done = 0;
  let classified = 0;

  onProgress?.({ done: 0, total: pending.length });

  for (const batch of batches) {
    const results = await classifyBatch(bridgeUrl, batch);
    if (Object.keys(results).length) {
      await mergeClassifyResults(results);
      classified += Object.keys(results).length;
    }
    done += batch.length;
    onProgress?.({ done, total: pending.length });
  }

  return { classified, skipped };
}

export default { name: 'classify-classifier' };
