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

## 测试报告（TDD 证据）

**约定**：`{规格名}.tdd.md`，按模块归入子文件夹；超长报告再拆 `{同名}/NN-主题.md` 分册。
devflow 任务完成时，需求 / 计划 / 测试报告一并提交，**归档在 git 历史**（`docs/` 不再保留期正文）。

**报告索引**：[docs/testing/README.md](../testing/README.md) —— 含「任务 → 报告 → 主要测试文件」映射与
已知 flaky 清单。**索引不在此处重复**，避免两处漂移。

**先看清这一点**：报告是**交付时点快照**，其中的门禁数字与覆盖率随后续开发已过期，
引用前须重新实测。它们唯一不随时间失效的价值是**测试意图的溯源**（某条用例为何存在、钉住哪条契约、做过哪些变异验证）。

**活证据（要跑测试看这里，不用读报告）**：

| 位置 | 内容 |
|------|------|
| `tests/**`（209 文件） | 单元与集成测试（vitest） |
| `e2e/**`（16 spec） | Playwright 端到端（基线 31 failed / 104 passed，比对失败集合） |
| `tests/benchmarks/ai-core-perf.test.ts` | 性能基准（可复跑） |
| `tests/main/ai/aiCorePerfGuards.test.ts` | 缓存一致性与并发栅栏守护用例 |
