# WeaveMD 优化实施计划

> 任务 slug: `optimize-outline-aiheading-composer`
> 分级: L 级
> 创建: 2026-09-11

---

## 变更清单

### 模块一：Outline 数据源统一

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/render/components/Editor/panels/OutlinePanel.tsx` | 修改 | 移除 v1 `extractOutline` import，改为接收 v2 `OutlineItemV2[]` props |
| `src/render/pages/MainPage.tsx` | 修改 | 新增 `outline` state，从 EditorView 接收 v2 outline，传给 OutlinePanel |
| `src/render/components/Editor/EditorView.tsx` | 修改 | 暴露 v2 outline 数据给 MainPage |
| `src/render/components/Editor/v2/EditorV2.tsx` | 修改 | 通过回调将 v2 outline 传递到 EditorView |
| `src/render/editor/kernel/outline.ts` | 不变 | 已有 v2 实现，直接使用 |

### 模块二：Agent 标题自动编号

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/render/services/aiMarkdown.tsx` | 修改 | 添加 `HeadingCounter` 类和 `addHeadingNumbering()` 函数，在 `hastToReact()` 中为 h1-h4 插入编号 span |
| `src/render/styles/globals.css` | 修改 | 添加 `.ai-heading-number` 样式 |

### 模块三：Composer /@ 标签化

| 文件 | 操作 | 说明 |
|------|------|------|
| `package.json` | 修改 | 新增 `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/suggestion` 依赖 |
| `src/render/components/AIAgent/composer/extensions/SkillTag.ts` | 新建 | SkillTag 自定义 Node 扩展 |
| `src/render/components/AIAgent/composer/extensions/MentionTag.ts` | 新建 | MentionTag 自定义 Node 扩展 |
| `src/render/components/AIAgent/composer/extensions/SkillTagComponent.tsx` | 新建 | SkillTag React NodeView 组件 |
| `src/render/components/AIAgent/composer/extensions/MentionTagComponent.tsx` | 新建 | MentionTag React NodeView 组件 |
| `src/render/components/AIAgent/composer/extensions/skillSuggestion.ts` | 新建 | /skill 补全配置 |
| `src/render/components/AIAgent/composer/extensions/mentionSuggestion.ts` | 新建 | @mention 补全配置 |
| `src/render/components/AIAgent/panel/AIPanelComposer.tsx` | 重写 | textarea → TipTap EditorContent |
| `src/render/components/AIAgent/composer/sendRoutes.ts` | 修改 | 从 ProseMirror state 解析标签 |
| `src/render/styles/globals.css` | 修改 | 添加 tag chip 样式 |

### 模块四：文件清理

| 文件 | 操作 | 说明 |
|------|------|------|
| `C:\Users\lenovo\Desktop\优化方向\Markdown_全语法完整参考.md` | 删除 | 测试文档，已完成验证 |

---

## 实施顺序

```
阶段 A（并行）:
  ├── A1: 模块一 - Outline 数据源统一
  ├── A2: 模块二 - Agent 标题自动编号
  └── A3: 模块四 - 文件清理

阶段 B（依赖 A 完成后）:
  └── B1: 模块三 - Composer /@ 标签化（需安装新依赖）

阶段 C（端到端验证）:
  └── C1: 全链路连通性测试
```

---

## 验收标准

### 模块一
- [ ] OutlinePanel 显示 v2 块树数据
- [ ] 点击标题，编辑器滚动到正确位置
- [ ] 编辑时 outline 实时更新
- [ ] 切换文件时 outline 重置

### 模块二
- [ ] h1 显示中文数字编号（一、二、三……）
- [ ] h2 显示阿拉伯数字编号（1. 2. 3.……）
- [ ] h3 显示层级编号（1.1 1.2 2.1……）
- [ ] h4 显示带圈数字编号（① ② ③……）
- [ ] 已有编号的标题不重复编号
- [ ] 编号 span 样式独立可控

### 模块三
- [ ] /skill 标签以蓝色 chip 渲染
- [ ] @file 标签以绿色 chip 渲染
- [ ] 点击标签选中整体
- [ ] Backspace 删除整个标签
- [ ] / 和 @ 触发补全菜单
- [ ] 中文 IME 输入正常
- [ ] 发送时正确解析标签

### 端到端
- [ ] EditorV2 → MainPage → OutlinePanel → 点击 → EditorV2 滚动 ✓
- [ ] Agent 输出 → parseAIMarkdown → hastToReact → 带编号 heading ✓
- [ ] 输入 / 或 @ → 补全 → 选择 → chip → 发送 → sendRoutes ✓
