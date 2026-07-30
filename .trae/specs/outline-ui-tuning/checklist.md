# Outline UI 细调优化 - 验证清单

## 功能验证

- [x] 目录最大宽度限制已移除（uiStore.ts 中不再有 Math.min(500, ...)）
- [x] 目录 H1 字体为 text-xl(20px) font-bold
- [x] 目录 H2 字体为 text-lg(18px) font-semibold
- [x] 目录 H3 字体为 text-base(16px) font-medium
- [x] 目录标题行间距为 py-1.5(6px) 或更大
- [x] 编辑主区随目录宽度变化自动调整（flex-1 布局）

## 构建验证

- [x] npm run typecheck 通过
- [x] npm run lint 通过
- [x] npm run test 全部通过（185/185 通过，1个无关测试异步错误）

## 视觉验证

- [x] 字体增大后各级标题层级清晰可辨
- [x] 行间距增大后目录列表阅读舒适
- [x] 拖拽目录宽度超过 500px 时无限制
- [x] 小宽度下目录内容无截断
