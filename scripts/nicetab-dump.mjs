#!/usr/bin/env node
// 把本扩展 chrome.storage.local 里的标签页导出成 CSV，方便拿给别人看/讨论排序标准。
//
// 导出的是当前真实状态（含分类结果），而不是某次导入用的中间文件。
//
// 用法: node scripts/nicetab-dump.mjs [输出路径] [--profile Default] [--ext <id>]
import { ClassicLevel } from 'classic-level';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_EXT_ID = 'pjfkjnlogehggjnlobgiolmnjdlgkjko';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : fallback;
};
const profile = flag('--profile', 'Default');
const extId = flag('--ext', DEFAULT_EXT_ID);
const outPath =
  args.find((a, i) => !a.startsWith('--') && args[i - 1]?.startsWith('--') !== true) ||
  'nicetab-tabs.csv';

const srcDir = join(
  homedir(),
  'Library/Application Support/Google/Chrome',
  profile,
  'Local Extension Settings',
  extId,
);

// Chrome 运行时会锁住 leveldb，先复制一份再读
const work = await mkdtemp(join(tmpdir(), 'nicetab-'));
let tagList = [];
let cache = {};
try {
  await cp(srcDir, work, { recursive: true });
  await rm(join(work, 'LOCK'), { force: true });

  const db = new ClassicLevel(work, { createIfMissing: false });
  await db.open();
  const read = async key => {
    try {
      return JSON.parse(await db.get(key));
    } catch {
      return undefined;
    }
  };
  tagList = (await read('tabList')) || [];
  cache = (await read('classifyCache')) || {};
  await db.close();
} finally {
  await rm(work, { recursive: true, force: true });
}

// 和 store.ts 的 normalizeUrl 保持一致，否则查不到分类
const STRIP = ['utm_', 'fbclid', 'gclid', 'msclkid', 'ref', 'ref_src', 'igshid'];
const normalizeUrl = url => {
  try {
    const u = new URL(url);
    u.hash = '';
    [...u.searchParams.keys()].forEach(k => {
      if (STRIP.some(p => (p.endsWith('_') ? k.startsWith(p) : k === p))) {
        u.searchParams.delete(k);
      }
    });
    return u.toString();
  } catch {
    return url;
  }
};

const rows = [];
for (const tag of tagList) {
  for (const group of tag.groupList || []) {
    for (const tab of group.tabList || []) {
      rows.push({
        category: cache[normalizeUrl(tab.url || '')]?.categoryId || 'unclassified',
        date: tab.createdAt || group.createTime || '',
        title: tab.title || '',
        url: tab.url || '',
        group: group.groupName || '',
      });
    }
  }
}
// 新的排前面，和仪表盘一致
rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));

const csvCell = v => `"${String(v).replace(/"/g, '""')}"`;
const header = ['category', 'date', 'title', 'url', 'group'];
const csv = [
  header.join(','),
  ...rows.map(r => header.map(h => csvCell(r[h])).join(',')),
].join('\n');
await writeFile(outPath, csv + '\n', 'utf8');

const byCategory = {};
rows.forEach(r => (byCategory[r.category] = (byCategory[r.category] || 0) + 1));
console.log(`${rows.length} tabs -> ${outPath}`);
console.log(
  Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n'),
);
