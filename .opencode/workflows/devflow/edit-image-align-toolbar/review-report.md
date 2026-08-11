# 审查报告：edit-image-align-toolbar

> 日期：2026-08-11 | 审查范围：`5510b1b`（K1+K2）、`d588ec9`（K3）、`d95c14d`（K4+K5+K6）、`acb7b02`（K7）

## 结论

**无 Critical / High 问题。** Medium 2 条、Low 3 条（均记录不阻塞，多为契约性文档说明）。

## 审查关注点逐项

| 关注点 | 结论 |
|---|---|
| 缺少测试 | 无。kernel（imageBlock 125 行矩阵、toImgSrc 解码边界、data 偏移）、formatCtrl 四控制器、blockTree.changeBlockType、markdownRoundTrip 往返、组件（imageToolbarV2 新、floatingToolbarV2 直选/取消、imageEditTool 预填）、e2e（FT2-E6/E9、LINK-IMAGE-E3~E6）全覆盖 |
| 安全回退 | 无。图片回退占位 `.inline-image-fallback` 语义保留；G3 容错链路未削弱 |
| 绕过权限 | 无。未触碰认证/权限代码 |
| 记录敏感信息 | 无新增日志；既有 ImageEditTool `console.warn` 不变 |
| 密钥泄漏 | 无。`git show` 复查无密钥/路径硬编码敏感物 |
| N+1 查询 | 不适用（无数据库） |
| 数据迁移风险 | 无迁移 |
| 部署风险 | 无部署变更 |
| 修改无关文件 | 仅 K3 因删除 `insertImagePlaceholder` 牵连 useEditorActions/types/EditorV2 各 1-3 行最小引用清理（已声明）；`e2e/drag-selection-markers.spec.ts` 未改动 |

## 正向发现（已核验）

1. **D2 修复正确**：`decodeMarkdownEscapes`（纯正则、非法 `%X` 字面保留不抛错）+ toImgSrc 解码后再 `encodeURIComponent`，与主进程 `decodeURIComponent` 单次解码契约对称；`%20`→`%2520` 双重编码根因消除（`C:\Users\...\屏幕截图%202026...png` 单测断言不含 `%25`）。
2. **D3 偏移可信链**：img `data-start/data-end` 由 kernel 渲染期按 token 绝对偏移输出（`base=innerStart` 透传），EditorV2 点击时直接读 DOM 属性，无文本偏移换算漂移风险；action 执行后 `onCloseImage` 关闭选中防陈旧区间。
3. **D1 安全形态**：`renderImageBlock` 仅对内层经白名单渲染器 `renderInline` 输出；`<div align>` 包裹结构化解析（`parseImageBlockText` 严格单行 + 单 image token + href 非空 + wrapper 配对），**无原始 HTML 注入**；空 href 占位 `![a]()` 不构成 image-block（保持段落可编辑语义）。
4. **交互完整**：行内图对齐置灰（standalone 判定）、当前 align active、点击外/Escape 关闭、图片工具栏打开时文本选区守卫（flushSelection）防竞争。
5. **往返无损**：image-block text 存整行原文，stateToMarkdown 原样输出；RT 用例覆盖 `%20` 路径、三向 wrapper、`\r` 容差、非规范 div 回退 paragraph。

## Medium / Low

| 级别 | 项 | 处置 |
|---|---|---|
| M1 | `wrapImageAlign` 以正则替换首个 `<div align>` 匹配——已被 parseImageBlockText 前置校验结构，安全但依赖校验顺序 | 记录；K3 测试覆盖换向 |
| M2 | setext 边缘：`![a](x)\n===` 由 setext 标题变为 image-block + thematic-break | 记录；行为可接受（K1 说明） |
| L1 | 文件名字面含 `%XX` 序列被单层解码（如真名 `a%20b.png` → `a b.png`） | 需求已共识的固有歧义，文档化 |
| L2 | e2e image-block 路径下 Chromium 对无效协议 img 同步 error → 瞬时 src 无法直接断言 | 由行内路径 MutationObserver + K1 单测覆盖 |
| L3 | 弹层锚定（rect.top-40）在 jsdom 只断言默认值 | 真实布局由 e2e LINK-IMAGE-E5 验证通过 |

## 验证证据（K7 代理实测，工作树无后续改动）

vitest 716 passed（41 files）；tsc 0 error；eslint 0 error（8 既有 warning）；vite build 通过；playwright 54 passed / 5 failed（全部为 `drag-selection-markers.spec.ts` 既有「（当前 RED）」跨任务缺陷）。
