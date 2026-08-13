# TDD 证据文档：SPEC-EDIT-FT3 浮动工具栏格式应用交互修正

> 日期：2026-08-08 | 规范：[SPEC-EDIT-FT3 v1.0](../specs/floating-toolbar-format-sticky.md)
> 计划：PLAN-EDIT-FT3（历史计划文档已归档删除）
> 风险等级：L3（生产行为修正，测试先行，无迁移）

## 1. 任务 → 测试目标 → 红/绿证据映射

| 用例 | 任务点（规范条目） | 测试目标 | 红阶段 | 绿阶段 |
| --- | --- | --- | --- | --- |
| C1 | A1 Step0 归一化：content-only | 选中纯内容点加粗 → 包一层 `**` | 原生包双层 `****` | ✅ |
| C2 | A1 Step0 归一化：content + `**`（部分标记） | 选中 `abc`+边界 `**` 点加粗 → 解除（`abc` 无标记） | 叠加 `****` | ✅ |
| C3 | A1 Step0 归一化：content + 全标记 | 选中整个 `**abc**` 点加粗 → 解除 | — | ✅ |
| C4 | A1 Step0 归一化：部分 + 全 | `**a` + `**bc**` 点加粗 → `a` 包裹 + `bc` 解除 | 各包一层（`a` 双标记） | ✅ |
| C5 | A1 Step0 归一化：跨多 token（==粗斜同向== + **同向粗**） | 混合高亮+加粗选区点高亮 → 仅去高亮，加粗保留 | — | ✅ |
| C6 | A2 恢复选区 | 格式应用后 `Window.getSelection()` 保留选中 | 选区折叠 | ✅ |
| C7 | A3 驻留触发 | 按钮点击后 300ms 工具栏仍在 | 立即隐藏 | ✅ |
| C8 | A4 点击外/Escape | 点击工具栏外 / Escape → 隐藏 | 驻留不退出 | ✅ |
| C9 | A4 键入退出 | 键入字符 → 隐藏 | — | ✅ |
| C10 | B1 多 token 逐 token 拆分 | 跨多个同风格 token 覆盖标记的选区 → 各 token 均解除，绝不 `****`/`====` | 原保守包裹叠加双层 | ✅ |
| C11 | case A 补全 | 选区落在 token 内容区内（部分内容）→ 解除，绝不 `****` | 原叠加 `****ab**c**` | ✅ |
| C12 | 跨风格叠加（bold+italic） | 加粗后再斜体 → `***a***` 渲染 em 内嵌 strong，无字面星号残留；解除逐层剥离 | 三连星被解析为 strong 包裹字面 `*a`，斜体不渲染 | ✅ |

## 2. 交付统计

| 阶段 | 生产文件 | 测试文件 | 说明 |
| --- | --- | --- | --- |
| A | `controllers/formatCtrl.ts`（Step0 归一化 + selection 恢复）、`controllers/selection.ts`（StickySelectionUtil 模块）、`kernel/inlineLexer.ts`（`findIntersectingStyleTokens` 复数 + 三连 `***` 嵌套） | `selection.test.ts`（sticky 3 例）、`formatCtrl.step0.test.ts`（4 例）、`ContentBlockRestore.test.tsx`（2 例）、`EditorV2StickyFormat.test.tsx`（1 例）、`ft2Css.test.ts`（回写 8 例）、`formatCtrl.test.ts`（C10/C11 +7、C12 +8）、`inlineLexer.test.ts`（复数 +4、三连 +4）、`inlineRenderer.test.ts`（三连 +1） | 单测 + 集成 |
| B | `FloatingToolbar.tsx`（sticky/驻留/退出路径）、`globals.css`（FT2-E1 尺寸 8→10）、`ContentBlock.tsx`（RestoreSelection hook） | `floatingToolbar.sticky.test.tsx`（4 例）、`FloatingToolbarV2.test.tsx`（回写）、`EditorV2.sticky.test.tsx`（1 例） | 组件 |
| E | — | `e2e/floating-toolbar.spec.ts`（FT3-E1/E2/E3/E5/E6/E7 共 6 例） | E2E 44 例 |

## 3. 红/绿证据（片段）

```text
# RED：Step 0 归一化目标 —— 部分标记覆盖（C2）
formatCtrl.formatRange({ text: 'abc', markdown: '**ab', start: 0, end: 3, target: 'bold' })
  → expected selection restored + apply to 'ab'
# 实施前：selection 折叠 + apply('**ab**c') → 实际 '****ab****c'（叠双层，红）
# 实施后：`ab` 解除为纯文本，selection 恢复选中，apply 无叠加（绿）

# RED：C12 跨风格叠加 —— 三连星渲染
renderInline('***both***') → 实施前 '<strong>**</strong>*both<strong>**</strong>*'（红）
# 实施后：'<em>*<strong>**both**</strong>*</em>'（em 内嵌 strong，无字面残缺，绿）
formatCtrl('**a**', italic, 0..5) → '***a***'；formatCtrl('***a***', bold, 0..7) → '*a*'（逐层剥离）

# GREEN：floatingToolbar.sticky（组件）
Tests  4 passed (4)

# GREEN：全量回归
Tests  460 passed (460)
Running 19 tests using 1 worker      # e2e/floating-toolbar.spec.ts（18 → 19）
Tests  44 passed (44)                # 全量 E2E（43 存量 + 1 新增 FT3-E7）
```

## 4. 验收核对

- [x] 部分标记选区不产生 `****`/`====`（case B 归一化解除）
- [x] 跨多个同风格 token 覆盖标记选区逐 token 拆分（C10），各 token 均解除、无叠加
- [x] case A 补全：选区落在 token 内容区内（部分内容）→ 解除，绝不 `****`（C11）
- [x] 跨风格叠加：加粗后再斜体 → `***a***` 渲染 em 内嵌 strong、无字面星号残留（C12）；`***a***` 解除逐层剥离
- [x] 格式应用后选区恢复保持选中（StickySelectionUtil + RestoreSelection）
- [x] 工具栏格式应用后驻留；点击外/滚动/Escape/键入退出；块转换仍退出
- [x] `tsc --noEmit` 通过、ESLint 0 error、`vite build`（render/main/preload）通过（electron-builder 重编译 better-sqlite3 因 .node 文件被运行中进程占用 EBUSY，环境问题，与本次改动无关）
- [x] 全量门禁：Vitest 460/460、Playwright 44/44（无回归）
- [x] 文档同步：FT3 §4.1/§9.9（C12）、tdd.md、modules/04、SUMMARY

## 5. 遗留问题

- 选区与 token 相交但不覆盖其标记、也不完全落在内容区的极端部分重叠场景（case D）保守处理。
- `***` 选区全选时工具栏 B/I active 高亮判定（`isBoundedWrap` 不可延伸规则）不显示双高亮，交互面后续处理。
- 工具栏在显示器边缘的溢出自适应为既有限制，非本期范围。
- 提交（checkpoint commit）需用户授权后执行；本证据已按 TDD 流程记录。
