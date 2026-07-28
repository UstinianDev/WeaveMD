# Normal Mode → Source Code Mode 内容同步修复计划

## 问题概述

| 操作方向 | 现象 |
|---------|------|
| Normal Mode → Source Code Mode | 修改内容丢失 |
| Source Code Mode → Normal Mode | 修改内容保留（正常） |

## 根因分析

### 数据流路径对比

**Source Code Mode → Normal Mode（正常）**
```
toggleSourceCodeMode()
→ useEffect 监听 isSourceCodeMode 变化
→ 从 editorStore.getState().content 获取最新内容
→ buildBlockTree(latestContent) 重建 blockTree
→ 显示最新内容 ✅
```

**Normal Mode → Source Code Mode（不工作）**
```
用户编辑 → DOM contentEditable
→ handleBlur 触发（失焦时）
→ onBlockContentChange
→ setBlockTree 更新 blockTree（本地状态）
→ syncTreeToStore → setContent 更新 editorStore

切换时：
toggleSourceCodeMode()
→ 直接切换状态
→ SourceCodeEditor 读取 editorStore.content
→ ❌ 如果 handleBlur 未触发，content 是旧值
```

### 问题核心

1. **同步时机问题**：Normal Mode 编辑通过 `handleBlur`（失焦事件）同步。切换模式时，焦点可能还在编辑区域内，`handleBlur` 不会触发。

2. **toggleSourceCodeMode 无同步保障**：当前实现直接切换状态，没有确保 Normal Mode 的编辑已同步。

## 修复方案

### 阶段 1：添加回调机制到 uiStore

修改文件：`src/render/stores/uiStore.ts`

1. 在 `UIStore` 接口添加：
   ```typescript
   beforeToggleSourceMode: (() => void) | null;
   setBeforeToggleSourceMode: (callback: (() => void) | null) => void;
   ```

2. 修改 `toggleSourceCodeMode`：
   ```typescript
   toggleSourceCodeMode: () => {
     get().beforeToggleSourceMode?.();  // 先执行同步回调
     set((s) => ({ isSourceCodeMode: !s.isSourceCodeMode }));
   }
   ```

3. 添加初始状态和方法实现。

### 阶段 2：在 EditorView 注册同步回调

修改文件：`src/render/components/Editor/EditorView.tsx`

1. 添加 ref 保存最新的 blockTree：
   - 在 `useState<BlockTree>` 声明后创建 `blockTreeRef`
   - 在 render 中更新 `blockTreeRef.current = blockTree`

2. 添加 useEffect 注册回调：
   ```typescript
   useEffect(() => {
     const syncContent = () => {
       if (!isSourceCodeMode) {
         const serialized = serializeBlockTree(blockTreeRef.current);
         isUpdatingFromExternalRef.current = true;
         setContent(serialized);
       }
     };
     useUIStore.getState().setBeforeToggleSourceMode(syncContent);
     return () => {
       useUIStore.getState().setBeforeToggleSourceMode(null);
     };
   }, [isSourceCodeMode, setContent]);
   ```

### 阶段 3：快捷键双重保障

修改文件：`src/render/components/Editor/EditorView.tsx`

在 Ctrl+` 快捷键处理（约 417 行）中，在调用 `toggleSourceCodeMode()` 前添加同步：

```typescript
if (ctrl && e.key === '`') {
  e.preventDefault();
  // 双重保障：直接同步
  if (!isSourceCodeMode) {
    const serialized = serializeBlockTree(blockTreeRef.current);
    isUpdatingFromExternalRef.current = true;
    setContent(serialized);
  }
  useUIStore.getState().toggleSourceCodeMode();
  return;
}
```

## 文件修改清单

| 文件 | 修改内容 | 风险等级 |
|------|---------|---------|
| `src/render/stores/uiStore.ts` | 添加 beforeToggleSourceMode 回调机制 | 低 |
| `src/render/components/Editor/EditorView.tsx` | 注册同步回调 + 快捷键双重保障 | 低 |

## 验证步骤

1. `npm run typecheck` — 类型检查
2. `npm run lint` — ESLint 检查
3. `npm run test` — 运行测试
4. 手动验证：
   - Normal Mode 编辑内容 → 切换到 Source Code Mode → 内容保留
   - Source Code Mode 编辑内容 → 切换到 Normal Mode → 内容保留
   - 重复切换，内容一致

## 注意事项

- 所有 ref 必须在其依赖的状态变量之后声明，避免 TypeScript "used before declaration" 错误
- 使用 `isUpdatingFromExternalRef` 防止 useEffect 循环触发
- 回调通过 ref 读取最新值，避免闭包陈旧值问题
