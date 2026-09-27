---
name: doc-pipeline-b10-done
description: B10 打包体积批次完成记录——体积前后数字、monaco Q5 验证结论、v24 files 排除要点与遗留（sqlite-vec 打包降级）
metadata:
  type: project
---

# doc-pipeline B10 完成（2026-09-27，L4 已二次放行）

**状态**：✅ 三 commit 至 `bc34ef3`（6f5ef21 测试/脚本 → 80a93fd 打包配置 → bc34ef3 文档），分支 `feat/doc-pipeline`，未推送。证据 `docs/testing/doc-pipeline-b10.tdd.md`，状态入 `docs/plan/doc-pipeline.status.md` B10 小节。

**体积实测（前后）**：Setup 147.68→99.16MB、msi 154.68→109.93MB、win-unpacked 602.15→368.96MB、app.asar 288→85.93MB。门禁 `scripts/sizeGate.mjs` 挂 postbuild（exe/msi≤500MB、win-unpacked≤1GB + asar 黑白名单断言），`npm run size` 单跑。

**七-2 monaco Q5 结论：验证通过、已剔除**。方法：打包 exe 开 CDP（--remote-debugging-port）+ Playwright connectOverCDP，page request + CDP Network 双通道，先 reload 再 Ctrl+` 进源码模式；正对照 = 懒加载 chunk 全被捕获，`node_modules/monaco-editor|react-icons` 加载 0；剔除后源码模式实测正常（双向闭环）。

**Why**: 后续批次（B12 Docling 转正）必须重跑 `npm run size` 门禁；改 build.files 或升级 electron-builder 时需复核排除是否仍生效。

**How to apply / 关键坑**：
- v24.13.3 files 反向排除对 node_modules 生效，但匹配基准是「依赖目录父目录」与「项目根」双口径——每条排除必须写两种形式（`!node_modules/x/**` + `!x/**`）。
- `NODE_OPTIONS=--require` 对打包 Electron 应用不生效（"Most NODE_OPTIONs are not supported in packaged apps"）——主进程运行时钩子只能靠改包/等效组合证据。
- asar list 的条目含 unpacked 标记文件（asar 与 app.asar.unpacked 会"同时"出现于 list 与磁盘，非双拷贝）。
- **遗留（非 B10 引入）**：打包形态 `sqlite-vec load failed` 降级 FTS5-only（旧包即有，vec0.dll 在 unpacked 但加载路径疑未映射）——建议 B11 或独立批次核查。
- 隐患：Linux AppImage target 启用前必须移除 liteparse Linux 两条排除（packaging.md 已警示）。
- vitest 新增 22 例（IconInventory 4 + sizeGate 18），全量 161 文件 3730 passed；E2E 基线仍 31 failed 零新增。

相关：[[doc-pipeline-b9-done]]、[[doc-pipeline-progress]]
