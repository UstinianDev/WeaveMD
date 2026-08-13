# SPEC-EDIT-FT2 TDD 实施证据报告

> 规范：docs/specs/floating-toolbar-ux-and-inline-format.md（SPEC-EDIT-FT2 v1.0）
> 计划：PLAN-EDIT-FT2（历史计划文档已归档删除）
> 日期：2026-08-08 | 运行器：Vitest 1.x + Playwright | 环境：Windows PowerShell
> 检查点说明：本报告为阶段检查点证据，git 提交需用户授权（未授权则后续补充）。

---

## 1. 用户旅程（阶段 → 证据）

| 阶段 | 目标 | RED 证据 | GREEN 判据 | 结果 |
| ---- | ---- | ---- | ---- | ---- |
| 0+1 内核 | katex 依赖 + inlineLexer 抽取（输出不变）；formatCtrl toggle/strip/clearFormat/underline/math/image；katex.ts | 模块不存在 / toggle 双层 / 无 u/math 渲染 | 新增单测全绿 + 存量 108 行金标准零漂移 | ✅（提交 9c1554a） |
| 2 样式 | 方案 B 隐藏+聚焦灰显、mark 黄色、主题变量、工具栏尺寸类、行内对象类 | ft2Css 7 例全红 | 7/7 绿 + `tsc --noEmit` | ✅ 本阶段 |
| 3 工具栏 | 分组/新按钮/橡皮擦/activeTest 边界 | FloatingToolbarV2 TB1~TB8 红 | 34/34 绿 + eslint 0 error | ✅ 本阶段 |
| 4 接线 | `url?`/`onClearFormat`/Ctrl+U/Ctrl+Shift+M | EditorV2Format 3 例红 | 5/5 绿 + 全量 vitest 392 绿 | ✅ 本阶段 |
| 5 E2E | G1 计算样式 / G2 标记隐藏 / G3 新功能 | 旧实现尺寸不足/双层/标记可见 | floating-toolbar 13/13 + 全量 38/38 + build | ✅ 本阶段 |

## 2. 改动清单（本阶段：阶段 2~5）

| 文件 | 改动摘要 | 性质 |
| ---- | -------- | ---- |
| `src/render/styles/globals.css` | 5 主题块 highlight 变量；`.md-syntax` 方案 B；mark 黄色；工具栏尺寸类；`.inline-image`/`.math-inline` | 生产 |
| `src/render/components/Editor/v2/FloatingToolbar.tsx` | `CHAR_BUTTONS`/`OBJECT_BUTTONS` 分组 + 橡皮擦；`isBoundedWrap` activeTest；image/link prompt；`onClearFormat?` prop；`.ft-btn`/`.ft-divider` | 生产 |
| `src/render/components/Editor/v2/types.ts` | `BlockHandlers.onFormat` 补 `url?`；新增 `onClearFormat` | 生产 |
| `src/render/components/Editor/v2/blocks/ContentBlock.tsx` | `onFormat` 补 `url?`；Ctrl+U / Ctrl+Shift+M | 生产 |
| `src/render/components/Editor/v2/EditorV2.tsx` | `onClearFormat` useCallback；注册进 handlers；传给 FloatingToolbar | 生产 |
| `tests/styles/ft2Css.test.ts`（新增） | CS1~CS6：静态源码断言（D9：vitest css:false） | 测试 |
| `tests/components/FloatingToolbarV2.test.tsx` | +TB1~TB8（分组顺序/回调/activeTest 边界/折叠隐藏/回归） | 测试 |
| `tests/components/EditorV2Format.test.tsx`（新增） | Ctrl+U / Ctrl+Shift+M / url 透传契约 | 测试 |
| `e2e/floating-toolbar.spec.ts` | +FT2-E1~E8（计算样式/toggle/标记隐藏/黄色高亮/下划线/图片/数学/橡皮擦） | 测试 |

未改动（规范禁区确认）：块树内核模型、双向转换、七类交互控制器（除 formatCtrl 扩展）、
撤销/重做、自动保存、查找替换、大纲导航。

## 3. 关键 RED 发现与修订

| # | 预期 | 实测 | 处理 |
| ---- | ---- | ---- | ---- |
| 1 | CS2 `.block-content:focus .md-syntax` 精确匹配 | `.replace` 转义选择器遇逗号分组/CRLF 匹配失败 | 测试改为行锚定 + CRLF 归一化；CSS 增 `:focus-within` 兼容 |
| 2 | TB 系列复用顶层同步 rAF stub | 前序 describe `afterEach` 的 `unstubAllGlobals` 清掉 stub，rAF 变异步 → 工具栏未及时渲染 | TB describe 内 `beforeAll` 重装 + `afterAll` 清理 |
| 3 | TB2 单容器点两次按钮 | 首次点击后 `setVisibleGuarded(false)` 隐藏，第二按钮查询不到 | 拆为独立场景（每断言独立渲染） |
| 4 | E3 块失焦后 `.md-syntax` 隐藏 | 加粗后光标仍在块内（聚焦）→ 灰显而非隐藏 | 断言顺序改为「先灰显 → 点击 header 失焦 → 隐藏」 |
| 5 | E6 图片后 `toHaveText` 断言 | `<img>` 无文本内容（textContent 空） | 改断言 `img.inline-image` 的 `alt`/`src`/数量 |
| 6 | TB7 折叠选区立即隐藏 | fade 为延迟隐藏（180ms） | 等待 hide 定时器后断言隐藏 |

## 4. 回归门禁（全绿）

```text
$ npx vitest run            Test Files 28 passed | Tests 392 passed
$ npx tsc --noEmit          通过
$ npx eslint <改动文件>      0 error
$ npx vite build            dist-render + dist-main 构建成功（katex 已打包进主 chunk）
$ npx playwright test       38 passed（含新增 FT2-E1~E8，8 例）
```

## 5. 遗留说明

- 列表间互转（bullet→task 等）、heading→列表/引用/代码块：`canConvertBlock` 置灰，后续任务。
- KaTeX 体积（~90KB gzip + woff2 字体）已随主 chunk 打包；动态 import 拆包列为后续优化。
- display math（块级 `$$`）与图片粘贴上传在本次范围外。
- 部分重叠/混合行内标记边界保守处理：选区切开标记时残体保留为字面量。
