# editor-opt-history-filetree — 编辑历史 + 恢复文件树（store/导航/文件树，L 级/TDD strict）

角色：fullstack-detail-dev | TDD strict | 分支 feat/ai-agent-ph3-ph4 | 需求 req.md §③ | 计划 editor-opt-history-filetree.plan.md

## 范围

- **新** `src/render/stores/recentStore.ts`（RecentFileEntry{id,path,name,lastOpenedAt}；touchRecent 去重置顶上限 20 / removeRecent / clearRecent；zustand persist `name:'weavemd_recent'` partialize 只存 recent）。
- 改 `useNavbarActions.ts`：handleHistoryOpenFile(230-238)/handleOpenFile(107-132)/handleNewFile(74-105) 打开成功后挂 `touchRecent`。
- 改 `HistoryMenu.tsx`：数据源换 recentStore 按 lastOpenedAt **倒序**；`TopBar.tsx` 传 recent 列表。HistoryPanel（DB 搜索+删除面板）保留解耦。
- 改 `fileTreeStore.ts`：加 zustand persist（`name:'weavemd_filetree'`，partialize 去 content 只存 id/name/path + activeTab/selectedIds/expanded）+ 新增 `restore()` action。
- `MainPage.tsx`：用户认证后 effect 调 `restore()`：looseFile readDisk 失败剔除并提示；root folder 失败剔除、成功则丢弃 persisted 子节点用 loadFolderContents 实读重建；当前编辑文件从 recent 首条恢复（readDisk 校验）。失效经 setErrorMessage 提示。**不加新 IPC**。
- 测试（先 RED）：recentStore persist 单测（时间倒序/去重/persist）、fileTreeStore.persist.test.ts（partialize 无 content / 失效剔除）、HistoryMenu.test.tsx、`e2e/recent-history-restore.spec.ts`（page.reload 近似重启）。

## 关键实现点

- 复用 readDisk success:false 做磁盘失效检测；恢复文件夹一律实读重建不信任 persisted 子节点。
- tests/setup.ts mock 需补 readDisk/folder.readFolder 返回值驱动失效用例。
- 不存 content；不强制 beforeunload flush（树只存路径）。

## 门禁（本模块）

- `npx vitest run tests/render/stores tests/render/components/HistoryMenu` 全绿（含先 RED 证据）
- `npm run typecheck` 0 | `npm run lint` 0（本模块文件）| Playwright recent-history-restore 全绿
- 只返回结构化摘要：{完成项, 测试证据, 未完成项, 风险}
