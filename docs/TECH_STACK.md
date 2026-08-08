# WeaveMD 技术选型文档

> 版本：v2.6 | 最后更新：2026-08-08

---

## 1. 总体架构

```
┌─────────────────────────────────────────────────┐
│                  Electron Shell                  │
│  ┌───────────────────┐  ┌─────────────────────┐  │
│  │   Main Process    │  │  Renderer Process   │  │
│  │  ┌─────────────┐  │  │  ┌───────────────┐  │  │
│  │  │  SQLite DB  │  │  │  │  React 18 App │  │  │
│  │  │  IPC Bridge │◄─┼──┼─►│  Editor v2    │  │  │
│  │  │  Export     │  │  │  │  (kernel +    │  │  │
│  │  │             │  │  │  │   controllers)│  │  │
│  │  │             │  │  │  │  Zustand Store│  │  │
│  │  │             │  │  │  │  Monaco Editor│  │  │
│  │  └─────────────┘  │  │  └───────────────┘  │  │
│  └───────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## 2. 技术栈

### 2.1 桌面框架

| 技术                 | 版本     | 选型理由                                  |
| -------------------- | -------- | ----------------------------------------- |
| **Electron**         | ^31.0.0  | 跨平台桌面应用成熟方案，庞大生态          |
| **Electron Builder** | ^24.13.0 | 多平台打包（NSIS/DMG/AppImage），自动更新 |

### 2.2 前端框架

| 技术           | 版本    | 选型理由                               |
| -------------- | ------- | -------------------------------------- |
| **React**      | ^18.3.1 | 组件化、生态丰富、TypeScript 支持完善  |
| **TypeScript** | ^5.4.5  | 类型安全、IDE 支持、减少运行时错误     |
| **Vite**       | ^5.3.0  | 极速 HMR、原生 ESM、与 Electron 集成好 |

### 2.3 状态管理

| 技术        | 版本   | 选型理由                                             |
| ----------- | ------ | ---------------------------------------------------- |
| **Zustand** | ^4.5.0 | 轻量（<2KB）、无 Provider 包裹、简洁 API、中间件支持 |

选型对比：

- Redux：模板代码多，对小应用过重
- MobX：响应式模型与 React 理念不一致
- Jotai/Recoil：原子化状态，跨组件共享不便

### 2.4 编辑器

| 技术                     | 版本    | 用途                      |
| ------------------------ | ------- | ------------------------- |
| **Monaco Editor**        | ^0.55.1 | Source Code Mode 全屏编辑 |
| **@monaco-editor/react** | ^4.6.0  | React 封装                |

选型理由：VS Code 同款引擎，语法高亮/智能提示/查找替换开箱即用。

**Normal Mode（v2，2026-08-06 重做）**：采用**自研块树内核**（架构照搬
marktext/muya），不依赖 Monaco：

- `src/render/editor/kernel/`：不可变块树、Markdown 无损双向转换、行内渲染器
  （语法标记保留，`textContent` 与源一致）、光标/选区 DOM 读写、
  `syntaxType.ts`（`resolveSyntaxType` 语法类型纯函数，SPEC-EDIT-FT）
- `src/render/editor/controllers/`：input/enter/backspace/convert/click/list/format
  七类交互控制器（对齐 marktext 行为：`checkNeedRender` 按需重渲染、IME 守卫）
- 仅叶子块内容区 `contentEditable`（替代 v1 容器级），支持列表/引用嵌套
- 解析期规范化补偿（SPEC-EDIT-CBTP）：整树最后叶子为代码块时自动补尾随空段落，
  保护空行重载后不丢失（文本输出不变）
- v2 浮动工具栏（marktext 风格，SPEC-EDIT-FT v1.0）：选区触发且仅单一语法类型显示；
  自定义块类型下拉（`canConvertBlock` 矩阵 + `syntaxTypeToOption` 映射）+ 行内格式按钮
- 跨块拖选（SPEC-EDIT-FT）：rAF 节流 + 反向端点交换 + 非内容区回退，正反双向跨块；
  拖选闪烁优化（SPEC-EDIT-DSF）：端点级变化检测（静止不重建）+ selectionchange rAF 合并 +
  一致性判定短路/上限

v1（容器级 contentEditable）回退路径已退役（v2 唯一路径，2026-08-06）。

### 2.5 Markdown 处理

| 技术                 | 版本    | 用途                               |
| -------------------- | ------- | ---------------------------------- |
| **unified**          | ^11.0.0 | 统一 AST 处理管线                  |
| **remark-parse**     | ^11.0.0 | Markdown → MDAST                   |
| **remark-gfm**       | ^4.0.0  | GFM 扩展（表格、删除线、任务列表） |
| **remark-rehype**    | ^11.1.2 | MDAST → HAST                       |
| **rehype-stringify** | ^10.0.0 | HAST → HTML                        |
| **Prism.js**         | ^1.29.0 | 代码块语法高亮                     |

选型理由：unified 生态模块化、可插拔，支持自定义转换。

### 2.6 数据库

| 技术               | 版本    | 选型理由                                           |
| ------------------ | ------- | -------------------------------------------------- |
| **better-sqlite3** | ^11.6.0 | 同步 API（无回调地狱）、WAL 模式并发、嵌入式零配置 |

选型对比：

- IndexedDB：API 复杂，无 SQL 查询能力
- LevelDB：无 SQL，需自建索引
- LokiJS：纯 JS，性能不如原生 SQLite

### 2.7 认证

| 技术             | 版本   | 用途                            |
| ---------------- | ------ | ------------------------------- |
| **bcryptjs**     | ^2.4.3 | 密码哈希（纯 JS，无需原生编译） |
| **jsonwebtoken** | ^9.0.2 | JWT 令牌生成/验证               |

### 2.8 UI 框架

| 技术            | 版本   | 选型理由                             |
| --------------- | ------ | ------------------------------------ |
| **TailwindCSS** | ^3.4.4 | 原子化 CSS，开发效率高，主题系统完善 |
| **Shadcn/ui**   | —      | 可定制组件库，不锁定运行时           |

### 2.9 开发工具

| 技术                       | 版本    | 用途                      |
| -------------------------- | ------- | ------------------------- |
| **ESLint**                 | ^8.57.0 | 代码规范                  |
| **Prettier**               | ^3.3.0  | 代码格式化                |
| **Vitest**                 | ^1.6.0  | 单元测试（Vite 原生集成） |
| **@testing-library/react** | ^14.2.0 | 组件测试                  |
| **Playwright**             | ^1.x    | 真实 Chromium E2E（编辑输入/IME/富文本渲染） |

## 3. 架构决策

> 3.1-3.4 为 **v1 基线（回退路径）** 的架构决策记录；编辑主区 v2 的当前决策
> 见 [specs/editor-v2-architecture.md](./specs/editor-v2-architecture.md) 与
> [modules/04-编辑主区-Editor.md](./modules/04-编辑主区-Editor.md)。

### 3.1 双模式编辑器

| 决策     | Normal Mode                                       | Source Code Mode                    |
| -------- | ------------------------------------------------- | ----------------------------------- |
| 渲染     | Block Tree → React 组件 + contentEditable         | Monaco Editor 全屏                  |
| 格式化   | `document.execCommand` + `Range API` 直接操作 DOM | 文本插入 Markdown 语法              |
| 数据存储 | `BlockNode.renderedHtml` 缓存 DOM HTML            | `editorStore.content` 原始 Markdown |
| 导航     | `startLine` → `scrollToBlock`                     | `lineNumber` → `scrollToLine`       |

### 3.2 Block Tree 数据模型

```
BlockTree → Record<BlockId, BlockNode>
BlockNode: { id, type, sourceLines, startLine, renderedHtml, headingLevel?, fenceLanguage?, orderedIndex?, checked?, orderedListId?, ... }
```

- 不可变数据结构，所有操作返回新树
- `startLine`：1-based 行号，用于目录导航映射
- `renderedHtml`：缓存 DOM innerHTML，React 重渲染时通过 `dangerouslySetInnerHTML` 恢复富文本
- `version` 语义：仅在内容/结构变更时自增；`setBlockRenderedHtml` 不自增（缓存非内容）。渲染 useEffect 依赖 `[version]`，避免缓存写入重触发 effect 导致 O(N²) 重扫
- `lastBuiltContentRef`：内容 useEffect 据此跳过挂载时的冗余重建（`buildBlockTree` 重新生成 ID 会导致渲染 effect 捕获的旧 ID 失效）
- `pendingTypeChange`：标记待提交的 markdown 类型转换（前缀已灰化、回车才提交）。`handleBlockInput` 设置时不 bump version/不 setBlockTree（仅 DOM 灰化），`handleBlockEnter` 提交时 bump version
- `lineMarkdown.ts` 前缀检测正则 `[ \t\u00A0]` 支持非断行空格（U+00A0，中文输入法产生）；`handleBlockEnter` 无 pending 时回退 `detectMarkdownLine`（防抖未触发场景）；渲染 effect 对 heading/list 按类型重建带前缀 markdown 再渲染

### 3.3 滚动与布局

- 外层 `editor-scroll-container`：`h-full` + `overflow-y-auto`，无 padding
- 内层 `editor-content-area`：`padding: 40px 40px 100vh 40px`，contentEditable 表面
- 将 padding 放在内层避免 `border-box` 模式下压缩内容区域，确保滚动条正确反映内容大小
- HistoryPanel 文件列表使用 `.history-scroll` 专属 10px 滚动条；拖拽手柄在面板外侧（`right: -4px`）避免遮挡滚动条
- 文件夹操作 IPC：`file:write`/`file:read`/`file:delete-disk`（磁盘文件操作）、`dialog:save-file-path`（保存路径选择，含 createDirectory）、`folder:read`/`folder:create`/`folder:delete`（文件夹操作）
- 侧边栏 Tab：OutlinePanel 改为 Tab 容器（目录/文件），`fileTreeStore` 管理文件树状态，`loadFolderContents` 构建层级树（路径前缀匹配，normalize `/`）
- 文件系统同步：editorStore.saveFile 对路径型 ID（含 `/` 或 `\`）直接 `file:write` 写磁盘；handleOpenFile 用磁盘路径作 file ID；CreateDialog 弹窗选位置+填名称创建文件/文件夹

### 3.4 IPC 通信

- 白名单通道（30+个），preload 脚本桥接；新增文件系统直操作通道（`file:write`/`read`/`delete-disk`）和文件夹操作通道（`folder:read`/`create`/`delete`）
- 主进程：数据库 CRUD、文件 I/O、导出、外部链接打开（`LINK_OPEN_EXTERNAL` → `shell.openExternal`）
- 渲染进程：通过 `window.api` 调用
- 导航守卫：`will-navigate` + `setWindowOpenHandler` 阻止窗口内导航，外部链接转系统浏览器

## 4. 项目结构

```
src/
├── main/            # Electron 主进程
│   ├── index.ts     # 应用入口
│   ├── window.ts    # 窗口管理
│   ├── ipc-handlers.ts  # IPC 通道
│   ├── preload.ts   # 安全桥接
│   └── db/          # SQLite 数据访问层
├── render/          # React 前端
│   ├── editor/      # 编辑内核（v2，与 React 解耦）
│   │   ├── kernel/          # 块树、双向转换、行内渲染、selection
│   │   ├── controllers/     # 七类交互控制器
│   │   └── editorInstance.ts # 内核宿主
│   ├── components/  # UI 组件
│   │   ├── Auth/    # 认证界面
│   │   ├── Editor/  # 编辑器（v2 渲染层在 Editor/v2/，v1 保留回退）
│   │   ├── Navbar/  # 顶部导航
│   │   ├── Settings/ # 设置模态框
│   │   └── Common/  # 通用组件
│   ├── services/    # 业务逻辑（blockTree、markdown、search）
│   ├── stores/      # Zustand 状态管理
│   ├── i18n/        # 国际化资源
│   └── styles/      # 全局样式
└── shared/          # 跨进程共享类型和常量

测试：
tests/                 # Vitest 单元/组件测试
e2e/                   # Playwright 真实 Chromium E2E（vite.test.config.ts renderer-only）
```
