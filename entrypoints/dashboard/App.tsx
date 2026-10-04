import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { theme, Button, Modal, Input, Spin, Tooltip, message } from 'antd';
import { ReloadOutlined, SettingOutlined, FolderOpenOutlined } from '@ant-design/icons';
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

import { StyledDashboard, StyledSection, StyledTabCard } from './App.styled';

initFaviconApiData();

// 启动桥接服务的命令，连不上时提示用户
const BRIDGE_CMD = 'pnpm bridge';

type FlatTab = TabItem & { groupName: string; createdAt: number };

export default function App() {
  const { token } = theme.useToken();
  const { themeTypeConfig } = useContext(GlobalContext);

  const [tabs, setTabs] = useState<FlatTab[]>([]);
  const [cache, setCache] = useState<ClassifyCache>({});
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<ClassifyProgress | null>(null);
  const [status, setStatus] = useState('');

  const [bridgeModalOpen, setBridgeModalOpen] = useState(false);
  const [bridgeDraft, setBridgeDraft] = useState(DEFAULT_BRIDGE_URL);

  // 自动分类每次打开页面只触发一次
  const autoRunRef = useRef(false);

  const initData = useCallback(async () => {
    const [tagList, nextCache] = await Promise.all([
      tabListUtils.getTagList(),
      getClassifyCache(),
    ]);
    const flat: FlatTab[] = [];
    tagList.forEach(tag =>
      tag.groupList.forEach(group => {
        // TabItem 本身没有时间戳，用所属标签组的创建时间排序
        const createdAt = new Date(group.createTime).getTime() || 0;
        group.tabList.forEach(tab =>
          flat.push({ ...tab, groupName: group.groupName, createdAt }),
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
    tabs.forEach(tab => {
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
  }, [tabs, cache]);

  const unclassified = useMemo(
    () => tabs.filter(tab => lookupCategory(cache, tab.url) === UNCLASSIFIED_ID),
    [tabs, cache],
  );

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

  const handleBridgeSave = useCallback(async () => {
    await setClassifyConfig({ bridgeUrl: bridgeDraft.trim() || DEFAULT_BRIDGE_URL });
    setBridgeModalOpen(false);
    message.success('Bridge address saved.');
  }, [bridgeDraft]);

  const statusLine = () => {
    if (progress) {
      return progress.total
        ? `Classifying… ${progress.done} / ${progress.total}`
        : 'Classifying…';
    }
    return status;
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
    return sections.map(({ category, tabList }) => (
      <StyledSection key={category.id} $color={category.color}>
        <div className="section-header">
          <span className="section-dot" />
          <h2 className="section-name">{category.name}</h2>
          <span className="section-count">
            {tabList.length} tab{tabList.length === 1 ? '' : 's'}
          </span>
          <span className="section-rule" />
        </div>
        <div className="section-grid">
          {tabList.map(tab => (
            <StyledTabCard
              key={tab.tabId}
              href={tab.url}
              title={`${tab.title || ''}\n${tab.url || ''}`}
            >
              <img src={getFaviconByExtApi(tab.url || '')} alt="" />
              <span className="card-title">{tab.title || tab.url}</span>
            </StyledTabCard>
          ))}
        </div>
      </StyledSection>
    ));
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
        <div className="dashboard-status">{statusLine()}</div>

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
