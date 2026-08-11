# 进度：edit-image-align-toolbar（图片插入直选 + 图片工具栏对齐）

> 任务名：`edit-image-align-toolbar` | 状态：**已完成（K1~K7 全部提交 + 工作流文档）** | 日期：2026-08-11
> 需求/计划/审查/合规：同目录 `requirements.md`、`plan.md`、`review-report.md`、`compliance.md`

## 提交清单

| 提交 | 内容 | 单元 |
|---|---|---|
| `5510b1b` | toImgSrc 单层解码修复（`%20` 不再 `%2520` 双重编码）+ img data-start/data-end 绝对偏移 + image-block 内核模型（类型/解析/序列化/渲染/LeafBlock） | K1+K2 |
| `d588ec9` | changeBlockType + formatCtrl 四控制器（insertImageFromSelection/alignImage/makeImageInline/removeImage）+ escapeImagePathForMarkdown；删除 insertImagePlaceholder | K3 |
| `d95c14d` | 图片点击选中（imageSelection）+ 图片工具栏（修改图片/内联图片/居左/居中/居右/移除图片，行内图置灰、active 态、外点/Escape 关闭）+ ImageEditTool「修改图片」预填 + pickImage 直选插入接线；清除 K3b 两段式残留 | K4+K5+K6 |
| `acb7b02` | e2e：FT2-E6/LINK-IMAGE-E3/E4 重写直选 + 新增 FT2-E9（取消 no-op）、LINK-IMAGE-E5（工具栏全链路）、LINK-IMAGE-E6（行内图置灰） | K7 |

## 验证证据（2026-08-11 实测，最终状态无后续改动）

- vitest：**716 passed**（41 files，基线 643 → +73）
- `npx tsc --noEmit`：0 error；`npx eslint src/ --ext .ts,.tsx`：0 error（8 条既有 warning）
- `npx vite build`：renderer/main/preload 三目标通过
- `npx playwright test`：**54 passed / 5 failed**——5 个全部为 `drag-selection-markers.spec.ts` 既有「（当前 RED）」跨任务缺陷，未触碰

## 关键决策执行记录

- **插入直选**：点图片按钮 → `pickImage` → 非空直接替换选区（`![sel](escapeImagePathForMarkdown(path))`，空格→`%20` 与用户示例一致）；取消纯 no-op；URL 嵌入保留在「修改图片」弹层。
- **对齐**：独立成块（image-block）→ 源码 `<div align="left|center|right">![alt](src)</div>`；内联图片 = 剥包裹恢复行内；行内图对齐/内联按钮置灰。
- **原图不显示根因**：`toImgSrc` 双重编码（`%20`→`%2520`）→ 已修复并单测锁定（含中文路径、UNC、非法 `%X` 边界）。
- **e2e 适配真实浏览器行为**：image-block 路径下 Chromium 对无效协议 img 同步 error（img 不进 DOM）→ media:// 编码断言移至行内路径；E5/E6 用 https + route 拦截 SVG 避免 fallback 顶替可点击 img。

## 遗留风险 / 未决

- `drag-selection-markers` 5 条 e2e 既有 RED，建议另立任务。
- 文件名字面含 `%XX` 序列被单层解码（共识接受的契约歧义）。
- 未推送远程（无授权）。

## 下一任务建议

`drag-selection-markers e2e RED（5 用例）`（拖选含 close 标记的标记移位缺陷，历史遗留）。