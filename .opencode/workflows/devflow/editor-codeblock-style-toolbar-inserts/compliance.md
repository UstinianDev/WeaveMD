# 合规检查报告：editor-codeblock-style-toolbar-inserts

> 阶段 7 合规核查 | 日期：2026-08-10 | 判定：**通过（无阻断项）**

## 1. 硬性规则逐条核查

| 规则 | 核查 | 结论 |
|---|---|---|
| 不提交密钥/API Key/密码/Token/.env | diff 扫描仅命中 CSS 测试局部变量 `token`；无 `.env`/密钥文件 | ✅ |
| 不删除测试 | 全程 0 删除；新增 45 用例（TB9-TB12/IPC 5/高亮与 CSS 等）+ TB3 **必要适配**（prompt mock→Modal 交互，属需求直接目标，已列入 plan.md R4 决策并获批） | ✅ |
| 不削弱认证/权限 | 未触碰任何认证、鉴权、登录逻辑；IPC 仅**新增**只读文件对话框通道 | ✅ |
| 不擅自改历史迁移 | 无数据库迁移改动 | ✅ |
| 不暴露库/内部服务/管理接口到公网 | 新增 channel 均为 Electron main↔renderer 本地 IPC，无网络暴露 | ✅ |
| 不自动部署/不改生产数据 | 无部署动作；`release/` 产物已 gitignore | ✅ |
| 不确定时请求确认 | 构建收口、MSI 处置、进程关闭均经用户确认 | ✅ |
| 已完成同步文档/进度/证据 | progress.md（状态/证据/遗留/下一任务）已写 | ✅ |

## 2. 范围核查（git diff）

- **15 改 + 4 新增**，全在需求 §5 范围内：
  - 改：`ipc-handlers.ts` `preload.ts` `weaveMDBridge.ts` `constants.ts` `FloatingToolbar.tsx` `blocks/CodeBlock.tsx` `blocks/ContentBlock.tsx` `kernel/blockTree.ts` `kernel/inlineRenderer.ts` `globals.css` + 5 测试文件
  - 新增：`fenceLanguage.ts` `InsertUrlModal.tsx` `insertUrlModal.test.tsx` `tests/main/ipcDialogs.test.ts`
- 越界：无（weaveMDBridge.ts +1 为类型完整性的必要连带，审查确认合理）。

## 3. 代码审查关注点

| 关注点 | 结果 |
|---|---|
| 测试覆盖 | 新增 45 用例真实覆盖（高亮 HTML/token/别名/plaintext 回退、Modal 交互、IPC 三态、CSS 断言）；scratch 5/5 实证 contentEditable 共存无回归 |
| 安全回退 | Prism XSS：`highlightCode`/`escapeHtml` 实测转义 `<`/`>` 无裸标签；plaintext 及无 grammar 前置守卫回退 ✅ |
| 绕过权限/泄露敏感信息/密钥 | 无 |
| N+1 查询 | 无数据库查询改动 |
| 数据迁移/部署风险 | 无 |
| 修改无关文件 | 无（§2） |

## 4. 构建与质量门禁

- test 553 ✅ · typecheck ✅ · eslint ✅ · vite build ✅ · electron-builder(NSIS) exit 0 ✅
- 遗留（与本次无关）：MSI target 因 `public/icons` 空（`icon.png` 缺失）失败；本机需开发者模式以过 winCodeSign symlink（用户已开启）。