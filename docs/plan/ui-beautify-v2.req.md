# UI 深度美化需求文档（v2）

> 任务：ui-beautify-v2
> 分级：S-M
> 分类：优化（美化修正 + 图标替换）
> 约束：严格不可更改任何模块功能，仅作优化处理
> 参考：AGENTS.md 美化规范（Iconify 图标、无 Emoji、极客美学）

## 需求清单

### R1：Composer 标签在输入框内部
**目标**：`/skill` 和 `@doc` 标签在输入框**内部**显示（非外部）

**验收标准**：
- [x] 标签视觉上在 textarea 输入框内部
- [x] 标签有明显的高亮标记（背景色 + 圆角 + 边框）
- [x] 标签有 × 按钮可删除
- [x] 鼠标悬停标签时显示下划线
- [x] 不改变 textarea 的原生输入行为
- [x] 不改变补全菜单功能

**技术方案**：
- 使用 overlay 方案：textarea 上方绝对定位 div显示标签
- 通过 padding-top 为标签预留空间
- 标签层 pointer-events:none（除×按钮外）

### R2：代码块字体确认
**目标**：确认代码块字体正确加载

**验收标准**：
- [x] 中文：阿里巴巴普惠体 B（Bold, 700 weight）
- [x] 英文：Consolas
- [x] 语法高亮颜色明显
- [x] 适配明/暗主题

**技术方案**：
- 确认 @font-face 声明正确
- 确认 font-family 配置正确

### R3：浮动工具栏图标美化
**目标**：使用 Iconify 图标替换文字字符

**验收标准**：
- [x] 所有按钮使用 Material Design Icons（react-icons/md）替代文字字符
- [x] 图标风格统一（线条风格，符合极客美学）
- [x] 图标大小适中（16px）
- [x] active 状态图标颜色变化（var(--accent)）
- [x] disabled 状态图标置灰（opacity 0.35）
- [x] 不改变按钮功能和交互逻辑

**需要替换的图标**：
| 当前 | 目标 Iconify | 说明 |
|------|-------------|------|
| B | lucide:bold | 加粗 |
| I | lucide:italic | 斜体 |
| U | lucide:underline | 下划线 |
| S | lucide:strikethrough | 删除线 |
| </> | lucide:code | 行内代码 |
| H | lucide:highlighter | 高亮 |
| 🔗 | lucide:link | 链接 |
| 🖼 | lucide:image | 图片 |
| ∑ | lucide:sigma | 数学公式 |
| ▦ | lucide:table | 表格 |
| 解链 | lucide:unlink | 移除链接 |
| ⌫ | lucide:eraser | 橡皮擦 |

**技术方案**：
- 使用 Iconify React 组件（`@iconify/react`）
- 或使用 SVG 内联图标
- 保持 ToolbarButton 接口不变

## 已对齐问题

1. **Iconify 安装**：需要确认项目是否已安装 `@iconify/react`，如果没有需要安装
2. **图标风格**：统一使用 Lucide 图标集（线条风格，符合极客美学）
3. **标签位置**：overlay 方案是最安全的，不改变 textarea 行为

## 不在范围内

- 不改变任何组件的功能逻辑
- 不改变补全菜单的行为
- 不改变工具栏的按钮布局和交互
- 不改变 textarea 的原生行为
