// 跨标签组去重。
//
// NiceTab 自带的 ALLOW_DUPLICATE_TABS 只在"发送标签页"时生效，而且只比较同一个
// 标签组内部；从外部导入的数据完全绕过那条路径，所以需要这个。
//
// 纯确定性逻辑，不该花模型的 token 去找重复项。
import { tabListUtils } from '~/entrypoints/common/storage';
import { normalizeUrl } from '~/entrypoints/common/classify/store';
import type { TabItem } from '~/entrypoints/types';

export interface DedupeResult {
  removed: number;
  // 受影响的标签组数量，方便在界面上说明范围
  groups: number;
}

/**
 * 删除 url 重复的标签页，每个 url 只保留最早保存的那一份。
 *
 * 保留最早的是为了不让存档显得比实际更新 —— 重复项的 url 完全相同，
 * 唯一的区别就是时间戳。
 *
 * 删除走 tabListUtils.removeTabs，所以重复项仍然会进回收站。
 */
export async function dedupeLibrary(): Promise<DedupeResult> {
  const tagList = await tabListUtils.getTagList();

  // url -> 最早出现的时间；先扫一遍再决定删谁
  const earliest = new Map<string, number>();
  const stamp = (tab: TabItem, groupTime: string) =>
    new Date(tab.createdAt || groupTime).getTime() || 0;

  tagList.forEach(tag =>
    tag.groupList?.forEach(group =>
      group.tabList?.forEach(tab => {
        if (!tab.url) return;
        const key = normalizeUrl(tab.url);
        const at = stamp(tab, group.createTime);
        const prev = earliest.get(key);
        if (prev === undefined || at < prev) earliest.set(key, at);
      }),
    ),
  );

  // 按标签组收集要删的，每组只写一次存储
  const byGroup = new Map<string, TabItem[]>();
  const kept = new Set<string>();
  tagList.forEach(tag =>
    tag.groupList?.forEach(group =>
      group.tabList?.forEach(tab => {
        if (!tab.url) return;
        const key = normalizeUrl(tab.url);
        // 最早的那一份留下；时间相同时只留第一个遇到的
        if (stamp(tab, group.createTime) === earliest.get(key) && !kept.has(key)) {
          kept.add(key);
          return;
        }
        const list = byGroup.get(group.groupId);
        list ? list.push(tab) : byGroup.set(group.groupId, [tab]);
      }),
    ),
  );

  let removed = 0;
  for (const [groupId, tabs] of byGroup) {
    await tabListUtils.removeTabs(groupId, tabs);
    removed += tabs.length;
  }
  return { removed, groups: byGroup.size };
}

export default { name: 'dedupe' };
