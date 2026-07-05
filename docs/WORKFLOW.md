# WeaveMD — 工作流规范

> 本章节为占位文档，将在开发过程中逐步完善。

## Git 提交规范
- 格式：`type(scope): message`
- type: feat / fix / refactor / docs / test / chore / style
- scope: auth / editor / navbar / settings / db / ui / config
- 示例：`feat(auth): add login page with form validation`

## 开发流程
1. 从 main 分支创建 feature 分支
2. 编码实现功能
3. 运行 `npm run test` 确保测试通过
4. 更新对应 docs 文档
5. 提交 PR → Code Review → 合并到 main

## 发布流程
- 遵循语义化版本 (SemVer)
- 更新 CHANGELOG.md
- 打 tag 并创建 GitHub Release