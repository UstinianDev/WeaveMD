# local-file-edit-and-tree-persist — 状态追踪

## 分级
- 类型：功能开发（新工具 + 文件树持久化 + 磁盘操作）
- 档位：L / standard
- 模块：AI 工具链、文件树 store、IPC、磁盘操作

## 需求
1. AI 可直接编辑本地文件（新增 editLocalFile 工具）
2. AI 创建的文件写入用户打开的文件夹（非 userData/files/）
3. AI 创建的文件夹真实创建在磁盘上
4. 文件树自动刷新 + 重启持久化
5. 支持嵌套创建（文件夹内套文件）

## 变更清单

### 新增文件
| 文件 | 说明 |
|------|------|
| `src/main/ai/tools/editLocalFileHandler.ts` | editLocalFile 工具处理器（绝对路径 + 新内容 → 写盘） |

### 修改文件
| 文件 | 改动 |
|------|------|
| `src/main/ai/toolTypes.ts` | ToolCtx 新增 `fileTreePaths` 字段 |
| `src/main/ai/toolRegistry.ts` | 注册 editLocalFile 到 handlerMap + defineCoreTools |
| `src/main/ai/agentLoop.ts` | toolCtx 注入 fileTreePaths；系统提示词新增规则 7/8/9（editLocalFile、createFile 路径、createFolder 嵌套）；editLocalFile 加入基础工具集 |
| `src/main/ai/tools/createFileHandler.ts` | 重写：优先写入用户文件夹（fileTreePaths.folders[0]），回退 userData/files/ |
| `src/main/ai/tools/createFolderHandler.ts` | 重写：真实磁盘创建目录，支持嵌套路径，无 electron 时降级为逻辑概念 |
| `src/render/stores/agentStore.ts` | onTool 回调新增 createFolder/editLocalFile 处理：文件夹加入文件树、编辑后刷新父文件夹 |
| `src/render/components/AIAgent/AgentWorkflowCard.tsx` | extractToolSummary 新增 editLocalFile 摘要提取 |
| `tests/main/ai/toolRegistry.test.ts` | 工具数量 20→21，新增 editLocalFile 到期望列表 |

## 工具能力矩阵（修改后）

| 工具 | 类型 | 写磁盘 | 更新文件树 | 持久化 |
|------|------|--------|-----------|--------|
| createFile | DB + 磁盘 | ✅ 用户文件夹 | ✅ looseFiles | ✅ localStorage |
| createFolder | 磁盘 | ✅ 用户文件夹 | ✅ folders | ✅ localStorage |
| editLocalFile | 磁盘 | ✅ 绝对路径 | ✅ 刷新父文件夹 | ✅ 磁盘实体 |
| readLocalFile | 只读 | - | - | - |
| listLocalDirectory | 只读 | - | - | - |
| editBlocks | 提案 | ❌ 仅改当前文档 | - | - |
| preview_file_revision | 提案 | ❌ 仅预览 | - | - |

## 验证
- [x] tsc 0 新增错误（3 个已有）
- [x] vitest 1488/1488 通过（1 个已有失败文件）
- [x] eslint 0 新增错误
- [x] toolRegistry 测试 31/31 通过
- [ ] 手动验证：AI editLocalFile 可编辑桌面文件
- [ ] 手动验证：AI createFile 写入用户文件夹
- [ ] 手动验证：AI createFolder 真实创建目录
- [ ] 手动验证：重启后 AI 创建的文件夹不丢失

## 完成时间
2026-08-26
