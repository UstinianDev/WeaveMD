# agent-file-toolcall-optimize — 状态追踪

## 分级
- 类型：优化（体验改进）
- 档位：M / standard
- 模块：agentLoop + fileTreeStore（Bug 1）、AgentWorkflowCard（Bug 2）

## Bug 1：AI 看不到用户打开/导入的文件

### 根因
- `agentLoop.ts:384` 只调用 `listFiles(userId)` 从 SQLite 查文件
- 用户打开/导入的文件只在渲染进程 `fileTreeStore.looseFiles` 和 `fileTreeStore.folders` 中
- 主进程没有途径获取文件树数据 → AI 无法发现这些文件 → 无法读取/修改

### 方案
在渲染进程发送 agent 请求时，将 `fileTreeStore` 的 `looseFiles` 和 `folders` 路径列表
附加到 payload 中，主进程 `agentLoop` 将其注入系统提示词。

### 涉及文件
- `src/render/stores/agentStore.ts` — sendAgentMessage 构造 payload 时附加文件树路径
- `src/main/ai/agentLoop.ts` — 系统提示词注入文件树路径
- `src/shared/ai/agent.ts` — payload 类型扩展

## Bug 2：AI 面板重开后工具调用参数原始显示

### 根因
- `AgentWorkflowCard.tsx` `extractToolSummary` switch 使用 snake_case 名称
- 实际 LLM 工具名是 camelCase（listFiles、readFile、createFile 等）
- 不匹配 → default 分支 → 显示原始 args JSON

### 工具名对照表（LLM 实际名称 → switch 应有名称）
| LLM 工具名 | switch 中应匹配 |
|------------|----------------|
| listFiles | ❌ 缺失（走 default） |
| readFile | ❌ 缺失（走 default） |
| searchKB | ❌ 缺失（走 default） |
| runSkill | ❌ 缺失（走 default） |
| editBlocks | ❌ 缺失（走 default） |
| createFile | ❌ 缺失（走 default） |
| createFolder | ❌ 缺失（走 default） |
| readLocalFile | ❌ 缺失（走 default） |
| listLocalDirectory | ❌ 缺失（走 default） |
| renameFile | ❌ 缺失（走 default） |
| moveFile | ❌ 缺失（走 default） |
| deleteFile | ❌ 缺失（走 default） |
| ask_question_card | ✅ 匹配 |
| preview_patch_files | ❌ 缺失（走 default） |
| web_search | ❌ 缺失（走 default） |
| analyze_folder | ✅ 匹配 |
| check_links | ✅ 匹配 |
| get_task_activity | ✅ 匹配 |
| preview_file_revision | ✅ 匹配 |

### 涉及文件
- `src/render/components/AIAgent/AgentWorkflowCard.tsx` — extractToolSummary 补全工具名映射

## 验证
- [x] tsc 0 新增错误（3 个已有）
- [x] vitest 1488/1488 通过（1 个已有失败文件）
- [x] eslint 0 新增错误（18 warnings 均已有）
- [ ] 手动验证：用户打开的文件 AI 可读取
- [ ] 手动验证：重开面板工具调用显示人类可读摘要

## 完成时间
2026-08-26
