# notus-agent-clone — 设计决策文档

> 创建日期: 2026-08-24
> 状态: 已完成

## 一、设计约束（来自 AGENTS.md）

- 禁止紫色/靛蓝色/蓝紫渐变（#6366F1、#8B5CF6）
- 禁止纯平背景色（必须有噪点纹理或渐变）
- 禁止 Shadcn/Material UI 默认组件（必须深度定制）
- 必须口语化文案风格（像朋友聊天，每句 ≤15 字）
- 图标使用 Iconify 图标库

## 二、设计氛围锚点

**精神内核**：「《黑客帝国》— 编程语言是用来思考的」

- 极客美学：深色系、高对比、代码感、赛博朋克气质
- 命令行光标感：琥珀色主色调
- 噪点纹理：避免纯平背景

## 三、配色方案

```css
:root {
  /* 主色调 - 琥珀/橙色系（黑客帝国风格） */
  --agent-primary: #F59E0B;        /* 琥珀色 - 命令行光标感 */
  --agent-primary-hover: #FBBF24;
  --agent-primary-muted: #92400E;  /* 暗琥珀 */

  /* 表面色 - 深灰渐变 */
  --agent-surface-0: #0A0A0B;      /* 最深背景 */
  --agent-surface-1: #111113;      /* 卡片背景 */
  --agent-surface-2: #1A1A1E;      /* 悬浮层 */
  --agent-surface-3: #222228;      /* 输入框 */

  /* 文字色 */
  --agent-text-primary: #E5E5E7;
  --agent-text-secondary: #8B8B90;
  --agent-text-muted: #52525A;

  /* 状态色 */
  --agent-success: #22C55E;        /* 绿色 - 确认/应用 */
  --agent-warning: #EAB308;        /* 黄色 - 警告 */
  --agent-error: #EF4444;          /* 红色 - 删除/错误 */
  --agent-info: #3B82F6;           /* 蓝色 - 信息 */

  /* 特效 */
  --agent-glow: 0 0 10px rgba(245, 158, 11, 0.3);  /* 琥珀光晕 */
}
```

## 四、组件设计

### 4.1 ClarifyDrawer（结构化提问卡片）

**布局**：
- 顶部标题栏：⚡ AI 需要更多信息 + 关闭按钮
- 问题卡片：左侧琥珀色竖线 + 问题文本
- 选项按钮：选择题/文本输入/确认按钮
- 条件依赖：未满足时半透明 + 禁用态
- 底部操作栏：跳过 + 提交回答

**交互**：
- 卡片进入：从下方滑入 + 淡入（200ms ease-out）
- 选项选中：轻微缩放（0.95 → 1.0）+ 颜色过渡
- 条件问题出现：折叠展开动画（300ms）
- 进度指示器：顶部小圆点（1/3, 2/3, 3/3）

### 4.2 PatchPreviewDialog（多文件补丁预览）

**布局**：
- 左侧文件列表（25%宽度）：文件图标 + 名称 + 状态标签
- 右侧 Diff 视图（75%宽度）：行号 + 删除行（红色）+ 新增行（绿色）
- 底部操作栏：全部丢弃 + 应用选中 + 全部应用

**视觉**：
- 删除行：红色背景 `rgba(239, 68, 68, 0.15)` + 红色文字
- 新增行：绿色背景 `rgba(34, 197, 94, 0.15)` + 绿色文字
- 状态标签：新增（绿色）、修改（黄色）、删除（红色）
- 选中态：左侧琥珀色边框 + 背景高亮

**交互**：
- 点击文件列表项：右侧 diff 切换
- 复选框：支持部分应用
- "全部应用"按钮：确认对话框（破坏性操作）
- 键盘导航：↑↓ 切换文件，Enter 应用选中

### 4.3 MentionPreview（@ 引用预览弹窗）

**布局**：
- 文件预览：文件名 + 内容摘要（前 500 字符）+ 元数据（大小、修改时间）
- 目录预览：树形结构（2 层深度）+ 文件数量统计
- Skill 预览：描述 + 参数列表

**触发**：
- 输入 `@` 后显示补全菜单
- 悬停在补全选项上 300ms 后显示预览
- 预览弹窗定位在补全项右侧

**性能**：
- 预览缓存：Map<type+id, previewData>
- 懒加载：仅在悬停时请求
- 防抖：300ms 延迟避免频繁请求

## 五、Iconify 图标推荐

```tsx
// ClarifyDrawer
<Icon icon="mdi:lightning-bolt" />  // AI 提示图标
<Icon icon="mdi:check-circle" />     // 选中状态
<Icon icon="mdi:arrow-right" />      // 下一步

// PatchPreviewDialog
<Icon icon="mdi:file-document" />    // 文件图标
<Icon icon="mdi:folder" />           // 目录图标
<Icon icon="mdi:plus-circle" />      // 新增状态
<Icon icon="mdi:pencil" />           // 修改状态
<Icon icon="mdi:delete" />           // 删除状态
<Icon icon="mdi:check-all" />        // 全部应用

// MentionPreview
<Icon icon="mdi:file-code" />        // 代码文件
<Icon icon="mdi:folder-open" />      // 目录
<Icon icon="mdi:puzzle" />           // Skill
<Icon icon="mdi:clock-outline" />    // 时间
<Icon icon="mdi:database" />         // 大小
```

## 六、文案风格（口语化）

| 场景 | 避免 | 推荐 |
|------|------|------|
| 提问标题 | "请回答以下问题" | "AI 需要更多信息" |
| 确认操作 | "确认提交" | "搞定，继续" |
| 取消操作 | "取消" | "算了" |
| 错误提示 | "操作失败" | "哎呀，出了点问题" |
| 加载状态 | "加载中..." | "稍等，马上好..." |
| 空状态 | "暂无数据" | "这里还空着呢" |
| 成功反馈 | "操作成功" | "搞定了 ✓" |

## 七、无障碍考虑

1. **键盘导航**：
   - Tab 键在问题/选项间切换
   - Enter/Space 选中选项
   - Escape 关闭弹窗
   - 方向键在文件列表中导航

2. **屏幕阅读器**：
   - ARIA 标签：`role="dialog"`, `aria-label="文件变更预览"`
   - 状态通知：`aria-live="polite"` 用于动态内容
   - 进度：`aria-valuenow`, `aria-valuemin`, `aria-valuemax`

3. **对比度**：
   - 文字对比度 ≥ 4.5:1（WCAG AA）
   - 交互元素对比度 ≥ 3:1
   - 焦点指示器：2px 琥珀色轮廓

4. **动效偏好**：
   - 尊重 `prefers-reduced-motion`
   - 禁用动画时使用淡入淡出替代滑动
