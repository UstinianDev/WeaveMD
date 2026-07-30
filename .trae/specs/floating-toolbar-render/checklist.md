# 浮动工具栏实时渲染 + 格式化叠加 — Verification Checklist

## Task 1 — 块结构转换 (handleBlockTypeChange)
- [ ] STRUCTURE 下拉选中 "正文" → paragraph 块样式正确渲染（14px/普通字重/无项目符号）
- [ ] STRUCTURE 选中 "一级标题" ~ "六级标题" → 对应字号 (26/22/18/16/15/14) 和字重立即生效
- [ ] STRUCTURE 选中 "无序列表" → 项目符号 ● 出现
- [ ] STRUCTURE 选中 "有序列表" → 编号 1. 出现
- [ ] STRUCTURE 选中 "任务" → `- [ ]` 复选框语义占位
- [ ] STRUCTURE 选中 "代码块" → 灰色背景 monospace 字体
- [ ] STRUCTURE 选中 "引用" → 左侧紫色竖条 + 斜体出现
- [ ] 上述 12 种切换后，切换到 Source Code Mode，Markdown 源码与样式对应（#/-/1./> /```）
- [ ] 切换后光标位置不丢失（仍在该块内大致原处）
- [ ] Ctrl+Z 能撤销最近一次结构转换

## Task 2 — DOM 内联格式化 (B/I/U/H/Code 叠加)
- [ ] 选中一段文字 → Bold → 显示粗体
- [ ] 已加粗文字再点 Bold → 取消加粗
- [ ] 选中文字 → Bold → Italic → Underline 依次点击，三种效果同时可见（视觉粗+斜+下划线）
- [ ] 三叠加后单独点 Bold 取消加粗，I+U 保留
- [ ] 选中文字点 Highlight(H) → 显示淡色底纹
- [ ] 选中文字点 Code(`` ` ``) → 等宽字体+灰色底小块
- [ ] H + Code 同时存在时两种样式叠加可见

## Task 3 — Link / Comment
- [ ] 选中文字点 Link → 弹出 URL 输入；输入后文字变色为 accent 且带下划线
- [ ] Link 鼠标悬停显示手型光标
- [ ] 占位 URL ("url") 点击不跳转（e.preventDefault）
- [ ] 选中文字点 Comment → 文字右側出现注释角标

## Task 4 — DOM→MD 往返 (buildSourceLinesFromContent)
- [ ] B+I+U 叠加 → 切 Source Code Mode → MD 语法三者同时存在；切回 Normal Mode → 视觉不变
- [ ] `<mark><code>text</code></mark>` → 切 Source → `` ==`text`== `` 可见
- [ ] `<a href="https://example.com">WeaveMD官网</a>` → 切 Source → `[WeaveMD官网](https://example.com)`
- [ ] 含 `.comment-marker` → 切 Source → `text ^[comment]`
- [ ] 嵌套顺序正确（先 outer 再 inner 语法匹配）

## Task 5 — 全局沙箱测试
- [ ] `npm run test` 全部通过（exit 0，原 185+ 测试，新增格式化测试）
- [ ] `npm run typecheck`（tsc --noEmit）无类型错误
- [ ] `npm run lint` 无 ESLint 错误，`--fix` 后干净
- [ ] 撤销栈：执行 5 次连续工具栏操作 → Ctrl+Z ×5 回到初始；Ctrl+Y ×5 回到最终；DOM 与 Source 双向一致
- [ ] 自动保存：编辑工具栏格式化后等待 1200ms → 关闭应用重开 → 格式保留
