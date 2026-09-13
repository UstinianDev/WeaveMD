# 重构实施计划 — refactor-export-editor-outline-navbar

> L 级重型重构 | 技术调研结果 + 分阶段变更清单 | 总指挥内联产出

## 1. 技术调研

### 1.1 React 组件职责分离与 hook 抽取

应用于 P0/P1 组件裂解：

- **模式**：组件仅保留编排/渲染，副作用抽 `useXxx` hook（React 18 `useEffect` + ref）
- **Store 净化**：可变回调（如 `editorDraftFlusher`）不应存入 Zustand store——Zustand 是为可序列化状态设计的。替代：组件间通过 `useRef` + Context 或事件 emitter 传递一次性回调
- **DOM 查询集中**：选择器字符串抽 `src/render/utils/domSelectors.ts` 常量模块，全局 grep 替换字面量

### 1.2 Zustand Store 净化

应用于 P0 uiStore 净化：

- Zustand v4 `set()` 内不应执行 DOM 操作（`openModal` 的 Monaco textarea 清理）——DOM 操作放在组件 `useEffect` 或工具函数
- 函数型字段（`editorDraftFlusher` / `beforeToggleSourceMode`）移除，改用组件级 ref + 注册/反注册模式

### 1.3 长文件裂解

应用于 P2 blockTree.ts / formatCtrl.ts / FloatingToolbar.tsx：

- **策略**：沿职责边界切分（树操作 vs 语法检测；格式化按子类型拆；工具栏按按钮类型拆）
- **混合导出**：原 `blockTree.ts` 改为 barrel export，转发给子模块（保持所有 import 路径不变）
- **上限**：目标 ≤400 行/文件，≤200 行/函数

### 1.4 保守原则（P2 编辑主区）

- 不改内核 API 签名（`EditorInstance` / `BlockTreeV2` / `EditorActionResult`）
- 不新增函数间接层（如装饰器/代理/管道）
- 只做：拆文件 + 重复消除 + 死代码清理 + 命名修正

---

## 2. 分阶段变更清单（白名单）

### 阶段 0 — 前置准备（所有阶段前执行）

| 文件 | 动作 | 风险 |
|------|------|------|
| `src/render/utils/domSelectors.ts` | **新建**：集中 DOM 选择器常量 `EDITOR_SCROLL_CONTAINER = '.editor-scroll-container'`、`MONACO_EDITOR_ROOT = '.monaco-editor'`、`MONACO_HIDDEN_TEXTAREA = '.ime-text-area, .inputarea'` | L |
| `src/render/components/Editor/EditorView.tsx` | 替换 `.editor-scroll-container` / `.monaco-editor` / `.ime-text-area` / `.inputarea` 为常量引用 | L |
| `src/render/stores/uiStore.ts` | 替换 `.ime-text-area` / `.inputarea` 为常量引用（openModal 内） | L |
| `src/render/components/Editor/v2/EditorScrollContainer.tsx` | 替换 `.editor-scroll-container` 类名字面量为常量（仅 css class 赋值处，不动 JSX className） | L |
| `src/render/components/AIAgent/cards/AIMessageBubble.tsx` | 替换 `.editor-scroll-container` 为常量引用 | L |
| `src/render/components/Editor/v2/blocks/TableBlock.tsx` | 替换 `.editor-scroll-container` 为常量引用 | L |

### 阶段 1 — P0 模式切换

| 文件 | 动作 | 风险 |
|------|------|------|
| `src/render/hooks/useMonacoTheme.ts` | **新建**：从 EditorView.tsx L49-66 提取 Monaco 主题异步加载 + `themesLoading` 状态 | L |
| `src/render/hooks/useGlobalShortcuts.ts` | **新建**：从 EditorView.tsx L74-127 提取全局 keydown（Ctrl+F/S/Z/Y/`），合并 TopBar.tsx L98-128 `shouldIgnoreGlobalShortcutTarget`+`getShortcutAction` 逻辑到同一 hook，统一目标忽略判定。EditorView 和 TopBar 共用同一 hook 实例 | M |
| `src/render/hooks/useModeScrollPersistence.ts` | **新建**：从 EditorView.tsx L168-206 提取模式切换滚动保存/恢复（含 `savedNormalScrollRef`/`savedSourceScrollRef` + beforeToggleSourceMode 注册 + setTimeout 恢复）。返回 `{ saveCurrentScroll, restoreSavedScroll }`。内部 `setTimeout` 延迟提炼为具名常量 `SCROLL_RESTORE_DELAY_MS = 100` | L |
| `src/render/hooks/useDraftFlusher.ts` | **新建**：从 EditorView.tsx L210-223 提取草稿刷新注册/反注册，替代 uiStore 的 `editorDraftFlusher`/`beforeToggleSourceMode`。用内部 ref 而非 store | M |
| `src/render/components/Editor/EditorView.tsx` | 移除上述 4 块逻辑，改为调用新 hook；保留 only 模式编排与渲染。净减约 100 行 | M |
| `src/render/components/Navbar/TopBar.tsx` | 快捷键 keydown 监听改为共享 `useGlobalShortcuts`；删除 `shouldIgnoreGlobalShortcutTarget`/`getShortcutAction`/`SHORTCUT_MAP` + `new-file` 空分支（L110-112）；快捷键`handleSave`/`handleUndo`/`handleRedo` 保留但改为从 hook 传入 | M |
| `src/render/components/Editor/SourceCodeEditor.tsx` | 删除死代码：`monacoRef`（只赋值不读取）、`onEditorRef` prop（grep 确认无调用方）；`useImperativeHandle` 移除 `monacoRef` 引用（为 L77）| L |
| `src/render/stores/uiStore.ts` | 移除 `editorDraftFlusher`/`beforeToggleSourceMode`/`setBeforeToggleSourceMode`/`flushEditorDraft` 字段；`openModal` Monaco textarea 清理逻辑（L137-143）移到独立工具函数 `removeMonacoOrphanTextareas()` 由调用者管理 | M |
| `src/render/hooks/useNavbarActions.ts` | `handleUndo`/`handleRedo` 中 `flushEditorDraft` 调用改为新 hook 提供的 ref 回调 | M |

### 阶段 2 — P1 目录区

| 文件 | 动作 | 风险 |
|------|------|------|
| `src/render/editor/kernel/outline.ts` | ① 提取 `headingFromBlock(block): { text, level, id }` 纯函数（统一文本清洗+level默认值）；② `extractHeadingOutline`（非缓存版）标记 `@deprecated`，内部委托给 Cached 版全量路径或删除（grep 确认 src 内无消费）；③ 三函数的行号累加循环改为共享 `accumulateLines(blocks)` 辅助；④ `blockLineCount` 简化为 `countNewlines(str)` 纯函数 | L |
| `src/render/hooks/useOutlineNavigation.ts` | 保持现状（已合理） | — |
| `src/render/components/Editor/panels/OutlinePanel.tsx` | ① `buildTree`/`buildHeadingIndexMap` 移到 `src/render/editor/kernel/outline.ts` 作为共享导出（三处统一：v1/v2/OutlinePanel）；② 文件创建逻辑 `handleCreateConfirm` + `createPanelType` 状态 → 抽出 `useCreatePanel` hook 或移到独立 `CreatePanelManager`；③ `effectiveTab` 改为 store selector `useFileTreeStore(s => isEditorCollapsed ? 'files' : s.activeTab)` 不再本地计算；④ `OutlineItemRow` prop drilling（indexMap/onNavigate/activeHeadingIndex）改为 Context 传递 | M |
| `src/render/components/Editor/panels/FileTreePanel.tsx` | ① `renderNode` + `renderLooseFile` → 统一 `FileTreeRow` 子组件（props: node/isActive/onRename/...）；② 硬编码 `fontFamily: 'Consolas, KaiTi,...'` → 移到 `src/render/utils/fontConstants.ts`；③ `renderNode` 10项依赖数组用 `useMemo`+ref 收窄 | M |
| `src/render/components/Editor/panels/SidebarToolbar.tsx` | 8 个 icon button → 抽出 `ToolbarIconButton` 子组件（props: icon/title/active/disabled/onClick） | L |
| `src/render/services/markdown.ts` | v1 `extractOutline` 改为 v2 大纲的适配层——内部调用 `extractHeadingOutline`（从 editorInstance.tree）或标注 `@deprecated`；`headingToId` 若 src 内无消费者则删除 | M |
| `src/render/components/Editor/SourceCodeEditor.tsx` | `getNearestHeadingLineNumber`（L46-58）替换为基于 `extractOutline`（v2 大纲）的同源索引查询，删除行级正则 `/^(#{1,3})\s/` 第二次独立实现；或保留但复用 v2 大纲数据缓存 | M |
| `src/render/stores/fileTreeStore.ts` | `loadFolderContents` 长函数拆 `buildPathTree` + `sortAndMerge` 两步；`restore` 两个 catch 回退块复用 `readDiskOrNull` helper | M |
| `src/render/utils/fontConstants.ts` | **新建**：集中编辑器字体字符串 `EDITOR_FONT_FAMILY = 'Consolas, KaiTi, 楷体, STKaiti, system-ui'`，OutLinePanel/FileTreePanel/FileSearchBar 统一引用 | L |

### 阶段 3 — P2 编辑主区（保守深度）

| 文件 | 动作 | 风险 |
|------|------|------|
| `src/render/editor/kernel/blockTree.ts` | ① 语法检测函数（`detectFenceLine` L782 + `detectBlockConversion` L854）→ `src/render/editor/kernel/blockDetection.ts` **新建**；② `markdownSyntax.ts` 已有 ATX_HEADING_RE/THEMATIC_BREAK_RE 等——blockDetection 引入这些；③ `blockTree.ts` 从 865 行 → 目标 ~500 行，保留纯树操作 | H |
| `src/render/editor/kernel/markdownToState.ts` | 行级解析器分段过长（543行）→ 按节点类型提取子函数到 `markdownToState/` 子目录（headings.ts / lists.ts / blocks.ts），on 主文件改为 barrel + 调度循环。**不改签名** | H |
| `src/render/editor/controllers/formatCtrl.ts` | ① 图片操作函数（`insertImageFromSelection` L262 / `alignImage` L316 / `makeImageInline` L341 / `removeImage` L363 / `replaceImage` L415）→ `src/render/editor/controllers/imageFormatCtrl.ts` **新建**；② `unlinkRange` L468 → `linkFormatCtrl.ts` 或保留原位；③ 原 formatCtrl 行内格式 CRUD（粗体/斜体/删除线/代码/高亮）保留 | M |
| `src/render/editor/controllers/shared.ts` | 扩展公共辅助：`applyBlockAction(instance, blockId, fn)` 统一控制器管线（setTree + syncContent + focus restore），供所有控制器复用 | M |
| `src/render/components/Editor/v2/toolbar/FloatingToolbar.tsx` | ① 工具栏按钮定义 + 图标映射 → `src/render/components/Editor/v2/toolbar/toolbarButtons.ts` **新建**；② 块类型下拉菜单 → `BlockTypeDropdown.tsx` **新建**；③ `onConvertBlock` 调用链简化为 `convertBlockAction` 纯函数 | M |
| `src/render/components/Editor/v2/blocks/ContentBlock.tsx` | ① 跨块拖选逻辑 → `useContentBlockDrag.ts` **新建**（从现有 paste/crossBlock 逻辑中提取）；② 粘贴处理 `onPaste` 逻辑 → `useContentBlockPaste.ts` **新建**；③ ContentBlock 从 488行 → 目标 ~250行 | H |
| `src/render/editor/kernel/katex.ts` | 确认是否被消费（grep `from.*katex`）；若无消费者 → 标注 `@deprecated` 或移除 | L |
| `src/render/components/Editor/v2/types.ts` | `BlockHandlers` 接口若随 formatCtrl 裂解需要拆图片相关 handler 到子接口，保守：保持原接口不变，子 controller 内部转发 | L |

### 阶段 4 — P3 导出（轻量级）

| 文件 | 动作 | 风险 |
|------|------|------|
| `src/main/export/imageInline.ts` | ① `IMG_SRC_RE` 提为模块级常量（L256 + L307 去重）；② `isWindowsAbsolutePath` + `decodeWindowsPath` 合并为 `toLocalFilePath(src): string \| null`；③ `resolveImageSrc` 5 参数 → 复用 `ImageInlineDeps`（已有接口）+ 新增 `SrcResolutionDeps` 子类型；④ `resolveMediaMime` / `imageNeedsAlpha` 归一化 → `normalizeExt(ext)` 纯函数 | L |
| `src/main/export/exportService.ts` | ① `exportFile`（56-119）按格式族拆：`exportDirect(filePath, fullHtml)` + `exportDocx(filePath, fullHtml, filename)` + `exportRaster(format, filePath, fullHtml)`；② `renderToFile`（228-308）拆 `renderPdf` / `renderBitmap` + 共享 `createHiddenWindow` + `writeTmpAndLoad`；③ 成功返回值 `{success:true, data:{filePath}}` 提取 `ok(filePath)` 辅助；④ `600` 魔法值 → `EXPORT_DEFAULT_WIN_HEIGHT`；margins `1440` → `DOCX_MARGIN_TWIPS`；`setZoomFactor(2)` → 引用 `EXPORT_ZOOM_FACTOR` 新常量 | M |
| `src/main/export/types.ts` | `EXPORT_SCALE_FACTOR=3` 死常量 → 删除；新增 `EXPORT_ZOOM_FACTOR=2`（替换 exportService 硬编码）；新增 `EXPORT_DEFAULT_WIN_HEIGHT=600` | L |
| `src/main/mediaMime.ts` | **新建**：合并 `MIME_BY_EXT`（imageInline:39）+ `EXTENSION_CONTENT_TYPES`（exportService:122）→ 单一 `EXT_TO_MIME` map + `resolveMediaMime()` + `imageNeedsAlpha()` + `normalizeExt()`。grep 项目内 ≥5 处同型映射（imageStorage/agentMedia/documentParser/...）→ 替换引用 | M |
| `src/main/ai/files/documentParser.ts` | 替换内联 MIME 映射为 `mediaMime.ts` 引用 | L |
| `src/main/ai/tools/handlers/imageStorage.ts` | 替换内联 MIME 映射为 `mediaMime.ts` 引用 | L |
| 其他 MIME 使用者 | grep 全项目 mime/image/png/jpeg 替换所有重复映射为 `mediaMime.ts` 引用 | L |

---

## 3. 执行约束

1. **铁律**：不改任何模块行为的任一 API 签名（内核 / 组件 / 服务 / 类型导出）
2. **每阶段结束后**：`npm run test` + `npm run typecheck` + `npm run lint` 回归
3. **任意回归失败** → git checkout 该阶段改动 + 本阶段不继续
4. **P2（编辑主区）保守**：不新增函数间接层（不引入装饰器/代理/管道模式/wrapper）
5. **Barrel export 不改 import**：原 `blockTree.ts` 拆分后，新增 `blockTree/index.ts` barrel 保持 `from './blockTree'` 兼容，不破坏已有调用方

---

## 4. 风险矩阵

| 阶段 | 最高风险项 | 风险等级 | 缓解 |
|------|-----------|---------|------|
| P0 | 快捷键统一（两个监听合并） | M | 统一 hook 先做完整测试；forward 带 flush 策略 |
| P0 | uiStore 移除 editorDraftFlusher | M | 新 hook 在渲染层注入，先验证保存草稿/切换文件场景 |
| P1 | 大纲 v1→v2 适配层 | M | v1 extractOutline 先标记 deprecated 保留原逻辑；Source 模式验证 outline 高亮正常 |
| P2 | blockTree 拆分 barrel 兼容 | H | 每个子模块拆分后用原 import 路径验证 typecheck 零错误 |
| P2 | ContentBlock 拆 hook | H | 先拆 paste（有单元测试覆盖 ClipboardEvent mock），再拆 drag |
| P3 | MIME 映射跨项目替换 | M | 单文件逐步替换，每步 typecheck 确认无 breakage |

---

## 5. 估时

| 阶段 | 文件数 | 预计工时 |
|------|--------|---------|
| 0 | 6 | 30 min |
| 1 | 10 | 2-3 h |
| 2 | 12 | 3-4 h |
| 3 | 11 | 4-5 h |
| 4 | 8+ | 2-3 h |
| **合计** | **47+** | **半天到一天** |