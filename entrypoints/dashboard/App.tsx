import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { theme, Button, Modal, Input, Progress, Spin, Tooltip, message } from 'antd';
import { ReloadOutlined, SettingOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { ThemeProvider } from 'styled-components';
import { tabListUtils } from '~/entrypoints/common/storage';
import type { TabItem } from '~/entrypoints/types';
import { GlobalContext } from '~/entrypoints/common/hooks/global';
import { openAdminRoutePage } from '~/entrypoints/common/tabs';
import { GlobalStyle } from '~/entrypoints/common/style/Common.styled';
import { getFaviconByExtApi, initFaviconApiData } from '~/entrypoints/common/utils/favicon';
import { CATEGORIES, UNCLASSIFIED_ID, categoryById } from '~/entrypoints/common/classify/taxonomy';
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
  type ClassifyProgress,
} from '~/entrypoints/common/classify/classifier';

// 启动桥接服务的命令，连不上时提示用户
const BRIDGE_CMD = 'pnpm bridge';

import { StyledDashboard, StyledCategoryCard, StyledTabRow } from './App.styled';

initFaviconApiData();

// 每张卡片最多展示的标签页数量
const ROWS_PER_CARD = 8;

type FlatTab = TabItem & { groupName: string };

function hostOf(url?: string) {
  try {
    return new URL(url!).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export default function App() {
  const { token } = theme.useToken();
  const { themeTypeConfig } = useContext(GlobalContext);

  const [tabs, setTabs] = useState<FlatTab[]>([]);
  const [cache, setCache] = useState<ClassifyCache>({});
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<ClassifyProgress | null>(null);

  const [bridgeModalOpen, setBridgeModalOpen] = useState(false);
  const [bridgeDraft, setBridgeDraft] = useState(DEFAULT_BRIDGE_URL);

  const initData = useCallback(async () => {
    const [tagList, nextCache] = await Promise.all([
      tabListUtils.getTagList(),
      getClassifyCache(),
    ]);
    const flat: FlatTab[] = [];
    tagList.forEach(tag =>
      tag.groupList.forEach(group =>
        group.tabList.forEach(tab => flat.push({ ...tab, groupName: group.groupName })),
      ),
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

  // 按分类聚合
  const buckets = useMemo(() => {
    const map = new Map<string, FlatTab[]>();
    tabs.forEach(tab => {
      const id = lookupCategory(cache, tab.url);
      const list = map.get(id);
      list ? list.push(tab) : map.set(id, [tab]);
    });
    const ordered = [...CATEGORIES.map(c => c.id), UNCLASSIFIED_ID]
      .map(id => ({ category: categoryById(id), tabList: map.get(id) || [] }))
      .filter(bucket => bucket.tabList.length > 0);
    return ordered;
  }, [tabs, cache]);

  const maxBucketSize = useMemo(
    () => buckets.reduce((max, b) => Math.max(max, b.tabList.length), 0),
    [buckets],
  );

  const unclassifiedCount = useMemo(
    () => tabs.filter(tab => lookupCategory(cache, tab.url) === UNCLASSIFIED_ID).length,
    [tabs, cache],
  );

  const openBridgeModal = useCallback(async () => {
    const { bridgeUrl } = await getClassifyConfig();
    setBridgeDraft(bridgeUrl);
    setBridgeModalOpen(true);
  }, []);

  const handleClassify = useCallback(async () => {
    setProgress({ done: 0, total: 0 });
    try {
      const { classified, skipped } = await classifyTabs(tabs, setProgress);
      await initData();
      if (!classified && !skipped) message.info('Nothing to classify yet.');
      else message.success(`Classified ${classified} tab(s).`);
    } catch (err) {
      if (err instanceof BridgeUnreachableError) {
        message.warning(`Start the classify bridge first: ${BRIDGE_CMD}`);
        openBridgeModal();
      } else {
        console.error('Classification failed:', err);
        message.error(`Classification failed: ${(err as Error).message}`);
      }
    } finally {
      setProgress(null);
    }
  }, [tabs, initData, openBridgeModal]);

  const handleBridgeSave = useCallback(async () => {
    await setClassifyConfig({ bridgeUrl: bridgeDraft.trim() || DEFAULT_BRIDGE_URL });
    setBridgeModalOpen(false);
    message.success('Bridge address saved.');
  }, [bridgeDraft]);

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
            Send some tabs to NiceTab, then classify them here.
          </p>
          <Button type="primary" onClick={() => openAdminRoutePage({ path: '/home' })}>
            Open NiceTab
          </Button>
        </div>
      );
    }
    return (
      <div className="dashboard-grid">
        {buckets.map(({ category, tabList }) => (
          <StyledCategoryCard key={category.id} $color={category.color}>
            <div className="card-header">
              <span className="card-name">{category.name}</span>
              <span className="card-count">{tabList.length}</span>
            </div>
            <div className="card-bar">
              <div
                className="card-bar-fill"
                style={{
                  width: `${maxBucketSize ? (tabList.length / maxBucketSize) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="card-list">
              {tabList.slice(0, ROWS_PER_CARD).map(tab => (
                <StyledTabRow
                  key={tab.tabId}
                  href={tab.url}
                  title={`${tab.title}\n${tab.url}`}
                >
                  <img src={getFaviconByExtApi(tab.url || '')} alt="" />
                  <span className="row-title">{tab.title || tab.url}</span>
                  <span className="row-host">{hostOf(tab.url)}</span>
                </StyledTabRow>
              ))}
              {tabList.length > ROWS_PER_CARD && (
                <div className="card-more">
                  + {tabList.length - ROWS_PER_CARD} more
                </div>
              )}
            </div>
          </StyledCategoryCard>
        ))}
      </div>
    );
  };

  return (
    <ThemeProvider theme={{ ...themeTypeConfig, ...token }}>
      <GlobalStyle />
      <StyledDashboard>
        <div className="dashboard-header">
          <h1 className="dashboard-title">Outstanding work</h1>
          <div className="dashboard-actions">
            {progress && progress.total > 0 && (
              <Progress
                type="line"
                style={{ width: 120, marginBottom: 0 }}
                percent={Math.round((progress.done / progress.total) * 100)}
                size="small"
              />
            )}
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              loading={!!progress}
              disabled={!unclassifiedCount}
              onClick={handleClassify}
            >
              {unclassifiedCount
                ? `Classify ${unclassifiedCount}`
                : 'All classified'}
            </Button>
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
        <div className="dashboard-summary">
          {tabs.length} saved tab{tabs.length === 1 ? '' : 's'} across{' '}
          {buckets.length} categor{buckets.length === 1 ? 'y' : 'ies'}
          {unclassifiedCount ? ` · ${unclassifiedCount} not yet classified` : ''}
        </div>

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
            repo with <code>{BRIDGE_CMD}</code> and leave it running.
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
