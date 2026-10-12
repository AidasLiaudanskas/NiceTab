import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  theme,
  Button,
  Modal,
  Input,
  Spin,
  Tooltip,
  message,
  notification,
} from 'antd';
import {
  ReloadOutlined,
  SettingOutlined,
  FolderOpenOutlined,
  DownOutlined,
  UpOutlined,
  CloseOutlined,
  BookOutlined,
} from '@ant-design/icons';
import { ThemeProvider } from 'styled-components';
import { tabListUtils } from '~/entrypoints/common/storage';
import type { TabItem } from '~/entrypoints/types';
import { GlobalContext } from '~/entrypoints/common/hooks/global';
import { openAdminRoutePage } from '~/entrypoints/common/tabs';
import { GlobalStyle } from '~/entrypoints/common/style/Common.styled';
import { getFaviconByExtApi, initFaviconApiData } from '~/entrypoints/common/utils/favicon';
import { UNCLASSIFIED_ID, categoryById } from '~/entrypoints/common/classify/taxonomy';
import {
  DEFAULT_BRIDGE_URL,
  classifyCacheKey,
  getClassifyCache,
  getClassifyConfig,
  lookupCategory,
  setClassifyConfig,
  type ClassifyCache,
} from '~/entrypoints/common/classify/store';
import {
  BridgeUnreachableError,
  classifyTabs,
  isBridgeUp,
  type ClassifyProgress,
} from '~/entrypoints/common/classify/classifier';
import {
  computePicks,
  getPicks,
  shouldRerank,
  type PickCandidate,
  type PicksState,
} from '~/entrypoints/common/classify/picks';
import { dedupeLibrary } from '~/entrypoints/common/utils/dedupe';
import { getUsageStats, type UsageStats } from '~/entrypoints/common/utils/usage';
import {
  collectIngestCandidates,
  ingestStaleReadings,
  ingestTabsDirectly,
  type IngestCandidate,
} from '~/entrypoints/common/classify/ingest';

import {
  StyledDashboard,
  StyledPicks,
  StyledSection,
  StyledTabCard,
} from './App.styled';

initFaviconApiData();

// 启动桥接服务的命令，连不上时提示用户
const BRIDGE_CMD = 'pnpm bridge';

// 默认每个分类只展示最近的若干个，避免几百个标签页一次铺满屏幕
const TOP_N = 10;

// 删除后留给用户撤销的时间；这段时间内只是在界面上隐藏，还没真正写存储
const UNDO_MS = 15000;

// createdAt 在这里统一成时间戳，便于排序
type FlatTab = Omit<TabItem, 'createdAt'> & {
  groupId: string;
  groupName: string;
  createdAt: number;
  // 原始的 TabItem，删除时要原样交给 NiceTab（它会放进回收站）
  source: TabItem;
};

export default function App() {
  const { token } = theme.useToken();
  const { themeTypeConfig } = useContext(GlobalContext);

  const [tabs, setTabs] = useState<FlatTab[]>([]);
  const [cache, setCache] = useState<ClassifyCache>({});
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<ClassifyProgress | null>(null);
  const [status, setStatus] = useState('');
  // 折叠时每个分类只显示 TOP_N 个
  const [showAll, setShowAll] = useState(false);
  // 等待撤销的标签页 id，这些只是在界面上隐藏了
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [picks, setPicks] = useState<PicksState | undefined>();
  const [usage, setUsage] = useState<UsageStats | undefined>();
  const [picksBusy, setPicksBusy] = useState(false);
  const [ingesting, setIngesting] = useState(false);

  const [bridgeModalOpen, setBridgeModalOpen] = useState(false);
  const [bridgeDraft, setBridgeDraft] = useState(DEFAULT_BRIDGE_URL);

  // 自动分类每次打开页面只触发一次
  const autoRunRef = useRef(false);
  // tabId -> 定时器，撤销窗口结束后才真正删除
  const pendingRef = useRef(new Map<string, { timer: number; tab: FlatTab }>());
  // 同一时刻只允许一次排序在跑
  const picksBusyRef = useRef(false);
  // 去重每次打开页面只跑一次
  const dedupeRunRef = useRef(false);

  const initData = useCallback(async () => {
    const [tagList, nextCache] = await Promise.all([
      tabListUtils.getTagList(),
      getClassifyCache(),
    ]);
    const flat: FlatTab[] = [];
    tagList.forEach(tag =>
      tag.groupList.forEach(group => {
        // TabItem 本身没有时间戳，用所属标签组的创建时间排序
        const groupTime = new Date(group.createTime).getTime() || 0;
        group.tabList.forEach(tab =>
          flat.push({
            ...tab,
            source: tab,
            groupId: group.groupId,
            groupName: group.groupName,
            // 优先用标签页自己的时间，没有才用标签组的
            createdAt: (tab.createdAt && new Date(tab.createdAt).getTime()) || groupTime,
          }),
        );
      }),
    );
    setTabs(flat);
    setCache(nextCache);
    setLoading(false);
  }, []);

  useEffect(() => {
    initData();
    const unwatchTabs = storage.watch(tabListUtils.storageKey, () => initData());
    const unwatchCache = storage.watch(classifyCacheKey, () => initData());
    return () => {
      unwatchTabs();
      unwatchCache();
    };
  }, [initData]);

  // 按分类聚合，分类之间按最新标签页时间排序，分类内部按时间倒序
  const sections = useMemo(() => {
    const map = new Map<string, FlatTab[]>();
    const hidden = new Set(pendingIds);
    tabs.forEach(tab => {
      if (hidden.has(tab.tabId)) return;
      const id = lookupCategory(cache, tab.url);
      const list = map.get(id);
      list ? list.push(tab) : map.set(id, [tab]);
    });
    return [...map.entries()]
      .map(([id, list]) => ({
        category: categoryById(id),
        tabList: [...list].sort((a, b) => b.createdAt - a.createdAt),
        newest: list.reduce((max, t) => Math.max(max, t.createdAt), 0),
      }))
      .sort((a, b) => {
        // 未分类的始终放最后
        if (a.category.id === UNCLASSIFIED_ID) return 1;
        if (b.category.id === UNCLASSIFIED_ID) return -1;
        return b.newest - a.newest;
      });
  }, [tabs, cache, pendingIds]);

  const unclassified = useMemo(
    () => tabs.filter(tab => lookupCategory(cache, tab.url) === UNCLASSIFIED_ID),
    [tabs, cache],
  );

  // 撤销窗口结束（或页面关闭）后真正写存储。NiceTab 的 removeTabs 会把标签页
  // 放进回收站，所以这一步仍然是可恢复的。
  const commitRemoval = useCallback(async (tabId: string) => {
    const entry = pendingRef.current.get(tabId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pendingRef.current.delete(tabId);
    notification.destroy(tabId);
    try {
      await tabListUtils.removeTabs(entry.tab.groupId, [entry.tab.source]);
    } catch (err) {
      console.error('Failed to remove tab:', err);
      message.error('Could not remove that tab.');
      setPendingIds(ids => ids.filter(id => id !== tabId));
    }
  }, []);

  const undoRemoval = useCallback((tabId: string) => {
    const entry = pendingRef.current.get(tabId);
    if (entry) clearTimeout(entry.timer);
    pendingRef.current.delete(tabId);
    notification.destroy(tabId);
    setPendingIds(ids => ids.filter(id => id !== tabId));
  }, []);

  // 批量版本：入库之后要一次清掉几十个，不能弹几十个提示
  const dismissTabs = useCallback(
    (list: FlatTab[], label: string) => {
      const fresh = list.filter(tab => !pendingRef.current.has(tab.tabId));
      if (!fresh.length) return;
      const key = `batch-${Date.now()}`;
      fresh.forEach(tab => {
        const timer = window.setTimeout(() => commitRemoval(tab.tabId), UNDO_MS);
        pendingRef.current.set(tab.tabId, { timer, tab });
      });
      setPendingIds(ids => [...ids, ...fresh.map(tab => tab.tabId)]);
      notification.open({
        key,
        message: `${fresh.length} tab(s) removed`,
        description: label,
        placement: 'bottomRight',
        duration: UNDO_MS / 1000,
        btn: (
          <Button
            size="small"
            type="link"
            onClick={() => {
              fresh.forEach(tab => undoRemoval(tab.tabId));
              notification.destroy(key);
            }}
          >
            Undo
          </Button>
        ),
      });
    },
    [commitRemoval, undoRemoval],
  );

  const dismissTab = useCallback(
    (tab: FlatTab) => {
      if (pendingRef.current.has(tab.tabId)) return;
      const timer = window.setTimeout(() => commitRemoval(tab.tabId), UNDO_MS);
      pendingRef.current.set(tab.tabId, { timer, tab });
      setPendingIds(ids => [...ids, tab.tabId]);
      notification.open({
        key: tab.tabId,
        message: 'Tab removed',
        description: tab.title || tab.url,
        placement: 'bottomRight',
        duration: UNDO_MS / 1000,
        btn: (
          <Button size="small" type="link" onClick={() => undoRemoval(tab.tabId)}>
            Undo
          </Button>
        ),
      });
    },
    [commitRemoval, undoRemoval],
  );

  // 真正删掉之后标签页就不在 tabs 里了，顺手把 pendingIds 里的陈旧 id 清掉
  useEffect(() => {
    setPendingIds(ids => {
      if (!ids.length) return ids;
      const present = new Set(tabs.map(tab => tab.tabId));
      const next = ids.filter(id => present.has(id));
      return next.length === ids.length ? ids : next;
    });
  }, [tabs]);

  // 页面关闭时把还没落盘的删除补上，否则点了 x 又马上关页面就等于没删
  useEffect(() => {
    const flush = () => {
      pendingRef.current.forEach((entry, tabId) => {
        clearTimeout(entry.timer);
        tabListUtils.removeTabs(entry.tab.groupId, [entry.tab.source]);
      });
      pendingRef.current.clear();
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  // 入库候选（纯本地筛选），按钮上显示数量用
  const ingestCandidates = useMemo<IngestCandidate[]>(() => {
    const hidden = new Set(pendingIds);
    return collectIngestCandidates(
      tabs
        .filter(tab => !hidden.has(tab.tabId))
        .map(tab => ({
          tabId: tab.tabId,
          title: tab.title,
          url: tab.url,
          categoryId: lookupCategory(cache, tab.url),
          createdAt: tab.createdAt,
        })),
    );
  }, [tabs, cache, pendingIds]);

  const openBridgeModal = useCallback(async () => {
    const { bridgeUrl } = await getClassifyConfig();
    setBridgeDraft(bridgeUrl);
    setBridgeModalOpen(true);
  }, []);

  const runClassify = useCallback(
    async (silent: boolean) => {
      setProgress({ done: 0, total: 0 });
      try {
        const { classified } = await classifyTabs(tabs, setProgress);
        await initData();
        if (!silent && classified) message.success(`Classified ${classified} tab(s).`);
        setStatus('');
      } catch (err) {
        if (err instanceof BridgeUnreachableError) {
          setStatus(`Bridge offline — run \`${BRIDGE_CMD}\` to classify automatically.`);
          if (!silent) {
            message.warning(`Start the classify bridge first: ${BRIDGE_CMD}`);
            openBridgeModal();
          }
        } else {
          console.error('Classification failed:', err);
          setStatus(`Classification failed: ${(err as Error).message}`);
          if (!silent) message.error(`Classification failed: ${(err as Error).message}`);
        }
      } finally {
        setProgress(null);
      }
    },
    [tabs, initData, openBridgeModal],
  );

  // 打开页面后，桥接服务可用则自动分类
  useEffect(() => {
    if (loading || autoRunRef.current || !unclassified.length) return;
    autoRunRef.current = true;
    (async () => {
      if (await isBridgeUp()) {
        runClassify(true);
      } else {
        setStatus(`${unclassified.length} tabs not classified — run \`${BRIDGE_CMD}\` and reload.`);
      }
    })();
  }, [loading, unclassified.length, runClassify]);

  // 顶部的使用统计，和标签页数据无关，单独取
  useEffect(() => {
    getUsageStats()
      .then(setUsage)
      .catch(err => console.error('Usage stats failed:', err));
  }, []);

  // 先去重，再分类排序 —— 重复项既浪费分类调用，也会挤掉 close 列表的名额
  useEffect(() => {
    if (loading || dedupeRunRef.current || !tabs.length) return;
    dedupeRunRef.current = true;
    (async () => {
      try {
        const { removed } = await dedupeLibrary();
        // storage.watch 会触发 initData，这里不用手动刷新
        if (removed) setStatus(`Removed ${removed} duplicate tab(s) — recoverable from the recycle bin.`);
      } catch (err) {
        console.error('Dedupe failed:', err);
      }
    })();
  }, [loading, tabs.length]);

  // 分类好了之后再排重点，否则 categoryId 还不准
  useEffect(() => {
    if (loading || picksBusyRef.current || !tabs.length || unclassified.length) return;
    (async () => {
      const stored = await getPicks();
      // 先把存着的显示出来。重排要跑 40 秒左右，期间不该是一片空白 ——
      // 之前就是这个顺序反了，导致每次重排时整块都看不见。
      if (stored) setPicks(stored);
      // close 列表里还真实存在的条数：用户清掉的不算
      const live = new Set(tabs.map(tab => tab.tabId));
      const remainingClose = (stored?.close || []).filter(p => live.has(p.tabId)).length;
      if (!shouldRerank(stored, remainingClose)) return;
      picksBusyRef.current = true;
      setPicksBusy(true);
      const candidates: PickCandidate[] = tabs.map(tab => ({
        tabId: tab.tabId,
        title: tab.title,
        url: tab.url,
        categoryId: lookupCategory(cache, tab.url),
        createdAt: tab.createdAt,
      }));
      try {
        setPicks(await computePicks(candidates));
      } catch (err) {
        // 桥接没起来时静默跳过，上面的状态行已经在提示了
        if (!(err instanceof BridgeUnreachableError)) {
          console.error('Picks failed:', err);
        }
        if (stored) setPicks(stored);
      } finally {
        picksBusyRef.current = false;
        setPicksBusy(false);
      }
    })();
  }, [loading, tabs, cache, unclassified.length]);

  const handleBridgeSave = useCallback(async () => {
    await setClassifyConfig({ bridgeUrl: bridgeDraft.trim() || DEFAULT_BRIDGE_URL });
    setBridgeModalOpen(false);
    message.success('Bridge address saved.');
  }, [bridgeDraft]);

  const runIngest = useCallback(async () => {
    setIngesting(true);
    setStatus(`Curating ${ingestCandidates.length} stale reading(s) for the knowledge base…`);
    try {
      const result = await ingestStaleReadings(ingestCandidates);
      if (!result) {
        setStatus('Nothing worth ingesting right now.');
        return;
      }
      const byId = new Map(tabs.map(tab => [tab.tabId, tab]));
      const ingested = result.items
        .map(item => byId.get(item.tabId))
        .filter(Boolean) as FlatTab[];
      message.success(`Wrote ${result.items.length} item(s) to the knowledge base.`);
      setStatus(`Ingested ${result.items.length} reading(s) → ${result.file}`);
      // 写进知识库之后这些标签页就没必要留着了，但仍然给 15 秒撤销
      dismissTabs(ingested, 'Ingested into the knowledge base');
    } catch (err) {
      if (err instanceof BridgeUnreachableError) {
        setStatus(`Bridge offline — run \`${BRIDGE_CMD}\` and try again.`);
        message.warning(`Start the classify bridge first: ${BRIDGE_CMD}`);
      } else {
        console.error('Ingest failed:', err);
        setStatus(`Ingest failed: ${(err as Error).message}`);
        message.error(`Ingest failed: ${(err as Error).message}`);
      }
    } finally {
      setIngesting(false);
    }
  }, [ingestCandidates, tabs, dismissTabs]);

  // 逐条入库。用户自己点的，不需要模型再判断一次，所以这条路径不花钱。
  const ingestTab = useCallback(
    async (tab: FlatTab) => {
      try {
        const result = await ingestTabsDirectly([
          {
            tabId: tab.tabId,
            title: tab.title,
            url: tab.url,
            categoryId: lookupCategory(cache, tab.url),
            createdAt: tab.createdAt,
          },
        ]);
        if (!result) return;
        setStatus(`Sent to the knowledge base → ${result.file}`);
        dismissTabs([tab], 'Sent to the knowledge base');
      } catch (err) {
        if (err instanceof BridgeUnreachableError) {
          message.warning(`Start the classify bridge first: ${BRIDGE_CMD}`);
        } else {
          console.error('Ingest failed:', err);
          message.error(`Ingest failed: ${(err as Error).message}`);
        }
      }
    },
    [cache, dismissTabs],
  );

  // 两个卡片渲染处共用，避免按钮逻辑写两遍
  const cardActions = (tab: FlatTab) => (
    <span className="card-actions">
      <button
        type="button"
        className="card-ingest"
        aria-label="Send to knowledge base"
        title="Send to knowledge base and remove"
        onClick={e => {
          // 卡片本身是链接，别让按钮把页面打开
          e.preventDefault();
          e.stopPropagation();
          ingestTab(tab);
        }}
      >
        <BookOutlined />
      </button>
      <button
        type="button"
        className="card-close"
        aria-label="Remove tab"
        title="Remove tab"
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          dismissTab(tab);
        }}
      >
        <CloseOutlined />
      </button>
    </span>
  );

  const statusLine = () => {
    if (progress) {
      return progress.total
        ? `Classifying… ${progress.done} / ${progress.total}`
        : 'Classifying…';
    }
    return status;
  };

  // 重点关注区：卡片和普通分类一样，但多一行模型给的理由
  const picksBlock = () => {
    if (!picks) return null;
    const hidden = new Set(pendingIds);
    const byId = new Map(tabs.map(tab => [tab.tabId, tab]));
    const resolve = (list: PicksState['keepJob']) =>
      list
        .map(pick => ({ pick, tab: byId.get(pick.tabId) }))
        .filter(entry => entry.tab && !hidden.has(entry.tab.tabId)) as {
        pick: { tabId: string; reason?: string };
        tab: FlatTab;
      }[];

    const blocks = [
      { label: 'Job applications', items: resolve(picks.keepJob) },
      { label: 'Learning', items: resolve(picks.keepLearn) },
      { label: 'Safe to close', items: resolve(picks.close) },
    ].filter(block => block.items.length);
    if (!blocks.length) return null;

    return (
      <StyledPicks>
        <div className="picks-header">
          <h2 className="picks-title">Start here</h2>
          <span className="picks-hint">
            {picksBusy
              ? 'ranking…'
              : `ranked ${new Date(picks.at).toLocaleString()}`}
          </span>
        </div>
        {blocks.map(({ label, items }) => (
          <div className="picks-target" key={label}>
            <h3 className="picks-target-name">
              {label} · {items.length}
            </h3>
            <div className="picks-grid">
              {items.map(({ pick, tab }) => (
                <StyledTabCard
                  key={tab.tabId}
                  href={tab.url}
                  title={`${tab.title || ''}\n${tab.url || ''}`}
                >
                  <img src={getFaviconByExtApi(tab.url || '')} alt="" />
                  <span className="card-body">
                    <span className="card-title">{tab.title || tab.url}</span>
                    {pick.reason ? (
                      <span className="card-reason">{pick.reason}</span>
                    ) : null}
                  </span>
                  {cardActions(tab)}
                </StyledTabCard>
              ))}
            </div>
          </div>
        ))}
      </StyledPicks>
    );
  };

  const body = () => {
    if (loading) {
      return (
        <div className="dashboard-center">
          <Spin size="large" />
        </div>
      );
    }
    if (!tabs.length) {
      return (
        <div className="dashboard-center">
          <p style={{ fontSize: 16, margin: 0 }}>Nothing saved yet.</p>
          <p style={{ opacity: 0.6, margin: 0 }}>
            Press Alt+Shift+A to send this window's tabs here.
          </p>
          <Button type="primary" onClick={() => openAdminRoutePage({ path: '/home' })}>
            Open NiceTab
          </Button>
        </div>
      );
    }
    return sections.map(({ category, tabList }) => {
      const visible = showAll ? tabList : tabList.slice(0, TOP_N);
      const hidden = tabList.length - visible.length;
      return (
      <StyledSection key={category.id} $color={category.color}>
        <div className="section-header">
          <span className="section-dot" />
          <h2 className="section-name">{category.name}</h2>
          <span className="section-count">
            {hidden
              ? `${visible.length} of ${tabList.length}`
              : `${tabList.length} tab${tabList.length === 1 ? '' : 's'}`}
          </span>
          <span className="section-rule" />
        </div>
        <div className="section-grid">
          {visible.map(tab => (
            <StyledTabCard
              key={tab.tabId}
              href={tab.url}
              title={`${tab.title || ''}\n${tab.url || ''}`}
            >
              <img src={getFaviconByExtApi(tab.url || '')} alt="" />
              <span className="card-title">{tab.title || tab.url}</span>
              {cardActions(tab)}
            </StyledTabCard>
          ))}
        </div>
      </StyledSection>
      );
    });
  };

  return (
    <ThemeProvider theme={{ ...themeTypeConfig, ...token }}>
      <GlobalStyle />
      <StyledDashboard>
        <div className="dashboard-header">
          <h1 className="dashboard-title">Outstanding work</h1>
          <span className="dashboard-meta">
            {sections.length} categor{sections.length === 1 ? 'y' : 'ies'} ·{' '}
            {tabs.length} tab{tabs.length === 1 ? '' : 's'}
          </span>
          <div className="dashboard-actions">
            <Tooltip title="Classify any new tabs">
              <Button
                icon={<ReloadOutlined />}
                loading={!!progress}
                disabled={!unclassified.length}
                onClick={() => runClassify(false)}
              >
                {unclassified.length ? `Classify ${unclassified.length}` : 'All sorted'}
              </Button>
            </Tooltip>
            <Tooltip
              title={
                ingestCandidates.length
                  ? `Curate ${ingestCandidates.length} stale reading(s) into ~/kb/to-ingest and clear them`
                  : 'No stale readings to ingest'
              }
            >
              <Button
                icon={<BookOutlined />}
                loading={ingesting}
                disabled={!ingestCandidates.length}
                onClick={runIngest}
              >
                {ingestCandidates.length
                  ? `Ingest ${ingestCandidates.length}`
                  : 'Nothing to ingest'}
              </Button>
            </Tooltip>
            <Tooltip title={showAll ? `Collapse to ${TOP_N} per category` : 'Show every tab'}>
              <Button
                icon={showAll ? <UpOutlined /> : <DownOutlined />}
                onClick={() => setShowAll(v => !v)}
              >
                {showAll ? `Top ${TOP_N}` : 'Show all'}
              </Button>
            </Tooltip>
            <Tooltip title="Classify bridge settings">
              <Button icon={<SettingOutlined />} onClick={openBridgeModal} />
            </Tooltip>
            <Tooltip title="Open NiceTab">
              <Button
                icon={<FolderOpenOutlined />}
                onClick={() => openAdminRoutePage({ path: '/home' })}
              />
            </Tooltip>
          </div>
        </div>
        {usage && usage.sinkVisits > 0 ? (
          <div className="dashboard-shame">
            Last {usage.days} days: <strong>{usage.sinkVisits.toLocaleString()}</strong>{' '}
            visits to time sinks
            {usage.topHost ? ` — ${usage.topHost} ${usage.topVisits.toLocaleString()}` : ''}
            {usage.refVisits
              ? ` · ${usage.refHost} ${usage.refVisits.toLocaleString()}`
              : ''}
            {usage.refVisits && usage.sinkVisits > usage.refVisits
              ? ` (${(usage.sinkVisits / usage.refVisits).toFixed(1)}x)`
              : ''}
          </div>
        ) : null}
        <div className="dashboard-status">{statusLine()}</div>

        {picksBlock()}
        {body()}

        <Modal
          title="Classify bridge"
          open={bridgeModalOpen}
          onOk={handleBridgeSave}
          onCancel={() => setBridgeModalOpen(false)}
          okText="Save"
        >
          <p style={{ opacity: 0.7, fontSize: 13 }}>
            Classification runs through your local Claude Code CLI, so there is no API
            key and nothing leaves your machine except the tab titles. Start it from the
            repo with <code>{BRIDGE_CMD}</code> and leave it running — the dashboard then
            classifies new tabs on its own.
          </p>
          <Input
            value={bridgeDraft}
            placeholder={DEFAULT_BRIDGE_URL}
            onChange={e => setBridgeDraft(e.target.value)}
            onPressEnter={handleBridgeSave}
          />
        </Modal>
      </StyledDashboard>
    </ThemeProvider>
  );
}
