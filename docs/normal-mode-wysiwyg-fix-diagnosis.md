# WeaveMD Normal Mode 编辑功能 — 诊断与现状文档

## 一、实现目标

修复 Normal Mode（非源码模式）下两个核心问题：

1. **新增内容保存**：用户按 Enter 新建段落并输入内容后，切换到源码模式（Ctrl+`），新增内容不应丢失
2. **Markdown 语法自动渲染**：用户在非源码模式下输入 Markdown 语法（如 `# 标题`、`- 列表`、`> 引用`）后按 Enter，应立即渲染为富文本格式

## 二、遇到的具体问题

### 问题 1：新增内容切换模式后丢失

**现象**：Normal Mode 下按 Enter 新建段落 → 输入内容 → 按 Ctrl+` 切换到源码模式 → 新增内容丢失

**根因分析**：

```
数据流路径：

用户输入 → contentEditable DOM
    ↓ (onInput 事件)
handleBlockContentChange → 更新 blockTreeRef.current + setBlockTree + syncTreeToStore
    ↓
editorStore.content (Zustand store)
```

**竞态场景**：
1. 用户在新块中输入内容，触发 `handleBlockContentChange`
2. React 状态更新是异步的，`blockTree` prop 尚未更新
3. 用户快速按 **Ctrl+`** 切换模式
4. `syncContentBeforeToggle` 回调执行，从 `blockTreeRef.current` 读取（✅ 这里是新的）
5. 但组件卸载时 `handleBlur` 触发，读取的 `blockTree` 仍然是旧 props 值（❌ 这里是旧的）
6. `handleBlur` 调用 `onBlockContentChange(blockId, newContent)`，但该函数读取的 ref 可能已被覆盖

**核心代码问题**：
- `EditorScrollContainer.tsx` 的 `handleBlur` 函数（第 84-109 行）使用 `blockTree.blocks[blockId]` —— 这个 `blockTree` 来自 React props，在快速操作时可能是旧值
- `EditorScrollContainer.tsx` 缺少 `blockTreeRef` prop，无法获取最新的 block tree 状态

### 问题 2：Markdown 语法不自动渲染

**现象**：输入 `# 标题` → 按 Enter → 不转换为 H1 样式；需切换到源码模式再切回来才渲染

**根因分析**：
1. `handleBlockEnter` 中的 Markdown 检测路径需要正确更新 `version` 字段
2. 渲染 useEffect 依赖 `blockTree.version`，如果 version 没变，不会重新渲染
3. 已修复：在手动构造 block tree 时显式递增 `version`

## 三、当前代码状态

### 已完成的修复

| 文件 | 修改内容 | 状态 |
|------|---------|------|
| `EditorView.tsx` | 5个 handler 函数重构：消除 `setBlockTree((prev) => { syncTreeToStore(next) })` 反模式 | ✅ 已完成 |
| `EditorView.tsx` | `syncContentBeforeToggle` 添加 version 递增 | ✅ 已完成 |
| `EditorView.tsx` | 清理所有 `[DEBUG]` 日志 | ✅ 已完成 |
| `EditorScrollContainer.tsx` | 添加 `blockTreeRef` prop 并在 `handleBlur` 中使用 | ❌ **尚未完成** |

### 关键未修复点

**`EditorScrollContainer.tsx` 第 84-109 行的 `handleBlur`**：

```typescript
const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      const blockId = getBlockIdFromEventTarget(e.target);
      if (!blockId) return;

      const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
      if (blockEl) {
        const block = blockTree.blocks[blockId];  // ← 问题：使用 props 中的 blockTree（可能过时）
        // ...
      }
    },
    [blockTree, onBlockContentChange]  // ← 依赖 blockTree props
  );
```

应改为使用 `blockTreeRef.current` 获取最新状态。

### 已实施的解决方案（EditorView.tsx）

所有写入操作遵循统一模式：

```typescript
// ✅ 正确模式（已应用于 EditorView.tsx 所有 handler）
const currentTree = blockTreeRef.current;  // 1. 从 ref 读取最新状态
const nextTree = computeTree(currentTree);  // 2. 在外部计算新树
blockTreeRef.current = nextTree;            // 3. 先更新 ref
setBlockTree(nextTree);                     // 4. 再触发 React 渲染
syncTreeToStore(nextTree);                  // 5. 最后同步到全局 store
```

**已修复的函数**：
- `handleBlockContentChange` — 内容变更（含 Markdown 检测）
- `handleBlockEnter` — Enter 键新建段落（含 Markdown 检测路径）
- `handleFenceLanguageChange` — 代码块语言切换
- `handleBlockDelete` — 删除空段落
- `handleBlockTypeChange` — 块类型变更

## 四、需要完成的修复

### 修复 1：EditorScrollContainer.tsx — 添加 blockTreeRef

```typescript
// interface 添加
interface EditorScrollContainerProps {
  blockTree: BlockTree;
  blockTreeRef: React.MutableRefObject<BlockTree>;  // ← 新增
  // ... 其他 props
}

// handleBlur 修改
const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      const blockId = getBlockIdFromEventTarget(e.target);
      if (!blockId) return;

      const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
      if (blockEl) {
        const block = blockTreeRef.current.blocks[blockId];  // ← 使用 ref
        // ...
      }
    },
    [blockTreeRef, onBlockContentChange]  // ← 依赖 ref
  );
```

### 修复 2：EditorView.tsx — 传递 blockTreeRef 给 EditorScrollContainer

```typescript
<EditorScrollContainer
  blockTree={blockTree}
  blockTreeRef={blockTreeRef}  // ← 传递 ref
  // ... 其他 props
/>
```

## 五、验证命令

```bash
npm run typecheck    # TypeScript 类型检查
npm run lint         # ESLint 代码规范
npm run test         # Vitest 单元测试（185 个用例）
npm run dev          # 启动开发服务器手动验证
```

## 六、相关文件路径

| 文件 | 作用 |
|------|------|
| `src/render/components/Editor/EditorView.tsx` | 编辑器主视图，模式切换、内容同步 |
| `src/render/components/Editor/EditorScrollContainer.tsx` | 滚动容器，事件委托、blur 处理 |
| `src/render/services/blockTree.ts` | BlockTree 数据模型和操作函数 |
| `src/render/services/lineMarkdown.ts` | Markdown 语法检测 |
| `src/render/stores/editorStore.ts` | Zustand 编辑器状态管理 |
| `src/render/stores/uiStore.ts` | Zustand UI 状态管理 |
