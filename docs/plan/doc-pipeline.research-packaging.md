# Electron 安装包体积治理 — 外部调研笔记

> doc-pipeline 任务外部调研（只读）。检索工具：`@arabold/docs-mcp-server`（本地索引）+ 官方文档抓取 + Stack Exchange API。
> `crw search` 不可用（本地后端需 Docker，环境未安装；Cloud 无 API key），网络搜索类查询改用官方文档与 Stack Overflow API 兜底，中文社区文章**未检索到**。
> 索引状态：`electron-builder` 本次新建索引（2026-09-25，308 页，completed）；此前已有 `electron`、`electron-updater`、`better-sqlite3`、`liteparse`。
> 版本差异注意：官方站点当前文档为 v26/v27 语义，本项目 `package.json` 使用 `electron-builder ^24.13.0`，条目已在下方标注是否需在 v24 实测确认。

## 0. 现状基线（本机 release/ 实测，2026-09-25）

| 指标 | 实测值 |
| --- | --- |
| `release/win-unpacked/resources/app.asar` | 288 MB |
| `app.asar.unpacked` | 58 MB（@llamaindex 57M + sqlite-vec-windows-x64 0.3M） |
| `WeaveMD-Setup-2.0.8.exe` / `.msi` | 148 MB / 155 MB |
| asar 内条目总数 | 11313，其中 `node_modules/*` 11073（占 97.8%） |

asar 内主要死重（磁盘体积 ≈ 打包体积，均已被 Vite 打进 bundle 或属跨平台冗余）：

- `dist-main/` 陈旧构建：70 份 `index-*.js`（各约 800 KB，合计约 50 MB），只有入口 `dist-main/index.js` 引用的那份是活的 —— 根因是 `vite-plugin-electron` 不清空 `outDir`，而 `files` 配了 `dist-main/**/*`。
- `node_modules/react-icons` 约 85 MB（143 个文件，每个图标集一个巨型 `index.mjs`），渲染层已用具名导入 + Vite 打包，包内副本纯死重。
- `node_modules/monaco-editor` 约 73 MB（2100 个文件）：`src/render/utils/monacoSetup.ts` 已 `loader.config({ monaco })` 本地打包，dist-render 自带 worker chunk，包内副本死重。
- `@llamaindex/liteparse` 包内自带 `liteparse.linux-x64-gnu.node`(25 MB) + `libpdfium.so`(7.1 MB)，打进 **Windows** 包约 32 MB 纯死重；同包的 `liteparse-win32-x64-msvc`（.node 19 MB + pdfium.dll 6.7 MB）是活的。
- 其余被 Vite 打进 bundle 但仍在包内的生产依赖：`@tiptap/*`(7.8M)、`katex`(4.6M)、`prismjs`(3.5M)、`cheerio`(3.4M)、`lodash`(3.1M)、`underscore`、`xmlbuilder2` 等。
- 主进程 `vite.config.ts` 明确 external 的 5 个依赖必须保留在 node_modules：`better-sqlite3`、`bcryptjs`、`html-to-docx`、`nodemailer`、`electron-updater`。

## 1. files 排除语法与注意事项

官方文档（https://www.electron.build/file-patterns 与 /contents，本次抓取）要点：

- glob 以**应用目录**为基准；`!` 前缀表示排除；支持 `* ? [...] !(a|b) ?(a|b) +(a|b) *(a|b) @(a,b) **` 等 minimatch 扩展。
- 多模式按序匹配：后写的包含模式可以重新纳入先前被排除的文件（`["**/*", "!foo/*.js", "foo/bar.js"]`）。
- **关键行为一**：只要 `files` 里存在一个非 `!` 的包含模式，自动前置的默认 `**/*` 就**不会**添加 —— 项目当前 `files: ["dist-render/**/*","dist-main/**/*","public/**/*"]` 因此是"只打包这三个目录 + 强制项"，改写时若想要全量必须显式写 `**/*`。
- **关键行为二（需实测）**：文档称 `package.json` 与 `node_modules/**/*`（生产依赖）"无论 pattern 如何都始终包含"；但同一文档的示例又演示 `!node_modules/**/*.md` 排除包内文件。整包排除（如 `!node_modules/react-icons/**`）在 v24 是否生效，建议 `DEBUG=electron-builder electron-builder --dir` 看 "excluding" 日志实测，未实测前不得断言。
- 排除目录要写成 `!dir${/*}`（宏写法）或 `!dir/**`：只写 `!dir/**/*` 会留下空目录。
- 默认排除（`.obj/.o/.a/.d.ts`、lockfile、`.git/.idea/.github` 等）始终生效；v27 起 `disableDefaultIgnoredFiles` 已移除，想放行需用**具体**包含模式（宽泛的 `**/*` 不能覆盖默认排除）。
- 文件宏：`${os}`（按**目标**平台 mac/linux/win）、`${arch}`（ia32/x64）、`${platform}`（按 **Node 构建机** process.platform）。做"按目标平台排除"要用 `${os}`，用 `${platform}` 在交叉构建时会取错值（v24 是否支持这些宏需确认）。
- 按平台排除依赖的**包级**方案：v27 起构建时对生产依赖做 `cpu`/`os` 过滤（包级 optionalDependencies，如 `@llamaindex/liteparse-win32-x64-msvc` 这类会自动按目标平台取舍）；**包内**自带的跨平台二进制（liteparse 主包里的 linux `.node/.so`）不受此机制保护，只能靠 `files` 反向 glob 或 `ignoredProductionDependencies`。
- v27 提供 `ignoredProductionDependencies`（官方明示可用于"bundler 已内联的依赖，如 react"）与 `allowMissingDependencies`；v24 未检索到同名配置项，需按 `files` 排除路线处理。
- `extraResources`：`from` 相对**项目目录**（`files` 相对应用目录），`to` 默认落在 resources 目录（asar 之外），运行时用 `process.resourcesPath` 访问 —— 适合"从 asar 挪出去但仍需文件形态存在"的大文件。
- 排查工具：`DEBUG=electron-builder`（看收集/排除日志）、`npx asar list <app.asar>`（列包内容）、7-Zip + Asar7z 插件（图形化查看）。

## 2. asarUnpack 与 better-sqlite3 共存的误伤风险

- `asar` 默认 `true`（v27 迁移后改为 `asar.unpack` 等新键）；`asar.smartUnpack` 默认 `true`，会自动检测 `.node`/可执行文件并解包到 `app.asar.unpacked/`，正常情况无需手工配 `asarUnpack`（官方 troubleshooting：开发正常、打包崩溃 → 加 `asarUnpack: ["node_modules/better-sqlite3/**"]`）。
- 实测本项目：`app.asar.unpacked` 只有 `@llamaindex`（57M）与 `sqlite-vec-windows-x64`（0.3M），**`better_sqlite3.node` 仍留在 asar 内**（`/node_modules/better-sqlite3/build/Release/better_sqlite3.node`，1.7 MB）。若某台机器运行时报 "did not self-register"/dlopen 失败，第一处置就是显式 `asarUnpack` better-sqlite3 全目录（含 `build/Release`）。
- 误伤风险（glob 写宽的后果）：
  - `asarUnpack: ["**/*.node"]` 或 `["**/*.dll"]` 会把**所有**平台的 `.node/.dll` 解包 —— 在 win 包里把 `liteparse.linux-x64-gnu.node` 也解包出来（实测 @llamaindex 已整体在 unpacked，linux 二进制随之变成裸文件），既膨胀又留死重；解包文件**不进 NSIS LZMA 压缩**，单位体积代价高于 asar 内文件。
  - 解包后路径读取语义变化：asar 内文件必须走 `app.getAppPath()`，`__dirname` 相对路径在 unpacked 场景是另一套真实路径（官方 troubleshooting 明示 ENOENT 来源之一即此），better-sqlite3 与其 `bindings` 路径解析对目录结构敏感，`asarUnpack` 范围要**整包**（`node_modules/better-sqlite3/**`）而不是只圈 `.node` 文件，否则 `bindings` 找不到 `build/Release` 下的依赖文件。
  - 反向风险：`files` 里若把 `node_modules/better-sqlite3/**` 排除掉，asarUnpack 再宽也无文件可解 —— external 的 5 个依赖必须同时通过 `files` 与 `asarUnpack` 两道检查。
- `sqlite-vec` 走 `vec0.dll`（smartUnpack 已自动解包 `sqlite-vec-windows-x64`），可作为"自动解包正常工作"的参照样本。

## 3. react-icons 按需导入方案要点

- 现状：全仓库 5 个文件引用 `react-icons/md`，且都是**具名导入**（`MdClose` 等），`src/render/components/Common/Icon.tsx` 用 `ICON_MAP` 集中映射 —— 代码层面已经是按需形态。
- react-icons v5（`^5.7.0`）`package.json`：`main=lib/index.js`、`module=lib/index.mjs`、`sideEffects:false`；每个图标集目录一个巨型 `index.mjs`（`md` 4.5M、`gi` 14M、`pi` 12M…），磁盘合计 85 MB、全仓库仅 143 个文件。
- 因此治理重心不在"改 import 写法"，而在两点：
  1. **打包剔除**：Vite（rollup）对 `sideEffects:false` + 具名导入做 tree-shake，dist-render 只含实际用到的图标（产物里只有 `codicon-ngg6Pgfi.ttf` 等字体与 bundle）；所以 `node_modules/react-icons` 的 85 MB 副本可整体从安装包排除（方式见 §1，整包排除在 v24 需实测）。
  2. **换包收益有限**：换成 `@mdi/js`/单图标子路径导入（`react-icons/md/...` 子路径在 v5 不提供逐图标文件）对 dist-render 体积几乎无影响，除非同时把 node_modules 副本打进包；不建议为此改代码。
- 验证手段：对比改动前后 `dist-render/assets/index-*.js` 体积 + `npx asar list app.asar | grep react-icons` 计数归零。

## 4. 体积断言脚本写法建议

- 断言对象分四层，任一层回归都应在 CI 失败：
  1. **asar 内容黑名单**（最强信号，成本最低）：
     ```bash
     npx asar list release/win-unpacked/resources/app.asar | tr '\\' '/' > /tmp/asar.txt
     # 陈旧主进程构建：除入口引用的一份外不允许出现其它 index-*.js
     ! grep -E '^/dist-main/index-[A-Za-z0-9_-]+\.js$' /tmp/asar.txt
     # 打包机死重（Vite 已内联）
     ! grep -q '^/node_modules/react-icons' /tmp/asar.txt
     ! grep -q '^/node_modules/monaco-editor' /tmp/asar.txt
     # 跨平台原生件：win 包不得含 linux/darwin 二进制
     ! grep -E 'liteparse\.(linux|darwin)|libpdfium\.so' /tmp/asar.txt
     # 必需品存在性断言（防排过头）
     grep -q 'better-sqlite3/build/Release/better_sqlite3.node' /tmp/asar.txt
     grep -q '^/node_modules/electron-updater' /tmp/asar.txt
     ```
  2. **unpacked 断言**：`app.asar.unpacked` 内不得出现非当前目标平台的 `.node/.dll`；better-sqlite3 若声明了 `asarUnpack`，断言其目录存在。
  3. **产物体积阈值**：对 `release/*.exe`、`release/*.msi`、`app.asar` 取 `stat`/`wc -c` 字节数，与提交在仓库里的基线文件比较，超过设定涨幅（如 +5%）即失败；基线随有意变更显式更新（同"锁文件"思路）。
  4. **构建期日志**：`DEBUG=electron-builder electron-builder --dir` 后 grep `excluding`，确认目标排除模式确实命中（避免 glob 写错静默无效）。
- 反例提醒：只断言 `.exe` 总大小不可靠（NSIS LZMA 会掩盖结构回归，且 Electron 本体升级会正常抬高基线）；内容黑名单 + 体积阈值需并用。
- 断言脚本应挂在 `npm run build` 之后的独立 npm script，失败时打印命中的违规路径，便于定位。

## 5. 文章出处 URL

官方文档（本次索引/抓取，均为真实可访问）：

- file-patterns（glob 语法、`!` 排除、`${os}/${platform}` 宏）：https://www.electron.build/file-patterns
- contents（files 行为、默认排除、asar/asarUnpack、FileSet、compression）：https://www.electron.build/contents
- troubleshooting（native module 崩溃 → asarUnpack、asar list 排查、Node 模块缺失）：https://www.electron.build/v26/docs/troubleshooting
- compression / asar / asarUnpack 选项定义（`store|normal|maximum`，默认 normal；`maximum` 官方称体积收益不明显但更慢）：https://www.electron.build/v26/docs/win （`PlatformSpecificBuildOptions`）
- v26→v27 迁移（`ignoredProductionDependencies`、cpu/os 过滤、`disableDefaultIgnoredFiles` 移除）：https://www.electron.build/docs/migration/v26-to-v27
- NSIS / nsis-web（LZMA 压缩与多架构体积讨论）：https://www.electron.build/nsis

社区文章（经 Stack Exchange API 检索，真实存在）：

- electron-builder MSI installer asar file too large（最佳答案：先 bundle 再只打包产物目录 + `extraMetadata.main` + `asarUnpack` 原生模块；另一答案给出 asar 187M/安装器 87M 的量级与 `!src/**` 排除实践）：https://stackoverflow.com/questions/77598804/electron-builder-msi-installer-asar-file-too-large
- Does Production Electron need node_modules（被采纳答案：bundle 后通常无需把 node_modules 打进包，可移除后实测）：https://stackoverflow.com/questions/71315637/does-production-electron-need-node-modules
- Electron application is missing some files only when installing the .exe（files 排除与安装后缺文件的对照案例）：https://stackoverflow.com/questions/75299593/electron-application-is-missing-some-files-only-when-installing-the-exe-file

未检索到：

- 中文社区（掘金/博客园/CSDN/知乎）关于「Electron 安装包体积治理 asar 死重 跨平台原生件排除」的专题文章 —— `crw search` 后端不可用、WebSearch/WebFetch 在本环境无结果或被拦、DuckDuckGo/Google/Baidu/Mojeek 直连均不可达，故本轮**未检索到**合格中文出处。
- 「electron-builder exclude dependency platform native module」英文专题文章（同上原因，仅取得 Stack Overflow 问答级出处）。
