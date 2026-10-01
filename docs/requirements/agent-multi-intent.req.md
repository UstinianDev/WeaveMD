# agent-multi-intent — 需求文档（P0 主线）

> 来源：`C:\Users\lenovo\Desktop\优化方向\智能创作Agent-多意图识别-优化方向.md`（任务 1、2、3、5、11）
> 对齐方式：grill-me 一轮对齐（Q1~Q14），2026-10-01 用户裁定「全部按推荐」
> 档位：L（重型），TDD strict

## 1. 目标

补齐智能创作 Agent 的多意图识别与执行能力缺口：

1. LLM 出参结构化任务 Schema（拆分结果可校验、失败可降级）；
2. 多意图识别与拆分（含规则预检门，单意图零成本）；
3. 置信度消费与低风险追问改造；
4. 同 session 内子任务顺序执行；
5. 风险分档确认矩阵（intent × tool），铁律一不削弱。

## 2. 范围

**本次仅 P0 主线 5 任务**（P1：4/6/7/9/12/13；P2：8/10 挂起至下轮）。

| # | 任务 | 风险级 | 依赖 |
| - | ---- | ------ | ---- |
| 1 | 结构化任务 Schema | L3 | 无 |
| 2 | 多意图识别与拆分 | L3 | 任务 1 |
| 3 | 置信度消费与追问 | L2 | 任务 2 |
| 5 | 子任务顺序执行 | L3 | 任务 2 |
| 11 | 风险分档确认矩阵 | L3 | 任务 2 |

## 3. 已对齐问题清单（决策记录）

| # | 问题 | 裁定 |
| - | ---- | ---- |
| Q1 | 施工范围 | 本对话只做 P0 五任务，P1/P2 挂起 |
| Q2 | 验收标准 | 按源文档各任务验收小节 + typecheck + test 全绿 + 同步指定文档；TDD strict，证据报告 `docs/testing/agent-multi-intent.tdd.md` |
| Q3 | zod 依赖 | **不引入**；抽通用 `parseStructuredJson` 骨架（源自 memoryWriter `parseExtractionItems`），memory 侧行为不变 |
| Q4 | 结构化出参机制 | **厂商无关**：提示词内嵌 JSON Schema + 本地严格解析校验（双协议 OpenAI/Anthropic 均可用）；不用 `output_config`/`tool_choice` |
| Q5 | 校验失败策略 | 重试 1 次 → 降级单意图直通（现规则引擎路径），拆分失败不阻断对话 |
| Q6 | 规则预检门 | 连接词（并且/然后/顺便/另外/同时/接着）**或**意图关键词并列命中 ≥2 类；不加长度阈值；单意图零 LLM 调用 |
| Q7 | 过度拆分 | 上限 5，超限取置信度前 5 并明示省略；同文件写子任务合并；不同对象写标注串行依赖 |
| Q8 | candidates 语义 | 两套并存：低置信单意图仍出候选卡（择一重发，现状不变）；多意图出**新拆分确认卡**（可增删后确认） |
| Q9 | 轮次预算 | 按子任务独立分配（=现单意图预算）+ 总量封顶（2×上限），写测试钉死 |
| Q10 | 追问与 confidence | 沿用每轮 ≤2 题；confidence 只驱动追问不参与轮次；部分子意图低置信 → 先执行高置信部分 + 追问并行 |
| Q11 | 执行中新消息 | 维持 supersede 语义（只作废 pending），当前子任务链在当前子任务完成的安全点停止 |
| Q12 | 子任务上下文/失败 | 前序结果以执行摘要注入后续 prompt，轮次预算独立计；失败重试 1 次 → `waiting_interaction` 等用户（预登记为 P1 任务 7 合并口径） |
| Q13 | auto 与铁律 | 确认不省略；多写子任务**汇总一次确认**，逐项勾选拒绝走快照回滚 |
| Q14 | 规则权威 | 代码矩阵为准，测试钉死，提示词同步改，禁止分叉 |

## 4. 验收标准（汇总）

- 新增测试：`taskPlannerSchema.test.ts`（合法/非法/降级）、`intentRouter.test.ts` 多意图 ≥6 例、追问矩阵（挂 `agentContext.test.ts`）、`subtaskSequence.test.ts`（顺序/失败/打断）、确认矩阵（挂 `agentToolExecutor.test.ts`，含 fail-closed）
- 门禁：`npm run typecheck` + `npm run test` + `npm run lint` + `npx playwright test` 全绿
- 文档同步：`docs/specs/ai-agent/agent-prompt-context.md`、`docs/architecture/ai-agent.md`、`docs/modules/11-AI代理面板-Agent/03-question-cards.md`、`docs/specs/ai-agent/agent-tool-runtime.md`
- TDD strict 证据报告：`docs/testing/agent-multi-intent.tdd.md`

## 5. 约束与风险预登记

- 铁律一「AI 写入必经确认」与 fail-closed（无交互环境拒执行）不可削弱；
- 不改已应用历史迁移；如需 `agent_task_queue` 加列仅限 P0 需要的最小集（P0 预计**不加列**，子任务先在 session 内内存编排）；
- 不引入 zod、不引入 @anthropic-ai/sdk；
- agent 模块不在覆盖率白名单，验收不看覆盖率数值。
