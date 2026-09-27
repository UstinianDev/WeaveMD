# 测试架构

> 最后更新：2026-09-27

## 测试策略

| 层级 | 工具 | 覆盖 |
|------|------|------|
| 单元测试 | Vitest | 纯函数/工具/服务 |
| 组件测试 | Vitest + React Testing Library | UI 组件 |
| E2E 测试 | Playwright | 真实 Chromium 全流程 |
| 类型检查 | tsc --noEmit | TypeScript 严格模式 |
| 代码检查 | ESLint | 0 error |
| 构建验证 | Vite build | 生产构建 |

## 质量门禁

```
tsc --noEmit + vitest run + eslint(0 error) + vite build + npx playwright test
全绿才算完成。
```

## 目录结构

```
tests/
├── main/                    # 主进程测试
│   ├── ai/                  # AI 模块测试
│   │   ├── agentLoop.test.ts
│   │   ├── intentRouter.test.ts
│   │   ├── toolRegistry.test.ts
│   │   └── ...
│   └── db/                  # 数据库测试
├── render/                  # 渲染进程测试
│   ├── editor/              # 编辑器测试
│   │   ├── kernel/          # 内核测试
│   │   │   ├── blockTree.test.ts
│   │   │   ├── markdownToState.test.ts
│   │   │   ├── stateToMarkdown.test.ts
│   │   │   └── inlineRenderer.test.ts
│   │   └── controllers/     # 控制器测试
│   └── components/          # 组件测试
└── shared/                  # 共享模块测试

e2e/                         # Playwright E2E（16 个 spec）
├── ai-agent-panel.spec.ts   # AI 面板 E2E（31 条）
├── editor.spec.ts           # 编辑器 E2E
├── floating-toolbar.spec.ts # 浮动工具栏 E2E
├── editor-table.spec.ts     # 可编辑表格块 E2E
├── exit-behavior.spec.ts    # 前缀退出规则 E2E
├── drag-selection-*.spec.ts # 跨块拖选（3 个）
├── cross-block-*.spec.ts    # 跨块选区/替换（2 个）
├── feedback / image-resize / link-editing-regression /
│   marktext-rendering / recent-history-restore /
│   thematic-break / welcome-doc .spec.ts
└── fixtures/                # 共享 mock（installWeaveMDMock 等）
```

**当前规模（2026-09-24 实测）**：单元/组件 **3226 passed / 0 failed（138 文件）**；
E2E 全量 **31 failed / 1 skipped / 97 passed**（基线 112 failed / 20 passed），
其中 10 条为已知/预期失败（见 `docs/TODO.md` 已知问题）。

## 测试命令

| 命令 | 说明 |
|------|------|
| `npm run test` | Vitest 单元测试 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 代码检查 |
| `npx playwright test` | Playwright E2E |

## TDD 三档

| 档位 | 流程 | 覆盖率 |
|------|------|--------|
| L / strict | RED → GREEN → 重构 → 覆盖率 ≥80% | 强制 |
| M / standard | RED → GREEN → 重构 → 覆盖率记录 | 不强制 |
| S / light | 新行为核心测试先行 + 回归通过 | 不强制 |

## 测试报告

测试报告存储在 `docs/testing/` 目录：

| 报告 | 说明 |
|------|------|
| spec-edit-ft.tdd.md | 浮动工具栏 TDD |
| spec-edit-ft2.tdd.md | 行内格式 TDD |
| spec-edit-ft3.tdd.md | 叠加收敛 TDD |
| spec-edit-ft4.tdd.md | 跨风格叠加畸形修复 TDD |
| spec-edit-cbtp.tdd.md | 代码块尾随空行 TDD |
| spec-edit-dsf.tdd.md | 拖选闪烁 TDD |
| agent-cost-optimize.tdd.md | Agent 成本降低 TDD（M/standard + 基线对照 + 13 条偏离） |
| doc-pipeline-b1.tdd.md ~ doc-pipeline-b11.tdd.md | 文档处理流水线 11 批 TDD（解析/上传/持久化/入库/检索/多模态/版面/工具引用/文件树/体积/外发闸） |
| doc-pipeline.final.md | doc-pipeline 五门禁收口（tsc / vitest / lint / build / E2E 基线零新增） |
| doc-pipeline-remedial.tdd.md | 遗留修复批次 TDD（Bug A/B + R3~R8） |
