# editor-image-resize-fix — 进度/分级状态

> 更新：2026-08-13 | 任务 slug：`editor-image-resize-fix`
> 工作流：/devflow-core（M 级，standard TDD；按用户指示除需求提问外全自动化执行）

## 阶段 0 — 任务分级与分类

**请求类型**：混合 — 2 Bug（选中框提交后滞后/比图小、等比例拖拽逻辑）+ 1 功能完善（居中/居右可用 + 宽度模型）。

**跨模块判断**：不跨模块。全部落在「编辑主区 v2」图片子系统（kernel inlineRenderer / v2 组件 ImageResizeBox·LeafBlock / resizeMath 纯函数）。不涉权限/密钥/数据库/多端/Agent/Skill/MCP。

**定档**：**M**（半天内，单模块多子模块）。

**裁剪决定**：Bug → 复现测试 → 最小修复短路径；跳过完整 grilling（仅对 R1 缩放语义做一次 AskUserQuestion 决策）；跳过技术调研（纯内部算术/渲染逻辑，无外部库）；规划轻量（自写 plan.md）；实现直改（上下文完整，不派子智能体以减少失真）；TDD standard；全量门禁 + 合规 + 交付核对全走。

## 阶段 1 — 复现证据（Playwright 真实 Chromium，`_diag-image.spec.ts` 测后已删）

| # | 用户现象 | 实测证据 |
| --- | --- | --- |
| R1 | 等比例拖拽不符合逻辑（右拖即等比、斜向"迟钝"） | `computeResizeWidth` 主轴向：拖 SE `(100,50)` 与 `(100,100)` 增量**相同**（都 +100） |
| R2 | 选中框提交后比图小 | 提交重渲染（setTree/setBlockWidthMap）替换 img DOM，`handleUp.setRect` 读的是提交前 rect，框不重查 |
| R3 | 居中/居右位置无变化 | 宽度写在外层 `<div style="width:Npx">`（LeafBlock）→ img `max-width:100%` 受限于自然宽（小图无法放大、松手弹回）、带宽度图溢出内容列（920 列可到 992）、居中偏差 ~4px |

用户确认：R1 → **跟随指针位移、始终等比例**；R2 → **松手提交后，框比图小**；R3 → **点击按钮位置无变化**。

## 阶段 2 — 规划

- 产出 `docs/requirements/editor-image-resize-fix.req.md` + `docs/plan/editor-image-resize-fix.plan.md`。

## 阶段 3~5 — 实现（TDD standard）

**R3（宽度模型）**：`inlineRenderer.renderImageBlock` 将 `parsed.width` 经新纯函数 `applyImgWidth` 注入 `<img style="width:Npx">`（`applyRuntimeWidths` 复用同一注入）；`LeafBlock` image-block case wrapper 仅保留 `textAlign`。序列化文本语法 `<div align style="width:Npx">` 不变（往返不变量保持）。

**R1（缩放算术）**：`resizeMath.computeResizeWidth` 增量改为 `Math.sign(dominant) × Math.hypot(dx, dy)`；纯横/纵不变；钳制/取整/非有限防御保留。

**R2（提交后重锚定）**：`ImageResizeBox` 新增 `useLayoutEffect`（每次渲染后、非拖拽期）重查 img rect → 直改 `boxRef` DOM + 变化守卫 `setRect`（防循环；eslint-disable 注明）。

**测试**：`resizeMath.test.ts`（欧氏距离 + G1 用户样例 341/312）；`ImageResizeBox.test.tsx`（R2 重锚定 + 拖拽期不干扰）；`inlineRenderer.test.ts`（R3 宽度注入 3 例）；`EditorV2ImgResize.test.tsx`（宽度落点 img 断言更新）；E2E `R1·E9` 对齐回归、`R1·E10` 提交后框==图（小图放大不回弹）。

## 阶段 6 — 全量质量门禁

| 门禁 | 结果 |
| --- | --- |
| `tsc --noEmit` | 0 error |
| `npx vitest run` | 49 files / **826 passed**（基线 821 + 新增 5） |
| `npm run lint` | 0 error（8 条存量 warning：useContentSync/useEditorActions，非本任务） |
| `npx vite build` | ✓（renderer + main + preload） |
| `npx playwright test` | **65 passed / 5 failed**（5 个失败均为**存量 drag-selection-markers「当前 RED」**，未触碰；较基线 63 增 2：R1·E9/R1·E10） |

**E2E 新增**：`R1·E9`（居中/居右相对内容列对齐，含带宽度图，±2px）、`R1·E10`（松手提交后 `box.width/height/x/y == img`，±1px；小自然图放大到 >380 不回弹）。

## 阶段 7 — 合规核对

- **代码 vs 需求**：逐条核对 REQ G1~G6，全部满足（G1 单测 341/312；G2 E2E R1.E8；G3 E2E R1.E10；G4 E2E R1.E9；G5 E2E 小图放大 + img max-width:100% 不溢出；G6 全量门禁绿）。
- **代码 vs 规范（CONVENTIONS/SECURITY/WORKFLOW）**：无 `any`；命名规范；无内联样式新增（ImageResizeBox 的 fixed overlay 动态像素值沿用既有已注明例外 N2）；无 `dangerouslySetInnerHTML` 新增（`applyImgWidth` 仅向预渲染 img 的 style 注入数字，非用户文本）；无 IPC/DB 改动；测试未删除（1 处 `EditorV2ImgResize` 断言按新宽度模型更新为更严格语义，非弱化）。
- **工作流自身**：docs 已同步（req/plan/status + spec 13.15）；未跑 skill-comply（成本高，默认不做）。

## 阶段 8 — 交付核对

**变更清单核对**（对照 plan）：9 文件全部在计划内（4 src + 5 test）；2 新文档。计划外改动：无。临时诊断 spec 已删除。

**剩余风险 / 注意事项**：
- **N1（宽度模型语义变更）**：独立图宽度现在作用于 `<img>`（可放大到超过自然宽）；行为更符合直觉，但与"宽度只作缩小上限"的旧理解不同。若需限制"不大于自然宽"，另立任务。
- **N2（行内图对齐）**：居左/居中/居右对**行内图（段落内）仍置灰**（设计语义：行内图由段落 text-align 决定）。若用户期望行内图也可单独对齐（转为独立块），另立任务。
- **N3（存量）**：5 个 drag-selection-markers E2E 为已知 RED；electron-builder MSI icon 错误为存量配置问题。均未触碰。
- **N4**：`applyImgWidth` 新增导出但未进 `kernel/index.ts`（无外部消费需求；需要时补）。

## 下一任务（建议）

- 修 drag-selection-markers 5 个已知 RED E2E（独立任务）。
- 或确认行内图对齐策略是否需要放开（独立任务）。
