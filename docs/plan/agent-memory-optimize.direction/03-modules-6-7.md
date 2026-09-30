# 模块六 / 模块七

> 拆分自 [agent-memory-optimize.direction.md](../agent-memory-optimize.direction.md)，原 §六 经验沉淀与 Skill、§七 测试与验收；2026-10-01 按渐进式披露拆分，正文未改动。
> 返回索引：[agent-memory-optimize.direction.md](../agent-memory-optimize.direction.md)

---

## 六、经验沉淀与 Skill 模块

> 本模块为 P2 远期能力，复杂任务，均带外部检索 ①②③。

### 1.【P2】执行轨迹 → 可复用 Skill 提炼（依赖：三.2、五.1）

**重点文档**：`C:\Users\lenovo\Desktop\生产级Agent Memory.txt:9-10`（程序性经验沉淀：Logs→定期回看反思→成功路径抽象为步骤/失败根因抽象为避坑规则）、`.claude/CLAUDE.md:29-30`（项目已有 `src/main/ai/skills/` 与 skillLoader）、`docs/modules/11-AI代理面板-Agent.md`（skillLoader 职责）

**重点代码**：`src/main/ai/skills/`（skillLoader 现有实现）、`src/main/ai/agent/agentEventStore.ts`（轨迹来源：chunk/tool/done 事件）、`src/main/ai/toolRegistry.ts`（技能注入点参照）

**执行前拷问**：
❓ 提炼是全自动（LLM 定期回看日志）还是半自动（人工审核后生效）？参考文档避坑指南 `:12` 要求"工具不成熟先人工审核再生效"——采纳哪档？
❓ 轨迹来源用 `agent_run_events` 还是 `ai_messages`（前者含 chunk 噪声，后者缺工具细节）？
❓ 与现有 skills/（用户手写技能）的存放与命名如何共存不冲突？

**验收拷问**：
❓ 构造 3 次同类任务轨迹，提炼出的步骤可被第 4 次任务直接调用且结果正确？
❓ 失败轨迹提炼出的避坑规则在后续任务中确实被触发？

**外部检索**：
① Docs MCP Server 查询 `langmem` 库索引：procedural memory / skill 提取相关最新文档；再查 `langchain` 库索引：reflection / self-improvement 模式
② fastcrw 检索："distill reusable skills from agent execution trajectories reflection design" 的设计资料
③ fastcrw 检索："agent skill library induction from logs success failure path" 的功能实现及特性

### 2.【P2】经验的结构化存储 + 任务类型识别注入（依赖：六.1、四.2）

**重点文档**：`C:\Users\lenovo\Desktop\生产级Agent Memory.txt:11`（存和用：结构化存储保持流程顺序 → 注入上下文识别任务类型后作行为指导 → 沉淀成技能）

**重点代码**：`src/main/ai/skills/`、`src/main/ai/agent/agentContext.ts:483-501`（注入位置）、`src/main/ai/intentRouter.ts:17-67`（任务类型识别可复用）

**执行前拷问**：
❓ 存储结构如何保持"流程规则的顺序"（有序 JSON？markdown 步骤？）？
❓ 注入时机由什么触发（意图分类命中？工具调用前检索？），注入量如何控 token？

**验收拷问**：
❓ 识别到任务类型后，行为指导出现在提示词中且顺序未被洗乱？
❓ 未命中类型时零注入、无副作用？

**外部检索**：
① Docs MCP Server 查询 `langchain` 库索引：structured memory / store namespace 组织方式最新文档
② fastcrw 检索："procedural memory structured steps prompt injection design" 的设计资料
③ fastcrw 检索："task type classification routing memory retrieval" 的功能实现及特性

### 3.【P2】防膨胀三防线：合并去重 / 过期复核 / 人工审核（依赖：六.1、六.2）

**重点文档**：`C:\Users\lenovo\Desktop\生产级Agent Memory.txt:12`（避坑：避免过拟合、方法过期需复核淘汰、规则合并去重防膨胀、工具不成熟先人工审核再生效）

**重点代码**：`src/main/ai/skills/`（技能清单管理）、`src/main/db/`（经验表 Policy 落地）

**执行前拷问**：
❓ 去重判定标准（语义相似度阈值 vs 关键词）？合并由谁执行（自动 vs 审核）？
❓ "过期复核"的周期与信号是什么？人工审核的入口在哪（最小改动方案）？

**验收拷问**：
❓ 注入 50 条相似经验后，三防线生效、注入条数有上界？
❓ 复核淘汰后的经验不再出现在任何提示词中？

**外部检索**：
① Docs MCP Server 查询 `langmem` 库索引：memory deduplication / curation 最新文档
② fastcrw 检索："skill library deduplication expiry human review design" 的设计资料
③ fastcrw 检索："LLM rule consolidation anti overfitting guardrail" 的功能实现及特性

---

## 七、测试与验收模块

### 1.【P1】指代 E2E 三场景（场景①随一.1 同批交付）（依赖：一.1、一.2、一.3、二.1、二.2）

**重点文档**：`docs/architecture/testing.md`（测试策略）、`docs/testing/`（既有 TDD 报告写法范例，如 `agent-cost-optimize.tdd.md`）、`.claude/CLAUDE.md:11`（`npx playwright test` 真实 Chromium E2E）

**重点代码**：`playwright.config.*` 与 e2e 用例目录（实施时 glob 定位）、`src/main/ai/agent/agentContext.ts`（被测行为）、`src/render/components/AIAgent/cards/QuestionCard.tsx`（断言不弹卡）

**执行前拷问**：
❓ 三场景固定为：①RAG 问答后问「它有什么优势」→ 不弹卡且回答引用先行词；②chat 意图下历史仍存在；③压缩触发后指代仍成立——是否需补"全新会话纯代词仍正确反问"的反向用例？
❓ 场景③如何稳定触发压缩（注入大历史 vs 调低阈值构造）？
❓ E2E 是否要 mock LLM？用哪个后端保证可重复？

**验收拷问**：
❓ 三场景在 CI 质量门禁下稳定通过（连续 3 次无 flaky）？
❓ 修复前跑会失败、修复后通过（证明用例真的覆盖根因）？

### 2.【P1】质量门禁回归（依赖：全部任务）

**重点文档**：`.claude/CLAUDE.md:10-12`（门禁四件套）、`.claude/rules/WORKFLOW.md`（编码→测试→文档→提交流程）

**重点代码**：`package.json` scripts（`npm run lint` / `typecheck` / `test` / `build`）

**执行前拷问**：
❓ 每批任务（P0/P1/P2）交付时各跑哪些门禁（全量 vs 快速集）？
❓ 改了 DB 表结构后，`npm run test` 是否覆盖迁移双路径用例？

**验收拷问**：
❓ `tsc + vitest + eslint(0 error) + vite build + npx playwright test` 全绿的输出证据是否留存到 `docs/testing/`？
❓ 是否同步更新了 `docs/` 对应设计文档与 `docs/TODO.md` 状态？

### 3.【P1】压缩 / 记忆单元测试（依赖：一.5、三.1、四.3）

**重点文档**：`docs/architecture/testing.md`、`docs/requirements/agent-perf-optimize.req.md:11-17`（历史保留红线的守护测试）

**重点代码**：`src/main/ai/contextManager.ts:109-170,192-259`（阈值与摘要）、`src/main/ai/agent/agentContext.ts:359-424`（历史组装）、`src/main/db/ai.ts`（记忆表 DAO）

**执行前拷问**：
❓ 守护测试清单：历史 20 条读取、KEEP_RECENT_ROUNDS、chat 意图历史保留、tool_calls 落库回读、记忆表迁移双路径——还缺什么？
❓ 参考阈值改动（四.3）后，测试如何锁定"不减历史轮次"红线？

**验收拷问**：
❓ vitest 全绿且新增用例能对被修改的阈值/行为产生失败信号（变异验证：故意改错应变红）？
❓ 测试断言不含 any、不依赖真实网络？

---

