# WeaveMD — 工作流规则

## 编码 → 测试 → 文档 → 提交（强制顺序）

### 第 1 步：编码
- 从 `main` 分支创建 `feat/xxx` 或 `fix/xxx` 分支
- 遵循 `CONVENTIONS.md` 中的命名和导入规则
- 遵循 `SECURITY.md` 中的安全规则

### 第 2 步：测试
- 运行 `npm run test` — 所有测试必须通过
- 运行 `npm run typecheck` — 类型检查无错误
- 运行 `npm run lint` — 无 lint 错误
- 如果测试失败，修复代码后重新运行，不得跳过

### 第 3 步：文档
- 更新 `docs/` 下对应的设计文档
- 如果新增功能，在对应 docs 中添加章节
- 确保 `AGENTS.md` 中的文档路由指向正确

### 第 4 步：提交
- 使用 `git add` 暂存所有变更（**不得删除迁移文件**）
- 提交信息格式：`type(scope): message`
- 推送到 GitHub 远程仓库

## 禁止行为
- ❌ 不得跳过测试直接提交
- ❌ 不得删除或忽略数据库迁移文件
- ❌ 不得在未更新文档的情况下提交代码
- ❌ 不得使用 `--no-verify` 跳过 hooks