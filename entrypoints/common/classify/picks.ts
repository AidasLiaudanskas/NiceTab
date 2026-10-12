// 首屏的"重点关注"：从已分类的标签页里挑出现在最该处理的，以及最该清掉的。
//
// 和 classifier.ts 的分工：classifier 回答"这是什么类"，picks 回答"哪几个重要"。
// 候选集筛选、id 映射、缓存都在代码里做，只有排序判断交给模型。
import { callBridge, extractJson, BridgeUnreachableError } from './classifier';
import { getClassifyConfig } from './store';
import { PICKS_CRITERIA } from './picksCriteria';

// 候选集上限：按时间倒序取最近的这么多个。CLOSE 的判断标准（重复、失效、
// 不匹配的岗位……）覆盖所有分类，所以这里不按分类过滤。
const CANDIDATE_LIMIT = 400;

// 挑选结果缓存多久。新标签页开得很频繁，不该每次都重新排。
const TTL_MS = 6 * 60 * 60 * 1000;

// close 列表剩不到这么多条就重新排一次
const CLOSE_FLOOR = 5;

// 两次重排之间的最小间隔。没有这个，模型本来就只给出 <5 条时会每次打开都重排。
const MIN_RERANK_MS = 10 * 60 * 1000;

const PICKS_KEY: `local:${string}` = 'local:topPicks';

export interface Pick {
  tabId: string;
  reason?: string;
}

export interface PicksState {
  at: number;
  keepJob: Pick[];
  keepLearn: Pick[];
  close: Pick[];
  // 初次排序时 close 的条数。用来区分"被清空了"和"模型本来就没给够"
  closeInitial: number;
}

export interface PickCandidate {
  tabId: string;
  title?: string;
  url?: string;
  categoryId: string;
  createdAt: number;
}

export async function getPicks(): Promise<PicksState | undefined> {
  return (await storage.getItem<PicksState>(PICKS_KEY)) || undefined;
}

export async function clearPicks(): Promise<void> {
  await storage.removeItem(PICKS_KEY);
}

export function picksAreFresh(state?: PicksState): boolean {
  return !!state && Date.now() - state.at < TTL_MS;
}

/**
 * 是否该重新排一次。
 *
 * remainingClose 是 close 列表里还真实存在的标签页数量 —— 用户清掉几个之后，
 * 剩下的不足 CLOSE_FLOOR 就补一批新的。但如果模型一开始就没给够，
 * 重排也补不出来，所以要靠 closeInitial 和最小间隔挡住死循环。
 */
export function shouldRerank(state: PicksState | undefined, remainingClose: number): boolean {
  if (!state) return true;
  if (!picksAreFresh(state)) return true;
  if (Date.now() - state.at < MIN_RERANK_MS) return false;
  return state.closeInitial >= CLOSE_FLOOR && remainingClose < CLOSE_FLOOR;
}

// 模型只需要照抄 id，所以用短序号而不是 NiceTab 的长 tabId，省 token 也更难抄错
function systemPrompt(): string {
  return [
    PICKS_CRITERIA.trim(),
    '',
    '## Output',
    'Use only ids from the input. Reply with JSON only — no prose, no markdown fences:',
    '{"keep":{"job":[{"id":"<id>","reason":"<why it matters now>"}],' +
      '"learn":[{"id":"<id>","reason":"<why it matters now>"}]},' +
      '"close":[{"id":"<id>","reason":"<why it is safe to close>"}]}',
  ].join('\n');
}

function renderCandidates(tabs: PickCandidate[]): string {
  return JSON.stringify(
    tabs.map((tab, idx) => ({
      id: String(idx + 1),
      title: tab.title?.slice(0, 140) || '',
      url: tab.url || '',
      category: tab.categoryId,
      saved: new Date(tab.createdAt).toISOString().slice(0, 10),
    })),
  );
}

function resolve(
  raw: { id?: string; reason?: string }[] | undefined,
  candidates: PickCandidate[],
  taken: Set<string>,
  limit: number,
): Pick[] {
  const out: Pick[] = [];
  (raw || []).forEach(({ id, reason }) => {
    const tab = candidates[Number(id) - 1];
    // id 越界、重复、或已经被别的列表占用的，直接丢弃，不猜测
    if (!tab || taken.has(tab.tabId) || out.length >= limit) return;
    taken.add(tab.tabId);
    out.push({ tabId: tab.tabId, reason: reason?.trim() || undefined });
  });
  return out;
}

/**
 * 计算重点关注列表。没有配置排序标准时退化成"每类取最近的 5 个"，
 * 这样 prompt 还没定下来时界面上也有东西可看。
 */
export async function computePicks(all: PickCandidate[]): Promise<PicksState> {
  const sorted = [...all].sort((a, b) => b.createdAt - a.createdAt);
  const recentByCategory = (categoryId: string, n: number) =>
    sorted.filter(t => t.categoryId === categoryId).slice(0, n).map(t => ({ tabId: t.tabId }));

  const fallback = (): PicksState => ({
    at: Date.now(),
    keepJob: recentByCategory('job-search', 5),
    keepLearn: recentByCategory('learning', 5),
    close: [],
    closeInitial: 0,
  });

  if (!PICKS_CRITERIA.trim() || !sorted.length) {
    const state = fallback();
    await storage.setItem(PICKS_KEY, state);
    return state;
  }

  const candidates = sorted.slice(0, CANDIDATE_LIMIT);
  const { bridgeUrl } = await getClassifyConfig();

  let state: PicksState;
  try {
    const text = await callBridge(
      bridgeUrl,
      `Tabs:\n${renderCandidates(candidates)}`,
      systemPrompt(),
    );
    const parsed = JSON.parse(extractJson(text)) as {
      keep?: { job?: { id?: string; reason?: string }[]; learn?: { id?: string; reason?: string }[] };
      close?: { id?: string; reason?: string }[];
    };
    // 同一个标签页不能同时出现在两个列表里，用 taken 保证
    const taken = new Set<string>();
    // KEEP 必须先解析：taken 是先到先得，而 prompt 要求"KEEP 里的东西绝不关闭"
    const keepJob = resolve(parsed.keep?.job, candidates, taken, 5);
    const keepLearn = resolve(parsed.keep?.learn, candidates, taken, 5);
    const close = resolve(parsed.close, candidates, taken, 10);
    state = {
      at: Date.now(),
      keepJob,
      keepLearn,
      close,
      closeInitial: close.length,
    };
  } catch (err) {
    if (err instanceof BridgeUnreachableError) throw err;
    // 排序失败不该让首屏空掉
    console.error('Ranking picks failed:', err);
    state = fallback();
  }

  await storage.setItem(PICKS_KEY, state);
  return state;
}

export default { name: 'classify-picks' };
