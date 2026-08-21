# AI 面板与编辑器调整 — 实施计划

## 1. 变更清单

### 1.1 AI面板主界面

| 文件 | 变更内容 |
|------|----------|
| `src/render/components/AIAgent/AIPanelHome.tsx` | 添加删除按钮、历史会话列表视图 |
| `src/render/components/AIAgent/AIAgentPanel.tsx` | 添加历史会话视图状态管理 |
| `src/render/i18n/zh-CN.json` | 添加新翻译键 |
| `src/render/i18n/zh-TW.json` | 添加新翻译键 |
| `src/render/i18n/en.json` | 添加新翻译键 |

### 1.2 会话内界面

| 文件 | 变更内容 |
|------|----------|
| `src/render/components/AIAgent/AIPanelComposer.tsx` | 添加 /compact 命令支持、上下文检测组件 |
| `src/render/components/AIAgent/AIPanelSession.tsx` | 移除压缩上下文按钮（可选） |
| `src/render/components/AIAgent/RewritePreviewCard.tsx` | 优化改写预览格式 |
| `src/render/components/AIAgent/AgentTab.tsx` | 确保改写消息正常显示 |
| `src/render/stores/agentStore.ts` | 添加 /compact 命令处理逻辑 |

### 1.3 编辑主区

| 文件 | 变更内容 |
|------|----------|
| `src/render/styles/globals.css` | 修改编辑器字体设置 |

## 2. 实施步骤

### 阶段 1: AI面板主界面 (R1-R3)

1. **AIPanelHome.tsx**:
   - 在最近会话项右侧添加删除按钮（垃圾箱图标）
   - 添加删除确认对话框
   - 添加历史会话列表视图（显示所有会话）
   - 实现视图切换逻辑

2. **AIAgentPanel.tsx**:
   - 添加 `history` 视图状态
   - 实现历史会话视图的渲染逻辑
   - 处理会话删除后的状态更新

3. **i18n 文件**:
   - 添加翻译键：`ai.home.delete`, `ai.home.deleteConfirm`, `ai.history.title` 等

### 阶段 2: 会话内界面 (R4-R7)

1. **AIPanelComposer.tsx**:
   - 添加 /compact 命令检测和处理
   - 实现命令提示（输入 / 时显示 compact 选项）
   - 添加上下文占比指示器
   - 实现悬停 tooltip 显示 token 使用情况

2. **agentStore.ts**:
   - 添加 `handleCompactCommand` 方法
   - 实现上下文压缩逻辑

3. **RewritePreviewCard.tsx**:
   - 移除「改写后整段输出」部分
   - 添加 diff 折叠/展开功能
   - 添加 AI 改动说明区域
   - 调整 diff 字体大小（13px → 15px）

4. **AgentTab.tsx**:
   - 确保改写消息正常显示在会话中

### 阶段 3: 编辑主区字体 (R8)

1. **globals.css**:
   - 修改 `.editor-scroll-container` 的 `font-family`
   - 设置中文字体为楷体（KaiTi）
   - 设置英文字体为 Consolas
   - 确保混合内容自动切换字体

## 3. 验收标准

### 功能验收

- [ ] R1: 最近会话删除按钮正常工作，有确认对话框
- [ ] R2: 「查看全部」进入历史会话列表，显示所有会话
- [ ] R3: 历史会话顶部栏布局正确（标题+垃圾箱+×）
- [ ] R4: /compact 命令正常触发压缩，有命令提示
- [ ] R5: 上下文占比指示器正常显示，悬停有 tooltip
- [ ] R6: 智能体模式改写消息正常显示和回复
- [ ] R7: 改写预览仅显示 diff，可折叠，字体放大
- [ ] R8: 编辑主区中文字体为楷体，英文为 Consolas

### 质量门禁

- [ ] TypeScript 类型检查通过（0 errors）
- [ ] 所有现有测试通过
- [ ] ESLint 检查通过（0 errors）
- [ ] Vite 构建成功

## 4. 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 删除会话误操作 | 低 | 添加确认对话框 |
| /compact 命令与现有命令冲突 | 低 | 检查命令前缀唯一性 |
| 字体设置影响其他组件 | 低 | 使用特定选择器限定范围 |
| 改写预览格式变更影响用户体验 | 中 | 保留折叠功能，用户可展开查看 |

## 5. 依赖关系

- R1-R3 相互独立，可并行开发
- R4-R5 相互独立，可并行开发
- R6 依赖改写流程现有实现
- R7 依赖 RewritePreviewCard 组件
- R8 独立，可随时实施

## 6. 测试策略

- 单元测试：覆盖新增的工具函数（如 /compact 命令解析）
- 组件测试：覆盖新增的 UI 交互（删除确认、命令提示）
- 集成测试：验证改写流程完整性
- E2E 测试：验证用户交互流程
