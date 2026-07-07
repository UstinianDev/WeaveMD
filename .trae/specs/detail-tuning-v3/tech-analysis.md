# WeaveMD 细节调优 V3 - 技术选型分析

## 概述

本次升级的核心需求是实现类似 Typora 的即时编辑体验：光标进入区块时显示原始 Markdown 语法，离开时隐藏语法标记。本文档分析几种可能的实现方案，并推荐最优方案。

## 方案对比

### 方案 1: 完整替换编辑器为 WYSIWYG 编辑器

#### 描述

将 Monaco Editor 完全替换为支持即时编辑的 Markdown 编辑器，如：

- Milkdown
- TipTap (基于 ProseMirror)
- Slate.js
- Toast UI Editor

#### 优点

- 开箱即用的即时编辑体验
- 完善的 Markdown 支持
- 活跃的社区和文档

#### 缺点

- 需要完全重写编辑器相关代码
- 与现有架构（Monaco Editor、浮动工具栏等）不兼容
- 极高的迁移成本和风险
- 可能失去 Monaco Editor 的强大功能（如多光标、快捷键等）

#### 评估

- 可行性: ⭐⭐ (技术可行但成本过高)
- 成本: ⭐⭐⭐⭐⭐ (极高)
- 风险: ⭐⭐⭐⭐⭐ (极高)
- **不推荐**

---

### 方案 2: Monaco Editor + 自定义 Decoration 层（推荐）

#### 描述

继续使用 Monaco Editor 作为核心编辑引擎，利用其强大的 Decorations API 来控制语法标记的显示和隐藏：

- 使用 Inline Decorations 来隐藏语法标记（设置为透明或极小字体）
- 监听光标位置变化，检测当前所在区块
- 根据区块位置动态更新装饰器

#### 技术细节

1. **区块检测**:
   - 解析当前行和光标周围的文本
   - 使用正则表达式匹配 Markdown 语法模式
   - 确定当前光标所在区块的类型和边界

2. **装饰器管理**:
   - 使用 `monaco.editor.createDecorationsCollection()` 管理装饰器
   - 对于需要隐藏的语法标记，应用 `opacity: 0` 或 `fontSize: 0`
   - 或者使用 `inlineClassName` 配合 CSS 来控制可见性

3. **光标监听**:
   - 监听 `onDidChangeCursorPosition` 事件
   - 当光标移动时，重新计算区块并更新装饰器

#### 优点

- 保留 Monaco Editor 的所有功能
- 与现有代码架构兼容
- 实现成本相对较低
- 可以渐进式实现和测试

#### 缺点

- 需要精确处理复杂的 Markdown 语法嵌套
- 装饰器性能需要优化
- 某些复杂语法（如表格）可能难以完美处理

#### 评估

- 可行性: ⭐⭐⭐⭐⭐ (非常可行)
- 成本: ⭐⭐ (中等)
- 风险: ⭐⭐ (可控)
- **强烈推荐**

---

### 方案 3: 双视图叠加

#### 描述

在 Monaco Editor 上方叠加一个渲染后的预览层：

- 底层是 Monaco Editor（始终显示完整语法）
- 上层是透明的渲染预览层（显示美化效果）
- 当光标进入某区域时，上层预览层对应区域变透明，显示底层的语法

#### 优点

- 渲染效果可以完全自定义
- 不依赖 Monaco Editor 的装饰器能力

#### 缺点

- 光标定位困难（需要同步两个层的滚动和位置）
- 实现复杂度极高
- 性能可能有问题
- 用户体验可能不流畅

#### 评估

- 可行性: ⭐⭐⭐ (技术可行但复杂)
- 成本: ⭐⭐⭐⭐ (高)
- 风险: ⭐⭐⭐⭐ (高)
- **不推荐**

---

### 方案 4: 增强现有预览模式

#### 描述

保留现有的双栏模式，但优化交互：

- 当在编辑区操作时，预览区自动滚动到对应位置
- 增加更多的编辑区高亮效果
- 但不完全实现"即时编辑"体验

#### 优点

- 实现成本最低
- 风险最小

#### 缺点

- 不满足用户的核心需求（即时编辑体验）
- 只是对现有模式的小幅优化

#### 评估

- 可行性: ⭐⭐⭐⭐⭐ (非常可行)
- 成本: ⭐ (低)
- 风险: ⭐ (极低)
- **不满足需求**

---

## 推荐方案详细设计

### 推荐: 方案 2 - Monaco Editor + 自定义 Decoration 层

#### 核心模块设计

1. **MarkdownBlockDetector 模块** (`src/render/services/markdownBlockDetector.ts`)

   ```typescript
   interface BlockInfo {
     type: 'heading' | 'bold' | 'italic' | 'list' | 'quote' | 'code' | 'link';
     startLine: number;
     startColumn: number;
     endLine: number;
     endColumn: number;
     syntaxMarkers: { start: number; end: number; text: string }[];
   }

   function detectCurrentBlock(
     model: monaco.editor.ITextModel,
     position: monaco.Position
   ): BlockInfo | null;

   function detectAllBlocks(model: monaco.editor.ITextModel): BlockInfo[];
   ```

2. **DecorationManager 模块** (集成在 EditorView 中)
   ```typescript
   class DecorationManager {
     private decorations: monaco.editor.ITextModelDecorationsCollection;

     updateDecorations(
       editor: monaco.editor.IStandaloneCodeEditor,
       cursorPosition: monaco.Position
     ): void;

     private createHideMarkerDecoration(range: monaco.Range): monaco.editor.IModelDeltaDecoration;
   }
   ```

#### 关键技术点

1. **语法标记隐藏方式**:
   - 使用 `opacity: 0` 完全隐藏但保留占位
   - 或者使用 `fontSize: 0` + `letterSpacing: 0` 彻底隐藏
   - 需要测试哪种方式在 Monaco Editor 中效果更好

2. **性能优化**:
   - 使用防抖（debounce）来避免频繁更新装饰器
   - 只更新变化的区块，而不是重新计算所有装饰器
   - 缓存区块检测结果

3. **复杂语法处理**:
   - 表格：暂不隐藏语法，始终显示完整语法
   - 嵌套结构：以最内层语法为优先
   - 代码块：始终显示完整语法

#### 实现步骤

1. 实现基础的区块检测
2. 实现简单的装饰器应用
3. 测试和优化性能
4. 处理边界情况和复杂语法
5. 完善用户体验

---

## 最终建议

**采用方案 2: Monaco Editor + 自定义 Decoration 层**

理由：

1. 完全满足用户需求
2. 与现有架构兼容
3. 实现成本可控
4. 风险可管理
5. 保留了 Monaco Editor 的强大能力

这是最优的技术选择。
