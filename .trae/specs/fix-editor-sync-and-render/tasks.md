# WeaveMD 编辑器同步与实时渲染修复 - The Implementation Plan

## [x] Task 1: 修复 handleBlockEnter 中当前块内容未同步问题

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 修改 `EditorView.tsx` 中的 `handleBlockEnter` 函数
  - 在普通分支（无 Markdown 类型转换）中，先更新当前块（用户正在编辑的块）的 `sourceLines`，再创建新块
  - 需要读取 DOM 中当前块的最新文本内容，使用 `buildSourceLinesFromContent` 构建新的 sourceLines
  - 确保序列化时当前块的内容不丢失
  - 同时处理类型转换分支中的相同问题（确保转换后的块也使用最新内容）
- **Acceptance Criteria Addressed**: [AC-1, AC-7]
- **Test Requirements**:
  - `programmatic` TR-1.1: 在段落 A 中输入文本后按 Enter，新段落 B 创建，切换到源码模式后 A 的文本完整保留
  - `programmatic` TR-1.2: 对包含 Markdown 前缀的段落按 Enter（触发类型转换），原内容正确转换并保留
  - `programmatic` TR-1.3: 空段落按 Enter 创建新空段落，无异常
  - `programmatic` TR-1.4: 多个段落依次创建，所有内容在模式切换后完整保留
- **Notes**: 关键修改点在 `EditorView.tsx` 的 `handleBlockEnter` 函数。当前在普通分支中仅执行 `insertBlockAfter`，需增加对当前块的内容更新步骤。参考类型转换分支的实现逻辑。

## [x] Task 2: 实现 Normal Mode 下 Markdown 实时渲染

- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 在 `EditorScrollContainer.tsx` 的内容编辑区域添加 `onInput` 事件监听
  - 当用户输入时，检测当前块的文本内容是否发生 Markdown 语法变化
  - 调用 `detectMarkdownLine` 检测 Markdown 类型
  - 若检测到类型变化（如 paragraph → heading），更新 BlockTree 中该块的类型和 sourceLines
  - 若类型未变化但内容有更新，仅更新 sourceLines
  - 光标位置管理：在更新块后，将光标恢复到用户预期的位置（基于字符偏移计算）
  - 需要处理防抖（debounce）以避免快速输入时的性能问题
  - 需要处理 IME（输入法）兼容：`isComposing` 期间不触发实时渲染
- **Acceptance Criteria Addressed**: [AC-2, AC-3, AC-4, AC-5, AC-6, AC-8, AC-9]
- **Test Requirements**:
  - `programmatic` TR-2.1: 输入 `# ` 后立即转换为 heading 块
  - `programmatic` TR-2.2: 输入 `- ` 后立即转换为无序列表项
  - `programmatic` TR-2.3: 输入 `1. ` 后立即转换为有序列表项
  - `programmatic` TR-2.4: 输入 `> ` 后立即转换为引用块
  - `programmatic` TR-2.5: 输入 `- [x] ` 后立即转换为已勾选任务项
  - `programmatic` TR-2.6: 输入纯文本（无 Markdown 前缀）时块类型保持 paragraph
  - `programmatic` TR-2.7: IME 输入期间不触发实时渲染，避免干扰中文/日文输入
  - `human-judgement` TR-2.8: 实时渲染时光标位置正确，不跳动、不丢失
  - `human-judgement` TR-2.9: 编辑体验流畅，无明显卡顿或延迟感
- **Notes**: 实现方式：在 `EditorScrollContainer` 的 `.editor-content-area` div 上添加 `onInput` 处理器。当用户输入时，获取当前块的 DOM 文本，调用 `detectMarkdownLine` 检查类型变化。若类型变化，更新 BlockTree 并调用 `setBlockTree` 触发重渲染。关键点在于光标位置的正确恢复，需要在更新 DOM 后用 `setTimeout` 或 `requestAnimationFrame` 重新定位光标。

## [x] Task 3: 完善 syncContentBeforeToggle 的边界处理

- **Priority**: medium
- **Depends On**: Task 1, Task 2
- **Description**:
  - 审查 `syncContentBeforeToggle` 函数的逻辑，确保在所有场景下都能正确同步内容
  - 添加对以下边界情况的处理：
    - 块在实时渲染过程中（类型正在转换时）的同步
    - 新创建但尚未 blur 的块的同步
    - 多个块同时有待同步变更的场景
  - 添加更多错误处理和日志（在开发模式下）
  - 确保版本号在所有更新路径上都正确递增
- **Acceptance Criteria Addressed**: [AC-1, AC-7]
- **Test Requirements**:
  - `programmatic` TR-3.1: 在实时渲染转换过程中切换模式，内容不丢失
  - `programmatic` TR-3.2: 刚按 Enter 创建新块立即切换模式，内容不丢失
  - `programmatic` TR-3.3: 多次快速编辑后切换模式，所有变更完整保留
- **Notes**: 此任务是对现有 `syncContentBeforeToggle` 函数的增强，确保它能正确处理 Task 1 和 Task 2 引入的新数据流场景。

## [x] Task 4: 编写和运行综合测试

- **Priority**: high
- **Depends On**: Task 1, Task 2, Task 3
- **Description**:
  - 为修复后的编辑行为编写测试用例
  - 测试覆盖：
    1. Enter 创建新段落 + 内容保留（AC-1）
    2. Markdown 实时渲染：heading（AC-2）
    3. Markdown 实时渲染：无序列表（AC-3）
    4. Markdown 实时渲染：任务列表（AC-4）
    5. Markdown 实时渲染：引用（AC-5）
    6. Markdown 实时渲染：有序列表（AC-6）
    7. 双模式切换内容完整性（AC-7）
    8. 纯文本编辑不受影响（AC-9）
  - 运行现有 185 个测试，确保全部通过
- **Acceptance Criteria Addressed**: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-9, AC-10]
- **Test Requirements**:
  - `programmatic` TR-4.1: 所有现有 185 个测试通过（npm run test）
  - `programmatic` TR-4.2: 新增的实时渲染测试通过
  - `programmatic` TR-4.3: 新增的内容同步测试通过
  - `programmatic` TR-4.4: 无类型错误（npm run typecheck）
- **Notes**: 由于 Normal Mode 编辑依赖 DOM 操作和 contentEditable，单元测试需要使用 jsdom 环境。建议在 Vitest 中配置。
