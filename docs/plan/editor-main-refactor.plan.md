# PLAN-EDITOR-MAIN-REFACTOR：编辑主区重构实施计划（浮动工具栏 + 插入图片）

> 档位：M（标准重构）| 分类：纯重构（零行为变更）| 需求：[REQ-EDITOR-MAIN-REFACTOR](../requirements/editor-main-refactor.req.md)
> 基线：vitest 41 文件 / 724 测试全绿 | tsc 0 错 | eslint 0 error（8 warnings 既有）
> 铁律：**一次只做一种重构，每步跑目标测试 + typecheck**，任何断言变化立即回退该步。

## 0. 现况与内联样式清点（已核对源码）

**FloatingToolbar.tsx（882 行）11 处内联样式：**
- `ToolbarButton` active/hover 的 color + backgroundColor（含 hover 两处 `style.backgroundColor=` 赋值）
- 图片工具栏容器（dynamic top/left + bg + border）+ 2 个 `.ft-divider`
- 文本工具栏容器（position + bg + border）
- `.block-type-trigger`（borderColor + color）
- `.block-type-menu`（bg + border）
- `.block-type-option`（color + bg transparent）
- 文本侧 3 个 `.ft-divider`

**ImageEditTool.tsx 22 处内联样式**（L114-311，含 container、header、两个 Tab、三个 input、选择按钮、取消/嵌入按钮、错误提示）。

**迁移起点（FloatingToolbar 图片专属逻辑）**：`editImage`、`anchorRect`、`handleEditImage`、`editImagePrefill`、`editImagePosition`、`handleEditConfirm`、`handleEditCancel`、`handleAlignImage/handleMakeInline/handleRemoveImage`、scroll 重锚定分支、图片 JSX。

---

## 1. 变更清单

### 新增
| 文件 | 内容 |
| ---- | ---- |
| `src/render/components/Editor/v2/toolbarState.ts` | `SelectionState`、`ToolbarState`、`computeToolbarState`、`nearestContentSpan`（纯函数，无 React 依赖） |
| `src/render/components/Editor/v2/ImageToolbar.tsx` | 图片工具栏子组件（见 §3） |

### 修改
| 文件 | 改动 |
| ---- | ---- |
| `FloatingToolbar.tsx` | ① 删图片专属 state/logic/JSX → 换 `<ImageToolbar .../>` 挂载点；② `SelectionState/ToolbarState` 改 import；③ 末尾 `export { syntaxTypeToOption, selectionSyntaxTypesConsistent } from './toolbarState'` 保持测试兼容；④ 11 处内联样式 → CSS 类；⑤ 保留文本工具栏/块下拉/InsertUrlModal/事件监听；⑥ `computeToolbarState` import 自 `./toolbarState` |
| `ImageEditTool.tsx` | 22 处内联样式 → `.ie-*` CSS 类，JSX 结构零改动 |
| `InsertUrlModal.tsx` | 结构清理（已用 CSS 类） |
| `globals.css` | 新增 ImageToolbar / `.ie-*` / FloatingToolbar 迁移类 |

### 不动
`types.ts`；所有内核/控制器。

---

## 2. 分步顺序（每步独立验证）

> 每步通用验证：`npx vitest run tests/components/FloatingToolbarV2.test.tsx tests/components/ImageToolbarV2.test.tsx` + `npm run typecheck`。E2E 最后统一跑。

- **Step 0 基线复核**：`npx vitest run` + typecheck，记录 41/724。
- **Step 1 纯函数提取（toolbarState.ts）**：迁 `SelectionState`/`ToolbarState`/`computeToolbarState`/`selectionSyntaxTypesConsistent`/`syntaxTypeToOption`/`nearestContentSpan`；FloatingToolbar import + re-export。验证：FloatingToolbarV2 + typecheck。
- **Step 2 提取 ImageToolbar 组件【核心】**：迁图片 state/logic/JSX；FloatingToolbar 挂载 `<ImageToolbar/>`；scroll 重锚定分支迁入 ImageToolbar 自管。**风险 A 处理**：ImageToolbar 弹层态经 `onModalStateChange(open)` 上抛，FloatingToolbar 并入 `isModalOpen`。验证：ImageToolbarV2 + FloatingToolbarV2 + typecheck。
- **Step 3 ImageToolbar 样式 → CSS 类**：`.it-toolbar` + `.it-divider`。验证：ImageToolbarV2。
- **Step 4 ImageEditTool → `.ie-*` 类**：22 处逐条映射，data-testid/className 保留。验证：ImageToolbarV2 + lint。
- **Step 5 FloatingToolbar 文本侧样式 → CSS 类**：容器/trigger/menu/option/divider。**决策：ToolbarButton active/hover 内联保留不迁**（防破坏 FloatingToolbarV2 active 色断言）。验证：FloatingToolbarV2。
- **Step 6 清理收尾**：删未用 import/ref；InsertUrlModal 清理；全量单测 + typecheck + lint + build。
- **Step 7 E2E**：`npx playwright test`。

---

## 3. ImageToolbar 组件 props 接口

```ts
interface ImageToolbarProps {
  imageSelection: ImageSelection;              // 非空传入（null 时不渲染本组件）
  editorContainerRef: React.RefObject<HTMLDivElement>; // 滚动重锚定查询 img
  tree: BlockTreeV2;                            // editImagePrefill tokenizeInline
  onCloseImage?: () => void;
  onEditImage?: (sel: ImageSelection) => void;
  onAlignImage?: (blockId: string, align: ImageAlign) => void;
  onMakeInline?: (blockId: string) => void;
  onRemoveImage?: (blockId: string, start: number, end: number) => void;
  onReplaceImage?: (blockId, imgStart, imgEnd, img) => void;
  onModalStateChange?: (open: boolean) => void; // 弹层态上抛（风险 A）
}
```
内部：`anchorRect`（惰性初始化 + 同步 effect）、`editImage`、`editImagePrefill`、`editImagePosition`、自管 scroll 重锚定监听、ToolbarButton 复用（迁入或共享）。图片鼠标离开用 `scheduleHide(300)`。

---

## 4. 状态归属划分

| State | 归属 | 依据 |
| ---- | ---- | ---- |
| `visible` / `position` / `selection`（文本选区） | **FloatingToolbar** | 文本工具栏核心 |
| `insertModal`（link） | **FloatingToolbar** | 链接弹层 |
| `anchorRect` / `editImage` / `editImagePrefill` / `editImagePosition` | **ImageToolbar** | 图片专用 |
| `imageSelection` | **EditorV2 持有 → 透传**（只读 prop） | 不迁移 |
| scroll 重锚定分支 | **ImageToolbar 自管** | 图片跟随 |

迁移后 FloatingToolbar 的 scroll/mousedown/keydown 只保留文本语义；图片外部点击关闭与 Escape 的 guard 分支保留在 FloatingToolbar（`isModalOpen` 并入 `onModalStateChange` 上抛的弹层态）。

---

## 5. 兼容性策略

- **测试导入**：`syntaxTypeToOption`/`selectionSyntaxTypesConsistent` 保留 FloatingToolbar re-export → FloatingToolbarV2 零改动；`types.ts` 不动。
- **e2e/data-testid**：`.floating-toolbar-v2`、`.block-type-trigger/menu/option`、`[data-value]`、`[data-testid="image-toolbar"]`、`image-toolbar-edit/inline/align-*/remove`、`[data-testid="image-edit-tool"]`、`.ft-divider` 全部原样保留。
- **动态 style→CSS 类**：`position:fixed; z-[100]`、`top/left` 计算值（clamp 依赖 offsetWidth/Height）**不能静态化**，保持 JS 计算；仅背景/边框/颜色类提取。
- **CSS 落点**：`.it-toolbar`（图片工具栏容器）、复用 `.ft-divider`；`.ie-*` 12~14 个语义类（container/header/tab/field/label/input/error/btn 等，var() 原样）。

---

## 6. 验收标准

1. `npx vitest run`：41 文件 / 724 测试全绿，断言零修改（除必要时测试导入路径）
2. `npm run typecheck`：0 错误
3. `npm run lint`：0 error（8 warnings 既有或更少）
4. `npm run build`：通过
5. `npx playwright test`：E2E 全绿（floating-toolbar.spec.ts 优先）
6. DOM 契约：类名/data-testid/块下拉选择器 diff 为空

---

## 7. 风险与回退

| 风险 | 缓解 |
| ---- | ---- |
| **A（高）** editImage 迁入后 `isModalOpen` 守卫失去弹层开合认知 | `onModalStateChange(open)` 上抛并入 `isModalOpen`；事件监听顺序/语义复刻 |
| **B（中）** 图片外部点击关闭/Escape 归属 | 保留在 FloatingToolbar，ImageToolbar 不重复注册 |
| **C（中）** ToolbarButton active 色断言依赖内联 style | **保留 ToolbarButton 内联不迁**（降风险） |
| **D（低）** 锚定依赖 toolbarRef 尺寸 | ref 各组件独立持有，offsetWidth/Height 回退 320/40 复刻 |
| **E（低）** scroll 监听迁移竞争 | 顺序/语义复刻；目标测试 Bug B + e2e E7 守护 |
| **回退** | 改动集中 4 组件 + globals.css；断言变化即 `git checkout <file>` 回退该步 |

---

## 8. 实施顺序回放

Step 0 基线 → Step 1 纯函数 → Step 2 提取 ImageToolbar（重点风险 A/C）→ Step 3/4 图片侧 CSS 类 → Step 5 文本侧 CSS 类 → Step 6 清理+全量 → Step 7 E2E。
