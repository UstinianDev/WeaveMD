# REFACTOR-EDITOR-TOOLBAR-IMAGE-LINK：编辑主区（工具栏/图片/超链接）重构状态

> 档位：M（标准重构）| 分类：纯重构（零行为变更）| 日期：2026-08-13
> 任务 slug：`editor-toolbar-image-link-refactor`

## 阶段 0：分级

- **① 请求类型**：重构（用户明确「不可改变现有功能」）
- **② 跨模块判断**：是——工具栏（FloatingToolbar/ImageToolbar/ToolbarButton/toolbarState）、
  图片（ImageEditTool/ImageResizeBox/resizeMath/imageBlock/imageReplace/imageWidthCtrl）、
  超链接（InsertUrlModal/formatCtrl link+image/enterCtrl link）三模块
- **③ 定档**：**M（标准重构）**——1~3 模块、半天内、无数据/API/权限变更
- 裁剪：跳过技术调研（方案确定，全为既有代码整理）、跳过并行执行（S/M 小步串行）

## 阶段 1：需求对齐（用户已拍板）

1. **WIP 基线**：先提交 WIP 再重构（已提交 `2fb1602` feat(editor): replace text
   across block selection on input/paste；单测 845 全绿 + 新增 e2e 2/2 通过）
2. **档位**：M 标准重构
3. **疑似死代码**：核实后清理（grep 全仓零引用才删）

### 需求清单

- 重构编辑主区代码，重点：工具栏、图片功能代码、超链接
- **硬约束**：不可改变现有功能 → 断言零修改、行为不变、DOM 契约不变
- 已知候选点：
  - FloatingToolbar：10 ref + 4 组 document 级事件监听，事件语义分散
  - ImageToolbar.scheduleHide：注释自认 no-op 死代码（待核实）
  - ImageToolbar 与 ImageResizeBox：scroll 重锚定逻辑复制粘贴重复
  - ImageEditTool 与 InsertUrlModal：Escape 监听/open-reset/URL 校验重复
  - InsertUrlModal.showPickImage：疑似死代码（图片已走 K6 直选，待核实）
  - formatCtrl unlinkRange：delta 循环可读性一般

### 已对齐问题清单

- WIP 是否纳入重构：否（已独立提交，重构不触碰）
- 疑似死代码处置：核实全仓零引用后删除，有引用则保留并说明

---

## 阶段 2~8 实施记录

- **阶段 2（规划）**：Plan 智能体产出 `editor-toolbar-image-link-refactor.plan.md`
  （6 步顺序 + 变更清单 + 验收标准）
- **阶段 4（重构）**：Step 1 死代码清理（ImageToolbar.scheduleHide）→ Step 2 图片锚定去重
  （imageAnchor.ts）→ Step 3 超链接常量合并（modalConstants.ts）→ Step 4 评估无需改动 →
  Step 5 默认跳过 → Step 6 全量门禁 → Step 7 E2E。重构报告：
  `docs/refactor/editor-toolbar-image-link.refactor.md`
- **阶段 5（审查）**：git-diff-reviewer APPROVED WITH COMMENTS（0 Critical / 0 High；
  3 Medium 均确认非行为变更）
- **阶段 6（全量门禁）**：testing-quality-agent 独立复核通过——vitest 845/845、
  tsc 0 错、lint 0 error（8 既有 warnings）、vite build 通过
- **阶段 7（合规核对）**：无 any / 无危险 HTML / blockId 生成安全（仅 `[0-9a-z]`）/
  命名符合 CONVENTIONS / 不涉密钥与 IPC
- **阶段 8（交付核对）**：实际 diff 与计划变更清单逐条一致，无计划外改动

### 最终证据

| 门禁 | 结果 |
| ---- | ---- |
| vitest | 49 文件 / 845 测试全绿（断言零修改） |
| typecheck | 0 错误 |
| lint | 0 error（8 warnings 既有） |
| vite build | 通过（render+main+preload） |
| e2e | 74 通过（全部既有 spec）；5 个 drag-selection-markers RED 为既有技术债（stash 验证重构前同样失败） |
| 净改动 | 4 修改 + 2 新增纯函数，净删 31 行 |

### 剩余风险

- `npm run build` 的 electron-builder 阶段：运行中 Electron 进程持有 better_sqlite3.node
  文件锁（已知环境阻塞，历史一致）；`npx vite build` 已独立验证编译
- `drag-selection-markers` 5 个既有 RED：本次不处理（FT4 复现测试，既有技术债）

