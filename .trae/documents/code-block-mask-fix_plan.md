# 代码块蒙版问题修复计划

## Debug 工作流程

### 阶段 1：假设

**假设 A（CSS 样式不一致）**：`.code-fence-content` 使用硬编码的浅色主题颜色，在暗色主题下产生"蒙版"效果
- 证据：`globals.css:1408-1429` 中 `.code-fence-content` 使用 `#ffffff` 背景和 `#111827` 文字
- 证据：`.code-fence-content .token.*` 使用硬编码浅色主题颜色（`#6b7280`, `#dc2626` 等）
- 对比：`.markdown-preview .token.*` 有完整的主题变体（`html.dark`, `html.light` 等）

**假设 B（Prism.js 初始化时序）**：首次加载时 Prism.js 语言组件未完全初始化，导致 `highlightCode` 返回纯 HTML 而非带 token class 的 HTML
- 证据：用户观察到"第二次导入蒙版消失"
- 可通过在 `highlightCode` 中添加埋点验证

**假设 C（渲染路径差异）**：首次加载走 `.code-fence-content` 路径，二次加载走 `.code-fence-fallback` 路径
- 证据：`.code-fence-fallback` 使用 `text-[var(--text-code,#cdd6f4)]` CSS 变量，正确支持暗色主题

### 阶段 2：埋点

在以下位置添加临时调试日志：

1. **`markdown.ts:420-431`** - `highlightCode` 函数：
   - 记录 `language` 参数、`Prism.languages[language]` 是否存在
   - 记录返回的 HTML 前 200 字符

2. **`CodeFenceBlock.tsx:79-82`** - 组件渲染：
   - 记录 `block.renderedHtml` 是否为 null
   - 记录 `block.fenceLanguage` 值

3. **`EditorView.tsx:200-214`** - `renderBlocks` 函数：
   - 记录每个 block 的 `id`, `type`, `renderedHtml` 状态
   - 记录 `renderMarkdownToHtml` 调用结果

### 阶段 3：复现

1. 启动开发服务器：`npm run dev`
2. 打开应用，确保暗色主题
3. 导入包含代码块的 markdown 文档
4. 观察控制台日志
5. 切换代码块语言
6. 再次导入相同文档
7. 对比日志差异

### 阶段 4：用数据验证

分析日志，确定：
- 首次导入时 Prism.js 是否正常工作
- 首次导入和二次导入的渲染路径是否不同
- token class 是否正确应用
- CSS 变量是否正确解析

### 阶段 5：修复

**主要修复（CSS 样式）**：

修改文件：`src/render/styles/globals.css`

1. 修改 `.code-fence-content` 基础样式：
   - `background: var(--bg-code)` 替代 `#ffffff`
   - `color: var(--text-code)` 替代 `#111827`

2. 添加 `html.dark .code-fence-content .token.*` 暗色主题样式：
   - 复制 `.markdown-preview` 的暗色主题 token 颜色
   - 适配代码块容器

**辅助修复（确保一致性）**：

3. 修改 `.code-fence-block` 容器样式：
   - `background: var(--bg-code)` 替代 `#ffffff`

4. 修改 `.code-fence-header` 样式：
   - `background: var(--bg-secondary)` 替代 `#f5f5f7`
   - `border-bottom: 1px solid var(--border-color)` 替代 `#e5e7eb`

### 阶段 6：再验证

1. 运行 `npm run typecheck` 确保类型正确
2. 运行 `npm run test` 确保所有测试通过
3. 运行 `npm run lint` 确保代码规范
4. 启动开发服务器手动验证：
   - 导入文档时代码块无蒙版
   - 切换语言后正常
   - 二次导入无蒙版

### 阶段 7：清理

1. 移除所有调试日志
2. 清理临时代码

---

## 文件修改清单

| 文件 | 修改内容 | 风险等级 |
|------|---------|---------|
| `src/render/styles/globals.css` | 添加暗色主题 token 样式，替换硬编码颜色为 CSS 变量 | 低 |
| `src/render/services/markdown.ts` | 添加临时调试日志（仅调试阶段） | 低 |
| `src/render/components/Editor/blocks/CodeFenceBlock.tsx` | 添加临时调试日志（仅调试阶段） | 低 |
| `src/render/components/Editor/EditorView.tsx` | 添加临时调试日志（仅调试阶段） | 低 |

---

## 风险评估

- **低风险**：修改仅限于 CSS 样式和添加/移除调试日志
- **无破坏性**：不改变组件逻辑和数据结构
- **可回退**：CSS 样式修改可完全回退

---

## 执行步骤

1. ✅ 添加调试日志（markdown.ts, CodeFenceBlock.tsx, EditorView.tsx）
2. ✅ 启动开发服务器并复现问题
3. ✅ 分析日志数据，确认根因
4. ✅ 执行 CSS 修复
5. ✅ 验证修复效果
6. ✅ 清理调试日志
7. ✅ 运行测试套件
