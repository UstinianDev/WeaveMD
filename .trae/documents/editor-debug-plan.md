# WeaveMD Editor Debug Plan - 内容同步与Markdown实时渲染修复

## 问题概述

### 问题一：新增内容保存失败
- **现象**：在 Normal Mode 中新增段落（按 Enter）并添加内容，切换到 Source Code Mode 后新增内容丢失
- **根因假设**：异步渲染（renderedHtml）在用户输入过程中替换 DOM，导致 contentEditable 状态被清除

### 问题二：Markdown 实时渲染失败
- **现象**：在 Normal Mode 中输入 Markdown 语法并按 Enter，文本保持为纯文本，需切换模式才能渲染
- **根因假设**：块类型转换后，异步渲染时机不对，或新块焦点抢占导致视觉回退

## 调试会话信息

- **Session ID**: `editor-sync-render`
- **Debug 文件**: `debug-editor-sync-render.md`
- **状态**: [OPEN]

## 可证伪假设

| ID | 假设 | 可能性 | 验证难度 | 预期信号 |
|----|------|--------|----------|----------|
| H1 | 异步渲染替换 DOM 导致 contentEditable 中断 | 高 | 低 | 日志显示 renderedHtml 设置时间 < 用户输入完成时间 |
| H2 | handleBlockInput 防抖(30ms)未在切换模式前触发 | 中 | 低 | 日志显示 onInput 事件与 syncContentBeforeToggle 的时序 |
| H3 | 新块 sourceLines 在类型转换后未正确同步 | 中 | 中 | 日志显示 convert 后 sourceLines 与 DOM content 不一致 |
| H4 | 块类型转换成功但 renderedHtml 异步设置导致视觉闪烁/回退 | 高 | 低 | 日志显示 block.type 已改变但 renderedHtml 设置后组件重新渲染 |
| H5 | 新创建的段落块在异步渲染后抢占焦点/清除内容 | 中 | 中 | 日志显示 focus 事件在 renderedHtml 设置后触发 |

## 实施步骤

### Phase 1: 启动调试服务器并添加埋点

1. 启动 Debug Server（端口自动探测）
2. 在以下关键位置添加 `#region debug-point` 埋点：

   **埋点 1 - `handleBlockEnter` (EditorView.tsx)**
   - 记录：Enter 时的 blockId、DOM content、detectMarkdownLine 结果、类型转换决策、新块创建状态
   - 假设：H3, H4

   **埋点 2 - `handleBlockInput` (EditorView.tsx)**
   - 记录：input 事件时间戳、防抖触发时间、捕获的 DOM content、块更新决策
   - 假设：H2

   **埋点 3 - 渲染 useEffect (EditorView.tsx)**
   - 记录：块渲染时序、renderedHtml 设置时间、正在渲染的块 ID 和内容
   - 假设：H1, H5

   **埋点 4 - `syncContentBeforeToggle` (EditorView.tsx)**
   - 记录：切换模式时的所有块 DOM content vs tree sourceLines、检测到的变更
   - 假设：H1, H2, H3

   **埋点 5 - `handleInput` (EditorScrollContainer.tsx)**
   - 记录：input 事件的 target、isComposing 状态、blockId 识别结果
   - 假设：H2

### Phase 2: 复现与证据收集

3. 构建并启动应用（`npm run dev`）
4. 按以下步骤复现并收集日志：
   - **复现 1 (问题一)**：打开编辑器 → 输入文本 → 按 Enter → 输入新文本 → 立即切换到源码模式 → 观察内容
   - **复现 2 (问题二)**：打开编辑器 → 输入 `# 标题` → 按 Enter → 观察是否自动渲染为标题
   - **复现 3 (组合)**：输入文本 → Enter → 输入 `# 新标题` → Enter → 切换模式 → 切回 → 观察

### Phase 3: 分析与修复

5. 读取 `.dbg/trae-debug-log-editor-sync-render.ndjson` 分析日志
6. 确认/排除各假设
7. 基于证据实施最小修复

### Phase 4: 验证与清理

8. 清除日志，重新复现以验证修复
9. 用户确认修复
10. 清理所有埋点代码和调试文件

## 需要修改的文件

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `src/render/components/Editor/EditorView.tsx` | 添加埋点 | handleBlockEnter, handleBlockInput, 渲染useEffect, syncContentBeforeToggle |
| `src/render/components/Editor/EditorScrollContainer.tsx` | 添加埋点 | handleInput |

## 风险与注意事项

- 埋点代码应使用 `#region debug-point <id>` 包裹，便于后续清理
- 埋点使用 HTTP 上报到 Debug Server，不使用 console.log
- 修复阶段可能涉及修改块渲染逻辑、contentEditable 与 renderedHtml 的切换机制
- 需要确保修复后不影响现有 185 个测试
