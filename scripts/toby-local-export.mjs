#!/usr/bin/env node
// 从本地 Toby 扩展的 chrome.storage.local 中导出收藏，生成 NiceTab 原生导入格式。
//
// 相比 Toby 自己的导出，这里能保留每个标签页真实的 createdAt，
// 否则导入后所有标签页都会变成"刚刚创建"。
//
// 用法: node scripts/toby-local-export.mjs [输出路径] [--profile Default]
import { ClassicLevel } from 'classic-level';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const TOBY_EXT_ID = 'hddnkoipeenegfoeaoibdmnaalmgkpip';

const args = process.argv.slice(2);
const profileIdx = args.indexOf('--profile');
const profile = profileIdx > -1 ? args[profileIdx + 1] : 'Default';
const outPath = args.find(a => !a.startsWith('--') && a !== profile) || 'toby-export.json';

const srcDir = join(
  homedir(),
  'Library/Application Support/Google/Chrome',
  profile,
  'Local Extension Settings',
  TOBY_EXT_ID,
);

// dayjs 的 'YYYY-MM-DD HH:mm:ss'
const fmt = iso => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// Chrome 运行时会锁住 leveldb，先复制一份再读
const work = await mkdtemp(join(tmpdir(), 'toby-'));
try {
  await cp(srcDir, work, { recursive: true });
  await rm(join(work, 'LOCK'), { force: true });

  const db = new ClassicLevel(work, { createIfMissing: false });
  await db.open();
  let state = JSON.parse(await db.get('state'));
  if (typeof state === 'string') state = JSON.parse(state);
  await db.close();

  const collections = Object.values(state.lists || {})
    .filter(list => list.cards?.length)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  let tabCount = 0;
  const groupList = collections.map(list => ({
    groupId: list.id,
    groupName: list.title?.trim() || `toby-${list.id.slice(0, 8)}`,
    createTime: fmt(list.createdAt),
    tabList: [...list.cards]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(card => {
        tabCount++;
        return {
          tabId: card.id,
          title: card.customTitle || card.title || card.url,
          url: card.url,
          createdAt: fmt(card.createdAt || list.createdAt),
        };
      }),
  }));

  const tagList = [
    {
      tagId: 'toby',
      tagName: 'Toby',
      createTime: fmt(collections[collections.length - 1]?.createdAt),
      groupList,
    },
  ];

  await writeFile(outPath, JSON.stringify(tagList, null, 2));

  const years = {};
  groupList.forEach(g =>
    g.tabList.forEach(t => {
      const y = (t.createdAt || '').slice(0, 4);
      years[y] = (years[y] || 0) + 1;
    }),
  );
  console.log(`Wrote ${outPath}`);
  console.log(`  ${groupList.length} collections, ${tabCount} tabs`);
  console.log(`  by year: ${Object.entries(years).sort().map(([y, n]) => `${y}=${n}`).join(' ')}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
