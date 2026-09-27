# Agent Memory Index

- [doc-pipeline B2 完成与共享通道坑](doc-pipeline-b2-done.md) — B2 commit da7ceaa、下一任务 B3；DIALOG_OPEN_FILE 双消费方耦合改契约前必查
- [doc-pipeline B3 完成与真库迁移工作流](doc-pipeline-b3-done.md) — B3 commit d55002b、下一任务 B4；vitest 不能实例化 better-sqlite3→走 electron smoke
- [doc-pipeline B4 完成与覆盖率口径坑](doc-pipeline-b4-done.md) — B4 commit 064cc3e、下一任务 B5；coverage fail 不落报告 + 附件唯一删除点收口
- [doc-pipeline B5 完成与分支核实坑](doc-pipeline-b5-done.md) — B5 commit 26816af、下一任务 B6(L4 需二次确认)；kbIndexOpts→resolveEmbedding 单点 + 提交前核实当前分支
- [doc-pipeline B6 完成与 mock/性能用例坑](doc-pipeline-b6-done.md) — B6 四 commit 至 e35ea78、下一任务 B7；contextManager 局部 mock 缺 key 运行期炸 + 性能断言负载 flaky
- [doc-pipeline B7 完成与选型/算法坑](doc-pipeline-b7-done.md) — B7 四 commit 至 e606ca9、下一任务 B8；liteparse 坐标实测不引 pdfjs-dist + gutter/字号/覆盖率补测/JSON 转义坑
- [doc-pipeline B8 完成与四个环境坑](doc-pipeline-b8-done.md) — B8 四 commit 至 9fbcfdc、下一任务 B9；vitest path.isAbsolute 是 posix、bm25 负分、路径转义吃字、段聚合干扰 top1
- [doc-pipeline B9 完成与引用模式取舍](doc-pipeline-b9-done.md) — B9 两 commit 至 67372f8、下一任务 B10/B11（L4 需二次确认）；发送构造在 agentStore 非 FileTreePanel + 越界判定先于存在性检查
- [doc-pipeline B10 完成与打包验证坑](doc-pipeline-b10-done.md) — B10 三 commit 至 bc34ef3、下一任务 B11/B12；asar 288→85.93MB、Q5 验证通过、v24 排除双口径 + sqlite-vec 打包降级遗留
- [doc-pipeline B11 完成与外发过滤结构](doc-pipeline-b11-done.md) — B11 两 commit 至 b1ed1f1、下一任务 B12；过滤必须包 deps.searchKb（preloader 覆盖 toolCtx）+ D5b 计划缺口 + FakeDb run 的 sql 是闭包变量
- [doc-pipeline remedial 完成与裁定/fs-mock 坑](doc-pipeline-remedial-done.md) — remedial 11 commit 至 e6bdb6e、R3 本会话豁免跨会话恒拦；vi.mock('fs') 打不进 agentMedia 用真文件
