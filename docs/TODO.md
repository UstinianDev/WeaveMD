# TODO

> 最后更新：2026-08-29

## 已完成

### UI 美化（2026-08-29）

- ✅ 字体统一：代码块使用 `Consolas + 阿里巴巴普惠体 B`，编辑主区保持 `Consolas + 阿里巴巴普惠体`
- ✅ 工具栏毛玻璃效果：浮动工具栏、表格工具栏、图片工具栏均使用 `backdrop-filter` 毛玻璃
- ✅ 按钮悬停动效：工具栏按钮悬停 `translateY(-1px)` + `box-shadow` 发光
- ✅ Composer 标签：`/skill` 和 `@doc` 在输入框内部显示（overlay 方案）
- ✅ 浮动工具栏图标：使用 Material Design Icons 替代文字字符（12个图标）

**门禁**：tsc 0 新增 | vitest 1505/1505 | vite build ok

### AI 模块性能优化 v2（2026-08-29）

- ✅ 前端 4 组件 memo（AIMessageBubble、StepCard、ToolCallRow、ToolCallTrace）
- ✅ 后端 5 项 DB 查询优化（agentEventStore persistAndSend seq参数、touchConversation 延迟更新、getMessagesByConversation SELECT 精简、appendMessage 去除 SELECT 回读、AgentContext 缓存 summary）

**门禁**：tsc 0 新增 | vitest 1499/1499 | lint 0 新增 error

### 知识库 Notus 对齐（2026-08-25 ~ 2026-08-27，R1~R12 全部交付）

12 项需求全部完成，将 WeaveMD 知识库与 Notus 完全对齐：

- ✅ R1: Embedding 多提供商（OpenAI/Qwen/Doubao/Zhipu/自定义，自适应批量 20→10→5→2→1）
- ✅ R2: RRF 混合检索（向量+FTS5+标题三路并行 → `1/(60+rank)` 融合）
- ✅ R3: 加权策略（当前文件+标题+时效+置顶四维权重）
- ✅ R4: 段聚合（heading 提升+单文件 cap+上下文扩展）
- ✅ R5: 查询理解（5类意图+指代消解+查询扩展+模糊检测）
- ✅ R6: 条件重排（top2 差距<0.03 触发 LLM reranker，5分钟缓存）
- ✅ R7: 知识澄清（歧义检测→澄清卡片→重新检索）
- ✅ R8: 证据分级（grounded/weak/conflicting/no_evidence 四级）
- ✅ R9: 研究循环（证据不足→自动3+2子查询）
- ✅ R10: 文档上下文（top文档全文≤18K，总预算50K）
- ✅ R11: jieba分词（cut_for_search+bigram回退，替换unicode61）
- ✅ R12: 图片embedding（images_vec表+多模态embedding）

**门禁**：tsc 0 新增 | vitest 1499/1499 | lint 0 error

### @ 引用同步文件区 + 预览写入按钮移除（2026-08-27）

- ✅ @ 引用改为从 fileTreeStore 实时读取（looseFiles 排除欢迎文档 + folders 扁平化），不再走 IPC
- ✅ 移除每条 assistant 回复下方的「预览写入文档」按钮

### 写控制与任务安全模块（2026-08-24 ~ 2026-08-25，R1~R7 全部交付）

参考 Notus 项目，7 项需求全部完成：

- ✅ R1: 写模式切换（auto/manual 泛化到 editBlocks/createFile/createFolder，持久化 ai_config）
- ✅ R2: 写预览版本对比（proposal 携带 MD5，确认时二次校验，stale 拒绝静默覆盖）
- ✅ R3: Agent 交互暂停/恢复（ask_question_card → waiting_interaction → 用户回答恢复续轮）
- ✅ R4: 待处理状态 UI（QuestionCard 组件 + waiting 状态标识 + 重试入口）
- ✅ R5: 任务事件持久化（agentLoop/agentTaskWorker 全部事件 persistAndSend，渲染侧 visibilitychange replay）
- ✅ R6: IndexedDB 草稿恢复（composer 输入 300ms 防抖保存，刷新后自动恢复，按 conversationId 索引）
- ✅ R7: 已实现模块集成（DeadLoopDetector 替代硬编码 MAX_ROUNDS、每轮 checkpoint、完整文件快照、回滚 UI）

**门禁**：tsc 0 新增 | vitest 1500/1500 | lint 0 error

### Notus Agent 克隆（2026-08-24，Phase 1-5 全部交付）

深度模仿 Notus 项目的 AI Agent 功能，21 项功能全部实现：

- ✅ P0-1: Agent Session 状态机扩展（11 种状态）
- ✅ P0-2: Checkpoint/Resume 系统（断线可恢复）
- ✅ P0-3: 结构化提问卡片（ClarifyDrawer）
- ✅ P0-4: 持久化任务队列（SQLite FIFO，同会话串行）
- ✅ P0-5: preview_patch_files 工具（多文件补丁预览）
- ✅ P0-6: 文件快照+回滚
- ✅ P1-1: SSE 事件持久化+回放
- ✅ P1-2: 任务取代机制（新消息优先）
- ✅ P1-3: 死循环检测（3x 相同结果 / 2x 连续失败）
- ✅ P1-4: 联网搜索注入 Agent 循环（集成 searchClient）
- ✅ P1-5: analyze_folder 工具（目录分析）
- ✅ P1-6: Mention 预览弹窗（@ 引用预览）
- ✅ P1-7: 对话导出（Markdown）
- ✅ P1-8: 对话搜索（按标题/内容）
- ✅ P2-1: 对话历史重写（编辑消息后级联删除）
- ✅ P2-2: check_links 工具（内部链接检查）
- ✅ P2-3: get_task_activity 工具（任务活动查询）
- ✅ P2-4: 模型选择器搜索（搜索过滤）

**门禁**：tsc 0 新增 | vitest 1497/1497 | lint 0 新增 | vite build ok

### 编辑主区 v2（2026-08-06 ~ 2026-08-19）

- ✅ 块树内核重做（marktext/muya 架构，v2 唯一路径，v1 已退役）
- ✅ 前缀即时转换（`# `/`- `/`1. `/`- [ ] `/`> `/` ```lang `）
- ✅ 六条退出规则 + 退格链
- ✅ 代码块尾随保护空行持久化（SPEC-EDIT-CBTP）
- ✅ 分割线后自动空行保护（2026-08-19）
- ✅ 浮动工具栏（选区触发、块类型下拉、行内格式）
- ✅ 行内格式化（inlineLexer、双形态 toggle、橡皮擦、叠加收敛）
- ✅ 跨块鼠标拖选 + 块树级删除
- ✅ 拖选闪烁优化（SPEC-EDIT-DSF）
- ✅ 图片插入与图片工具栏（直选、对齐、缩放）
- ✅ 本地图 `media://` 协议（非 standard scheme）
- ✅ 跨块选区替换输入（beforeinput 拦截 + replaceLeafRange）
- ✅ 可编辑表格块（单元格编辑、增删行列、markdown 往返）
- ✅ 链接渲染与本地图片显示

### AI 代理面板（2026-08-14 ~ 2026-08-16）

- ✅ 第 1/2 期：基建 + Chat 闭环（llmClient、会话持久化、知情同意）
- ✅ 第 3+4 期：知识库（FTS5 召回）+ Agent 能力（工具、skills、意图识别）
- ✅ 第 5 期：块级改写（选区触发、红删绿增预览、确认写入可撤销）
- ✅ 第 6 期：KB 参数持久化 + stretch editBlocks（仅产 proposal）
- ✅ 第 7 期：体验重构（选区改写高亮、自动补全、双 Tab 合并、视觉美化）
- ✅ 后端收敛 remote-only（去除 ollama、KB 仅 FTS5）

### AI 面板体验优化（2026-08-21）

- ✅ 主界面最近会话删除按钮（🗑 图标 + 确认对话框）
- ✅ 历史会话列表视图（「查看全部」→ 全量会话列表 + 删除）
- ✅ 会话标题栏布局（会话名 + 垃圾箱 + ×）
- ✅ /compact 命令压缩上下文（含补全提示，chat/agent 双模式）
- ✅ 上下文检测组件（底栏绿/黄/红圆点 + token 估算 + 悬停 tooltip）
- ✅ 智能体模式改写消息显示（用户消息入会话 + AI 预览卡片）
- ✅ 改写预览格式优化（仅 diff 可折叠 + AI 改动说明 + 字体放大 15px）
- ✅ 编辑主区与目录区字体统一（中文楷体 + 英文 Consolas）

### AI 模块重构（2026-08-21）

- ✅ consent 逻辑统一（`@shared/ai` 统一导出，主进程/渲染进程共用）
- ✅ db/kb.ts 死代码清理（删除 float32 BLOB 工具，-36 行）
- ✅ llmClient.ts SSE 去重（提取 `processSseLines()`，-35 行）
- ✅ ipc.ts 按域拆分（771 行 → 7 个模块 + 薄 re-export）
- ✅ agentStore stream 提取（`createStreamManager()` 工厂函数，-60 行重复）

### Bug 修复（2026-08-21）

- ✅ 选区读取多行段落 `<br>` ↔ `\n` 映射（`spanTextWithNewlines` 替代 `textContent`）

### 其他

- ✅ 认证系统（注册/登录、JWT、多账号隔离）
- ✅ 文件管理（新建、软删除、文件列表）
- ✅ 导出功能（8 格式：md/html/pdf/doc/docx/png/jpg/jpeg）
- ✅ 国际化（中文简繁、英文三语言）
- ✅ 深色主题 + 5 种预设主题
- ✅ Frameless 窗口 + 自定义标题栏

## 进行中

（无）

## 待开发

- 🔲 v2 Normal 查找高亮
- 🔲 撤销/重做后光标定位优化（当前回到重建树首块）
- 🔲 段落级 MD Source 视图迁移
- 🔲 真 MCP server 管理（context7/firecrawl）
- 🔲 GitHub 自取 `writing-shape` 技能
- 🔲 pdf/docx 知识库导入（需引入解析器）

## 已知问题

- v2 Normal 模式无查找高亮（NAV-04 在 Normal 模式下不生效）
- 撤销/重做后光标回到重建树首块（非原位置）
- 5 个既有 E2E 红（drag-selection-markers.spec.ts 跨任务缺陷）
