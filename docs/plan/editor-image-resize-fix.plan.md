# 图片选中框三缺陷修复 — 实施计划

> 计划编号：PLAN-EDIT-IMAGE-RESIZE-FIX | 更新：2026-08-13
> 需求：[REQ-EDIT-IMAGE-RESIZE-FIX](../requirements/editor-image-resize-fix.req.md)
> 任务名：`editor-image-resize-fix` | 档位：M（standard TDD）| 单模块（编辑主区 v2）

## 一、总览

三项缺陷同源于图片缩放/对齐的宽度模型与交互实现。根因已用 Playwright 实测确认（见需求二、三）。

**核心架构约束**：
1. 宽度持久化文本语法 `<div align="X" style="width:Npx">` **不变**（往返不变量）；仅改**渲染时宽度落点**：从外层 div 移到 `<img>` 自身。
2. 缩放算术纯函数 `computeResizeWidth` 保持 React-free（可单测），仅改增量语义。
3. 选中框仍为 fixed overlay + 直接 DOM 同步（不引入新依赖/渲染架构）。

## 二、变更清单（文件级，函数级改动）

### R3（宽度模型）→ 先做，它是 R2 尺寸对不上的诱因之一

1. **`src/render/editor/kernel/inlineRenderer.ts`**
   - 抽 `applyImgWidth(html, width)`：对 `<img class="inline-image">` 注入/合并 `style="width:Npx"`（复用 `setWidthInInlineStyle`；无 style 属性则 tag 末尾附加）。
   - `applyRuntimeWidths` 内部逻辑复用同一注入（保持 key 匹配语义不变）。
   - `renderImageBlock(text)`：`parsed.width != null` 时对渲染出的 inner html 调 `applyImgWidth(html, parsed.width)`。

2. **`src/render/components/Editor/v2/blocks/LeafBlock.tsx`**
   - image-block case：`alignStyle` 只含 `textAlign: parsed.align`（移除 `width`）；宽度已由 `block.inlineHtml`（renderImageBlock 注入）落到 img。
   - 会话 map 注入 `applyRuntimeWidths` 逻辑不变（行内图专用，独立图 map 恒空）。

### R1（缩放算术）→ resizeMath 纯函数

3. **`src/render/components/Editor/v2/resizeMath.ts`**
   - `computeResizeWidth`：`delta = Math.sign(dominant) * Math.hypot(dx, dy)`（dominant = |横贡献| ≥ |纵贡献| 者取之）；纯横/纵行为不变；钳制/取整/非有限输入防御保留。

### R2（提交后框跟随）→ ImageResizeBox

4. **`src/render/components/Editor/v2/ImageResizeBox.tsx`**
   - 新增 `useLayoutEffect`（每次渲染后、非拖拽期）：重查 `getSelectedImg()` rect → 直改 `boxRef` DOM（left/top/width/height）+ `setRect`（变化守卫防循环，`Object.is` 各字段比较）。兜住提交重渲染后 img 尺寸/位置变化。
   - 保留现有 drag 直改 DOM、scroll 重锚定、handleUp setRect（作为即时快照）。

### 测试（M/standard：新行为测试先行 + 回归）

5. **`tests/components/resizeMath.test.ts`**：对角用例改欧氏距离期望；新增 G1 样例 `(100,100)`→+141、`(100,50)`→+112。
6. **`tests/components/ImageResizeBox.test.tsx`**：新增「提交重渲染后框与 img 尺寸一致」断言（layout effect 重查）。
7. **内核渲染测试**（`tests/editor/` 或现有 inlineRenderer 测试文件）：`renderImageBlock` 宽度注入 `style="width:Npx"`。
8. **`e2e/image-resize.spec.ts`**：新增 R1·E9 对齐回归（居中/居右移动、带宽度图同样）、R1·E10 松手提交后 `box.width === img.width`。
9. 回归：`tsc` / `vitest` / `lint` / `vite build` / 全量 E2E。

## 三、实施顺序（串行，避免并行冲突）

R3（kernel→LeafBlock，含测试）→ R1（resizeMath，含测试）→ R2（ImageResizeBox，含测试）→ E2E 回归 → 全量门禁。

## 四、风险与回滚

- **低风险**：宽度落点从 div→img，仅影响 image-block 渲染视觉，序列化文本不变；`stateToMarkdown` 零改动。
- **中风险**：`useLayoutEffect` 需防 setRect 循环（变化守卫）；jsdom 下 `getBoundingClientRect` 为 stub，测试用 stub 值断言。
- 回滚：任一项不合规 → 恢复该文件 git 版本（改动互不依赖，可独立回滚）。

## 五、验收（对应 REQ G1~G6）

以 E2E 实测 + 单测 + 全量门禁为准；E2E 用真实 Chromium 断言 box/img 尺寸、对齐位置。
