# Outline UI 细调优化 - 实施计划

## [x] Task 1: 移除目录最大宽度限制

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 修改 `src/render/stores/uiStore.ts` 第96行 `setOutlineWidth` 方法
  - 将 `Math.min(500, Math.max(200, width))` 改为 `Math.max(200, width)`
  - 允许用户拖拽目录至任意宽度（包括整个应用宽度）
- **Acceptance Criteria Addressed**: AC-3
- **Test Requirements**:
  - `programmatic` TR-1.1: 检查 uiStore.ts 中 setOutlineWidth 方法不再包含 Math.min(500, ...)
  - `programmatic` TR-1.2: 拖拽目录宽度超过 500px 时宽度继续增加

## [ ] Task 2: 增大目录字体尺寸

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 修改 `src/render/components/Editor/OutlinePanel.tsx` 第12行 FONT_CLASSES
  - 将 `['text-lg font-semibold', 'text-base font-medium', 'text-sm']` 改为 `['text-xl font-bold', 'text-lg font-semibold', 'text-base font-medium']`
  - H1: text-xl(20px) font-bold
  - H2: text-lg(18px) font-semibold
  - H3: text-base(16px) font-medium
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - `programmatic` TR-2.1: 检查 OutlinePanel.tsx 中 FONT_CLASSES 使用新的字体大小类
  - `human-judgment` TR-2.2: 目视检查各级标题字体大小层级清晰

## [ ] Task 3: 增大目录标题行间距

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 修改 `src/render/components/Editor/OutlinePanel.tsx` 第57行按钮样式
  - 将 `py-0.5` 改为 `py-1.5`（或 `py-2`）以增加行间距
  - 确保标题间有足够视觉分隔
- **Acceptance Criteria Addressed**: AC-2
- **Test Requirements**:
  - `programmatic` TR-3.1: 检查按钮元素使用 py-1.5 或更大的垂直间距类
  - `human-judgment` TR-3.2: 目视检查目录列表项之间有足够间距

## [x] Task 4: 验证

- **Priority**: high
- **Depends On**: Task 1, Task 2, Task 3
- **Description**:
  - 运行 `npm run typecheck` 确保 TypeScript 类型检查通过
  - 运行 `npm run lint` 确保代码风格检查通过
  - 运行 `npm run test` 确保所有单元测试通过
- **Acceptance Criteria Addressed**: AC-5
- **Test Requirements**:
  - `programmatic` TR-4.1: typecheck 无错误
  - `programmatic` TR-4.2: lint 无错误
  - `programmatic` TR-4.3: 所有测试通过

# Task Dependencies

- Task 1, Task 2, Task 3 相互独立，可并行执行
- Task 4 依赖 Task 1, Task 2, Task 3 完成
