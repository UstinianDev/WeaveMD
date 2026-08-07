# WeaveMD — CLAUDE.md

> 精简版：仅保留当前主线所需信息。深层设计见 `docs/`（[SUMMARY.md](../docs/SUMMARY.md) 为索引，
> `specs/` 为编辑主区实现记录）。

## Build / Test

- `npm run dev` — Vite + Electron (HMR)
- `npm run build` — Vite build + electron-builder
- `npm run lint` / `npm run typecheck` / `npm run test` — ESLint / tsc --noEmit / Vitest
- `npx playwright test` — 真实 Chromium E2E（自动启动 renderer-only vite server）
- 质量门禁：tsc + vitest + eslint(0 error) + vite build + E2E 全绿才算完成

## 目录结构（要点）

- `src/main/` — Electron 主进程：window、ipc-handlers、db（better-sqlite3）
- `src/render/editor/` — **编辑主区 v2 内核（React-free）**：`kernel/`（块树、双向转换、
  行内渲染、选区）+ `controllers/`（七类交互）
- `src/render/components/Editor/v2/` — v2 渲染层：EditorV2（宿主）、`blocks/`
  （ContentBlock 是唯一 contentEditable）、FloatingToolbar
- `src/render/components/Editor/` — EditorView（双模式编排，v2 默认）+ v1 回退组件
- `src/render/stores/ services/ styles/` — Zustand / markdown 服务 / globals.css
- `docs/` — REQUIREMENTS / TECH_STACK / SUMMARY / modules/ / specs/

## 规范

- 中文交流；代码/标识符英文；React 18 + TS strict；Zustand v4；Tailwind
- 文档优先：改代码前先同步需求/技术文档，完成后更新进度与验证记录
- 命名：组件 PascalCase，函数/文件 camelCase；不用 `any`
- 标题字号：H1 26/700、H2 22/600、H3 18/600、H4 16/500、正文 14/400
- 行前缀解析统一走 `src/render/services/lineMarkdown.ts`（含 U+00A0 分隔）

## 编辑主区 v2（当前主线，架构照搬 marktext/muya）

- 仅叶子块内容 span（`ContentBlock`）可编辑；不可变块树 + 无损双向转换（往返不变式）
- 行内语法标记保留在 DOM（`span.md-syntax`），`textContent` 与源一致
- 前缀即时转换（`# `/`- `/`1. `/`- [ ] `/`> `/` ```lang `），退格在内容起点降级
  （六条退出规则：docs/specs/markdown-block-exit-rules.md）
- 语法外观对齐 marktext（spec 13.7）：标题 `#`×n 光标提示、深灰列表 marker、
  圆形任务复选框、引用绿色竖线，语法符号全部不可选中；类名勿用 `list-item`
  （Tailwind 工具类冲突，用 `list-item-block`）
- 退出/退格链（spec 13.9 / 13.11）：空列表项退格退出列表；空代码块退格一键删除、
  回车退出（保留）；代码块后空行 Backspace 受保护（删除代码块后可删）；删光标题
  内容后连续退格光标跳回上一行
- 代码块尾随保护空行持久化（SPEC-EDIT-CBTP）：`markdownToState` 解析期若整树最后
  叶子为 code-block 自动补尾随空段落，重载/模式切换后不丢失；文本输出不变
- 浮动工具栏（SPEC-EDIT-FT v1.0）：选区触发且**仅单一语法类型显示**（h1+h2 不显示）；
  自定义块类型下拉（正文/H1-H6/代码块/引用/三类列表，`canConvertBlock` 矩阵置灰，
  `syntaxTypeToOption` 映射）——纯函数 `selectionSyntaxTypesConsistent` / `resolveSyntaxType`
  均在 kernel/syntaxType.ts 与 FloatingToolbar 导出，组件测试直接覆盖
- 跨块鼠标拖选（spec 13.13）：rAF 节流 + 反向显式交换端点 + 非内容区回退 + mouseup
  末帧兜底/3 帧重放（`useCrossBlockDragSelection.ts`）；Backspace/Delete 走
  `deleteLeafRange` 块树级删除；**注意**：Chromium 对跨编辑宿主 Selection.toString()
  只返回 anchor 块内文本（Range 边界保留跨块），拖选验证须用块 id + Backspace 而非文本
- 焦点恢复：`applyAction` 树未变时立即恢复；降级转换焦点用新块 id
- **v1 回退路径已退役（2026-08-06）**：v2 为唯一路径，`__EDITOR_V2__` 开关已移除，
  v1 组件/服务/测试已删除（EditorView 1920 行重写为薄编排器）

## 关键文件

- `src/render/editor/kernel/` — blockTree / markdownToState / stateToMarkdown /
  inlineRenderer / outline / selection / syntaxType（resolveSyntaxType）
- `src/render/editor/controllers/` — input / enter / backspace / convert / click / list / format
- `src/render/editor/editorInstance.ts` — 内核宿主（内容加载、markdown 同步）
- `src/render/components/Editor/v2/EditorV2.tsx` — v2 入口（状态、事件路由、焦点恢复、撤销）
- `src/render/components/Editor/v2/blocks/ContentBlock.tsx` — 唯一 contentEditable 表面
- `src/render/components/Editor/v2/FloatingToolbar.tsx` — 浮动工具栏
- `src/render/components/Editor/EditorView.tsx` — 双模式编排（v2 默认）

## 已知限制（详见 spec 13.x）

- v2 Normal 无查找高亮；撤销/重做后光标回到重建树首块；段落级 MD Source 视图未迁移
