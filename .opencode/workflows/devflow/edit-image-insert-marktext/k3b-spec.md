# K3b 装配接线任务规格（edit-image-insert-marktext）

对象：WeaveMD `D:\software\WeaveMD`。强制 TDD（RED 先看到失败→实现→GREEN，证据真实执行）。不要执行 git 提交。必须返回结构化摘要 {完成项, 测试证据, 未完成项, 风险}，禁止空返回。

## 背景（K1/K2/K3a 已完成，勿改其文件）
- `formatCtrl.insertImagePlaceholder(instance, blockId, start, end)`：写 `![label]()`，label=选区文本||'图片'，光标落括号内。
- `formatCtrl.replaceImage(instance, blockId, s, e, {src,alt,title?})`：token 精确匹配替换，focus 到 token 末；不匹配返回 null。
- 已有 `ImageEditTool.tsx` Props：`{ open, position:{top,left}, initialAlt, pickImage?, onConfirm({src,alt,title}), onCancel }`（open=false 渲染 null；双 Tab；Escape/取消/× → onCancel；Select pickImage 非空直接 onConfirm、null 保持打开、无 pickImage 不崩溃；Link src 聚焦全选+alt/title+嵌入/Enter 非空提交）。

## 先阅读（完整读再动手）
- `src/render/components/Editor/v2/FloatingToolbar.tsx`
- `src/render/components/Editor/v2/useEditorActions.ts`
- `src/render/components/Editor/v2/EditorV2.tsx`
- `src/render/components/Editor/v2/ImageEditTool.tsx`
- `tests/components/floatingToolbarV2.test.tsx`
- `src/render/editor/controllers/formatCtrl.ts`（只看签名）
- 需求/计划：`.opencode/workflows/devflow/edit-image-insert-marktext/requirements.md` 与 `plan.md`

## 实现要求

### 1. useEditorActions.ts
新增 `onInsertImage(blockId, start, end)`、`onReplaceImage(blockId, imgStart, imgEnd, img)`，经既有 `applyBlockAction` 管线调 formatCtrl 对应函数；加入 handlers。

### 2. EditorV2.tsx
向 FloatingToolbar 透传 `onInsertImage`、`onReplaceImage`、`getBlockEl`。

### 3. FloatingToolbar.tsx
- 新增 props：`onInsertImage`、`onReplaceImage`、`getBlockEl`。
- `handleFormat` 的 image 分支：不再 `setInsertModal({style:'image'})`；改调 `onInsertImage(blockId, start, end)`；记录 `imageEdit = { blockId, imgStart: start, imgEnd: start + 2 + label.length + 5, initialAlt: label }`（`label = selection.anchorText || '图片'`）；随后 `stickyRef=false; hideToolbar()`（图片操作后立即隐藏）。link 分支保持现状（InsertUrlModal）。
- 锚定 effect（deps `[tree, imageEdit]`）：`imageEdit` 非空时，取 `tree.blocks[id].text` → `tokenizeInline(text)` 过滤 image token → 定位 `token.start===imgStart` 的 token（fallback：含 imgStart 中点的 token）→ 其序号 n → `getBlockEl(blockId)?.querySelectorAll('.inline-image, .inline-image-empty')[n]` → 元素存在则 `getBoundingClientRect()` → `position = { top: rect.bottom + 6, left: clamp(rect 中心, 视口内) }` 并置 open；元素不存在（DOM 未更新）则返回等待下次 effect。
- 渲染 `<ImageEditTool open={!!imageEditPos && !!imageEdit} position={imageEditPos} initialAlt={imageEdit?.initialAlt} pickImage={window.weaveMD?.dialog.pickImage} onConfirm={(img)=>{ onReplaceImage(imageEdit.blockId, imageEdit.imgStart, imageEdit.imgEnd, img); setImageEdit(null); }} onCancel={()=>setImageEdit(null)} />`。InsertUrlModal 保留给 link。
- **interactionGuard**：所有原 `if (insertModal)` 守卫点（flushSelection / mousedown 外部 / Escape）改为 `insertModal !== null || imageEdit !== null`。可将返回结构改为单一包裹 div（ref 覆盖工具栏 + ImageEditTool），使 ImageEditTool 参与外部点击关闭，且不破坏 `floating-toolbar-v2 fixed` 样式。

### 4. 测试适配 + 新增（tests/components/floatingToolbarV2.test.tsx）
- 适配既有"图片按钮 → prompt/modal"相关用例为新两段式；链接 TB 用例零改动。
- 新增：
  1. 点图片 → `onInsertImage` 被调 + 工具栏隐藏 + ImageEditTool 出现（含 initialAlt）；
  2. ImageEditTool 确认 → `onReplaceImage(blockId, imgStart, imgEnd, {src,alt,title})` + 弹层关闭；
  3. 取消/×/Escape → 不调 onReplaceImage，占位保留；
  4. 锚定 effect：mock `getBlockEl` 返回含 `.inline-image-empty` span 的 DOM（jsdom 手工构造，可 mock Element.prototype.getBoundingClientRect）→ 计算到非空 position；
  5. 无 pickImage 不崩溃。
- 需要时补充 mock `window.weaveMD.dialog.pickImage`；确保既有链接用例与 editorV2Format 相关断言不回归。

## 验证命令
- `npx vitest run tests/components/floatingToolbarV2.test.tsx tests/components/imageEditTool.test.tsx tests/components/editorV2Format.test.tsx tests/components/editorV2ImgFallback.test.tsx`
- `npx tsc --noEmit`

## 硬约束
- 只改：`useEditorActions.ts`、`EditorV2.tsx`、`FloatingToolbar.tsx`、`tests/components/floatingToolbarV2.test.tsx`（editorV2Format.test.tsx 仅在确有断言依赖时微调）。
- `InsertUrlModal.tsx`、`ImageEditTool.tsx`、内核/控制器文件一行不改。
- 不削弱权限、不泄露密钥、不部署、不修改生产数据；不执行 git 提交；不删既有测试。