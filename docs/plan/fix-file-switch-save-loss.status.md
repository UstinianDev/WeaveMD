# fix-file-switch-save-loss — 文件树切换丢失未保存修改（状态）

## 分级（阶段 0）

- **请求类型**：Bug 修复
- **影响面**：渲染层 — 文件树面板切换（FileTreePanel）、保存链路（editorStore）、Source 模式 Monaco flush（SourceCodeEditor/EditorView）
- **定档**：**S~M**（核心修复 3 文件 + Source 加固 2 文件 + 测试）
- **裁剪**：Bug → 链路分析 → 最小修复（复用 Navbar 已正确的保存前置模式）

## 复现与根因（阶段 1，已完成）

用户场景：编辑主区（Normal 块编辑器）修改后保存未正确保存；目录区文件树先切别的文件再切回，修改丢失/显示旧内容。

| 症状 | 根因 | 证据 |
|---|---|---|
| 切换文件后未保存修改丢失 | `FileTreePanel.handleFileClick` 直接 `openFile` 覆盖 store，不 flush、不落盘；对比 Navbar 路径（`useNavbarActions` 打开/删除/关闭前都 `saveCurrentDraftIfNeeded()`） | FileTreePanel.tsx:25-55 无保存前置 |
| 编辑后 <1.2s 切换即丢 | `MainPage` 1200ms 防抖 autoSave 在 `openFile` 清 `isDirty` 后被 cleanup 取消，改动从未写盘 | MainPage.tsx:40-52 |
| 切回显示旧内容（陈旧缓存） | `handleFileClick` 用 `node.content ?? ''`（fileTreeStore 缓存），只有空内容才 readDisk；保存后不更新缓存 | FileTreePanel.tsx 原 :28-41 |
| 点击当前文件重置编辑 | 对当前已打开文件也重新 readDisk + openFile | FileTreePanel 原逻辑 |
| Source 模式同类丢失 | Monaco 150ms 防抖才同步 store，防抖窗口内切换丢失；`EditorView` 注册的 flusher 是 no-op，无法强制 flush | SourceCodeEditor.tsx:203-206、EditorView.tsx:159-166 |

## 修复实现（阶段 2~5，已完成）

1. **统一保存前置**：新建 `src/render/services/saveCurrentDraft.ts` 的 `saveCurrentDraftIfNeeded()`（flushEditorDraft + dirty 则 saveFile），供 FileTreePanel 与 useNavbarActions 复用。
2. **FileTreePanel.handleFileClick**：切换前先 `await saveCurrentDraftIfNeeded()`；点击当前已打开文件 no-op；**总是 readDisk 以磁盘为唯一真源**（忽略陈旧 content 缓存）。
3. **editorStore.saveFile** 返回 `Promise<boolean>`：无文件/写盘失败返回 false（写盘失败保留 isDirty），catch 增强日志；调用点向后兼容。
4. **Source 加固**：`SourceCodeEditorHandle` 增加 `flushContent`（复用 blur flush 逻辑）；`EditorView` 的 flusher 按 `isSourceCodeMode` 路由 —— Source 模式强制 flush Monaco，Normal 模式 no-op。

## 变更文件（实际）

- `src/render/services/saveCurrentDraft.ts`（新增）— 统一保存前置工具
- `src/render/components/Editor/panels/FileTreePanel.tsx` — 切换前保存 + 跳过当前文件 + 总 readDisk
- `src/render/stores/editorStore.ts` — saveFile 返回 boolean + 磁盘失败分支
- `src/render/hooks/useNavbarActions.ts` — 复用工具函数（删除内部重复定义）
- `src/render/components/Editor/SourceCodeEditor.tsx` — 暴露 flushContent
- `src/render/components/Editor/EditorView.tsx` — flusher 按模式路由
- `tests/setup.ts` — 补 file.readDisk / file.write mock
- `tests/stores/editorStore.test.ts` — 磁盘分支 / 失败分支 / 工具函数用例
- `tests/components/FileTreePanel.test.tsx`（新增）— 切换前保存 / no-op / 陈旧缓存 3 用例

## 验证证据（阶段 6，已完成）

- `npm run typecheck` — 通过（tsc --noEmit 无输出）
- `npm run lint` — **0 error**（8 个既有 warning 在 useContentSync/useEditorActions，本次未触碰）
- `npm run test` — **919 通过 / 55 文件**（新增 editorStore +5、FileTreePanel +3）
- `npx vite build` — 成功（render + main + preload）
- `npx playwright test` — **71 passed**，5 failed 均为 `drag-selection-markers.spec.ts` 既有已知 RED 复现测试（文件头注释明确"本阶段只写复现，不改生产代码"，根因是拖选标记 CSS/selection 偏移，与本次修复无关）→ 本次改动无 E2E 回归

## 遗留问题

- **手工验证建议**：`npm run dev` 下打开磁盘文件 A 编辑 → 立即点文件 B → 点回 A，确认改动保留；Source 模式 Monaco 编辑后 150ms 内切换文件，不丢内容；点击当前已打开文件不重置编辑。
- **E2E 未覆盖**：现有 Playwright 用例未覆盖文件树切换保存路径，后续可补（当前仅靠单测锁定该路径）。
- **已知边界**：Save 成功后 fileTreeStore 缓存仍不更新，但打开已改为总 readDisk 以磁盘为准，缓存仅作 UI 展示冗余字段，不影响正确性。
- **未触碰**：`src/main/export/**` 与 `tests/main/export/**`（导出 PDF/DOCX 修复在途）。
