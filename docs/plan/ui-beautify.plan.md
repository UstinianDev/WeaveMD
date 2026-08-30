# UI 美化实施计划

> 任务：ui-beautify
> 分级：M
> 预计工时：半天
> 状态：✅ 已完成

## 变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/render/styles/globals.css` | 修改 | 字体配置 + 工具栏样式 + 代码块样式 + Composer 标签 |
| `src/render/components/AIAgent/composer/InputTag.tsx` | 新增 | /skill @doc 高亮标签组件 |
| `src/render/components/AIAgent/panel/AIPanelComposer.tsx` | 修改 | 集成 InputTag 组件 |
| `tests/styles/ft2Css.test.ts` | 修改 | 更新测试（padding 6px→8px） |

## 实施步骤

### Step 1：字体与代码块样式（R2 + R4）
1. 更新 `.editor-scroll-container` 字体配置
2. 更新 `.code-fence-content` 字体配置
3. 增强 Prism token 颜色对比度
4. 优化代码块头部样式

### Step 2：工具栏美化（R3）
1. 浮动工具栏毛玻璃效果
2. 工具栏按钮悬停动效
3. 表格工具栏样式统一
4. 图片工具栏样式统一

### Step 3：Composer 标签（R1）
1. 创建 InputTag 子组件
2. 解析 composer value 中的 /skill 和 @doc
3. 渲染标签显示层
4. 添加删除和悬停交互

### Step 4：测试验证
1. 运行 typecheck
2. 运行 vitest
3. 运行 lint
4. 视觉验证

## 验收标准

- [x] 所有需求的验收标准通过
- [x] typecheck：3 个预先存在的错误（非本次引入）
- [x] vitest：1505/1505 通过（1 个套件失败是预先存在的问题）
- [x] lint：1 个错误（非本次引入）
- [x] vite build：成功
- [x] 视觉效果符合预期（毛玻璃、悬停动效、字体统一、Composer 标签）
