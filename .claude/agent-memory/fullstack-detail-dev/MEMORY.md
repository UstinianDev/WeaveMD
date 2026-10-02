# Agent Memory Index

- [multi-intent 任务10 边界固化](project-multi-intent-p1-task10-boundary.md) — P1 八任务全完成（87e9c63）；裁定：不建共享常量文件，两套意图枚举禁止合并
- [multi-intent 任务8 并行调度](project-multi-intent-p1-task8-parallel.md) — 启用信号 subtaskParallel（计划外红线偏离）+ 轮次基址方案保 worker E2E call id；ab-test flaky 第三次记录
- [multi-intent P1 提交纪律](project-multi-intent-p1-commit-discipline.md) — status/req/plan 三文件永不入库；按计划 §3 白名单 add；任务 6/7/4/9/12/13/8/10 已交付 1bb52b5、4fcd6a2、d2b3168、7d1f8f4、7fa9eb5、1587976、cd61099、87e9c63
- [multi-intent 任务13 write_mode](project-multi-intent-p1-task13-writemode.md) — computeRoundSkipSet 触发=无交互**或**manual；selector 半派生留 unused warning；ab-test 计时 flaky 非回归
- [multi-intent 任务12 确认与级联](project-multi-intent-p1-task12-confirm.md) — worker E2E DONE 走 persistAndSend；return await 才落 ERROR catch；自动 serial_after 扩大级联范围（chainReport ③ 已改）
- [multi-intent 任务9 透传与两坑](project-multi-intent-p1-task9-bridge.md) — agentIntent 透传链；闭包重建 opts 丢参（grep agentTaskWorker）；链测试部分 ctx 判空
- [multi-intent 报告红线裁定](project-multi-intent-report-redlines.md) — confirmWriteBatch 返回保持 string 走 sink（任务 12 必读）；报告段条件渲染 + 6 处链正文 toBe 锚点；Q7 同对象写合并陷阱
- [multi-intent 任务4 意图分层口径](project-multi-intent-p1-task4-tiering.md) — 缓存只写 tier2 成功值/shared 只读；protocol==='openai' 门；预取双键；任务 9 改 kbSearch 必读
