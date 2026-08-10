# 进度文档：editor-codeblock-style-toolbar-inserts

> 阶段 7 交付同步 | 日期：2026-08-10 | 状态：**全部完成并验证**

## 1. 进度总览

| 阶段 | 内容 | 状态 | 证据 |
|---|---|---|---|
| 1 | grill-me 需求共识 | ✅ | requirements.md（Q1–Q5: A/自绘Modal·mac终端/本地选图/A/字号15·间距20·24） |
| 2 | 规划（@planner 空返，总指挥自产）| ✅ | plan.md |
| 3/4 | U1-U6 实现 | ✅ | 553 passed / 34 文件（含 45 新增用例）|
| 5 | 代码审查 | ✅ | Approved@Medium1+Low4，Medium 与 Low(类型) 已修复 |
| 6 | 构建验证 | ✅ | vite build 3 bundles 通过；electron-builder NSIS exit 0 → `WeaveMD Setup 1.1.0.exe`；MSI 环境项(见下) |
| 7 | 合规 | ✅ 👉 | 本文件 + compliance.md |

## 2. 单元状态

| 单元 | 内容 | 状态 | 证据 |
|---|---|---|---|
| U1 | IPC 选图 channel | ✅ | `constants.ts` DIALOG_PICK_IMAGE、`ipc-handlers.ts` handler（含 L110 `{success:false,error}`→`null` 契约修复）、`preload.ts` pickImage、`weaveMDBridge.ts` 类型 |
| U2 | 代码块 Prism 高亮 | ✅ | `fenceLanguage.ts`(新)、`inlineRenderer.ts` renderBlockHtml 读 meta、`blockTree.ts` renderBlock 透传 + updateMeta 补 renderBlock、`CodeBlock.tsx`/`ContentBlock.tsx` |
| U3 | 字号15px/内边距20·24px | ✅ | `globals.css`（.code-fence-content 15px、pre 20/24px）；ContentBlock raw fontSize 统一 CSS |
| U4 | InsertUrlModal 组件 | ✅ | `InsertUrlModal.tsx`(新)：URL输入/选文件/空URL拦截/Escape/遮罩 |
| U5 | FloatingToolbar 接线 | ✅ | link/image 分支 `window.prompt`→state 驱动 Modal；sticky/hide 短路；TB3 完成 Modal 交互适配 + TB9-TB12 新增 |
| U6 | 回归收尾 | ✅ | 见 §3 |

## 3. 验证矩阵

| 门禁 | 结果 |
|---|---|
| `npm test` | **553 passed / 34 files**（548 + IPC 5）|
| `npm run typecheck` | ✅ exit 0 |
| `npx eslint <18 变更文件>` | ✅ exit 0（globals.css 无 css 解析器，cf. 项目既有 lint 口径）|
| `npm run build` | ✅ vite build 3 bundles；NSIS 安装器 exit 0（93.1MB）|
| 密钥扫描 | ✅ 仅命中 CSS 测试局部变量名 `token` |

## 4. 审查结论（阶段 5）

- **判词**：Approved（附 Medium 1 + Low 4 + Nit 1，均不阻塞）。
- **Medium 处置**：plan.md U1 明确要求的 IPC 测试缺失 → **已补** `tests/main/ipcDialogs.test.ts`（5 用例，含无窗口/取消/空文件返回 null 四态）。
- **Low 处置**：ipc-handlers L102 无窗口时返回 `{success:false,error}` 与 preload `Promise<string|null>` 契约不符（Modal 会当真值 URL）→ **已修为 `return null`**。
- **未处理 Low（非阻塞，留作后续）**：Modal 关闭后工具栏卡死理论边角（flushSelection 分支短路）、updateMeta 双次 cloneTree 可选优化。
- **审查实测**：新增 scratch vitest（5/5）验证 高亮×contentEditable 共存 无回归（DOM→model textContent 免疫 token span、语言切换双向刷新、多 span 光标恢复、围栏不为行内化侵吞）。Scratch 已删除。

## 5. 遗留问题

| # | 类型 | 描述 | 处置 |
|---|---|---|---|
| 1 | 环境/既有配置 | MSI target 失败（`Icon:WeaveMDIcon.exe` not found）：`public/icons/` 目录为空，`win.icon` 指向不存在的 icon.png。**与本次改动无关**，自项目既有 | 后续：填充 `public/icons/icon.png`(.ico) 后验证 msi |
| 2 | 构建环境 | 本机需 Windows 开发者模式（无权限创建 symlink）electron-builder winCodeSign 才不报错；已由用户开启 ✓ | 已解决 |
| 3 | Low（审查） | FloatingToolbar flushSelection 在 insertModal 时跳过 hide 决策，极端卸载场景理论卡死 | 后续可选强化 |
| 4 | Low（审查） | updateMeta 语言变更路径双次 cloneTree | 后续可优化聚合 renderBlock 克隆 |
| 5 | 需求 §8 | 高亮降级方案（编辑时临降纯文本）**未触发**，方案 A 实证可行，无需回批 | 至此无待决 |

## 6. 下一任务建议

1. 修复既有 MSI target（补齐 `public/icons` 图标资源，.ico 格式），补全多安装器产物。
2. 处理审查 Low 3/4（工具栏 Modal 卸载边角、cloneTree 优化）。
3. 人工验收：`npm run dev` 验证 ①代码块高亮与编辑 ②🖼/🔗 Modal 插入与本地选图 ③语言切换刷新（本会话构建验证时 dev 实例已关闭）。