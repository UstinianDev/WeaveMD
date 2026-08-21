# AI 面板与编辑器调整 — 任务状态

## 任务分级

- **请求类型**：功能开发（多模块 UI 调整）
- **影响面**：AI 面板（home/session/composer）+ 编辑主区字体
- **预估工时**：M 级（半天内，1~3 模块）
- **裁剪理由**：纯 UI 调整，无数据迁移/权限/API 变更，跳过完整拷问/调研，直接需求对齐 + 规划 + 执行

## 需求清单

### 1. AI面板主界面
- [x] ① 最近聊天区域，每个会话右侧添加删除按钮（垃圾箱图标）
- [x] ② 点击「查看全部」进入历史会话记录页面
- [x] ③ 历史会话顶部栏布局：会话名（左侧）+ 垃圾箱（右侧）+ ×（右侧）

### 2. 会话内界面
- [x] ① /compact 命令压缩上下文（替代点击按钮，输入命令带提示）
- [x] ② 底栏添加上下文检测组件（悬停显示上下文占比）
- [x] ③ 智能体模式：选中改写内容输入需求后，消息应出现在会话中且 AI 应回复
- [x] ④ 改写预览格式：仅显示 diff（红绿区分，可折叠）+ AI 改动看法，字体放大

### 3. 编辑主区
- [x] 字体设置：中文统一楷体，英文统一 Consolas（含目录区）

## 进度

- [x] 阶段 0：任务分级
- [x] 阶段 1：需求对齐（需求文档已创建）
- [x] 阶段 2：规划（实施计划已创建）
- [x] 阶段 3~5：执行（全部 8 个需求已完成）
- [x] 阶段 6：测试（tsc 0 error | vitest 113/1492 | lint 0 error）
- [x] 阶段 7：合规核对（代码 vs 规范一致）
- [x] 阶段 8：交付核对（变更清单核对通过）

## 变更清单

| 文件 | 变更 |
|------|------|
| `src/render/components/AIAgent/AIPanelHome.tsx` | 删除按钮 + 历史会话列表 |
| `src/render/components/AIAgent/AIAgentPanel.tsx` | history 视图 + 会话删除 |
| `src/render/components/AIAgent/AIPanelComposer.tsx` | /compact 命令 + 上下文指示器 + 改写消息修复 |
| `src/render/components/AIAgent/RewritePreviewCard.tsx` | diff 可折叠 + AI 改动说明 + 字体放大 |
| `src/render/styles/globals.css` | 编辑器+目录区字体（Consolas+KaiTi） |
| `src/render/i18n/{en,zh-CN,zh-TW}.json` | 新增翻译键 |
| `tests/.../RewritePreviewCard.test.tsx` | 适配 R7 改动 |
| `tests/.../AIAgentPanel.test.tsx` | 适配 R2 改动 |
