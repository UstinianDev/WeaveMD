# REFACTOR-EDITOR-TOOLBAR-IMAGE-LINK：编辑主区重构报告（工具栏 / 图片 / 超链接）

> 档位：M（标准重构）| 日期：2026-08-13 | 状态：已完成（零行为变更）
> 计划：[PLAN-EDITOR-TOOLBAR-IMAGE-LINK](../plan/editor-toolbar-image-link-refactor.plan.md)
> 基线：vitest 49 文件 / 845 测试全绿（断言零修改）

---

## 1. 前后对比

| 文件 | 重构前 | 重构后 | 说明 |
| ---- | ------ | ------ | ---- |
| `ImageToolbar.tsx` | 287 行，含死代码 scheduleHide/cancelHide/hideTimerRef | 删死代码 + scroll 重锚定复用共享函数 | 死代码清理 + 锚定去重 |
| `ImageResizeBox.tsx` | getSelectedImg + scroll 重锚定内联重复查询 | 复用 `findImageEl`/`readImageRect` | 锚定去重 |
| `InsertUrlModal.tsx` | 本地 `EMPTY_URL_MESSAGE` 字面量 | import 自 `modalConstants.ts` | 常量合并 |
| `ImageEditTool.tsx` | 本地 `EMPTY_URL_MESSAGE` 字面量 | import 自 `modalConstants.ts` | 常量合并 |
| `imageAnchor.ts` | —（不存在） | 新增：`findImageEl` + `readImageRect` 纯函数 | 图片 DOM 定位共享 |
| `modalConstants.ts` | —（不存在） | 新增：`EMPTY_URL_MESSAGE` 共享常量 | 弹层文案单源 |

## 2. 应用的重构模式

- **Delete Dead Code**：`ImageToolbar.scheduleHide`——注释自认"仅复刻 timer 生命周期，不改变图片工具栏可见性"（图片工具栏可见性由 imageSelection 决定），仅 setTimeout 置 hideTimerRef=null 无任何状态效果；连带删除 cancelHide/hideTimerRef/scroll effect 的 clearTimeout/onMouseLeave。已核实 ImageToolbarV2 测试无相关断言。
- **Extract Function（模块级）**：ImageToolbar 与 ImageResizeBox 复制粘贴的「块 id + token 区间 → 查 img.inline-image → 读 getBoundingClientRect」→ 提取纯函数 `findImageEl`/`readImageRect` 到 `imageAnchor.ts`（无 React 依赖）。**保留各组件自身的事件监听语义**（ImageToolbar 容器 capture；ImageResizeBox 容器+window + 挂载即跑一次），零行为变更。
- **Consolidate Duplicate Constant**：`EMPTY_URL_MESSAGE = 'URL 不能为空'` 双份字面量 → `modalConstants.ts` 单源。

## 3. 关键决策与风险处理

| 决策 | 依据 |
| ---- | ---- |
| **不抽 Escape/reset hook**（InsertUrlModal vs ImageEditTool） | 两组件 props 差异大（url 单值 vs src/alt/title+tab+预填），M 级抽 hook 收益低、改动面大；仅合并常量 |
| **`InsertUrlModal.showPickImage` 保留不删** | 已核实生产唯一调用点 FloatingToolbar 传 `title="插入链接"` 未传 showPickImage；但组件自洽 + InsertUrlModal.test.tsx 4 用例覆盖（公开 API + 测试覆盖）→ 保留 |
| **Step 4（FloatingToolbar 事件整理）评估无需改动** | 现有 3 组事件 effect 职责注释已充分（selectionchange+scroll / mousedown+mouseup 拖选 / mousedown(capture)+keydown 守卫）；M 级明确不动事件结构与 ref 语义耦合，避免为改而改 |
| **Step 5（formatCtrl unlinkRange）默认跳过** | delta 循环逻辑正确、注释充分；改动触及内核控制器、收益不显著，M 级克制 |
| **ToolbarButton 内联 style 保留** | FloatingToolbarV2 测试断言 `style.color === 'var(--accent)'`，迁移 CSS 类会破坏零断言修改 |

## 4. 每步测试结果

| 步骤 | 内容 | 验证命令 | 结果 |
| ---- | ---- | -------- | ---- |
| Step 0 | 基线复核 | `npx vitest run` | 49/845 全绿 |
| Step 1 | 死代码清理（ImageToolbar.scheduleHide） | ImageToolbarV2 + FloatingToolbarV2 + tsc | 64 通过 + 0 错 |
| Step 2 | 图片锚定去重（imageAnchor.ts） | ImageToolbarV2 + ImageResizeBox + EditorV2ImgResize + tsc | 27 通过 + 0 错 |
| Step 3 | 超链接常量合并（modalConstants.ts） | InsertUrlModal + ImageEditTool + tsc | 38 通过 + 0 错 |
| Step 4 | FloatingToolbar 事件整理 | 评估无需改动 | — |
| Step 5 | formatCtrl unlinkRange | 默认跳过 | — |
| Step 6 | 清理 + 全量门禁 | vitest 全量 + tsc + lint + vite build | 845 + 0 错 + 0 error + build 通过 |
| Step 7 | E2E 回归 | playwright | 74 通过 + 5 既有 RED |

## 5. 行为验证

- **全量门禁**：vitest **49 文件 / 845 测试全绿**（与基线一致，断言零修改）、tsc 0 错、eslint 0 error（8 warnings 既有）、vite build 编译通过（render + main）。
- **E2E**：floating-toolbar.spec（43，含 LINK-IMAGE-E1~E7 链接/图片全链路）、image-resize、link-editing-regression、cross-block-replace-input、cross-block-selection、editor、exit-behavior、marktext-rendering、drag-selection-move **全部通过**。
- **既有 RED 确认**：drag-selection-markers.spec 5 个失败为**已知既有技术债**（测试名标注"当前 RED"，FT4 复现阶段）。已用 `git stash` 验证重构前同样 5 个失败，非本次引入。
- **DOM 契约**：`.image-toolbar`/`.it-toolbar`/`[data-testid="image-toolbar"]`/`image-toolbar-*`/`.image-resize-box`/`.image-resize-handle`/`[data-handle]`/`.insert-url-modal-*`/`.ie-*`/`floating-toolbar-v2`/`.ft-*` 全部原样；`syntaxTypeToOption`/`selectionSyntaxTypesConsistent` re-export 保持。

## 6. 剩余风险与遗留

| 项 | 说明 |
| ---- | ---- |
| `npm run build` 的 electron-builder 阶段 | 被运行中 Electron 进程持有的 `better_sqlite3.node` 文件锁阻塞（EBUSY/EPERM）。**环境阻塞，非代码问题**（本次仅涉 render 层 + 新增纯函数，`npx vite build` 已独立通过 render+main 编译）。需关闭占用进程后重跑 |
| `drag-selection-markers` 5 个既有 RED | 本次重构**不处理**（FT4 Phase 0 复现测试，注释明确"当前 RED 本阶段只写复现"），列为此前已知技术债 |
| `InsertUrlModal.showPickImage` | 保留（公开 API + 测试覆盖）；后续若确认图片插入不再需要弹层式选图可评估删除 |
