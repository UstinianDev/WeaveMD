---
name: floating-toolbar-re-export-coupling
description: FloatingToolbar.tsx re-exports pure functions to keep legacy test import paths stable
metadata:
  type: project
---

FloatingToolbar.tsx 通过 `export { selectionSyntaxTypesConsistent, syntaxTypeToOption } from './toolbarState'` 维系兼容 re-export。

**Why:** `tests/components/FloatingToolbarV2.test.tsx`（第 27-28 行）与 `tests/editor/kernel/syntaxType.test.ts`（第 26 行）仍从 `@render/components/Editor/v2/FloatingToolbar` 导入这两个纯函数（已在 2026-08-12 重构中迁移到 `./toolbarState.ts`）。测试零改动即通过验证了该 re-export 的必要性。

**How to apply:** 任何涉及移除该 re-export 的重构必须先更新这两个测试文件的导入路径，否则 73 个相关测试（47 FloatingToolbar + 26 syntaxType）将立即破编译。这也是「重构不改测试」模式下的例外：re-export 是刻意保留的兼容层，不是死代码。
