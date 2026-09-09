# 测试架构

> 最后更新：2026-09-09

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

e2e/                         # Playwright E2E
├── ai.spec.ts               # AI 面板 E2E
├── editor.spec.ts           # 编辑器 E2E
└── ...
```

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
| spec-edit-cbtp.tdd.md | 代码块尾随空行 TDD |
| spec-edit-dsf.tdd.md | 拖选闪烁 TDD |
