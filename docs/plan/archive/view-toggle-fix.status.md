# 视图切换按钮修复状态文档

## 任务分级

- **请求类型**：Bug 修复 + 优化
- **影响面**：单模块（导航栏 + 编辑器视图切换）
- **预估工时**：S
- **裁剪理由**：S 级跳过完整流程，直接进入最小修复路径

## 问题分析

### 问题 1：冗余按钮

顶部导航栏有两个视图切换入口：
1. 独立的源代码/富文本切换按钮
2. ViewMenu 下拉菜单

两者功能重复，需要删除其中一个。

### 问题 2：滚动位置丢失

**富文本 → 源代码**：
- 保存：`savedNormalScrollRef.current`（scrollTop）
- 恢复：使用 `requestAnimationFrame`，但可能时机不对

**源代码 → 富文本**：
- 保存：`savedSourceLineRef.current`（行号）
- 恢复：需要转换为 scrollTop，但可能没有正确实现

### 根本原因

1. `requestAnimationFrame` 可能不够，新编辑器可能还没完全挂载
2. 从源代码模式切换到富文本模式时，保存的是行号，但恢复时需要转换为 scrollTop

## 修复方案

### 修改文件

1. `src/render/components/Navbar/TopBar.tsx`：删除 ViewMenu 组件
2. `src/render/components/Navbar/ViewMenu.tsx`：删除文件（可选）
3. `src/render/components/Editor/EditorView.tsx`：改进滚动位置保存和恢复逻辑

### 修改内容

1. **删除 ViewMenu**：保留独立的切换按钮，删除 ViewMenu 下拉菜单

2. **改进滚动位置保存**：
   - 富文本 → 源代码：保存 scrollTop 和当前可见区域的大致行号
   - 源代码 → 富文本：保存 scrollTop

3. **改进滚动位置恢复**：
   - 使用 `setTimeout` 替代 `requestAnimationFrame`，确保新编辑器完全挂载
   - 从源代码切换到富文本时，直接恢复 scrollTop（不转换行号）

## 测试证据

- [ ] 类型检查通过
- [ ] 功能验证

## 验证方法

1. 运行 `npm run dev` 启动应用
2. 在富文本模式下滚动到中间位置
3. 切换到源代码模式，验证是否跳转到文档最上方
4. 在源代码模式下滚动到中间位置
5. 切换到富文本模式，验证是否只跳转到文档下方一点点的位置

## 当前状态

- [x] 问题分析
- [x] 代码修复
- [x] 类型检查
- [ ] 用户验证

## 修改文件

1. `src/render/components/Navbar/TopBar.tsx`：删除 ViewMenu 组件导入和使用
2. `src/render/components/Editor/EditorView.tsx`：改进滚动位置保存和恢复逻辑
   - 使用 `savedSourceScrollRef` 替代 `savedSourceLineRef`（保存 scrollTop 而非行号）
   - 使用 `setTimeout` + `requestAnimationFrame` 确保编辑器完全挂载后再恢复
   - 统一使用 scrollTop 保存和恢复，避免行号转换问题

---

*文档创建时间：2026-09-12*
