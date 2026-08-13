# PLAN-EDITOR-TOOLBAR-IMAGE-LINK：编辑主区重构实施计划（工具栏 / 图片 / 超链接）

> 档位：M（标准重构）| 分类：纯重构（零行为变更）| 需求：EDITOR-MAIN-REFACTOR（工具栏+图片+超链接域）
> 基线：vitest 49 文件 / 845 测试全绿 | tsc 0 错 | eslint 0 error | 分支 `refactor/toolbar-image-link`（基线 `2fb1602`，工作区干净）
> 铁律：**一次只做一种重构，每步跑目标测试 + typecheck**，任何断言/DOM 契约/导出 API 变化立即回退该步。
> 结构参考：[editor-main-refactor.plan.md](editor-main-refactor.plan.md)

---

## 0. 现况与已核实要点

**FloatingToolbar.tsx（631 行）**：10 个 useRef（toolbarRef/wrapRef/hideTimerRef/latestSelectionRef/visibleRef/stickyRef/suppressSelectionRef/linkSelectedRef/linkHitSelectionRef/mouseDownRef）+ 3 组在组件内的 document/container 事件 effect（①selectionchange+scroll ②mousedown/mouseup 拖选 ③mousedown(capture)+keydown 驻留守卫），事件语义分散但相互依赖，M 级**不做**大规模 hook 拆分。

**三个已核实的确切事实（本计划依据）**：

1. **ImageToolbar.scheduleHide（L85-93）是死代码**：仅 `setTimeout(() => { hideTimerRef.current = null })`，不翻转任何 state（图片工具栏可见性由 `imageSelection` 决定）。唯一调用点 `onMouseLeave={() => scheduleHide(300)}`（L221）。scroll effect cleanup 里 `clearTimeout(hideTimerRef.current)`（L129）纯属清理一个从不被读的 timer。`ImageToolbarV2.test.tsx` 已 grep 核实：**无** scheduleHide/onMouseLeave/hideTimer 任何断言。→ **删除**。
2. **ImageToolbar scroll 重锚定（L110-131）与 ImageResizeBox scroll 重锚定（L56-75）+ getSelectedImg（L46-54）复制粘贴重复**：都用 `container.querySelector('[data-block-id="…"]')` + `inner img.inline-image[data-start][data-end]` + `getBoundingClientRect()`。差异仅在监听目标——ImageToolbar 只挂 `container` capture；ImageResizeBox 挂 `container`+`window` 且挂载即 `handleScroll()` 一次。因此**只提取纯函数，各自保留自己的事件 effect**（不抽共享 hook，避免改动监听语义）。→ 新建 `imageAnchor.ts` 导出 `findImageEl` + `readImageRect` 纯函数并入块。
3. **ImageEditTool / InsertUrlModal 重复**：两者各有 `const EMPTY_URL_MESSAGE = 'URL 不能为空'`（InsertUrlModal L26 / ImageEditTool L35）；都有 ①open reset+focus ②Escape 关闭 ③空值校验 ④change 清 error。但 props 不同（InsertUrlModal 用 `url`/onConfirm(url)；ImageEditTool 用 `src/alt/title`/onConfirm(img)，且有 tab + 预填差异）→ **抽 hook 收益低**，只合并常量到共享模块，Effect/hook 不抽。 → `InsertUrlModal.test.tsx` 4 个 showPickImage 用例覆盖该 prop（showPickImage=true/false 渲染与 pickImage 回填）→ **showPickImage 保留，不删**。

**其他确认**：
- `ToolbarButton.tsx` active/hover 内联 style 是**有意保留**（FloatingToolbarV2 断言 style.color === 'var(--accent)'）→ 不迁 CSS 类。
- `formatCtrl.ts` `unlinkRange`（L456-492）delta 循环逻辑正确、注释充分；`extractLinkLabel`（L430-449）嵌套 rebuild。重构收益低且高风险（触碰内核控制器），**仅在收益明确时做显式 slice 化**，否则保持现状。
- `types.ts`、`toolbarState.ts`、`resizeMath.ts`、`imageBlock.ts`、`imageReplace.ts` 均为纯函数基线，非本次重点。
- FloatingToolbar `onMouseLeave={() => scheduleHide(300)}`（L531）是其**真实逻辑**（延迟隐藏文本工具栏），**不得误删**——只删 ImageToolbar 里的死 `scheduleHide`。

---

## 1. 变更清单

### 新增
| 文件 | 内容 |
| ---- | ---- |
| `src/render/components/Editor/v2/imageAnchor.ts` | 图片 DOM 定位共享纯函数（无 React 依赖）：`findImageEl(container, blockId, start, end): HTMLImageElement \| null` + `readImageRect(img): {top,left,width,height}`（内部 `getBoundingClientRect`）。供 ImageToolbar / ImageResizeBox 复用 |
| `src/render/components/Editor/v2/modalConstants.ts` | 共享常量 `EMPTY_URL_MESSAGE = 'URL 不能为空'`（供 InsertUrlModal / ImageEditTool import，消除双份字面量） |

### 修改
| 文件 | 改动 |
| ---- | ---- |
| `src/render/components/Editor/v2/ImageToolbar.tsx` | ① 删死代码 `scheduleHide` + `cancelHide` + `hideTimerRef`；`onMouseLeave` 移除/置空；scroll effect cleanup 删 `clearTimeout(hideTimerRef.current)` ② scroll 重锚定改用共享 `findImageEl`/`readImageRect`（事件 effect 结构不变）③ `EMPTY_URL_MESSAGE` 改 import |
| `src/render/components/Editor/v2/ImageResizeBox.tsx` | `getSelectedImg`（L46-54）与 scroll 重锚定改用共享 `findImageEl`/`readImageRect`；`getMaxWidth` 不动；`handleMouseDown` 其余不动 |
| `src/render/components/Editor/v2/InsertUrlModal.tsx` | `EMPTY_URL_MESSAGE` 改 import（其余不动；showPickImage 保留） |
| `src/render/components/Editor/v2/ImageEditTool.tsx` | `EMPTY_URL_MESSAGE` 改 import（其余不动） |
| `src/render/components/Editor/v2/FloatingToolbar.tsx`（可选 Step 4） | 仅低风险整理：拖选 effect 的 mousedown/mouseup 语义注释梳理；**不动**事件结构与 ref 语义耦合 |
| `src/render/editor/controllers/formatCtrl.ts`（可选 Step 5） | unlinkRange 若收益明确改显式 slice 替换；否则**不改** |

### 不动
`types.ts`；`toolbarState.ts`；`ToolbarButton.tsx`（内联 style 保留）；`resizeMath.ts`；`imageBlock.ts`；`imageReplace.ts`；所有内核/控制器（除非 Step 5 显式收益）；`InsertUrlModal.showPickImage`（保留，公开 API + 测试覆盖）。

---

## 2. 分步顺序（每步独立验证）

> 每步通用验证：`npx vitest run tests/components/ImageToolbarV2.test.tsx tests/components/ImageResizeBox.test.tsx tests/components/FloatingToolbarV2.test.tsx tests/components/InsertUrlModal.test.tsx tests/components/ImageEditTool.test.tsx` + `npm run typecheck`。E2E 最后统一跑。

- **Step 0 基线复核**：`npx vitest run` 记录 49/845 + `npm run typecheck`。验证：全量绿。
- **Step 1 死代码清理（ImageToolbar.scheduleHide）【纯删】**：删 `scheduleHide`/`cancelHide`/`hideTimerRef`/`clearTimeout`/`onMouseLeave`；`useRef/useCallback` import 若不再用一并去。验证：ImageToolbarV2 + FloatingToolbarV2 + typecheck。
- **Step 2 图片锚定去重（imageAnchor.ts）**：新建纯函数文件；ImageToolbar + ImageResizeBox 分别换用（各自 event effect 保留）。验证：ImageToolbarV2（锚定 252px/390px + Bug B 重锚定）+ ImageResizeBox（拖拽提交 G2/钳制 G3/R2 重锚定）。
- **Step 3 超链接 Modal 重复合并（modalConstants.ts）**：新建常量文件；ImageEditTool + InsertUrlModal 改 import。**决策：不抽 Escape/reset hook**（两组件 props 差异大，M 级收益低），仅合并常量并在文件注释说明。验证：InsertUrlModal + ImageEditTool。
- **Step 4 FloatingToolbar 事件语义整理（低风险仅）**：强化 3 组事件 effect 的职责注释、`isModalOpen`/守卫语义梳理；**不做**hook 拆分、不动 ref 集合、不动事件监听目标。验证：FloatingToolbarV2 + ImageToolbarV2（守卫/关闭语义）。
- **Step 5 formatCtrl unlinkRange 可读性（可选）**：仅在收益明确且零断言变化时，把 delta 累加改为一次显式 slice 替换数组；先看 `npm run typecheck` + 相关 format 单测，收益不明确即**跳过**。验证：EditorV2Format / 相关 format 测试。
- **Step 6 清理收尾 + 全量门禁**：搜未用 import/死变量；`npx vitest run`（845）+ `npm run typecheck`（0）+ `npm run lint`（0 error）+ `npm run build`。验证：全绿 + DOM 契约 grep diff 为空（类名/data-testid）。
- **Step 7 E2E 回归**：`npx playwright test`（重点 floating-toolbar.spec / 图片相关 spec / cross-block-replace-input）。验证：全绿。

---

## 3. 兼容性策略

- **DOM 契约零变**：`.image-toolbar`、`.it-toolbar`、`[data-testid="image-toolbar"]`、`image-toolbar-*`、`.image-resize-box`、`.image-resize-handle`、`[data-handle]`、`.insert-url-modal-*`、`.ie-*`、`floating-toolbar-v2`、`.ft-*` 全部原样。
- **导出 API 零变**：FloatingToolbar 对 `syntaxTypeToOption`/`selectionSyntaxTypesConsistent` 的 re-export 保持；`imageAnchor.ts`/`modalConstants.ts` 为**新增**导出，不影响既有签名。
- **事件语义零变**：imageAnchor 只提取「查询/读取」纯函数，**不**改变 ImageToolbar（容器 capture 滚动）与 ImageResizeBox（容器+window capture 滚动 + 挂载即跑一次）各自的事件监听差异。
- **死代码删除只限 ImageToolbar 内部自证死语义**：不动 FloatingToolbar 的 `scheduleHide(300)`（那是真逻辑）。
- **常量合并不改变消息文案**：两处 `'URL 不能为空'` 合并为同一常量值，测试 `screen.getByText(/URL 不能为空/)` 断言不受影响。

---

## 4. 验收标准

1. `npx vitest run`：49 文件 / 845 测试全绿，断言零修改
2. `npm run typecheck`：0 错误
3. `npm run lint`：0 error（注：项目脚本含 `--fix`，若 0 error 判定受其影响，以 `eslint src/ --ext .ts,.tsx` 无报错为终态即可）
4. `npm run build`：通过
5. `npx playwright test`：E2E 全绿（floating-toolbar.spec / 图片相关 spec / cross-block-replace-input 优先）
6. DOM 契约 diff 为空（类名/data-testid/块下拉选择器）；导出 API 签名不变

---

## 5. 风险与回退

| 风险 | 缓解 |
| ---- | ---- |
| **A（中）** 删 scheduleHide 误伤 FloatingToolbar 的真 hide 逻辑 | 只删 **ImageToolbar 内** scheduleHide/cancelHide/hideTimerRef/onMouseLeave；FloatingToolbar 的 L235/L531 原样保留；Step 1 跑 ImageToolbarV2 + FloatingToolbarV2 验证 |
| **B（低）** imageAnchor 提取改变 ImageResizeBox 挂载即重锚定 / window 监听语义 | 只把查询/读取抽成纯函数，两组件事件 effect 结构原样；Step 2 分别跑两套重锚定测试 |
| **C（低）** 常量合并某处仍保留双份 | grep `URL 不能为空`/`EMPTY_URL_MESSAGE` 确认唯一来源；Step 3 跑两个 modal 测试 |
| **D（低）** Step 4 事件整理碰坏守卫/关闭语义 | 限定注释 + 语义梳理，不动监听目标与 ref；若 ImageToolbarV2 关闭用例变红即回退 |
| **E（可选）** Step 5 unlinkRange 改动碰内核 | **默认跳过**；仅当 Step 6 前能证明零断言变化且单测覆盖可回退才做；否则维持现状 |
| **回退** | 改动集中 4 组件 + 4 个纯函数/常量文件；断言/DOM/导出 API 有变即 `git checkout <file>` 回退该步，无关后续步 |

---

## 6. 实施顺序回放

Step 0 基线 → Step 1 死代码清理（重点风险 A）→ Step 2 图片锚定去重（纯函数，风险 B）→ Step 3 超链接常量合并（风险 C，明确**不**抽 hook）→ Step 4 FloatingToolbar 事件注释整理（风险 D）→ Step 5 unlinkRange（可选，默认跳过）→ Step 6 清理+全量门禁 → Step 7 E2E。
