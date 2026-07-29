# WeaveMD 目录交互优化 - Verification Checklist

## 功能验证

- [ ] Checkpoint 1: 点击 H1 标题 → 编辑主区滚动到 H1 所在位置，标题在视口顶部可见
- [ ] Checkpoint 2: 点击 H2 标题 → 编辑主区滚动到 H2 所在位置，标题在视口内可见
- [ ] Checkpoint 3: 点击 H3 标题 → 编辑主区滚动到 H3 所在位置
- [ ] Checkpoint 4: 快速连续点击不同级别标题 → 每次滚动正确，最终停在最后点击的标题位置
- [ ] Checkpoint 5: 点击 Collapse outline → 侧边栏折叠为窄条，编辑器自动扩展居中
- [ ] Checkpoint 6: 点击 Expand outline → 侧边栏恢复原始宽度，编辑器恢复原布局
- [ ] Checkpoint 7: 空文档（无标题）→ 目录展开/收起正常，编辑器无异常
- [ ] Checkpoint 8: Source Code Mode 下点击目录 → 行为合理（无报错）
- [ ] Checkpoint 9: 折叠/展开状态在切换文件后保持当前状态（可选）

## 代码质量

- [ ] Checkpoint 10: `npm run lint` 无错误、无新增警告
- [ ] Checkpoint 11: `npm run test` 全部 185 个测试通过
- [ ] Checkpoint 12: TypeScript 类型检查通过
- [ ] Checkpoint 13: 新增代码符合项目代码规范（命名、导入顺序、组件结构）
- [ ] Checkpoint 14: 无 console.log 调试语句残留

## 边界情况

- [ ] Checkpoint 15: 目标行号超出文档范围 → 不报错，静默处理
- [ ] Checkpoint 16: BlockTree 为空 → 不报错
- [ ] Checkpoint 17: DOM 中找不到目标 block → 不报错，静默处理
- [ ] Checkpoint 18: 文档内容更新后（编辑/删除），目录导航仍然正确
