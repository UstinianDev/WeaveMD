# 编辑主区 v2 — 实施记录

> 拆分自 [editor-v2-architecture.md](./editor-v2-architecture.md) §13
> 关联文档：[editor-v2-selection-undo.md](./editor-v2-selection-undo.md)（选区/集成/测试/风险）
> 实施分期见 [editor-v2-selection-undo.md §10](./editor-v2-selection-undo.md#10-实施分期)

---

## 13. 实现记录

**实施记录分册（按需展开）：**

| 节 | 内容 | 分册 |
|----|------|------|
| §13.1 | M1 完成（2026-08-05） | [分册 1](./editor-v2-progress/01-milestones-kernel.md) |
| §13.2 | M2 渲染骨架完成（2026-08-06） | [分册 1](./editor-v2-progress/01-milestones-kernel.md) |
| §13.3 | M3 交互控制器完成（2026-08-06） | [分册 1](./editor-v2-progress/01-milestones-kernel.md) |
| §13.4 | M4 系统集成完成（2026-08-06） | [分册 1](./editor-v2-progress/01-milestones-kernel.md) |
| §13.5 | 真实运行缺陷修复（2026-08-06） | [分册 1](./editor-v2-progress/01-milestones-kernel.md) |
| §13.6 | 真实 Chromium E2E 验证与最终修复（2026-08-06） | [分册 1](./editor-v2-progress/01-milestones-kernel.md) |
| §13.7 | 语法渲染对齐 marktext（2026-08-06） | [分册 2](./editor-v2-progress/02-milestones-exit-toolbar.md) |
| §13.8 | 渲染缺陷修复：列表类名冲突 / 标题 marker 换行 / 空标题不可点击（2026-08-06） | [分册 2](./editor-v2-progress/02-milestones-exit-toolbar.md) |
| §13.9 | 列表退出与代码块退出修复（2026-08-06） | [分册 2](./editor-v2-progress/02-milestones-exit-toolbar.md) |
| §13.10 | 引用退出补齐与代码块退格语义修订（2026-08-06） | [分册 2](./editor-v2-progress/02-milestones-exit-toolbar.md) |
| §13.11 | 退格链修复与 v2 浮动工具栏（2026-08-06） | [分册 2](./editor-v2-progress/02-milestones-exit-toolbar.md) |
| §13.12 | 编辑主区技术债清理（2026-08-06） | [分册 2](./editor-v2-progress/02-milestones-exit-toolbar.md) |
| §13.13 | v1 回退退役与跨块鼠标拖选（2026-08-06） | [分册 2](./editor-v2-progress/02-milestones-exit-toolbar.md) |
| §13.14 | 行内格式化增强（SPEC-EDIT-FT2，2026-08-08） | [分册 3](./editor-v2-progress/03-milestones-inline-image.md) |
| §13.15 | 图片选中框 + 四角缩放 + 宽度模型（SPEC-EDIT-IMG-W，2026-08-12） | [分册 3](./editor-v2-progress/03-milestones-inline-image.md) |

