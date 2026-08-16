---
name: editor-opt-history-filetree-notes
description: 最近打开 recentStore + 文件树 persist/restore 实现要点；zh-CN 导航「历史」label；persist hydration 后 children 可能 undefined
metadata:
  type: project
---

任务③「编辑历史(最近打开) + 恢复文件树」实现记录（2026-08-16）。

- `recentStore.ts`：`RecentFileEntry{id,path,name,lastOpenedAt}`，`touchRecent`(按 id 去重置顶、上限 RECENT_MAX=20) + module-level `touchRecent/removeRecent/clearRecent/getRecentList/resetRecentStore`；zustand persist `name:'weavemd_recent'` partialize 只存 recent。打开链路统一挂 touchRecent：useNavbarActions `handleNewFile/handleOpenFile/handleHistoryOpenFile` + FileTreePanel `handleFileClick`；新增 `handleRecentOpen`（readDisk 实读 → openFile，失效 removeRecent+提示）。
- `fileTreeStore.ts`：加 persist `name:'weavemd_filetree'` partialize 用 `stripContent` 去 content；新增 `restore()` 返回 `{removed:string[]}`——looseFile 用 readDisk success:false 剔除；root folder 用 folder.readFolder 失败剔除、成功则丢弃 persisted 子节点调 loadFolderContents 实读重建。**注意 restore 内最后的 folders 汇总必须基于 get().folders（loadFolderContents 已写入重建 root），再 filter 掉 removed root**，不要用累积数组覆盖。
- 失效提示：MainPage `useEffect` 认证后调 restore()，removed>0 时 setRestoreNotice 显示横幅（i18n `navbar.recentRestoreNotice` 带 {count}）；当前编辑文件从 recent 首条 readDisk 校验成功→openFile，失败 removeRecent。

**Why:** zustand persist 默认 shallow merge，历史/手工 seed 的持久化文件夹节点可能缺 `children`，`FileTreePanel.renderNode` 的 `node.children.length` 会抛 `undefined.length` 崩掉整个应用——生产级隐患。
**How to apply:** FileTreePanel 渲染层已加 `(node.children?.length ?? 0)` 守卫；今后对 hydrate 出的节点做只读遍历一律默认 children=[]。

**i18n 陷阱：** zh-CN 下 `navbar.history` 的 label 是「历史」不是「编辑历史」；e2e 点导航历史菜单 trigger 要用 `getByText(/^历史/)`，且默认 locale 由 `useUIStore.language`（默认 'zh-CN'，loadSettings 从 settings 读）。

**setup mock：** tests/setup.ts 补齐了 `folder:{createFolder,deleteFolder,readFolder}` 命名空间（readFolder 默认 `{success:false,data:[]}`）+ `readDisk` 默认返回 `{success:false}`——只做增量补充，未动既有键。已有 FileTreePanel/agent 等并行任务共用该 mock，改动前需先查现状。

相关：[[better-sqlite3-add-column-incompat]] [[fts5-cjk-unicode61]]
