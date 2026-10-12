// 首屏顶部那一行"羞耻统计"：最近几天在摸鱼站点上的访问次数。
//
// 数据来自 chrome.history，是回溯的 —— 不需要先采集一段时间才有东西看。
// visitCount 是「历史总次数」，要算窗口内的次数必须逐个 url 取 getVisits。
const SINK_HOSTS = [
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'x.com',
  'twitter.com',
  'reddit.com',
  'tiktok.com',
];

// 用来对比的"正经"站点，让数字有参照
const REFERENCE_HOST = 'github.com';

const WINDOW_DAYS = 7;

// 算一次要发不少 history 请求，缓存一会儿，别每开一个新标签页就重算
const TTL_MS = 30 * 60 * 1000;

const USAGE_KEY: `local:${string}` = 'local:usageStats';

export interface UsageStats {
  at: number;
  days: number;
  sinkVisits: number;
  topHost?: string;
  topVisits: number;
  refHost: string;
  refVisits: number;
}

// 窗口内某个站点的访问次数
async function visitsFor(host: string, since: number): Promise<number> {
  const items = await browser.history.search({
    text: host,
    startTime: since,
    maxResults: 1000,
  });
  let total = 0;
  for (const item of items) {
    if (!item.url) continue;
    // search 是全文匹配，可能带上 url 里只是提到了这个域名的条目
    try {
      if (!new URL(item.url).hostname.endsWith(host)) continue;
    } catch {
      continue;
    }
    const visits = await browser.history.getVisits({ url: item.url });
    total += visits.filter(v => (v.visitTime ?? 0) >= since).length;
  }
  return total;
}

export async function getUsageStats(): Promise<UsageStats | undefined> {
  const cached = await storage.getItem<UsageStats>(USAGE_KEY);
  if (cached && Date.now() - cached.at < TTL_MS) return cached;

  // 没授权就别算，调用方会把这一行藏起来
  if (!browser.history?.search) return cached || undefined;

  const since = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  let sinkVisits = 0;
  let topHost: string | undefined;
  let topVisits = 0;
  for (const host of SINK_HOSTS) {
    const count = await visitsFor(host, since);
    sinkVisits += count;
    if (count > topVisits) {
      topVisits = count;
      topHost = host;
    }
  }

  const stats: UsageStats = {
    at: Date.now(),
    days: WINDOW_DAYS,
    sinkVisits,
    topHost,
    topVisits,
    refHost: REFERENCE_HOST,
    refVisits: await visitsFor(REFERENCE_HOST, since),
  };
  await storage.setItem(USAGE_KEY, stats);
  return stats;
}

export default { name: 'usage' };
