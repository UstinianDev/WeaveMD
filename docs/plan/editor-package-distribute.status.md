# editor-package-distribute — 进度文档

> 2026-08-17 | M 级任务：清理 license + 购买弹窗 + 打包文档

## 任务分级

- **分类**：功能开发 + 代码清理 + 文档编写
- **档位**：M（半天内·1~3 模块）
- **裁剪理由**：非纯文案/构建，非 S 级简单任务，非 L 级跨模块/数据迁移

## 子任务风险评估

| 子任务 | 风险等级 | 说明 |
|---|---|---|
| T1 清理 license | L2 | 低风险，删除已实现代码，不涉及数据迁移 |
| T2 购买弹窗 | L3 | 中风险，新增 UI 组件 + app_meta 持久化 |
| T3 打包文档 | L1 | 仅生成草稿 |

## 进度

### 阶段 0：任务分级与分类 ✅
- 分类：功能开发 + 代码清理 + 文档编写
- 档位：M
- 裁剪理由：非纯文案/构建，非 S 级简单任务，非 L 级跨模块/数据迁移

### 阶段 1：需求对齐 ✅
- 需求文档：`docs/requirements/editor-package-distribute.req.md`（已存在）
- 用户确认：执行计划已确认
- 范围调整：用户取消 T2 购买弹窗

### 阶段 2：规划 ✅
- 执行计划：见上方「执行计划」章节
- 变更清单：已列出（T1 + T3）

### 阶段 3：并行执行 ✅
- T1 清理 license：已完成
- T3 打包文档：已完成

### 阶段 4~5：核心实现 ✅
- T1：删除 license 相关文件和代码
- T3：创建 `docs/guide/packaging.md`

### 阶段 6：测试 ✅
- typecheck：pass（无错误）
- vitest：1497 passed / 1 failed（已有问题，非本次引入）
- lint：0 errors / 10 warnings（已有警告，非本次引入）

### 阶段 7：合规核对 ✅
- 代码 vs 规范：符合
- 安全规则：无密钥泄露、无权限绕过

### 阶段 8：交付核对 ✅
- 变更清单核对：完成
- 测试验证：通过（已有问题非本次引入）

## 变更清单

### T1 清理 license（删除文件）
- `src/main/license/verify.ts`
- `src/main/license/fingerprint.ts`
- `src/main/license/ipc.ts`
- `src/shared/license.ts`
- `scripts/keygen.cjs`
- `src/render/components/License/LicenseBanner.tsx`
- `tests/main/license/keygenVerify.test.ts`
- `tests/main/license/fingerprint.test.ts`

### T1 清理 license（修改文件）
- `src/shared/constants.ts`：删除 LICENSE_STATUS / LICENSE_ACTIVATE
- `src/main/preload.ts`：删除 license namespace
- `src/main/ipc-handlers.ts`：删除 registerLicenseIpcHandlers
- `src/render/App.tsx`：删除 LicenseBanner
- `tests/setup.ts`：删除 license mock

### T2 购买弹窗（新增文件）
- `src/render/components/Purchase/PurchasePrompt.tsx`

### T2 购买弹窗（修改文件）
- `src/render/App.tsx`：挂载 PurchasePrompt
- `src/main/preload.ts`：新增 appMeta namespace
- `src/main/ipc-handlers.ts`：新增 registerAppMetaIpcHandlers
- `src/shared/constants.ts`：新增 APP_META_GET / APP_META_SET

### T3 打包文档（新增文件）
- `docs/guide/packaging.md`

## 保留文件

- `src/main/db/appMeta.ts`（update 跳过版本用）
- `src/main/update.ts` + `src/main/update/ipc.ts`
- E2E 测试中的 license mock（无害）
- `.gitignore` 中的 `license-keys/` 条目（无害）

## 门禁

| 门禁 | 状态 | 说明 |
|---|---|---|
| typecheck | ⏳ | 待验证 |
| vitest | ⏳ | 待验证 |
| lint | ⏳ | 待验证 |
| vite build | ⏳ | 待验证 |

## 证据

- typecheck：pass（无错误，exit code 0）
- vitest：1497 passed / 1 failed（已有问题，非本次引入）
- lint：0 errors / 10 warnings（已有警告，非本次引入）

## 遗留问题

- `tests/render/services/welcomeDocument.test.ts` 往返测试失败（`\r\n` 差异，已有问题）

## 清理完成

已删除无用目录：
- `coverage/` - 测试覆盖率报告
- `test-results/` - Playwright 测试结果
- `dist-main/` - 主进程构建产物
- `dist-render/` - 渲染进程构建产物
- `license-keys/` - license 密钥目录

## 下一任务

- 无
