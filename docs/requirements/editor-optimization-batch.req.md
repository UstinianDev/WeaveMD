# editor-optimization-batch — 需求交接文档（5 项优化/功能）

> 2026-08-16 | grill-me 已对齐（AskUserQuestion 一次确认）
> 本文件为**新会话交接输入**：用户将以 `/devflow-core` 启动，提示词见 `docs/plan/editor-optimization-batch.status.md`。
> 建议 slug：`editor-optimization-batch`（或按实际拆分）。5 项彼此独立，可拆分子任务并行。

## 需求总览（5 项，优先级由用户后续确定）

| # | 类型 | 需求 | 代码现状（已查证） |
|---|---|---|---|
| ① | 性能 bug | 跨块向上拖选不同语法类型内容时光标持续闪烁卡顿 | 已有 rAF 节流+端点级去重+500 叶上限；疑点 `resolveSyntaxTypesInRange` 无缓存 + mouseup 3 帧 replay |
| ② | UI/动画 | 登录页左侧四小人物动画（参考 careercompass） | 左栏已有 `InteractiveMascot` SVG 吉祥物（眼睛跟随+7 状态），纯 CSS 无动画库 |
| ③ | 功能 | 顶部导航栏「编辑历史」实现 + 恢复整个文件树 | `HistoryMenu`/`HistoryPanel`/`historyStore` 已存在但非「最近打开」；`fileTreeStore` 无 persist |
| ④ | 功能 | 内置全量 markdown 语法欢迎文档，每次启动注入 | 无欢迎文档机制；编辑区空态「Open or create a file」 |
| ⑤ | 功能 | 帮助菜单加「问题反馈」，多图+确认发送到 2762943351@qq.com | HelpMenu 仅「设置+版本」；主进程无邮件能力（需 nodemailer） |

---

## ① 跨块向上拖选闪烁卡顿（性能）

### 目标
鼠标从下往上选**不同语法类型不同段落**（如 list+heading+paragraph 混合跨块）时，消除「内容光标持续渲染闪烁、卡顿」。

### 现状（已查证）
- `useCrossBlockDragSelection.ts:106-169` 已有 rAF 节流（`createRafThrottle` L171）+ 端点级去重（`areRangeEndpointsEqual` L153-167）+ 静止不写。
- `FloatingToolbar.tsx:316-324` selectionchange 已 rAF 合并（≤每帧一次）。
- **疑点 1**：`toolbarState.ts:117` 跨块时每帧调 `resolveSyntaxTypesInRange`（`syntaxType.ts:95-117`），从 `startLeafId` 沿 `getNextLeaf` 走链到 `endLeafId` **无缓存**——长文档混合选区每帧重扫全链，最可能卡顿源。
- **疑点 2**：`useCrossBlockDragSelection.ts:223-248` mouseup 3 帧 replay 与原生拖选竞争，反复 `addRange` 可能造成闪烁。
- 反向拖选端点交换（L141-144）本身被显式处理，非主因。

### 决策（对齐确认）
- 定位优化 `resolveSyntaxTypesInRange` 缓存（按 (startLeafId,endLeafId) memo 或短路），排查 mouseup replay 竞争。

### 验收标准
- 向上跨块选不同语法类型段落：光标不持续闪烁、无明显卡顿。
- `resolveSyntaxTypesInRange` 对同一区间重复调用不重扫（缓存命中）。
- 门禁：tsc 0 / vitest 全绿 / lint 0 / Playwright 新增拖选回归（跨语法混合选区）全绿。
- 既有拖选行为（`e2e/cross-block-selection.spec.ts`、drag-selection-move 等）不回归。

---

## ② 登录页左侧四小人物动画（UI）

### 目标
登录/注册页左侧改为 **careercompass 风格四小人物动画**，增强趣味性。

### 参考项目（careercompass）
- 源码 `https://github.com/arsh342/careercompass`（演示 `careercompassai.vercel.app/login`）。
- 四角色交互：① 眼睛跟随鼠标（计算角度+限制瞳孔位移）；② 输入邮箱时角色变高/互相对视；③ 输入密码时角色遮眼/转头回避（保护隐私）；④ 显示密码时角色偷看；⑤ 登录失败沮丧摇头；⑥ 按钮悬停文字滑出+箭头滑入。
- 技术：React/TSX + CSS 图形（圆角矩形/半圆绘制）+ CSS transitions/keyframes + mousemove/focus/blur 驱动。纯 CSS，无动画库。

### 现状（已查证）
- 左栏已存在：`AuthPage.tsx:30-38`（`hidden md:flex w-[45%]` + 渐变 + 3 blur 圆 + `<InteractiveMascot>`）；`InteractiveMascot.tsx` 是 SVG 吉祥物（眨眼/眼随鼠标/typed/success/error 等 7 状态）。
- 右栏表单 `max-w-[380px]`，Tailwind 紫色系（未走 CSS 变量主题）。

### 决策（对齐确认）
- **完整复刻四角色**：用 careercompass 四角色**替换**现有 `InteractiveMascot`，含全部交互（眼随鼠标/邮箱变高对视/密码遮眼回避/显示偷看/失败沮丧摇头）。纯 CSS 无新依赖。

### 验收标准
- 登录/注册页左栏渲染四个 CSS 小人物。
- 眼睛跟随鼠标；邮箱输入→变高/对视；密码输入→遮眼回避；显示密码→偷看；登录失败→沮丧摇头。
- 明暗主题、不同窗口宽度（md 以下隐藏左栏）正常。
- 表单功能（登录/注册/校验/错误提示）不回归。
- 门禁：tsc 0 / vitest 全绿（新增 InteractiveMascot/四角色组件测试）/ lint 0 / Playwright（auth 相关）全绿。

---

## ③ 顶部导航栏「编辑历史」实现 + 恢复整个文件树（功能）

### 目标
1. 实现顶部导航栏「编辑历史」（`navbar.history`）功能——真正的「最近打开文件」列表，重启保留。
2. **恢复整个文件树**——重启后自动恢复上次打开的文件夹树 + 当前编辑文件。

### 现状（已查证）
- `HistoryMenu.tsx`（`navbar.history` 菜单）：`files` 来自 `useHistoryStore.files`（TopBar.tsx:58），`loadHistory` 从 DB `file.list(userId)` 拉**全部文件**，按 `name.localeCompare` 排序——**不是「最近打开」**。
- `HistoryPanel.tsx`（`history.manageFiles` 滑出面板）：搜索+删除，打开时 `loadHistory`。
- `useNavbarActions.handleHistoryOpenFile`（L230-238）：`saveCurrentDraftIfNeeded` + `openFile`，打开链路可用。
- `fileTreeStore.ts:101-103`：`looseFiles`/`folders` 仅内存，**无 zustand persist** → 重启清空。
- `uiStore` 有 `persistSettings`（localStorage 先例），`editorStore.currentFile` 无 persist。
- 磁盘路径文件以 path 为 id 走实时同步（`editorStore.ts:60-76`）。

### 决策（对齐确认）
- **两者都要**：① 实现「编辑历史」为最近打开（时间倒序，persist）；② 重启恢复整个文件树。
- 复用现有 `handleHistoryOpenFile`/`openFile`/`loadFolderContents` 链路。

### 验收标准
- 顶部导航栏「编辑历史」按最近打开时间倒序；点击打开对应文件。
- 重启应用后「编辑历史」列表保留。
- 重启后文件树恢复上次打开的文件夹结构 + 文件；若磁盘路径失效（文件被删/移动）优雅跳过并提示，不崩溃。
- 当前编辑文件重启后可恢复打开（或至少恢复文件树）。
- 门禁：tsc 0 / vitest 全绿 / lint 0 / Playwright（重启恢复）全绿。

---

## ④ 内置全量 markdown 语法欢迎文档（功能）

### 目标
内置一份覆盖**全部 markdown 语法**的欢迎/示例文档；每次进入应用左侧文件模块和编辑区**优先展示**；可删除，但重新进入还会出现（每次启动注入）。

### 现状（已查证）
- 无欢迎文档/静态 md 资源；`MainPage.tsx:160-177` 空态「Open or create a file to start editing」。
- `editorStore.currentFile` 初始 null；`fileTreeStore` 无 persist。
- 无「示例文件再生」先例，需新建种子逻辑。

### 决策（对齐确认）
- **每次启动注入**：应用启动时若左侧无文件树 → 自动注入内置 welcome.md 到文件树 + 编辑区默认打开；用户可删除（从树移除），但重启后再次注入。

### 待补充（实现期确认）
- 「全部 markdown 语法」内容清单：标题/段落/强调/列表（有序无序任务）/引用/代码块(带语言)/表格/图片(含本地 media://)/链接/分割线/数学 KaTeX/高亮/行内代码/图片缩放 等——**以编辑器实际支持语法为准**，避免展示未实现语法。
- 「可删除但重启出现」的具体语义：注入为独立入口（如「欢迎文档」可被删除，重启重建）；删除的是否影响用户真实文件。

### 验收标准
- 新增内置欢迎文档资源（如 `src/render/assets/welcome.md`）。
- 启动空态时自动注入文件树 + 编辑区展示；内容覆盖编辑器实际支持的全部 markdown 语法。
- 删除后重启再次注入。
- 不污染用户真实文件/文件夹（注入项可识别、可独立删除）。
- 门禁：tsc 0 / vitest 全绿 / lint 0 / Playwright（首启注入）全绿。

---

## ⑤ 帮助菜单「问题反馈」→ 邮箱（功能）

### 目标
顶部导航栏「帮助」中**设置下方**加入「问题反馈」：用户填描述、**可添加多张图片**、确认发送后**统一发送到 2762943351@qq.com**。

### 现状（已查证）
- `HelpMenu.tsx:15-30`：仅「设置」+「版本号」两项，无反馈项。
- 主进程**无邮件能力**（无 nodemailer/smtp/sendgrid 库）；IPC 无 mail 通道。
- 图片纯本地 `media://`（`media-protocol.ts`），无上传到服务器通道。
- i18n 无 feedback 相关键。

### 决策（对齐确认）
- **QQ 邮箱 SMTP 自收**：用 2762943351@qq.com 自身 SMTP（QQ 邮箱 SMTP 服务器 + 授权码）发给自己；授权码存应用设置（safeStorage 加密存 SQLite，**不 hardcode**，遵循 SECURITY.md）。图片作为邮件附件。
- 表单：问题描述 + 多图（本地选图，最多 N 张待定）+ 确认发送。

### 关键实现约束
- 主进程新增 `mail/send` IPC 通道（preload + ipc-handlers）+ nodemailer（新依赖）。
- SMTP 授权码：safeStorage 加密存 SQLite（仿 AI key 先例 `db/ai.ts` + `secureConfig.ts`），设置界面填授权码，不落渲染明文。
- 图片：本地路径读取 → 作为附件 base64 内嵌或 SMTP 附件；需校验大小/类型/数量上限。
- 发送失败（网络/授权码错误/超时）→ 明确错误提示，不静默。
- 帮助菜单「设置」下方插入「问题反馈」入口；i18n 三个 JSON 补键。

### 验收标准
- 帮助菜单出现「问题反馈」（设置下方）。
- 表单可填描述 + 添加多张图片 + 确认发送；发送后成功/失败明确提示。
- 邮箱 2762943351@qq.com 收到含描述+附件图片的邮件。
- 授权码加密存储，不落明文/不 hardcode。
- 门禁：tsc 0 / vitest 全绿 / lint 0 / Playwright（反馈表单流程）全绿。

---

## 范围外 / 另开任务
- 拖选卡顿的深度重架构（非本批，先做缓存+replay 最小修复）。
- 邮箱发送的通用化（多收件人/HTML 模板/发送历史）——本批仅单收件人基础发送。
- 内置文档的多语言版本 / 用户可编辑内置文档。
- 上述 5 项彼此独立，可拆 5 个子任务并行（各有独立文件面，仅 ③ 涉及 persist/文件树，④ 涉及 MainPage 空态）。

## 门禁总则（每项子任务）
- `npm run typecheck` 0 error | `npm run test` 全绿 | `npm run lint` 0 error | `npx vite build` 三包成功 |
  `npx playwright test` 全绿（新增用例 + 既有 115 不回归；drag-selection-markers 5 个已知 RED 为任务外）。
- 任务外既有阻塞（不处理，另开任务）：electron-builder MSI 缺图标（`public/icons/icon.png` + author 元数据）、
  drag-selection 5 RED。
