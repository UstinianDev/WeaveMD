# editor-opt-history-filetree — 编辑历史 + 恢复整个文件树（L 级）

> 2026-08-16 | 需求见 editor-optimization-batch.req.md §③ | Plan 智能体产出

## 1. 现状确认

- `loadHistory`（historyStore.ts:25-35）调 `file.list(userId)` 拉 DB **全部文件**，渲染层
  `HistoryMenu.tsx:19-21` 用 name.localeCompare 按名称排序——**非「最近打开」**，且缺磁盘文件、多库内文件。
- `fileTreeStore.ts:77-237` 裸 `create()` **无 persist**；looseFiles/folders/selectedIds/activeTab 全内存态，重启清空。
- 仓库**无 zustand persist 先例**（uiStore 是手写 localStorage('weavemd_ui')）；zustand 4.5.7 已装，persist 可用。
- 磁盘文件以 path 为 id 实时读写（editorStore.ts:60-76），不在 DB；`readDisk`（FILE_READ）对不存在路径
  返回 `{success:false}` → **可直接复用为磁盘失效检测，无需新增 stat IPC**。

## 2. 技术方案

### A. 编辑历史 = 最近打开（时间倒序 + persist）
- 新增/改造 store：`RecentFileEntry { id, path, name, lastOpenedAt }`；`touchRecent`（按 id 去重置顶、
  上限 20）/`removeRecent`/`clearRecent`；`persist`（partialize 只存 recent，`name:'weavemd_recent'`）。
- 打开动作统一挂 `touchRecent`：`handleHistoryOpenFile`(230-238)/`handleOpenFile`(107-132)/`handleNewFile`(74-105)/
  FileTreePanel handleFileClick 打开成功后。
- `HistoryMenu` 数据源换 recent list 按 lastOpenedAt 倒序；`HistoryPanel`（DB 全量搜索+删除面板）保留，
  与 recent 解耦。**不要把最近打开建立在 DB file.list 之上**。

### B. fileTreeStore persist
- `persist` 存 folders+looseFiles+activeTab+selectedIds+根目录 expanded/isRoot 标志；**不存 content**
  （磁盘内容实读即可，避免脏数据/体积）。
- zustand persist：`createJSONStorage(() => localStorage)` + `partialize`（去 content）+ `name:'weavemd_filetree'`
  + `version:0`/`migrate`。

### C. 重启恢复流程
- `MainPage.tsx` 用户认证后新 effect 调 `fileTreeStore.restore()`：
  1. 从 persisted 取路径列表。
  2. **磁盘失效优雅跳过**：looseFile → `readDisk(path)` 失败则剔除并累计提示；root folder →
     `folder.readFolder` 失败剔除，成功则**丢弃 persisted 子节点改用 `loadFolderContents` 实读重建**。
  3. **恢复当前编辑文件**：从 recent 首条或 editorStore 新字段 `lastOpenedId`，readDisk 校验成功 → openFile。
  4. 失效汇总经 `useNavbarActions.setErrorMessage` 提示。
- 不加新 IPC；不强制 beforeunload flush（树只存路径不存 content）。

## 3. 变更清单

| 文件 | 改动 |
|---|---|
| `src/render/stores/historyStore.ts` 或新 `recentStore.ts` | recent 列表 + touchRecent + persist（推荐拆独立 recentStore） |
| `src/render/stores/fileTreeStore.ts` | persist（partialize 去 content）+ `restore()` action |
| `src/render/components/Navbar/HistoryMenu.tsx` | 数据源换 recent，时间倒序 |
| `src/render/components/Navbar/TopBar.tsx` | 传 recent 列表给 HistoryMenu |
| `src/render/hooks/useNavbarActions.ts` | 打开动作挂 touchRecent |
| `src/render/pages/MainPage.tsx` | 认证后 effect 调 restore() |
| `src/render/stores/editorStore.ts` | 可选 persisted lastOpenedId |
| `src/render/components/Editor/panels/HistoryPanel.tsx` | 保持 DB 搜索+删除职能 |
| 测试 | **新** HistoryMenu.test.tsx、recentStore/historyStore persist 单测、fileTreeStore.persist.test.ts、`e2e/recent-history-restore.spec.ts` |

## 4. 实施步骤（RED → GREEN）
1. RED：recentStore persist 单测（时间倒序/去重/persist）+ fileTreeStore persist（partialize 无 content/
   readDisk 失效剔除）+ Playwright RED（打开→记录→reload 保留+树恢复+当前文件恢复+删路径不崩溃）。
2. 实现 recentStore + touch 链路。
3. HistoryMenu/TopBar 接 recent 倒序。
4. useNavbarActions 挂 touchRecent。
5. fileTreeStore persist + restore()。
6. MainPage 挂 restore effect + 提示。
7. 全量门禁。

## 5. 验收标准
- 编辑历史按最近打开时间倒序；点击打开对应文件；重启保留。
- 重启后文件树恢复上次文件夹结构+文件；磁盘失效优雅跳过并提示不崩溃。
- 当前编辑文件重启可恢复。

## 6. 风险
- 最近打开与 DB file.list 数据源冲突：拆 recentStore 解耦。
- 文件夹子节点 persist 与磁盘漂移：restore 一律 loadFolderContents 实读重建，不信任 persisted 子节点。
- 恢复当前编辑文件需异步 readDisk（短暂 loading，可接受）。
- e2e 用 page.reload() 近似冷启动；tests/setup.ts mock 需补 readDisk/folder.readFolder 返回值。
