// 把放久了的读物整理进知识库。
//
// 分工照旧：筛选（分类、年龄、明显不是文章的 url）全在代码里做，
// 只有"这东西值不值得长期留存"交给模型判断。
import { callBridge, extractJson, BridgeUnreachableError } from './classifier';
import { getClassifyConfig } from './store';

// 放这么多天没动的才算"陈旧"
const STALE_DAYS = 90;

// 一次最多交给模型这么多候选，太多了既慢又贵
const CANDIDATE_LIMIT = 250;

// 只从这两类里找读物
const READING_CATEGORIES = ['reading', 'learning'];

// 搜索结果页、登录页、本地服务、招聘页 —— 这些一定不是读物，不用问模型
const JUNK =
  /\/search|[?&]q=|google\.[a-z.]+\/(search|url)|duckduckgo|localhost|127\.0\.0\.1|\/login|accounts\.google|mail\.google|calendar\.google|\/jobs?\/|careers|ashbyhq|greenhouse|lever\.co|linkedin\.com\/(jobs|in)\//i;

const SYSTEM = `You curate a personal engineering knowledge base for an ML systems engineer (inference optimization, GPU efficiency, multimodal/VLM systems, 3D vision, world models).

From the candidate tabs, select the ones genuinely worth keeping as durable reference material: papers, substantive technical blog posts, in-depth tutorials, reference docs, and specific social posts or threads that actually explain something.

Judge social links (X/Twitter, HN, Reddit) by content, not by domain: a thread explaining a technique, reporting a benchmark, or walking through a paper belongs here. Exclude feeds, timelines, profiles and engagement bait.

Also exclude landing pages, product marketing, news, and anything you cannot identify from the title.

Classify each selection as one of: papers, blogposts, references, posts.
Use only ids from the input. Reply with JSON only — no prose, no markdown fences:
{"selected":[{"id":"<id>","kind":"papers|blogposts|references|posts","why":"<=12 words"}]}`;

export interface IngestCandidate {
  tabId: string;
  title?: string;
  url?: string;
  categoryId: string;
  createdAt: number;
}

export interface IngestItem {
  tabId: string;
  title?: string;
  url?: string;
  saved: string;
  kind: string;
  why?: string;
}

export interface IngestResult {
  file: string;
  items: IngestItem[];
}

// 手动入库时用户已经替模型做了判断，类型用 url 规则推即可，不必再问模型
function inferKind(url: string): string {
  if (/arxiv\.org|openreview|\.pdf($|\?)|dl\.acm\.org|ieeexplore/i.test(url)) return 'papers';
  if (/x\.com|twitter\.com|reddit\.com|news\.ycombinator/i.test(url)) return 'posts';
  if (/docs\.|developer\.|readthedocs|github\.com|\/docs?\//i.test(url)) return 'references';
  return 'blogposts';
}

/**
 * 手动把若干个标签页送进知识库，不调用模型，所以不花钱也没有延迟。
 *
 * 逐条点的时候会追加到当天同一个文件里，避免攒出几十个只有一行的文件。
 */
export async function ingestTabsDirectly(
  tabs: IngestCandidate[],
): Promise<IngestResult | undefined> {
  if (!tabs.length) return undefined;
  const { bridgeUrl } = await getClassifyConfig();
  const items: IngestItem[] = tabs.map(tab => ({
    tabId: tab.tabId,
    title: tab.title,
    url: tab.url,
    saved: day(tab.createdAt),
    kind: inferKind(tab.url || ''),
  }));

  const res = await fetch(`${bridgeUrl.replace(/\/$/, '')}/kb-ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items, append: true }),
  }).catch(() => {
    throw new BridgeUnreachableError(bridgeUrl);
  });
  const body = (await res.json()) as { file?: string; error?: string };
  if (!res.ok) throw new Error(body.error || `bridge returned ${res.status}`);
  return { file: body.file || '', items };
}

/** 纯确定性筛选，不花任何 token。 */
export function collectIngestCandidates(tabs: IngestCandidate[]): IngestCandidate[] {
  const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  return tabs
    .filter(
      tab =>
        READING_CATEGORIES.includes(tab.categoryId) &&
        tab.createdAt > 0 &&
        tab.createdAt < cutoff &&
        !!tab.title &&
        !!tab.url &&
        tab.url.startsWith('http') &&
        !JUNK.test(tab.url),
    )
    .filter(tab => !seen.has(tab.url!) && seen.add(tab.url!))
    // 最旧的优先，放得越久越该处理掉
    .sort((a, b) => a.createdAt - b.createdAt);
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * 挑出值得入库的读物，写进知识库的收件目录，返回写入的文件和入选条目。
 *
 * 调用方拿到 items 里的 tabId 之后可以把这些标签页清掉。
 */
export async function ingestStaleReadings(
  tabs: IngestCandidate[],
): Promise<IngestResult | undefined> {
  const candidates = collectIngestCandidates(tabs).slice(0, CANDIDATE_LIMIT);
  if (!candidates.length) return undefined;

  const { bridgeUrl } = await getClassifyConfig();
  const payload = candidates.map((tab, idx) => ({
    id: String(idx + 1),
    title: tab.title?.slice(0, 150) || '',
    url: tab.url,
    saved: day(tab.createdAt),
  }));

  const text = await callBridge(
    bridgeUrl,
    `Candidates:\n${JSON.stringify(payload)}`,
    SYSTEM,
  );
  const parsed = JSON.parse(extractJson(text)) as {
    selected?: { id?: string; kind?: string; why?: string }[];
  };

  const seen = new Set<string>();
  const items: IngestItem[] = [];
  (parsed.selected || []).forEach(({ id, kind, why }) => {
    const tab = candidates[Number(id) - 1];
    // id 越界或重复的直接丢弃，不猜测
    if (!tab || seen.has(tab.tabId)) return;
    seen.add(tab.tabId);
    items.push({
      tabId: tab.tabId,
      title: tab.title,
      url: tab.url,
      saved: day(tab.createdAt),
      kind: kind || 'references',
      why: why?.trim() || undefined,
    });
  });
  if (!items.length) return undefined;

  const res = await fetch(`${bridgeUrl.replace(/\/$/, '')}/kb-ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items }),
  }).catch(() => {
    throw new BridgeUnreachableError(bridgeUrl);
  });
  const body = (await res.json()) as { file?: string; error?: string };
  if (!res.ok) throw new Error(body.error || `bridge returned ${res.status}`);

  return { file: body.file || '', items };
}

export default { name: 'classify-ingest' };
