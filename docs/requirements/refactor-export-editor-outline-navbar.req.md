# 重构需求文档 — refactor-export-editor-outline-navbar

> L 级重型重构 | 铁律：任一模块功能行为严格不可改变（相同输入 → 相同输出）

## 范围与优先级

| 优先级 | 区域 | 核心目标 | 深度 |
|--------|------|---------|------|
| P0 | 模式切换 | EditorView 职责拆卸、快捷键统一、DOM 常量集中 | 中等 |
| P1 | 目录区 | 大纲 v1/v2 双源合并、OutlinePanel 拆职责、FileTreePanel 去重 | 中等 |
| P2 | 编辑主区 | blockTree 拆文件、控制器模式归一、formatCtrl/FloatingToolbar 裂解 | 保守 |
| P3 | 导出 | 正则/MIME 去重、长函数拆分、魔法值常量化 | 轻量 |

## 各区域具体目标

### P0 — 模式切换（navbar + EditorView + SourceCodeEditor + uiStore）

1. **EditorView 拆 hook**：主题加载 / 全局快捷键 / 滚动持久化 / 草稿刷新分开
2. **快捷键统一**：合并 TopBar 与 EditorView 的 keydown 监听到单一点
3. **DOM 常量集中**：`.editor-scroll-container` / `.monaco-editor` / `.ime-text-area` / `.inputarea` 抽 `domSelectors.ts`
4. **uiStore 净化**：`editorDraftFlusher` / `beforeToggleSourceMode` 移出 store 到 context/ref
5. **死代码清理**：`onEditorRef` prop、`monacoRef`、`new-file` 空分支、normal 模式 no-op flusher

### P1 — 目录区（outline kernel + OutlinePanel + FileTreePanel + SidebarToolbar）

1. **双大纲合并**：v1 `extractOutline` → 改为 v2 大纲的适配层；`getNearestHeadingLineNumber` 改为同源索引
2. **`outline.ts` 去重**：提取 `headingFromBlock()` helper + 统一累加循环；标记未使用 `extractHeadingOutline`
3. **`buildTree` 统一**：v1/v2/OutlinePanel 三套栈建树算法 → 共享 `buildHeadingTree(flat[]): TreeNode[]`
4. **OutlinePanel 拆职责**：文件创建逻辑 → `NewFileFolderPanel` / `useCreatePanel` hook
5. **FileTreePanel 去重**：`renderNode` vs `renderLooseFile` → 统一 `FileTreeRow`；硬编码字体 → 常量
6. **SidebarToolbar 去重**：8 个 icon button 模板 → `ToolbarButton`
7. **死代码清理**：v1 `headingToId`
8. **`effectiveTab` 收敛**：单一 store selector 替代双处重复计算

### P2 — 编辑主区（kernel + controllers + v2 渲染层）· 保守深度

1. **blockTree.ts 裂解**（865行 → 拆）：树操作函数 ≈350~400 行可行独立模块；语法检测（fenceLine/detectBlockConversion）分离到 `markdownSyntax` 扩容；前缀规则独立
2. **formatCtrl.ts 裂解**（693行）：图片相关函数 → `imageFormatCtrl.ts`；链接相关 → `linkFormatCtrl.ts`
3. **FloatingToolbar.tsx 裂解**（692行）：按钮定义 → 单独目录；选区计算 → 纯函数；块类型下拉 → 独立组件
4. **ContentBlock.tsx 裂解**（488行）：拖选逻辑 → `useContentBlockDrag.ts`；粘贴处理 → `useContentBlockPaste.ts`
5. **控制器模式归一**：`shared.ts` 扩展统一控制器模板，减少七类控制器之间的重复骨架
6. **死代码清理**：未使用的导出

### P3 — 导出（exportService + imageInline + types）· 轻量级

1. **正则去重**：`IMG_SRC_RE` 模块级常量 + `<img>` 处理统一
2. **MIME 映射集中**：`MIME_BY_EXT` / `EXTENSION_CONTENT_TYPES` → 共享 `mediaMime.ts`（跨项目 ≥5 处引用）
3. **长函数拆分**：`exportFile` 按格式族拆、`renderToFile` 拆 pdf/bitmap 分支
4. **魔法值常量化**：600/1440/硬编码 zoomFactor → 引用 types.ts 常量
5. **`isWindowsAbsolutePath` + `decodeWindowsPath` 合并**：→ 单一 `toLocalFilePath`
6. **死常量清理**：`EXPORT_SCALE_FACTOR=3`（实际 setZoomFactor 硬编码 2）
7. **参数列表缩减**：`resolveImageSrc` 5 参数 → 复用 `ImageInlineDeps` 接口

## 不在此次范围

- 不改变任何 API 签名（内核/组件/服务导出接口）
- 不新增抽象层 / 中间件 / 管道
- 不迁移语言（TS 保持 strict）
- 不改变用户可见行为
- 不新增依赖

## 验收标准

1. **行为零变化**：`npm run test`（vitest）全绿；`npx playwright test` E2E 全绿
2. **类型零退化**：`npm run typecheck` 零错误
3. **Lint 零错误**：`npm run lint` 零 error（warn 不计）
4. **构建通过**：`npm run build` 成功
5. **坏味道可核验**：文件行数/重复次数有前后对比
6. **死代码消失**：grep 确认无调用方残留
7. **无新间接层**：不改 API 签名、不新增抽象步骤