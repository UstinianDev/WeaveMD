# Refactor — refactor-export-editor-outline-navbar

> 状态文档（devflow-refactor）。总指挥：本会话。

## Phase 0 — 分级

- **任务**：重构 导出功能 / 编辑主区 / 目录区 / 顶部导航栏富文本↔源代码切换
- **铁律**：任一模块功能行为严格不可改变（相同输入 → 相同输出）
- **分类**：重构
- **影响面**：跨模块（4 个模块：export / editor / outline / navbar-mode）
- **定档**：**L 级**
  - 跳过项：无（L 级全阶段）
  - 强制项：技术调研（crw search + docs-mcp）、code-refactor-master、并行执行、M/L 连通性验证、code-review

### 未提交改动（前置确认）

- `M src/render/components/Editor/EditorView.tsx` — 上轮 bug 修复（Monaco scrollTop 改 API）
- `M src/render/components/Editor/SourceCodeEditor.tsx` — 上轮 bug 修复（新增 getScrollTop/setScrollTop）
- `D 1` — stash 杂物文件

**决策**：重构前需分离这些改动（commit bug 修复，删除杂物），避免混入重构 diff。

## Phase 1 — 需求对齐（grill-me）

（待执行：逐区确认坏味道清单、重构目标与验收标准）