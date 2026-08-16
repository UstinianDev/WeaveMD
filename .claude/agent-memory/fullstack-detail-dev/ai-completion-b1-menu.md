---
name: ai-completion-b1-menu
description: AI 面板 / 与 @ 补全的架构决策、CompletionMenu capture 键盘协议、listSkills IPC 只读 + 渲染数据流、测试 mock 与 e2e 选坑
metadata:
  type: project
---

# Phase-7 B1 `/` 与 `@` 自动补全（commit d236068）

## 数据流：技能清单（主进程 → 渲染）
- `src/shared/constants.ts` `IPC_CHANNELS.AGENT_SKILLS_LIST='agent:skills:list'`（只读 invoke）。
- `src/main/ai/skillLoader.ts` 新增 `listSkillsForUi(userDataSkillsDir?)` → `[{name,description}]`（复用 `loadSkills`，**map 只取 name/description，剥离 instructions/argsSchema**，避免执行细节经 IPC 外泄）。
- `src/main/ai/ipc.ts` handler：payload `{userId}`（空校验），userData 路径 `join(app.getPath('userData'), 'skills')`。非按户数据（内置+全局 userData/skills），userId 仅作参数。
- preload `ai.listSkills(userId)` + weaveMDBridge noop 返回 3 内置技能 + tests/setup mock `ai.listSkills: vi.fn()`。

## CompletionMenu 交互协议（关键决策）
- **父级（AgentTab）拥有 `activeIndex` 状态，CompletionMenu 纯展示**。props：`open/trigger/title/items/activeIndex/onMove(dir)/onSelect(item)/onClose`。
- **键盘导航用 document capture 阶段 keydown**（`{capture:true}`）：优先于 textarea 的 React 委托（root 冒泡）——这样 Enter 在菜单打开时由菜单确认选中，textarea 的 Enter→send 被 capture preventDefault 拦下，不会冲突发送。textArea onKeyDown 仍需 guard `if (completionOpen) { e.preventDefault(); return; }` 防双触发。
- 外部点击关闭：`mousedown` document 监听 `menuRef.contains(target)`；item 上 `onMouseDown e.preventDefault()` 防 textarea blur 误触发关闭。
- ↑/↓ 循环取模在父级 `handleCompletionMove`（`(prev+dir+len)%len`）。

## AgentTab composer 补全检测
- 正则 `/(^|\s)([/@])([^\s/@]*)$/` 匹配「光标处 token 以 / 或 @ 开头」。多词后缀过滤用 `insertText.slice(1).includes(query)`。
- **陷阱**：挂载异步加载 skills，首挂载空技能时输入 `/` 菜单不弹。需 `useEffect` 依赖 `[skills]` 重调 `refreshCompletion(input)` 重估。
- **陷阱**：`window.weaveMD?.ai.listSkills(...)` 在 vitest setup 里是 `vi.fn()` 返回 undefined → `.then` 崩。mount effect 必须用 async IIFE + `await`（`await undefined` 卫住），不能 `.then` 链。
- handleSend 分流顺序（/ 与 @ 前缀优先于 WRITE_WHOLE_DOC_RE）：selectionContext → `SLASH_SKILL_RE.test`(`^/[a-z_]+\s+`) 剥前缀 → sendAgentMessage → `@文档` → startDocumentRewrite → `@知识库` → sendAgentMessage(kbQa 意图) → 通用 `@` → WRITE_WHOLE_DOC_RE → sendAgentMessage。
- 补全前缀常量：`DOC_SCOPE_PREFIX='@文档'`、`KB_SCOPE_PREFIX='@知识库'`；`/技能名 ` 插入前缀带尾随空格（防再开菜单）。

## i18n & 测试坑
- 新增 `ai.completion.*`（skillsTitle/refTitle/currentDoc(+Desc)/kbDoc(+Desc)），en/zh-CN/zh-TW 三文件键集一致。
- CompletionMenu `beforeEach(() => vi.clearAllMocks())` 简写箭头返回 VitestUtils → TS2322；须用块体 `{ vi.clearAllMocks(); }`。
- `vi.hoisted(() => ({ listSkillsForUi: vi.fn(() => [...]) })).mock.calls[0]` 类型为 tuple `[]`，取参需 `as unknown[]` 再 `[0]`。
- e2e 断言 user 气泡文本用 `getByText('x', { exact: true })`——assistant 回显同文本时非 exact 会 strict violation 命中 2 元素。

相关：[[ai-main-process-layer]]、[[feedback-ai-renderer-security]]
