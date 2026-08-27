# Claude Code 斜杠命令完全指南

## 一、核心斜杠命令详解

### 1.1 基础对话控制

| 命令 | 功能描述 | 使用场景 | 示例 |
|------|----------|----------|------|
| `/help` | 显示所有可用指令列表 | 快速了解可用功能 | `/help` |
| `/clear` | 清除当前对话历史 | 频繁切换需求、重新开始对话 | `/clear` |
| `/resume` | 加载并继续之前的对话 | 中断后继续工作 | `/resume` |
| `/rewind` | 撤销对话或代码中的最近修改 | 发现错误需要回退 | `/rewind` |
| `/btw` | 提出临时问题，不影响主对话上下文 | 临时询问，不打断主要工作流 | `/btw 这个语法是什么意思？` |
| `/recap` | 生成当前对话的摘要 | 回顾讨论要点 | `/recap` |
| `/export` | 将完整对话记录导出为文件 | 记录重要讨论 | `/export conversation.md` |

### 1.2 项目记忆管理

| 命令 | 功能描述 | 最佳实践 | 注意事项 |
|------|----------|----------|----------|
| `/init` | 初始化项目结构，创建 `CLAUDE.md` 记忆文件 | 新项目开始时立即使用 | 会覆盖已有配置 |
| `/memory` | 编辑项目的长期记忆存储 | 保存项目规范、架构决策 | 内容量建议控制在2000字以内 |
| `/goal` | 设定并固定当前对话目标 | 明确对话范围，避免主题漂移 | 可随时调整 |

**记忆文件最佳结构：**
```markdown
# 项目架构
- 前端：React 18 + TypeScript
- 后端：Node.js + Express
- 数据库：PostgreSQL

# 编码规范
- 使用ESLint + Prettier
- 组件采用函数式组件+Hooks
- API遵循RESTful规范

# 当前任务
- 实现用户认证模块
- 优化数据库查询性能
```

### 1.3 工程开发命令

| 命令 | 功能描述 | 参数选项 | 输出示例 |
|------|----------|----------|----------|
| `/map` | 分析并展示项目目录结构 | `--depth 3` 控制深度 | 树形目录结构 |
| `/search` | 在整个项目中搜索代码内容 | `--include *.ts` 指定文件类型 | 匹配的代码片段 |
| `/analyze` | 检查代码中的潜在问题与风险 | `--strict` 严格模式 | 问题报告 |
| `/refactor` | 批量重构指定代码部分 | `--preview` 预览模式 | 修改对比 |
| `/docs` | 自动为项目生成文档说明 | `--type api` API文档 | Markdown文档 |
| `/sandbox` | 在隔离的沙箱环境中执行命令 | `--timeout 30` 超时设置 | 执行结果 |

### 1.4 质量保障命令

| 命令 | 功能描述 | 质量指标 | 集成建议 |
|------|----------|----------|----------|
| `/review` | 进行代码审查 | 代码规范、最佳实践、潜在问题 | 与Git PR流程集成 |
| `/bug` | 检测代码中的安全漏洞 | OWASP Top 10、常见漏洞模式 | 定期扫描 |
| `/simplify` | 简化代码结构，保持原有逻辑不变 | 圈复杂度、代码重复率 | 重构前使用 |
| `/unit-test` | 为代码自动生成单元测试 | 覆盖率目标80%+ | CI/CD集成 |
| `/fix` | 自动修复运行时错误 | 错误类型识别、修复建议 | 生产环境监控 |

### 1.5 成本与上下文管理

| 命令 | 功能描述 | 监控指标 | 优化建议 |
|------|----------|----------|----------|
| `/context` | 查看当前上下文窗口的使用状态 | Token使用量、剩余容量 | 大文件处理前检查 |
| `/compact` | 压缩上下文信息以节省空间 | 压缩率、信息保留度 | 长会话后使用 |
| `/cost` | 查询Token的具体消耗情况 | 成本分布、主要消耗项 | 预算控制 |
| `/usage` | 查看当前配额的剩余与使用详情 | 剩余额度、使用趋势 | 资源规划 |

### 1.6 安全配置

```
安全日志配置示例：
- 启用详细日志记录：/config logging verbose
- 设置敏感信息过滤：/config sensitive_filter true
- 配置访问控制：/config access_control strict
```

## 二、企业级使用场景

### 2.1 新项目标准化流程

```mermaid
graph TD
    A[项目启动] --> B[/init 初始化]
    B --> C[/goal 设定目标]
    C --> D[/map 分析结构]
    D --> E[/simplify 简化代码]
    E --> F[/bug 漏洞检测]
    F --> G[/unit-test 测试覆盖]
    G --> H[/review 代码审查]
    H --> I[/docs 文档生成]
    I --> J[/compact 压缩上下文]
    J --> K[/export 导出记录]
```

**详细步骤说明：**
1. **项目初始化**：`/init` 创建标准化的项目配置
2. **目标明确**：`/goal "实现电商平台用户系统"`
3. **架构分析**：`/map --depth 4` 了解项目全貌
4. **代码优化**：`/simplify --preserve-logic` 保持功能不变前提下优化
5. **安全检测**：`/bug --comprehensive` 全面扫描漏洞
6. **测试保障**：`/unit-test --coverage 85` 生成测试用例
7. **质量审查**：`/review --strict` 严格代码审查
8. **文档完善**：`/docs --type api,architecture` 生成多类型文档
9. **资源优化**：`/compact --aggressive` 压缩上下文信息
10. **记录导出**：`/export full-report.md` 完整项目报告

### 2.2 老项目优化修复流程

```mermaid
graph LR
    A[问题识别] --> B[/clear 清理上下文]
    B --> C[/bug 漏洞扫描]
    C --> D[/analyze 深度分析]
    D --> E[/simplify 代码简化]
    E --> F[/refactor 安全重构]
    F --> G{异常检测}
    G -->|有异常| H[/rewind 回滚]
    H --> F
    G -->|无异常| I[/review 代码审查]
    I --> J[/compact 资源优化]
    J --> K[/export 完成报告]
```

**关键点：**
- 使用 `/rewind` 作为安全网，确保重构失败时可快速回滚
- 每个阶段都要有明确的检查点
- 记录每个步骤的改动，便于追溯

### 2.3 上线前质检流程

```mermaid
graph TD
    A[上线准备] --> B[/goal 明确范围]
    B --> C[/permissions 权限检查]
    C --> D[/map 完整性检查]
    D --> E[/simplify 代码精简]
    E --> F[/review 终审]
    F --> G[/unit-test 最终测试]
    G --> H[/docs 文档更新]
    H --> I[/cost 成本核算]
    I --> J[/export 上线报告]
```

## 三、高级使用技巧

### 3.1 命令组合模式

**场景1：快速原型开发**
```bash
# 1. 快速生成项目结构
/init --template react-typescript

# 2. 设定明确目标
/goal "实现TODO应用基础功能"

# 3. 生成核心代码
/docs --type api --output ./src/api.ts
/unit-test --pattern "测试用例描述"
```

**场景2：代码质量提升**
```bash
# 1. 全面问题检测
/bug --comprehensive --include-security
/analyze --deep --performance

# 2. 逐步优化
/simplify --preserve-logic --preview
/refactor --safe --test-driven

# 3. 验证改进
/unit-test --coverage-increase
/review --before-after
```

### 3.2 性能优化技巧

| 优化场景 | 推荐命令 | 预期效果 | 注意事项 |
|----------|----------|----------|----------|
| 大文件处理 | `/compact --level 3` | 减少50%+ Token消耗 | 可能丢失部分上下文细节 |
| 长会话管理 | 定期使用 `/recap` + `/compact` | 保持对话效率 | 重要决策及时记录到记忆文件 |
| 并行任务 | 使用 `/btw` 隔离临时问题 | 避免主任务干扰 | 并行任务不超过3个 |

### 3.3 调试与故障排除

**常见问题解决方案：**

1. **命令无响应**
   ```bash
   # 检查上下文状态
   /context
   
   # 清理并重试
   /clear
   /resume last-session
   ```

2. **Token消耗过高**
   ```bash
   # 分析消耗分布
   /cost --breakdown
   
   # 压缩上下文
   /compact --aggressive
   
   # 优化记忆文件
   /memory --trim
   ```

3. **重构失败回滚**
   ```bash
   # 立即回滚
   /rewind --to "重构前状态"
   
   # 分析失败原因
   /analyze --error-focus
   
   # 尝试更保守的重构
   /refactor --safe-mode --preview
   ```

## 四、企业最佳实践

### 4.1 团队协作规范

**版本控制集成：**
```bash
# 每次重要修改前
/export pre-change-$(date +%Y%m%d).md

# 代码审查时
/review --team-standard --output review-report.md

# 知识沉淀
/memory --team-share --contribution
```

**代码审查清单：**
1. 使用 `/review --checklist` 生成审查清单
2. 确保 `/bug --zero-tolerance` 无高危漏洞
3. 验证 `/unit-test --coverage 90` 测试覆盖
4. 确认 `/docs --up-to-date` 文档同步

### 4.2 安全与合规

**安全扫描流程：**
```bash
# 1. 全面安全扫描
/bug --compliance GDPR,HIPAA
/bug --security-scan OWASP

# 2. 敏感信息检测
/search --sensitive --patterns "password,secret,token"
/analyze --privacy --data-flow

# 3. 安全报告生成
/export security-audit-$(date +%Y%m%d).md
```

### 4.3 持续集成/持续部署

**CI/CD集成示例：**
```yaml
# .github/workflows/claude-code.yml
jobs:
  quality-check:
    steps:
      - name: Code Review
        run: claude-code /review --strict --output review.md
      
      - name: Security Scan
        run: claude-code /bug --ci-mode --fail-on-high
      
      - name: Test Generation
        run: claude-code /unit-test --generate --coverage 85
      
      - name: Documentation
        run: claude-code /docs --ci --auto-update
```

## 五、常见误区与避坑指南

### 5.1 命令误用场景

| 错误用法 | 正确替代 | 原因分析 |
|----------|----------|----------|
| 频繁使用 `/clear` 解决上下文问题 | `/compact` + `/recap` 组合 | `/clear` 会丢失所有上下文 |
| 用 `/simplify` 进行复杂重构 | `/refactor --safe` | `/simplify` 只做简化，不做结构调整 |
| 忽略 `/goal` 直接开始工作 | 明确设定目标再开始 | 没有目标容易偏离方向 |
| 并行执行5个以上任务 | 控制在3个以内 | 并行过多影响性能和准确性 |

### 5.2 性能优化误区

**错误观念：** "越多命令越好"
- **现实：** 合理组合3-5个命令比堆砌10个命令更有效
- **建议：** 根据任务类型选择核心命令组合

**错误观念：** "上下文越大越好"
- **现实：** 过大的上下文会降低响应质量
- **建议：** 使用 `/compact` 主动管理上下文大小

### 5.3 团队协作陷阱

**陷阱1：** 记忆文件过于庞大
```bash
# 错误：添加所有信息到记忆文件
/memory --add "整个项目文档..."

# 正确：只添加关键架构决策和规范
/memory --add "使用React 18 Hooks模式"
/memory --add "API错误码规范：400-客户端错误，500-服务端错误"
```

**陷阱2：** 忽略版本控制
```bash
# 错误：直接修改生产环境配置
/init --production

# 正确：在开发环境测试后部署
/init --dev
/export dev-config.md
# 团队评审后
/init --production --from dev-config.md
```

## 六、附录与参考资源

### 6.1 完整命令速查表

**基础命令（10个）**
1. `/help` - 帮助信息
2. `/clear` - 清除历史
3. `/resume` - 继续对话
4. `/rewind` - 撤销修改
5. `/btw` - 临时问题
6. `/recap` - 对话摘要
7. `/export` - 导出记录
8. `/init` - 项目初始化
9. `/memory` - 记忆管理
10. `/goal` - 目标设定

**工程命令（8个）**
11. `/map` - 目录分析
12. `/search` - 代码搜索
13. `/analyze` - 问题分析
14. `/refactor` - 安全重构
15. `/docs` - 文档生成
16. `/sandbox` - 沙箱执行
17. `/review` - 代码审查
18. `/bug` - 漏洞检测

**质量命令（4个）**
19. `/simplify` - 代码简化
20. `/unit-test` - 测试生成
21. `/fix` - 错误修复
22. `/context` - 上下文状态

**管理命令（4个）**
23. `/compact` - 上下文压缩
24. `/cost` - 成本查询
25. `/usage` - 使用详情
26. `/config` - 安全配置

### 6.2 场景化命令组合

**Web开发组合：**
```bash
/init --template react
/goal "实现电商网站产品页面"
/map --depth 3
/simplify --performance
/unit-test --react-testing-library
/docs --storybook
```

**数据科学组合：**
```bash
/init --template python-data
/goal "机器学习模型训练"
/analyze --data-quality
/refactor --pandas-optimization
/unit-test --pytest
/docs --jupyter-notebook
```

**移动开发组合：**
```bash
/init --template react-native
/goal "iOS/Android跨平台应用"
/map --platforms
/simplify --react-native-best-practices
/unit-test --detox
/docs --app-store
```

### 6.3 性能监控指标

**关键性能指标（KPI）：**
1. **命令响应时间**：< 2秒为优秀
2. **Token效率**：每千Token产出价值
3. **错误率**：< 5%为可接受
4. **团队采纳率**：> 80%为成功

**监控命令：**
```bash
# 性能监控
/context --performance
/cost --efficiency-report
/usage --trend-analysis

# 质量监控
/review --quality-metrics
/bug --remediation-progress
/unit-test --coverage-trend
```

---

**最后更新：** 2024年1月
**版本：** 2.0
**维护团队：** Claude Code 企业支持团队

> 💡 **提示：** 本指南会持续更新，建议定期使用 `/export` 导出最新版本。遇到问题时，优先查阅本指南的"常见问题"章节。