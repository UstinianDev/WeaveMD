# WeaveMD 编辑器同步与实时渲染修复 - Verification Checklist

## 内容同步检查点

- [x] Checkpoint 1: 在 Normal Mode 段落中输入文本后按 Enter，新段落创建，切换到 Source Code Mode 后原段落文本完整保留
- [x] Checkpoint 2: 在已转换为 Markdown 类型的段落中按 Enter，类型转换正确且原内容保留
- [x] Checkpoint 3: 连续创建多个新段落并添加内容，所有内容在模式切换后完整保留
- [x] Checkpoint 4: 空段落按 Enter 创建新空段落，无异常，切换模式后仍为空
- [x] Checkpoint 5: 在段落中删除所有内容后按 Enter，原段落为空，新段落为空，切换模式后正确
- [x] Checkpoint 6: 长文本段落（多行内容）按 Enter 后内容完整保留

## Markdown 实时渲染检查点

- [x] Checkpoint 7: 在空段落中输入 `# `，立即转换为 H1 标题块
- [x] Checkpoint 8: 在空段落中输入 `## `，立即转换为 H2 标题块
- [x] Checkpoint 9: 在空段落中输入 `### `，立即转换为 H3 标题块
- [x] Checkpoint 10: 在空段落中输入 `- `，立即转换为无序列表项
- [x] Checkpoint 11: 在空段落中输入 `1. `，立即转换为有序列表项
- [x] Checkpoint 12: 在空段落中输入 `> `，立即转换为引用块
- [x] Checkpoint 13: 在空段落中输入 `- [x] `，立即转换为已勾选任务项
- [x] Checkpoint 14: 在空段落中输入 `- [ ] `，立即转换为未勾选任务项
- [x] Checkpoint 15: 输入普通文本（如 `Hello World`）时保持为 paragraph 类型
- [x] Checkpoint 16: 输入 Markdown 前缀加文本（如 `# My Title`），渲染后显示 "My Title"（不含前缀）

## 光标位置检查点

- [x] Checkpoint 17: 实时渲染触发后，光标保持在正确的文字位置，不跳到段落开头
- [x] Checkpoint 18: 实时渲染触发后，光标保持在正确的文字位置，不跳到段落末尾
- [x] Checkpoint 19: 在 heading 块中继续编辑时，光标位置始终正确

## 模式切换检查点

- [x] Checkpoint 20: Normal Mode → Source Code Mode：所有编辑变更（文本修改、新增段落、类型转换）完整保留
- [x] Checkpoint 21: Source Code Mode → Normal Mode：所有变更正确渲染为富文本
- [x] Checkpoint 22: Normal Mode → Source Code Mode → Normal Mode 往返切换，内容不变

## 兼容性检查点

- [x] Checkpoint 23: IME 中文输入期间，不触发实时渲染，不干扰输入法
- [x] Checkpoint 24: 已转换的 Markdown 块（如 heading）继续编辑内容时，类型不因中间修改而频繁切换
- [x] Checkpoint 25: 浮动工具栏在实时渲染后仍能正常显示和工作
- [x] Checkpoint 26: Find & Replace 功能在修改后仍正常工作
- [x] Checkpoint 27: 撤销/重做功能在修改后仍正常工作

## 性能与稳定性检查点

- [x] Checkpoint 28: 快速连续输入时，实时渲染流畅，无明显卡顿
- [x] Checkpoint 29: 大型文档（>100 个块）中实时渲染性能可接受
- [x] Checkpoint 30: 现有 185 个自动化测试全部通过（npm run test）
- [x] Checkpoint 31: 无 TypeScript 类型错误（npm run typecheck）
