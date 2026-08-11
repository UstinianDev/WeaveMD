# 进度：edit-image-insert-marktext

> 任务名：`edit-image-insert-marktext` | 状态：**已完成（K1~K6 全部提交）** | 日期：2026-08-11
> 需求/计划：`.opencode/workflows/devflow/edit-image-insert-marktext/requirements.md`、`plan.md`

## 提交清单

| 提交 | 内容 | 模块 |
|---|---|---|
| `413dbdb` | lexer 允许空 href 图片 token + 空 src 占位渲染 `.inline-image-empty`（textContent 不变量） | K1 |
| `93df949` | ImageEditTool 弹层（Embed/Select 双 Tab，Escape/×/取消，pickImage 直接应用） | K2 |
| `5daac30` | `imageReplace.ts` 纯函数 + `formatCtrl.insertImagePlaceholder/replaceImage` + `imageRange` 光标落点 | K3a |
| `9014b58` | `.inline-image-empty` 占位样式 | K5 |
| `fd08b4f` | FloatingToolbar 两段式接线：图片按钮 → `onInsertImage` 写占位 + 隐藏 → 锚定 effect（token.start/end 修正 + rect 定位）→ ImageEditTool → `onReplaceImage` 精确替换；`interactionGuard` 合并 insertModal/imageEdit | K3b |
| `4a78b53` | e2e 图片用例改两段式（FT2-E6/E3/E4）+ FT2-E3 对齐 e5e2f6f"md-syntax 始终隐藏"设计 + initialAlt 剥离 U+200B | K6 |

## 与本会话无关的既有提交（同链路）

`64aed66`（链接补协议/media://）、`e5e2f6f`（unlinkRange）

## 验证证据（2026-08-11 实测）

- `npx vitest run`：**39 files / 643 passed**（含 floatingToolbarV2 49、imageEditTool 17、markdownRoundTrip RT6 空图往返、imageReplace 7、inlineLexer/inlineRenderer 空 href 矩阵、ft2Css K5 断言）
- `npx tsc --noEmit`：0 error
- `npx eslint src/ --ext .ts,.tsx`：0 errors（8 条既有 react-hooks/exhaustive-deps warning，非本任务引入）
- `npx vite build`：通过
- `npx playwright test`：**51 passed / 5 failed**——5 个失败均为 `drag-selection-markers.spec.ts` 标题自标"（当前 RED）"的既有已知失败（拖选标记缺陷，另一任务范畴），与本任务无关

## 关键决策与坑

- **K3b 后台代理半成品**：第三次派发返回空、实现仅一半（props/state 到位但 image 分支/锚定 effect/ImageEditTool 渲染缺失，且 `insertModal` 类型收窄后出现 `'image'` 比较 TS 错误）。已人工补完并经测试验证后提交。
- **initialAlt 零宽剥离**：e2e 暴露 `selection.anchorText`（DOM textContent）带 contentEditable U+200B 占位符，initialAlt 需 `replace(/\u200B/g,'')` 才与 block 源文本一致（单测不受影响）。
- **FT2-E3 陈旧断言**：e5e2f6f 移除 `.md-syntax` 聚焦灰显（改始终隐藏），FT2-E3 仍断言 opacity 0.55 → 按既有设计改断言为聚焦/失焦均隐藏，未改源码。

## 遗留问题 / 风险

- `drag-selection-markers` 5 条 e2e 为既有 RED（拖选含标记序列化缺陷），建议另立任务；本次不动。
- 关注一下：`FloatingToolbar` 新增三个 props 为可选（`?`），依赖 EditorV2 全部传入；后续新调用方省略时点图按钮只会打开弹层不落占位。当前唯一调用方（EditorV2）已全部传参。
- e2e 本地文件选择链路不可自动化（真实文件对话框），由单测 `imageEditTool.test.tsx`（17 用例）与 e2e URL 链路共同覆盖。

## 下一任务建议

`drag-selection-markers e2e RED（5 用例）`，修复拖选含 close 标记时 Backspace/斜体/下划线/方向键的标记移位与畸形叠加。