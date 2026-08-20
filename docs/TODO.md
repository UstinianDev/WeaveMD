# TODO

## 已完成

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

### 其他

- ✅ 认证系统（注册/登录、JWT、多账号隔离）
- ✅ 文件管理（新建、软删除、文件列表）
- ✅ 导出功能（8 格式：md/html/pdf/doc/docx/png/jpg/jpeg）
- ✅ 国际化（中文简繁、英文三语言）
- ✅ 深色主题 + 5 种预设主题
- ✅ Frameless 窗口 + 自定义标题栏

## 进行中

- 🔵 HR 块后自动空行保护（已完成实施，待验证）

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
