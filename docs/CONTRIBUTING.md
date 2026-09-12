# 文档编写规范

> 最后更新：2026-09-12

## 文档结构

### 渐进式披露原则

文档应按复杂度分层，读者可按需深入：

1. **一级文档**（README/TODO/SUMMARY）：项目概览，快速了解
2. **二级文档**（architecture/modules/）：技术细节，按需查阅
3. **三级文档**（specs/testing/plan/）：实施细节，深入研究

### 目录组织

```
docs/
├── README.md          # 项目主页
├── TODO.md            # 功能进度
├── SUMMARY.md         # 文档索引
├── REQUIREMENTS.md    # 需求文档
├── CONTRIBUTING.md    # 本文档
├── architecture/      # 架构文档（按技术层）
├── modules/           # 模块文档（按功能模块）
├── specs/             # 规格文档（设计规范）
├── testing/           # 测试报告（TDD证据）
├── plan/              # 实施计划
│   └── archive/       # 已完成计划归档
├── requirements/      # 需求文档（devflow产出）
├── refactor/          # 重构报告
└── guide/             # 使用指南
```

## 文档编写规范

### 标题层级

- **H1**（#）：文档标题，每文档仅一个
- **H2**（##）：主要章节
- **H3**（###）：子章节
- **H4**（####）：细节说明

### 内容长度控制

| 文档类型 | 建议长度 | 拆分策略 |
|----------|----------|----------|
| README.md | ≤ 200 行 | 超长时拆分到 guide/ |
| 模块文档 | ≤ 150 行 | 超长时拆分到子模块 |
| 架构文档 | ≤ 300 行 | 按技术层拆分 |
| 规格文档 | ≤ 500 行 | 按功能点拆分 |
| 测试报告 | ≤ 200 行 | 按测试类型拆分 |

### 渐进式披露示例

**一级文档（README）**：
```markdown
## 技术栈
- 前端：React 18 + TypeScript + Tailwind
- 后端：Electron + better-sqlite3
- AI：OpenAI API + 自定义 Agent 框架
```

**二级文档（architecture/frontend.md）**：
```markdown
## 状态管理
使用 Zustand v4，按功能域拆分 store：
- editorStore：编辑器状态
- authStore：认证状态
- aiStore：AI面板状态
```

**三级文档（specs/editor-v2-architecture.md）**：
```markdown
## 块树数据结构
BlockNodeV2 接口定义：
- id: string（唯一标识）
- type: BlockType（块类型）
- text: string（纯文本内容）
- children: BlockNodeV2[]（子块）
```

## 命名规范

### 文件命名

- **架构文档**：`{技术层}.md`（如 frontend.md, backend.md）
- **模块文档**：`{序号}-{模块名}-{英文}.md`（如 04-编辑主区-Editor.md）
- **规格文档**：`{功能描述}.md`（如 editor-v2-architecture.md）
- **测试报告**：`{规格名}.tdd.md`（如 spec-edit-ft.tdd.md）
- **实施计划**：`{任务名}.status.md`（如 export-image-fix.status.md）

### 内容格式

- **代码块**：使用语言标识（```typescript, ```bash）
- **表格**：对齐列宽，保持可读性
- **链接**：使用相对路径（`./architecture/frontend.md`）
- **状态标记**：✅ 完成、🔄 进行中、⏳ 待开发、❌ 已取消

## 更新流程

### 何时更新

1. **功能完成**：更新 TODO.md、相关模块文档
2. **架构变更**：更新 architecture/ 下对应文档
3. **Bug 修复**：更新 TODO.md 已知问题、创建 status.md
4. **重构完成**：创建 refactor/ 报告、更新模块文档

### 更新检查清单

- [ ] 更新 SUMMARY.md 索引
- [ ] 更新 TODO.md 进度
- [ ] 更新相关模块文档
- [ ] 检查文档链接有效性
- [ ] 归档已完成的 status 文档

## 文档质量检查

### 必要内容

每个文档应包含：
- 标题（H1）
- 最后更新日期
- 主要章节（根据文档类型）
- 相关链接

### 避免的问题

- ❌ 内容过时未更新
- ❌ 链接失效未修复
- ❌ 内容冗余重复
- ❌ 缺少示例说明
- ❌ 格式不统一

## 归档策略

### 归档条件

满足以下条件的文档可归档：
1. 任务已完成（✅ 标记）
2. 超过 30 天未更新
3. 已被新文档替代

### 归档位置

- `docs/plan/archive/`：已完成的实施状态
- `docs/requirements/archive/`：已完成的需求文档

### 归档操作

```bash
# 移动到归档目录
mv docs/plan/xxx.status.md docs/plan/archive/

# 更新 SUMMARY.md
# 在"归档"章节添加说明
```

## 工具推荐

### 文档生成

- **Markdown**：VS Code + Markdown Preview Enhanced
- **图表**：Mermaid（流程图、时序图）
- **API 文档**：Swagger/OpenAPI（如适用）

### 文档检查

- **链接检查**：markdown-link-check
- **格式检查**：markdownlint
- **拼写检查**：cspell

## 参考

- [Google 技术写作指南](https://developers.google.com/style)
- [Microsoft 风格指南](https://docs.microsoft.com/en-us/style-guide/)
- [写作风格指南](https://github.com/OWASP/owasp-mastg/blob/master/docs/style_guide.md)
