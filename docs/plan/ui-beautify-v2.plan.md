# UI 深度美化实施计划（v2）

> 任务：ui-beautify-v2
> 分级：S-M
> 预计工时：1-2 小时
> 状态：✅ 已完成

## 变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/render/components/Common/Icon.tsx` | 修改 | 添加浮动工具栏所需图标 |
| `src/render/components/Editor/v2/toolbar/FloatingToolbar.tsx` | 修改 | 使用 Icon 替代文字字符 |
| `src/render/components/Editor/v2/toolbar/ToolbarButton.tsx` | 修改 | 支持 icon prop |
| `src/render/components/AIAgent/panel/AIPanelComposer.tsx` | 修改 | InputTag 移入输入框内部 |
| `src/render/styles/globals.css` | 修改 | InputTag 内部显示样式 |

## 实施步骤

### Step 1：添加图标到 Icon 组件
1. 在 ICON_MAP 中添加格式化图标（bold, italic, underline, strikethrough, code, highlighter, link, image, sigma, table, unlink, eraser）

### Step 2：修改 ToolbarButton 支持 icon prop
1. 添加 icon prop（可选）
2. 优先显示 icon，降级显示 label

### Step 3：修改 FloatingToolbar 使用图标
1. CHAR_BUTTONS 添加 icon 字段
2. OBJECT_BUTTONS 添加 icon 字段
3. 渲染时使用 icon 替代 label

### Step 4：修改 InputTag 移入输入框内部
1. 修改 AIPanelComposer 布局
2. 使用 overlay 方案将标签显示在 textarea 上方
3. 通过 CSS 让标签看起来在输入框内部

### Step 5：测试验证
1. 运行 typecheck
2. 运行 vitest
3. 运行 lint
4. 视觉验证

## 验收标准

- [x] 所有需求的验收标准通过
- [x] typecheck：3 个预先存在的错误（非本次引入）
- [x] vitest：1505/1505 通过
- [x] lint：无新增错误
- [x] vite build：成功
- [x] 视觉效果符合预期（图标替换、标签内部显示）
