# 前端渲染层架构

> 最后更新：2026-09-27

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 框架 | React | 18 |
| 语言 | TypeScript | ^5.4 strict |
| 样式 | TailwindCSS | ^3.4（自定义色板，禁止默认色） |
| 状态管理 | Zustand | v4 |
| 编辑器 | 自研块树内核 | v2（React-free） |
| 图标 | react-icons/md | Material Design Icons |

## 目录结构

```
src/render/
├── editor/                    # 编辑主区内核（React-free，纯 TS）
│   ├── kernel/                # 块树、双向转换、行内渲染、选区
│   │   ├── blockTree.ts       # 不可变块树数据结构
│   │   ├── blockDetection.ts  # 行前缀识别（消费 markdownSyntax）
│   │   ├── markdownSyntax.ts  # 行前缀解析（正则全含 U+00A0 分隔）
│   │   ├── markdownToState.ts # MD → 块树（无损解析）
│   │   ├── stateToMarkdown.ts # 块树 → MD（往返不变式）
│   │   ├── inlineRenderer.ts  # 行内语法渲染（加粗/斜体/链接等）
│   │   ├── outline.ts         # 大纲抽取
│   │   ├── tableCodec.ts      # 表格编解码
│   │   └── selection.ts       # 选区管理（跨块支持）
│   ├── controllers/           # 九类交互控制器 + shared/index
│   │   ├── inputCtrl.ts       # 输入处理
│   │   ├── enterCtrl.ts       # Enter 键行为
│   │   ├── backspaceCtrl.ts   # 退格行为
│   │   ├── convertCtrl.ts     # 前缀即时转换
│   │   ├── clickCtrl.ts       # 点击事件
│   │   ├── listCtrl.ts        # 列表行为
│   │   ├── formatCtrl.ts      # 行内格式化
│   │   ├── imageFormatCtrl.ts # 图片格式化
│   │   └── imageWidthCtrl.ts  # 图片宽度
│   └── editorInstance.ts      # 内核宿主（内容加载、markdown 同步）
├── components/                # UI 组件（AIAgent / Auth / Common / Editor / Feedback / Navbar / Settings）
│   └── Editor/
│       └── v2/                # v2 渲染层
│           ├── EditorV2.tsx   # 入口（状态、事件路由、焦点恢复、撤销）
│           ├── BlockRenderer.tsx + EditorScrollContainer.tsx
│           ├── blocks/        # ContentBlock.tsx（唯一 contentEditable）+ Table/Code/Quote 等
│           ├── toolbar/       # FloatingToolbar.tsx（文本浮动工具栏）
│           └── image/         # ImageToolbar + ImageResizeBox（四角等比缩放）
├── hooks/                     # 编辑器与全局 hooks（11 个）
│   ├── useGlobalShortcuts.ts / useMonacoTheme.ts
│   ├── useModeScrollPersistence.ts / useDraftFlusher.ts
│   └── useCrossBlockDragSelection.ts / useOutlineNavigation.ts ...
├── stores/                    # Zustand 状态管理（8 个）
│   ├── editorStore.ts / agentStore.ts / fileTreeStore.ts
│   ├── rewriteStore.ts / authStore.ts / uiStore.ts
│   └── historyStore.ts / recentStore.ts
├── services/                  # 业务逻辑
│   ├── saveCurrentDraft.ts    # 切换/关闭前统一保存
│   ├── markdown.ts / aiMarkdown.tsx
│   ├── searchEngine.ts / draftStore.ts / welcomeDocument.ts
│   └── fileOps.ts
├── pages/                     # AuthPage.tsx / MainPage.tsx
├── filters/                   # rewriteDiff.ts（改写 diff）
├── workers/                   # jsonParser.worker.ts
├── utils/                     # domSelectors / fontConstants / validators / weaveMDBridge ...
├── styles/
│   └── globals.css            # 全局样式 + CSS 变量
└── i18n/                      # 国际化（zh-CN.json / zh-TW.json / en.json + index.tsx）
```

## 编辑主区 v2 内核

核心设计原则：

- **仅叶子块内容 span 可编辑**：`ContentBlock` 是唯一的 `contentEditable` 表面
- **不可变块树**：块树数据结构不可变，修改时创建新树
- **无损双向转换**：MD → 块树 → MD 往返不变式
- **前缀即时转换**：`# ` / `- ` / `1. ` / `- [ ] ` / `> ` / ` ```lang ` 输入后立即转换
- **退格降级**：在内容起点按退格触发块类型降级（六条退出规则）

### 语法外观

对齐 marktext 风格：

- 标题 `#`×n 光标提示（深灰）
- 深灰列表 marker
- 引用绿色竖线
- 圆形任务复选框

### 性能优化

- `cloneTree` 精准化（仅修改路径上的节点）
- `tokenizeInline` LRU 缓存（256 条）
- outline 脏标记（避免重复计算）
- React.memo 补全
- Prism/KaTeX code splitting

## 状态管理

Zustand v4，关键 store：

| Store | 职责 | 关键状态 |
|-------|------|----------|
| `editorStore` | 编辑器内容 | `content`, `isDirty`, `undoStack`, `currentFile` |
| `agentStore` | AI 代理 | 会话列表、工具轨迹、提案（editBlocks/patch） |
| `fileTreeStore` | 文件树 | 文件夹列表、展开状态 |
| `rewriteStore` | 改写预览 | `pendingRewrite`, `staleRejected` |
| `authStore` | 认证 | `userId`, `token`, `isAuthenticated` |
| `uiStore` | 界板开关 | 侧栏、面板、Source/Rich 模式等 UI 标志 |
| `historyStore` | 编辑历史 | 历史面板列表与跳转 |
| `recentStore` | 最近打开 | 最近文件列表 |

## CSS 规范

- 颜色引用 CSS 变量：`var(--bg-primary)`, `var(--accent)` 等
- 字体栈：中文 `Alibaba PuHuiTi 2.0` / `KaiTi`（编辑区），英文 `Consolas`；AI 会话消息流（`.ai-message-stream` + `.ai-markdown`）同用编辑区 KaiTi 栈（2026-10-03，code/pre 等宽不变）
- 工具栏毛玻璃：`backdrop-filter: blur(12px) saturate(180%)`
- 禁止内联 `style={{}}`（动态值除外）
- 禁止 Tailwind 默认色（使用自定义色板）
