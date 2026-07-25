# BUG-001: Monaco 隐藏 textarea 残留导致全域输入失效 + IME 候选窗错位

> 优先级：P0 | 状态：修复未生效 | 发现日期：2026-07-25 | 更新：2026-07-25

---

## 1. 故障现象

### 1.1 全域输入框失效

- **触发条件**：点击任意可视化富文本块进入编辑模式（激活 Monaco 迷你编辑器显示 MD 源码），然后打开查找与替换弹窗（Ctrl+F）
- **表现**：查找与替换弹窗的 `<input>` 输入框无法通过键盘输入任何内容（中英文均无效）
- **IME 候选窗错位**：中文输入法候选选词窗口吸附在**之前活跃块的位置**（截图1 红框处），而非弹窗输入框的实际位置
- **不影响**：鼠标操作正常
- **未触发时**：所有输入框和输入法完全正常

### 1.2 用户原始描述

> "当我点击红框处的某一内容时，该富文本会自动显示对应 markdown 原文。接着我使用查找与替换功能，明明弹框在应用居中位置（红框处），但是我的输入法弹窗会出现在蓝框处，也就是截图1的红框处，并且该查找功能的输入框输入不了任何内容。"

---

## 2. 根因分析（修订版）

### 2.1 问题本质：焦点转移时序竞争

问题的核心不是 Monaco 的隐藏 `<textarea>` 未被清理，而是 **焦点在组件卸载/挂载交替过程中的时序竞争**。

#### 关键架构细节

Monaco Editor 在内部使用一个隐藏的 `<textarea>`（class 为 `.ime-text-area` 或 `.inputarea`）来捕获键盘输入和 IME 组合。这个 textarea 由 `@monaco-editor/react` 包装器通过 `monaco.editor.create(containerElement, options)` 创建，挂载在包装器的容器 `<div>` 内部。

#### 完整时序链路（Ctrl+F 按下时的精确流程）

```
时刻 T0: 用户按下 Ctrl+F
  ├─ 焦点位于 Monaco 隐藏 textarea 内
  └─ 事件冒泡到 window

时刻 T1: window keydown handler 触发 (EditorView.tsx:515-529)
  ├─ setActiveBlockId(null)    ← React 18 批处理调度
  └─ openModal('findReplace')  ← Zustand store 同步更新

时刻 T2: React 18 单次批处理提交
  ├─ DOM 变更：
  │   ├─ 移除 ActiveBlockEditor 的 React DOM（div.active-block-editor）
  │   │   └─ 副作用：Monaco 编辑器 DOM（含隐藏 textarea）随父元素一起被移除
  │   └─ 插入 FindReplaceModal 的 React DOM（含 autoFocus 的 <input>）
  │
  ├─ autoFocus 处理：
  │   └─ 浏览器尝试将焦点转移到新插入的 input
  │       ⚠ 但原焦点元素（Monaco textarea）刚被移出 DOM
  │       ⚠ 浏览器焦点转移可能不完整——
  │          - 常规英文键盘：通常能正常转移
  │          - CJK IME 上下文：OS 层面的 IME 状态可能仍然绑定在
  │            旧 textarea 的屏幕坐标上
  │
  └─ useLayoutEffect 清理（如果有的话）：此项目未使用

时刻 T3: useEffect cleanup 异步执行（在浏览器绘制之后）
  ├─ @monaco-editor/react 内部 cleanup:
  │   └─ editor.dispose() —— 编辑器 DOM 已被 React 移除，此操作可能是空操作
  │
  └─ 我们的 Fix 1 cleanup (ActiveBlockEditor.tsx:311-361):
      ├─ editor.getModel() === null 检查
      │   └─ 如果 @monaco-editor/react 已 dispose → 返回 null → 提前返回！
      │       我们跳过了 blur() 和 Phase 3 孤儿清理
      └─ 如果 model 尚在:
          ├─ Phase 1: hiddenTextarea.blur() — 但 textarea 已脱离 DOM，blur() 无效
          ├─ Phase 2: editor.dispose() — 对已脱离 DOM 的编辑器调用
          └─ Phase 3: queueMicrotask → RAF 孤儿清理 → 已无 textarea 在 DOM 中
```

### 2.2 根本原因（三重打击）

#### 根因 1：焦点元素被移除时浏览器行为不确定

React 在提交阶段**同步**移除了整个 ActiveBlockEditor DOM 树（包括 Monaco 隐藏 textarea），然后**同步**插入了 FindReplaceModal DOM（含 autoFocus input）。

当浏览器的焦点元素被直接从 DOM 中移除时：
- **Chromium 行为因版本/平台而异**：焦点可能正确转移到下一个可聚焦元素，也可能"卡住"在已移除元素的坐标上
- **Windows IME 上下文特别敏感**：OS 层面的 IME 状态管理器（TSF - Text Services Framework）不会立即收到焦点变更通知，导致候选窗坐标仍然指向旧位置
- 如果焦点转移失败，新插入的 `autoFocus` input **不会自动获得焦点**

#### 根因 2：无"控件白名单"机制（用户洞察确认 ✅）

用户的关键洞察是正确的。当前架构中，当块处于活跃状态时：

1. 系统没有定义"哪些 DOM 元素可以安全地接收键盘焦点"
2. 打开模态框时，系统仅调用 `setActiveBlockId(null)` 来隐式释放块编辑状态
3. 没有任何**显式的焦点转移机制**来保证模态框输入框一定能获得焦点
4. 完全依赖浏览器自带的焦点管理和 `autoFocus` 属性，这在 DOM 剧烈变化时不可靠

**缺失的设计模式**：一个"安全焦点接收者"注册表或显式焦点转移 API。当模态框/对话框打开时，应该有确定性的焦点转移流程，而不是依赖 React 卸载→挂载→autoFocus 的隐式链路。

#### 根因 3：我们的 Fix 1 cleanup 的执行时机太晚

Fix 1 的三阶段清理是在 `useEffect` cleanup 中执行的（异步，在浏览器绘制之后）。此时：

- 如果 `@monaco-editor/react` 先执行 cleanup → `editor.getModel()` 返回 null → 我们提前返回，blur 被跳过
- 如果我们的 cleanup 先执行 → textarea 已脱离 DOM → blur() 无效果
- **无论哪种顺序，textarea 都在没有经过正确 blur 的情况下被移除了**

**这意味着**：OS 层面的 IME 焦点可能永远没有收到 "blur" 通知，导致 IME 状态残留。

### 2.3 为什么 IME 候选窗位置错乱

IME 候选窗的屏幕坐标由 Windows TSF 根据**最后收到焦点事件的 textarea 的屏幕位置**来计算：

```
1. Monaco 隐藏 textarea 获得焦点 → IME 记录其位置 (X1, Y1)
2. React 移除 textarea（无 blur 通知给 OS）→ IME 仍认为焦点在 (X1, Y1)
3. FindReplaceModal 的 input 渲染在屏幕中央
4. 用户切换输入法开始打字 → IME 候选窗出现在 (X1, Y1) = 旧块位置
5. 但用户期望候选窗在 modal input 位置 → 视觉错位
```

### 2.4 为什么弹窗输入框完全无法输入

如果焦点没有正确转移到 FindReplaceModal 的输入框：
- 物理键盘事件路由到 `document.body`（或某个不确定的元素）
- 输入框的 `onChange` / `onKeyDown` 永远不触发
- 即使用鼠标点击输入框，如果存在残留的焦点拦截（如孤儿 textarea 的事件监听器），焦点可能被立即抢走

---

## 3. 修复方案（修订版）

### 方案 A（核心修复）：使用 useLayoutEffect 确保 blur 在 DOM 移除前执行 ⭐

**原理**：`useLayoutEffect` 的 cleanup 在 React 提交阶段**同步**执行，在 DOM 被移除之前。这确保我们在 React 移除 Monaco DOM 之前完成 blur。

```typescript
// ActiveBlockEditor.tsx — 将 cleanup 从 useEffect 改为 useLayoutEffect
useLayoutEffect(() => {
  return () => {
    const editor = editorRef.current;
    if (!editor) return;

    // 在 React 移除 DOM 之前，先找到隐藏 textarea 并强制 blur
    try {
      const domNode = editor.getDomNode();
      if (domNode) {
        const textareas = domNode.querySelectorAll('textarea');
        textareas.forEach(ta => {
          if (ta instanceof HTMLTextAreaElement) {
            ta.blur();          // 释放浏览器焦点
            ta.disabled = true; // 阻止后续焦点劫持
          }
        });
      }
    } catch { /* best-effort */ }

    // 手动从 DOM 移除 textarea（在 React 移除容器之前）
    // 确保没有任何残留节点
    try {
      const domNode = editor.getDomNode();
      if (domNode) {
        domNode.querySelectorAll('textarea.ime-text-area, textarea.inputarea')
          .forEach(el => el.remove());
      }
    } catch { /* best-effort */ }

    // 最后 dispose 编辑器
    try {
      if (editor.getModel() !== null) {
        editor.dispose();
      }
    } catch { /* best-effort */ }

    editorRef.current = null;
  };
}, [block.id]);
```

**为什么这能解决问题**：
- Phase 1（blur）在 React 移除 DOM **之前**执行 → OS 收到正确的焦点释放通知
- Phase 2（手动移除 textarea）在容器 div 被移除**之前**执行 → 没有孤儿节点
- `disabled = true` 防止 textarea 在 blur 和 remove 之间重新获得焦点

### 方案 B（控件白名单）：显式焦点接收者机制 ⭐

**原理**：当模态框/对话框打开时，提供显式的焦点转移 API，不依赖浏览器 autoFocus。

在 `uiStore` 或 `EditorView` 中添加：

```typescript
// 当模态框打开时，确保焦点转移到模态框
const openModalWithFocus = useCallback((modalName: string, focusSelector: string) => {
  // 1. 先停用所有块（释放 Monaco 焦点）
  setActiveBlockId(null);
  
  // 2. 打开模态框
  useUIStore.getState().openModal(modalName);
  
  // 3. 使用 requestAnimationFrame 等待 DOM 更新后显式设置焦点
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const target = document.querySelector(focusSelector) as HTMLElement | null;
      if (target) {
        target.focus();
      }
    });
  });
}, []);
```

### 方案 C（防御性兜底）：全局焦点审计

**原理**：在任何模态框打开时，检查是否存在孤儿 Monaco textarea 并立即清理。

```typescript
// uiStore.openModal 中添加
openModal: (modal) => {
  // 全局清理潜在的孤儿 Monaco textarea
  document.querySelectorAll('textarea.ime-text-area, textarea.inputarea')
    .forEach(el => {
      const monacoRoot = el.closest('.monaco-editor');
      if (!monacoRoot || !document.body.contains(monacoRoot)) {
        (el as HTMLTextAreaElement).blur();
        el.remove();
      }
    });
  
  set({ activeModal: modal });
},
```

### 建议执行顺序

| 优先级 | 方案 | 理由 |
|--------|------|------|
| **P0** | 方案 A | 从根源修复：确保 blur 在 DOM 移除之前执行 |
| **P1** | 方案 C | 防御性兜底：在任何模态框打开时清理残留 |
| **P2** | 方案 B | 显式焦点管理：提供确定性焦点转移 API |

---

## 4. 验证标准（更新）

| # | 测试场景 | 预期结果 | 关键检查点 |
|---|---------|---------|-----------|
| 1 | 点击块编辑 → Ctrl+F → 在查找输入框中输入英文 | 可正常输入 | 焦点在查找输入框 |
| 2 | 点击块编辑 → Ctrl+F → 在查找输入框中输入中文 | IME 候选窗在查找输入框附近 | IME 位置正确 |
| 3 | 点击块编辑 → Escape 退出 → 点击其他块编辑 → Ctrl+F | 可正常输入中英文 | 无残留状态 |
| 4 | 快速多次 Ctrl+F 切换（块活跃时） | 弹窗正常打开，焦点正确 | 无竞态条件 |
| 5 | DevTools: 打开查找弹窗后检查 DOM | 0 个孤儿 `textarea.ime-text-area` / `textarea.inputarea` | DOM 干净 |
| 6 | 编辑块 → 点击导航栏按钮打开查找 → 输入中英文 | 可正常输入 | 非 Ctrl+F 路径也正常 |
| 7 | 编辑块 → 不退出编辑 → 直接 Ctrl+F → 输入 → 关闭 → 回到原块 | 块仍然活跃，可继续编辑 | 不影响编辑流程 |
| 8 | CJK IME 输入拼音后按 Enter 确认字符（在块编辑中） | 字符确认，不触发块分裂 | Fix 3 验证 |

---

## 5. 影响范围评估

- **修改文件**：
  - `ActiveBlockEditor.tsx`：将 cleanup 从 `useEffect` 改为 `useLayoutEffect`，增强 blur 逻辑
  - `uiStore.ts`：在 `openModal` 中添加全局孤儿 textarea 清理（方案 C）
  - `EditorView.tsx`：可能调整 Ctrl+F 处理器的焦点管理逻辑
- **回归风险**：**中等** —— `useLayoutEffect` 是同步执行的，需要确保不会阻塞渲染；UI Store 的 `openModal` 修改影响所有模态框
- **测试要求**：必须在 Windows 环境下使用中文输入法进行实际验证

---

## 6. 用户洞察总结

> "我的思路是可能是未作控件白名单"

**这个思路是正确的**。问题本质上是：

1. 🔴 **缺失显式焦点转移机制**：系统依赖浏览器隐式的 autoFocus 行为，在 DOM 剧烈变化（块编辑器卸载 + 模态框挂载）时不可靠
2. 🔴 **Monaco textarea 的 blur 时机太晚**：在 `useEffect` cleanup 中执行 blur 时，textarea 已被 React 移出 DOM，blur 无效
3. 🔴 **OS IME 上下文残留**：Windows TSF 需要收到正确的焦点释放通知才能更新 IME 候选窗位置

---

> 文档版本：v2.0 | 作者：Claude | 用户已确认根因方向 | 待执行修复
