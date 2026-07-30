# 源码模式目录导航高亮错位修复计划

## 问题根因

点击源码模式目录的 "3.2" 时：
1. `scrollToLine()` 先调用 `setPosition()` → 触发 `onDidChangeCursorPosition` → **正确识别 3.2 的行号** → 目录高亮 3.2 ✅
2. 紧接着调用 `revealPositionInCenterIfOutsideViewport()` → 触发 `onDidScrollChange` → 使用可见区域第一行 → **可能仍然是 3.1 的行号**（因为平滑滚动过程中 3.1 仍在可见区域顶部）→ 目录高亮被覆盖为 3.1 ❌

**根因**：`onDidScrollChange` 事件在导航后的触发覆盖了 `onDidChangeCursorPosition` 设置的正确高亮。

## 修改计划

### 文件：`SourceCodeEditor.tsx`

1. 新增 `isNavigatingRef` 引用（`useRef<boolean>(false)`），作为导航锁标志
2. 在 `scrollToLine` 方法中：
   - 导航前设置 `isNavigatingRef.current = true`
   - 导航完成后 600ms 设置 `isNavigatingRef.current = false`（足以覆盖平滑滚动）
3. 在 `updateActiveHeading(true)` 的 `onDidScrollChange` 回调中：
   - 检查 `isNavigatingRef.current`，若为 true 则跳过更新
   - 确保光标事件 `updateActiveHeading(false)` 不受影响

### 修改后的行为
- 点击目录导航时：光标事件立即正确设置高亮 → 滚动事件被暂时抑制 → 导航完成后恢复正常滚动检测
- 用户手动滚动/移动光标时：行为完全不受影响

## 验证
- TypeScript 类型检查
- ESLint 检查
- 手动测试：点击源码模式目录任意标题，确认高亮正确