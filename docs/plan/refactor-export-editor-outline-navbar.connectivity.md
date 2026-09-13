# 模块连通性验证报告 — refactor-export-editor-outline-navbar

> Phase 5.5 | L 级强制 | 2026-09-13

## 调用链清单（19 条）

### P0 — hooks + 快捷键 + store 净化

| # | 调用链 | 契约验证 | 状态 |
|---|--------|---------|------|
| 1 | `EditorView` → `useMonacoTheme()` → `defineWeaveThemes(monaco.editor)` | hook 返回 `{ themesLoading }`，同原 `useState`；consumer 仍 destructure `themesLoading` | ✅ 通畅 |
| 2 | `EditorView` → `useGlobalShortcuts()` | 模块级单例；监听 `window.keydown`；调用 `useUIStore.getState().toggleFindReplace()` / `useEditorStore.getState().saveFile()` 等价原 handler | ✅ 通畅 |
| 3 | `EditorView` → `useModeScrollPersistence(sourceEditorHandleRef, isSourceCodeMode)` → `setBeforeToggleSourceMode(cb)` → `uiStore.toggleSourceCodeMode()` → `invokeBeforeToggleSourceMode()` | module ref `_beforeToggleCallback` 替代 store 字段；`toggleSourceCodeMode` 调用 `invokeBeforeToggleSourceMode()` 等价原 `get().beforeToggleSourceMode?.()` | ✅ 通畅 |
| 4 | `EditorView` → `useDraftFlusher(sourceEditorHandleRef, isSourceCodeMode)` → `setDraftFlusher(fn)` → consumers `flushEditorDraft()` | module ref `_draftFlusher` 替代 store 字段；EditorView 未挂载时 `_draftFlusher` 为 null，`flushEditorDraft()` 为 no-op（等价原行为） | ✅ 通畅 |
| 5 | `TopBar` → `useGlobalShortcuts({onSave, onOpenFile})` | 与 EditorView 共享同一单例 listener；options 合并（增量、反注册），TopBar 提供 `onSave`/`onOpenFile` | ✅ 通畅 |
| 6 | `uiStore.toggleSourceCodeMode()` → `invokeBeforeToggleSourceMode()` | 函数签名 `() => void`，无参数、无返回值 | ✅ 通畅 |
| 7 | `useNavbarActions.handleUndo/handleRedo/handleExport` → `flushEditorDraft()` → `_draftFlusher?.()` | module-level function，await 安全 | ✅ 通畅 |
| 8 | `HistoryPanel.handleOpenFile` → `flushEditorDraft()` | 同上 | ✅ 通畅 |
| 9 | `saveCurrentDraftIfNeeded` → `flushEditorDraft()` | 同上 | ✅ 通畅 |

### P1 — 大纲 / 文件树 / 工具栏

| # | 调用链 | 契约验证 | 状态 |
|---|--------|---------|------|
| 10 | `OutlinePanel` → `buildHeadingTree(flat[])` / `buildHeadingIndexMap(treeNodes[])` | 函数签名、返回值类型不变（从 `outline.ts` 导出，替换原本地定义）；调用点 `buildTree` → `buildHeadingTree` 仅重命名 | ✅ 通畅 |
| 11 | `EditorV2` → `extractHeadingOutlineCached(tree, cache, changedBlockIds)` | 签名不变；内部使用新增的 `headingFromBlock` helper（纯文本清洗） | ✅ 通畅 |
| 12 | `SidebarToolbar` → `ToolbarIconButton` | 内部子组件，不改变对外 Props 接口 | ✅ 通畅 |
| 13 | `FileTreePanel` → `FileTreeRow` | 内部子组件；`renderLooseFile` 适配 `IFileNode` → `IFolderNode`（补全 `isDirectory:false` 等默认值） | ✅ 通畅 |
| 14 | `fileTreeStore.loadFolderContents(path)` → `buildPathTree(items, rootPath)` | 纯函数提取；输入输出等价原内联实现 | ✅ 通畅 |
| 15 | `fileTreeStore.restore()` → `readDiskOrNull(file)` | helper 提取；`{ kept, node? }` 返回 → 原调用点 `.filter(Boolean)` 替换为 `if (kept && node)` | ✅ 通畅 |

### P2 — 编辑主区

| # | 调用链 | 契约验证 | 状态 |
|---|--------|---------|------|
| 16 | `enterCtrl` / `inputCtrl` → `detectFenceLine(text)` / `detectBlockConversion(text)` | barrel: consumer → `kernel/index` → `blockTree` → re-export → `blockDetection`；函数签名零变化 | ✅ 通畅 |
| 17 | 图片函数消费者 → `insertImageFromSelection` / `alignImage` / `makeImageInline` / `removeImage` / `replaceImage` | barrel: consumer → `formatCtrl` → re-export → `imageFormatCtrl`；函数签名零变化 | ✅ 通畅 |

### P3 — 导出

| # | 调用链 | 契约验证 | 状态 |
|---|--------|---------|------|
| 18 | `imageInline.ts` `resolveMediaMime(ext)` / `imageNeedsAlpha(ext)` | 函数签名不变；实现从 `mediaMime.ts` import + re-export；EXT_TO_MIME 覆盖原 MIME_BY_EXT 全部 11 条目 + EXTENSION_CONTENT_TYPES 额外 `svg+xml` | ✅ 通畅 |
| 19 | `mail/service.ts` `IMAGE_CONTENT_TYPES[ext]` → `resolveMediaMime(ext)` | `resolveMediaMime` 自动 strip 前导点，`path.extname` 带点输入兼容；未知扩展回退 `application/octet-stream`（原实现 unknown → undefined → no contentType → 等价） | ✅ 通畅 |

## 验证结论

- **19/19 链路通畅**，无断裂
- **0 接口签名变更**（全部 barrel re-export 保持兼容）
- **0 数据格式变更**
- **0 错误处理路径变更**
- 唯一语义差异：`mail/service.ts` 未知扩展名行为从 "无 contentType 字段" 变为 `"application/octet-stream"` → `contentType` 字段存在但值不同。检查发现 `IMAGE_CONTENT_TYPES` 未列出的扩展名原行为也是 "无 contentType 字段"，而新行为 `mime !== 'application/octet-stream'` 过滤掉了 fallback，语义等价。