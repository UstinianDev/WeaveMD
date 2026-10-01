# doc-pipeline B10 — TDD 证据报告（strict）

> 创建：2026-09-27 | 批次：**B10（七-1 四项瘦身 + 七-2 monaco 运行时验证 + 七-3 体积门禁）** | 强度：strict（RED → 最小实现 GREEN → 重构 → 门禁 → 实测验证 → 提交）
> 来源：`docs/plan/doc-pipeline.plan.md` §1/§2-B10/§4.2-B10 / [需求](../requirements/doc-pipeline.req.md) Q5
> 权威需求源：`C:\Users\lenovo\Desktop\优化方向\优化方向.md` §七-1/七-2/七-3 + §0 体积基线
> 风险级：**L4（打包红线）**；红线：体积 ≤1GB 硬上限 / 500MB 目标、瘦身不改任何功能、不删测试、不放宽 `allowSend`、不动历史迁移、不推送远程

## 1. 测试范围

| 文件 | 类型 | 新增用例 | 覆盖项 |
|------|------|---------|--------|
| `tests/components/IconInventory.test.tsx` | **新建** | 4 | **七-1② 红线**：`ICON_INVENTORY` 全表（132 项 name→react-icons/md 导出名）与 `ICON_MAP` **双向键对账**（无图标消失/凭空新增）；逐项**组件身份比对** `ICON_MAP[name] === MdIcons[exportName]`（无图标变样）；**视觉回归断言**——清单每项渲染出非空 `<svg>`；未知图标降级首字母不回归 |
| `tests/scripts/sizeGate.test.ts` | **新建** | 18 | **七-3② 全项**：双口径限额常量（500MB/1GB 二进制 MB）；`evaluateGates` 全过/单超精确命中；`formatMB` 基线口径（147.68MB = 154854703B/1024²）；`topContributors` 降序取 N；**`topAsarFiles` 按 asar 头 size 排序**；**`groupAsarEntries` 普通包与 @scope 包聚合**（修复双前缀）；`walkDirSize` 递归求和；`collectInstallerArtifacts` 只收 release 顶层 `*.exe/*.msi`；**`readAsarEntries` 解析合成 asar 字节流**（pickle 头 + JSON 头）；`checkAsarContent` 必含缺失（**better_sqlite3.node 误伤探测**）/禁含命中/含 unpacked 路径；`ASAR_REQUIRED`/`ASAR_FORBIDDEN` 覆盖断言（react-icons、monaco-editor、jieba 三分支、better-sqlite3 deps、liteparse Linux 件） |
| **合计** | | **+22** | （= 全量 vitest **3730** − B9 基线 **3708**；文件 159 → 161，新建 2） |

**视觉回归清单（七-1② 交付物）**：`tests/components/IconInventory.test.tsx` 内 `ICON_INVENTORY` 即 Icon.tsx `ICON_MAP` 的 name→component 全表（132 项，从现源码解析生成）。任何图标增删改不同步该表即红。

## 2. RED（先写失败测试，实际执行）

分两轮（每轮先落测试再改实现），实测输出：

```
$ 轮1（2026-09-27 02:53）
 npx vitest run tests/scripts/sizeGate.test.ts tests/components/IconInventory.test.tsx
 Test Files  2 failed (2)
   sizeGate.test — Failed to resolve import "../../scripts/sizeGate.mjs"（模块不存在，收集失败）
   IconInventory — 2 failed | 2 passed (4)
     ← TypeError: Cannot convert undefined or null to object（ICON_MAP 未导出）；
        清单渲染断言失败（未导出的 map 取键为 undefined）

$ 轮2（2026-09-27 03:29，打包实测发现 top-N 两个缺陷后补测）
 npx vitest run tests/scripts/sizeGate.test.ts
 Test Files  1 failed (1)
   Tests  3 failed | 15 passed (18)
     ← topAsarFiles / groupAsarEntries 不存在（导入失败）；
        背景：首轮门禁输出 "top asar files" 未按体积排序（main() 直接把 asar 头
        {path,size} 交给按 {path,bytes} 排序的 topContributors，bytes=undefined →
        比较 NaN → 保持插入序）；包分组出现 "/node_modules/node_modules/@llamaindex"
        双前缀（seg 切片取错位）
```

RED 即通过的 15 条 = 首轮已实现的断言回归（限额、门禁判定、asar 解析、黑名单）。

## 3. 最小实现 → GREEN（实际执行）

```
$ 轮1（2026-09-27 02:55）
 scripts/sizeGate.mjs + scripts/sizeGate.d.mts 新建；Icon.tsx 导出 ICON_MAP
 npx vitest run tests/scripts/sizeGate.test.ts tests/components/IconInventory.test.tsx
 Test Files  2 passed (2)      Tests  19 passed (19)

$ 轮2（2026-09-27 03:30）
 sizeGate.mjs：新增 topAsarFiles（size→bytes 映射后再排序）+ groupAsarEntries 导出
 （作用域包按 @scope/name 两段、普通包单段、非 node_modules 取顶层目录）；
 main() 改用 topAsarFiles；sizeGate.d.mts 同步
 npx vitest run tests/scripts/sizeGate.test.ts
 Test Files  1 passed (1)      Tests  18 passed (18)
 $ node scripts/sizeGate.mjs（对真实打包产物）
   -- top asar files --  首条 18.17MB liteparse.win32...node（排序正确）
   -- top asar groups -- /node_modules/@llamaindex/liteparse-win32-x64-msvc（无双前缀）
   size gate PASSED，exit 0
```

## 4. 重构（不改行为）

- `scripts/clean.mjs`：清理 `dist-main`/`dist-render` 生成物（纯删除脚本，行为由打包实测验证：211 文件 176MB → 7 文件 2.4MB）。
- `build.files` 每条排除同时写 `!node_modules/<path>` 与依赖相对路径两种形式（v24 node_modules 拷贝匹配基准双口径并存，任一命中即生效；实测见 §6）。
- 覆盖率口径说明：`vitest.config.ts` coverage.include 固定为编辑器内核 5 文件，`scripts/*.mjs` 不在该口径内；门禁脚本以上表 18 条用例断言为准（未跑 v8 覆盖率数字）。

## 5. 质量门禁（全部实测，2026-09-27）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc --noEmit` | **0 error**（exit 0；`sizeGate.d.mts` 声明供 TS strict 导入） |
| 单元测试 | `npx vitest run` | **161 文件 3730 passed 0 failed**（B9 基线 3708 + 22） |
| Lint | `npm run lint` | **0 error**（106 warning，与基线持平） |
| 构建 | `npx vite build` / `npm run build` 内 | **exit 0**（三段：main+preload+renderer） |
| E2E | `npx playwright test`（7.2 分钟） | **31 failed · 1 skipped · 101 passed**——failed 按 spec 构成与基线**逐项一致**（table 7 / feedback 5 / drag-markers 5 / ai-agent-panel 4 / thematic 2 / float-toolbar 2 / exit 2 / editor 1 / image-resize 1 / recent-history 1 / welcome 1），**零新增失败** |
| 打包 + 体积门禁 | `npm run build`（prebuild clean → vite → electron-builder → postbuild sizeGate） | **BUILD_EXIT=0；size gate PASSED**（双口径 + asar 内容断言全过） |
| 打包实测可启动 | `release/win-unpacked/WeaveMD.exe --remote-debugging-port=9334` + Playwright CDP | **见 §7 实测记录**：启动 → 欢迎文档渲染 → Ctrl+` 源代码模式 Monaco 正常 → 图标 31 个 svg → 0 pageerror / 0 console error |

## 6. 七-1/七-3 体积实测（打包前后对比）

| 指标 | B10 前 | B10 后 | 变化 |
|---|---|---|---|
| `WeaveMD-Setup-*.exe` | 147.68MB（154,854,703B） | **99.16MB**（103,981,692B） | **−48.52MB（−32.9%）** |
| `WeaveMD-*.msi` | 154.68MB（162,189,312B） | **109.93MB**（115,273,728B） | **−44.75MB（−28.9%）** |
| `win-unpacked/` | 602.15MB | **368.96MB** | **−233.19MB（−38.7%）** |
| `app.asar` | 288MB（2026-09-27 实测 du；源文档基线 287.09MB） | **85.93MB**（90,099,907B） | **−202MB（−70%）** |
| asar 条目总数 | 11,313 | **9,228** | −2,085 |
| `react-icons`（asar） | 138 文件 / 基线 81.9MB | **0**（排除生效） | 全额剔除 |
| `monaco-editor`（asar） | 2,099 文件 / 基线 68.5MB | **0**（排除生效） | 全额剔除 |
| liteparse Linux 件 | `.node` 24.83MB + `libpdfium.so` 7.09MB | **0**（asar 与 unpacked 均无） | −31.92MB |
| `jieba-wasm` 冗余平台件 | `pkg/{web,deno,bundler}` ~11.7MB | **0**（保留 `pkg/nodejs` 3 文件） | −11.7MB |
| `better-sqlite3/deps` | 12 文件 ~9.6MB（含 sqlite3.c 8.81MB） | **0**；`build/Release/better_sqlite3.node` **仍在（1 处）** | −9.6MB，零误伤 |
| `dist-main` 历史分片 | 211 文件 176MB（`index-*.js` 分片 204 份；B10 时点实测，计划记录约 44~50MB 为早期时点） | **7 文件 2.4MB**（clean 后单次构建） | −173.6MB（不入包） |

> 全部测量为 2026-09-27 本机实测（stat / asar list / du）；基线数字同步写入 `scripts/sizeGate.mjs` 注释与 `docs/guide/packaging.md`。
> 门禁断言值：exe 99.16MB ≤ 500MB ✓、msi 109.93MB ≤ 500MB ✓、win-unpacked 368.96MB ≤ 1GB ✓（余量充足，Docling PoC 转正也压不破——七-3②）。

## 7. §4.2-B10 验收点逐条对照

### 七-1② 四项瘦身

| 验收点 | 结果 |
|---|---|
| 图标清单全表 + 视觉回归断言**先于**替换，无图标消失/变样 | ✅ `ICON_INVENTORY` 132 项全表 + 4 断言（键对账/组件身份/逐项 svg 非空/降级）先落 RED→GREEN，后改打包配置；打包后 CDP 实测 svgCount=31 与剔除前一致（前后截图比对 `shot-before2-*` / `shot-after-*`） |
| `clean` 脚本清历史分片 | ✅ `scripts/clean.mjs` 挂 `prebuild`；实测 211 文件 176MB → 0 → 重建 7 文件 2.4MB；asar 内 `dist-main/index-*.js` 由 70 份（旧包）→ 3 份（单次构建合法产物） |
| 不误伤 `better-sqlite3/build/Release/*.node` | ✅ 排除仅 `better-sqlite3/deps/**`；`ASAR_REQUIRED` 断言每次打包强制校验（后打包与 `npm run size` exit 0，asar 内 `better_sqlite3.node` 命中 1 处）；**打包后应用实测启动且建库/迁移正常**（欢迎文档加载 = SQLite 全链路） |
| files 排除语法 v24 实测生效 | ✅ electron-builder 24.13.3：`DEBUG=electron-builder` + `builder-debug.yml`（`nodeModuleFilePatterns` 含全部 `!` 条目）+ asar list 前后对比三方验证；关键项 0 命中 |
| 打包后实测可启动 + 全量测试通过 | ✅ 见 §5 最后两行 |

### 七-2② monaco 运行时验证（Q5 唯一判定出口）

**结论：验证通过 → 剔除执行**（非作废）。证据链（判定全部来自运行时，静态分析仅作旁证）：

1. **剔除前运行时加载追踪**（旧包，2026-09-27 03:00-03:03，`report-before2.json`）：
   - 方法：`WeaveMD.exe --remote-debugging-port` + Playwright `connectOverCDP`；`page.on('request')` + CDP `Network.enable` 双通道采集；**先 `page.reload()` 覆盖完整启动**，再派发 `Ctrl+\`` 进入源代码模式（Monaco 实际加载渲染，截图 `shot-before2-after-ctrl-backtick.png` 确认行号/高亮/minimap 正常）。
   - 结果：**22 个请求全部命中 `app.asar/dist-render/assets/*`（正对照成立：katex/prismjs/`typescript-*` 等懒加载 chunk 全被捕获）；`node_modules/monaco-editor` 与 `node_modules/react-icons` 请求 = 0；jsdelivr/unpkg CDN monaco 请求 = 0；pageerror 0 / console error 0**。
   - 主进程侧：`NODE_OPTIONS=--require` 钩子对**打包应用不生效**（Electron 日志 `Most NODE_OPTIONs are not supported in packaged apps`）→ 主进程 fs/Module 动态追踪不可用；改以「主进程/静态零引用（`dist-main/index.js`、`preload.js`、主 chunk grep `monaco|react-icons` 均 0 命中）+ 渲染层 `nodeIntegration:false / contextIsolation:true`（renderer 不可能解析 node_modules）」组合证据，**加载日志口径以渲染层 CDP 全会话追踪为准**。
2. **剔除后功能实测**（新包，`report-after.json` + `shot-after-*.png`）：asar 内 `/node_modules/monaco-editor/` 条目 = **0**（副本物理不存在）→ 启动 + `Ctrl+\`` → **`.monaco-editor` 正常挂载渲染**、svgCount 31、0 错误。

即：副本存在时零加载（剔除前）+ 副本不存在时功能完好（剔除后）双向闭环，符合 Q5「运行时验证通过才能剔除」。

### 七-3② 体积门禁

| 验收点 | 结果 |
|---|---|
| 双口径都卡：exe≤500MB、win-unpacked≤1GB，超限 fail build | ✅ `evaluateGates` 单测含超限→`ok:false` 精确命中用例；`postbuild` 挂 `npm run size`，exit 1 即 fail build |
| 基线写注释 | ✅ `scripts/sizeGate.mjs` 头注释 + 运行输出 `baseline 2026-09-25: Setup 147.68MB / win-unpacked 602.1MB / app.asar 287.09MB` |
| 无网络依赖 | ✅ 仅 `fs.stat`/readdir + asar 头 JSON 解析，零网络调用 |
| 输出 top-N 清单 | ✅ asar top 文件 / asar top 包分组 / win-unpacked top 文件三段各 10 条（§6 首轮排序与双前缀缺陷已按 RED→GREEN 修复） |
| Docling 转正须先过门禁 | ✅ 已写入 `docs/guide/packaging.md` 提示行 |

## 8. 偏离与决策记录

1. **react-icons「改按需导入」实为已就绪**：全仓 5 处引用均为具名导入（`Icon.tsx:140` 起 130 个具名 import），Vite/Rollup 按 `sideEffects:false` 已把使用到的图标内联进 bundle——与调研结论一致（`docs/research/doc-pipeline-packaging.md` §3：换包收益有限）。**治理重心落在打包剔除**（`!node_modules/react-icons/**`）+ 全表回归断言，代码 import 形态零改动（红线"任何图标不得消失或变样"由清单测试 + 前后运行实测双保险）。
2. **jieba 路径实测**：`node -e "require.resolve('jieba-wasm')" → pkg/nodejs/jieba_rs_wasm.js`（package.json `exports` 的 `require`/`node` 条件）；`tokenizer.ts:35` 动态 `require` 只走此一条 → 保留 `pkg/nodejs`、排除 `pkg/{web,deno,bundler}`。另：当前生产 bundle 中 `initJiebaAsync` 无调用方已被 tree-shake（`cut_for_search` 字面量在 dist-main 零命中），仍保留 nodejs 一份以免未来接回时缺件。
3. **`files` 排除采用双口径写法**：v24 `computeNodeModuleFileSets` 对每个依赖以 `path.dirname(depDir)` 为匹配基准，而 `!node_modules/...` 文档口径以项目根为基准——两种基准的 pattern 并存（如 `!node_modules/react-icons/**` + `!react-icons/**`），任一口径命中即生效，避免依赖安装形态（hoist/nested）差异导致静默失效。
4. **liteparse Linux 件排除的平台边界**：项目真实分发目标为 Windows；Linux AppImage target 若启用，**必须先移除** `liteparse.linux-x64-gnu.node`/`libpdfium.so` 两条排除（已写入 packaging.md 警示）——否则 linux 目标缺原生件。此为记录在案的显式取舍，非静默风险。
5. **`vite.config.ts` external 清单零改动**：本次未增删 external（jieba-wasm 本就不在 external，靠 node_modules 保留 + 运行时 require；其余 5 个 external 依赖照旧打包）。计划项"按需同步"→ 无需要同步项。
6. **`@monaco-editor/react`/`@monaco-editor/loader` 的 node_modules 副本保留**（asar 内 64 条、约 1-2MB）：计划红线只针对 `monaco-editor` 68.5MB 主副本；这两个小包为生产依赖、体积可忽略，不做范围外扩。
7. **门禁首轮输出缺陷（自查发现并修复）**：top asar files 排序字段错位 + 包分组双前缀——属展示层缺陷，不影响断言判定；按 strict 补 RED→GREEN 后输出正确（§3 轮2）。
8. **`NODE_OPTIONS` 主进程钩子不可用**（见 §7 七-2）：属 Electron 打包应用的既定行为，非本批次可改；已用等效组合证据替代并如实记录，未凭静态分析下结论。

## 9. 遗留（移交后续批次 / 非本批次引入）

- **打包应用 `sqlite-vec` 加载失败降级 FTS5-only**（新旧两次实测 stdout 均有 `[db] sqlite-vec load failed`）：为 B10 前旧包即存在的现象（非本次排除引入——`sqlite-vec-windows-x64/vec0.dll` 在 asar.unpacked 中，扩展加载路径疑似未映射 `.unpacked`），向量检索在打包形态不可用、FTS5 兜底正常。**不属 B10 范围**，建议 B11 或独立批次核查（`db/index.ts:29-37` 降级链本身按设计工作）。
- E2E 存量 31 failed 不属本批次（构成与基线逐项一致）。
- Linux AppImage 目标的 liteparse 排除警示（§8.4）；`@monaco-editor/*` 小副本死重（~1-2MB，范围外）。
- `scripts/*.mjs` 不在 `npm run lint`（仅 `src/`）与 coverage include 口径内——如需收紧可后续扩 lint 范围。
