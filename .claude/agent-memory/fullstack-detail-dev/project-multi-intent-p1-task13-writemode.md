---
name: project-multi-intent-p1-task13-writemode
description: 任务 13 已交付（1587976）——write_mode 消费链路、computeRoundSkipSet caller 侧补强、confirmMatrix 权威倒置的实现口径与坑
metadata:
  type: project
---

任务 13 已提交 `1587976`（main，未推送）：write_mode 消费点 + 写工具清单收敛至 confirmMatrix。

**Why:** Q23 裁定 auto=链末汇总确认必经 / manual=逐写执行前确认 / confirmMatrix 唯一权威；遗留问题 3（非链流路径无交互拒写不可达）在此任务解决。

**How to apply:**
- 消费链路：`ai_config.write_mode` → `toIAIConfig`（`!= null` 才下发）→ `ctx.writeMode = config.writeMode ?? 'auto'` → `checkForceConfirmTools` batch 档分派。缺省 `?? 'auto'` = P0，既有测试零 fixture 改动。
- skip-set 补强在 `agentLoop.computeRoundSkipSet`（流式 + 延迟重发两路径统一），触发条件是「**无交互 或 manual**」——比计划字面的「无交互」多一个 manual 分支，因为流式路径 `confirmSkipSet(inChain=false)` 不含 batch，manual 单意图在生产唯一路径上不可达确认。`confirmSkipSet` 本体逐字节不动（confirmMatrix.test 103-129 钉死）。
- 方向倒置：confirmMatrix 自持 `CONFIRM_FORCE_TOOLS`/`CONFIRM_BATCH_TOOLS` + 显式 KNOWN_NON_WRITE 23 项（不再 spread READ_ONLY_TOOLS）；agentToolSelector 从 confirmMatrix 派生再导出 WRITE_TOOLS/FORCE_CONFIRM_TOOLS。改 selector 常量时必须同步 confirmMatrix 显式枚举，靠 writeModeConsumption.test ⑤ 交叉断言兜底。
- 手写 `WRITE_TOOLS = new Set([...literal, ...CONFIRM_FORCE_TOOLS])` 半派生会留 unused import lint warning（109≠108 基线）——要么完整派生 `new Set([...CONFIRM_BATCH_TOOLS, ...CONFIRM_FORCE_TOOLS])`，要么全字面量。
- manual 确认卡不传 variant（QuestionCard 默认样式）；无交互闸在 manual 分支之前（两模式共用拒写）。
- flaky：`tests/benchmarks/ab-test.test.ts`「djb2 faster than MD5」计时断言在全量并发下偶发失败，单跑必绿——非回归信号，重跑全量即可。

相关：[[project-multi-intent-p1-commit-discipline]]、[[project-multi-intent-report-redlines]]
