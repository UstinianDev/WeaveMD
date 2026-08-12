# 图片选中框三缺陷修复 — 需求

> 需求编号：REQ-EDIT-IMAGE-RESIZE-FIX | 更新：2026-08-13
> 任务名：`editor-image-resize-fix` | 档位：M（standard TDD）
> 来源：/devflow-core，用户提交三问题 + 复现证据（Playwright 真实 Chromium）

## 一、需求清单（3 项）

| # | 需求 | 类型 | 现状（已核实） |
| --- | --- | --- | --- |
| R1 | 四角拖拽缩放改为「跟随指针位移、始终等比例」 | Bug | `computeResizeWidth` 主轴向取 `max(\|horizontal\|,\|vertical\|)`；实测拖 `(100,50)` 与 `(100,100)` 宽度增量相同（都 +100），纵向分量在横向主导时被丢弃，斜向拖拽"迟钝" |
| R2 | 松手提交后选中框与图片尺寸/位置保持一致（当前框比图小） | Bug | `handleUp` 的 `setRect` 读取的是 React 提交渲染前的 img rect；提交重渲染后框不再重查，锚点陈旧 |
| R3 | 居中/居右可用且位置正确；宽度作用于 `<img>` 而非包裹 `<div>` | Bug | 宽度写在 `LeafBlock` 外层 div（`width:Npx` + `textAlign`），导致：小图无法放大（img max-width:100% 受限于自然宽，松手弹回）；带宽度图溢出内容列（920 列可到 992）；居中偏差 ~4px。对齐在未缩放图已生效，带宽度图不完美 |

## 二、已对齐问题（grill-me，用户已确认）

1. **R1 缩放语义** → **跟随指针位移，始终等比例**：宽度增量 = `sign(主方向) × √(dx²+dy²)`；纯横/纵拖拽行为不变（单维时 dist=该轴位移）；斜向拖拽按对角距离顺滑增长，无主轴向切换跳变。
2. **R2 延迟时刻** → **松手提交后，一般是框比图小**：框须在提交重渲染后重查 img 实际 rect。
3. **R3 对齐表现** → **点击按钮位置无变化**：须保证点击居中/居右后图片真实移动且位置正确（含带宽度图）；行内图（段落内）对齐按钮保持置灰（设计语义：行内图由段落 text-align 决定，不单独对齐）。

## 三、验收标准（G 判据）

- **G1（R1）**：`computeResizeWidth` 欧氏距离语义。`(200,100,100,'se')`→341（+141）；`(200,100,50,'se')`→312（+112）；纯轴 `(200,50,0,'se')`→250、`(200,0,-30,'ne')`→230 不变；钳制 `[min,max]`、取整、非有限输入防御保持。
- **G2（R1 交互）**：对角拖拽 SE 角 `(20,40)` 宽度增量在 `[30,50]`（√(400+1600)≈45）。
- **G3（R2）**：鼠标松开提交后 `box.width === img.width`（±1px）、`box.height === img.height`（±1px）、left/top 对齐（±1px）。
- **G4（R3）**：无宽度图点击居中后 `imgCenter === areaCenter`（±2px），点击居右后 `imgRight === areaRight`（±2px）；**带宽度图同样成立**。
- **G5（R3 宽度模型）**：自然宽 < 目标宽的小图可放大到目标宽，松手不回弹；宽度不超出内容列（`img.width ≤ area.clientWidth`）。
- **G6（回归）**：`tsc` 0 error；`vitest` 全绿；`lint` 0 error；`vite build` ✓；E2E 全绿（存量 drag-selection-markers RED 除外，另立任务）。

## 四、变更范围（预估文件）

- `src/render/editor/kernel/inlineRenderer.ts`（renderImageBlock 宽度注入）
- `src/render/components/Editor/v2/blocks/LeafBlock.tsx`（wrapper 仅 textAlign）
- `src/render/components/Editor/v2/resizeMath.ts`（欧氏距离）
- `src/render/components/Editor/v2/ImageResizeBox.tsx`（提交后重锚定）
- 测试：`tests/components/resizeMath.test.ts`、`tests/components/ImageResizeBox.test.tsx`、内核渲染测试、`e2e/image-resize.spec.ts`（新增对齐/提交后同步回归）
- 文档：`docs/specs/editor-v2-architecture.md`（13.15 宽度模型与缩放）、`docs/plan/editor-image-resize-fix.*`

## 五、非目标（范围控制）

- 不改行内图对齐策略（置灰保留）。
- 不改宽度持久化文本语法（`<div align style="width:Npx">` 序列化契约不变）。
- 不重构 ImageResizeBox 为 flex/absolutely-positioned 图片，仅在现 fixed overlay 上修复跟随。
- 不处理 drag-selection-markers 存量 RED E2E、electron-builder MSI icon 存量问题。
