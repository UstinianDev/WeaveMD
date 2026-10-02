# doc-pipeline — Docling PoC 报告（B12 / 二-5）

> 日期：2026-09-27 ｜ 分支：`feat/doc-pipeline` ｜ 风险级：L2（仅验证、随时可停）
> 权威依据：`优化方向.md` §二-5②（量化判定四项 + 红线）＋ `docs/plan/doc-pipeline.plan.md`（已随计划退役，见 git 历史）§2-B12 / §4.2-B12
> 结论先行：**不达标 → 按 Q6 关闭本任务**，`parseDocument` 主链路与打包配置零改动，主线不受影响。

---

## 1. 范围与红线自查

| 项 | 状态 | 说明 |
|---|---|---|
| 仅 PoC、不硬替换 `parseDocument` | ✅ | `src/main/ai/files/documentParser.ts` 零改动；可插拔后端接口落在 PoC runner 内部（`BACKENDS` 注册表，`--backend=aRoute|docling|all`） |
| 不动打包配置 | ✅ | `package.json` build 字段、`scripts/sizeGate.mjs` 零改动 |
| 模型与 pdfium 零进包 | ✅ | 依赖隔离在 `scripts/docling-poc/package.json`（独立 node_modules）；`docling.rs` 不在根 dependencies；`scripts/**` 不在 `build.files` glob（仅 `dist-render/dist-main/public` 三条正向）；模型/pdfium 落 PoC 目录下 `.models/` `.pdfium/`（cwd 相对，gitignore，不属任何打包对象） |
| 转正必须先重跑七-3 体积门禁 | ⚠️ **红线** | 见 §5：任何"用它替换 A 路线"的决策，必须先 `npm run build` + `npm run size` 实测通过 500MB/1GB，**未过不得替换** |
| Windows 原生件 `asarUnpack`/签名评估 | ✅ | 见 §4（基于本仓 electron-builder 24.13.3 本地源码 + release 实物核验） |
| PoC 停机原则 | ✅ 已走通 | 全程跑通；网络受阻段（GitHub 直连）已用等价官方通道绕过，见 §7 |

**与计划的偏离（如实记录）**：计划 §2-B12 写"以可插拔后端接口接入 `documentParser.ts` 试验分支验证"；按执行注意"不改 `parseDocument` 主链路"，可插拔接口改在 `scripts/docling-poc/runPoc.mjs` 内实现（同一 A 路线实现直接 bundle `pdfLayout.ts`，等价验证），未触碰主链路。

## 2. 包名与安装方式核实（执行前调研）

- 需求文档写的 `docling-node` **在 npm 不存在**（`npm view docling-node` → 404）。
- 实际包名为 **`docling.rs`**（docling-rs 的 napi-rs Node/Bun 绑定，docling-project 官方发布，v1.69.2）：
  - 平台二进制走 `optionalDependencies`：`docling.rs-win32-x64-msvc`（本机实测 unpacked **53.27MB**）自动拉取；
  - `npm install docling.rs` 即装即用，无需 Rust 工具链；
  - **PDF 管线另需按需下载**：`scripts/install/download_dependencies.sh` 把 pdfium + ONNX 模型（layout/OCR/TableFormer）拉到 **cwd 相对** 的 `./models` 与 `./.pdfium`，缺文件时 PDF 转换直接抛错（`checkDependencies()` 可查 `ready/missing`）——这正是"模型零进包、按需落开发机"红线的天然形态。
- 本机安装：`scripts/docling-poc/` 独立 `package.json`（`docling.rs` + `pdf-lib` 样例生成），主仓库 `package.json` **零改动**。

## 3. PoC 方法与量化四项

### 3.1 样例与真值

`scripts/docling-poc/genSample.mjs` 生成 `sample.pdf`（4 页，pdf-lib 定坐标绘制）+ `sample-truth.json` 真值：

- **P1**：全宽标题 + 双栏散文各 20 行（标记 `L01..L20` / `R01..R20`，阅读顺序真值 = 先左栏后右栏 40 个标记全序）；
- **P2**：标题 + 无框线表格 4×3（`Item/Q3/Q4`）+ 单栏散文；
- **P3/P4**：跨页无框线表格 9×5（表头+8 数据行，P4 续行锚点对齐、无重复表头）+ 收尾散文。

### 3.2 后端（可插拔）

| 后端 | 实现 |
|---|---|
| `aRoute`（对照，A 路线现状） | `@llamaindex/liteparse` textItems → esbuild 现场 bundle `src/main/ai/files/pdfLayout.ts` → `analyzePdfLayout`（与 `parsePdf` 生产路径同一实现） |
| `docling`（候选） | `docling.rs` 完整标准管线（layout_heron + TableFormer accurate + OCR en，热 `Pipeline` 复用） |

评估（`runPoc.mjs` 内统一函数）：双栏正确率 = 期望相邻标记对保持相对顺序的比例；表格准确率 = 按表头定位真值表后的**单元格级**命中率（跨页表允许吸收后续续表，docling 不合并则不补）。

### 3.3 判定标准（转正可行性口径）

1. **质量双项（决定性）**：双栏阅读顺序正确率、表格行列还原准确率均 **≥95% 且不低于 A 路线**——不优于对照即无转正价值；
2. 耗时：记录 warm 单页耗时（参照：附件解析应不显著劣于现有链路）；
3. 体积：进包增量投影 **双门禁（Setup≤500MB、win-unpacked≤1GB）通过**；
4. 工程：asarUnpack/签名/模型分发有可执行结论（§4）。

### 3.4 量化结果（`poc-result.json`，2026-09-27 实测）

| 指标 | A 路线（liteparse+pdfLayout） | docling.rs 1.69.2 | 判定 |
|---|---|---|---|
| 双栏阅读顺序正确率 | **100%**（39/39 相邻对） | **100%**（39/39） | 平手，docling 无增益 |
| 表格行列还原准确率 | **100%**（57/57 单元格；含跨页表 9 行合并+去重表头） | **64.9%**（37/57；单页表 12/12 满分，**跨页表仅 25/45**） | **docling 劣于对照 → 不达标** |
| 单页解析耗时（warm） | **12.5ms/页**（多轮 9.4~16.8ms；liteparse 36ms + layout 14ms / 4 页） | **5000ms/页**（多轮 5000~5308ms / 4 页热管线；one-shot 冷调用 10.2~22.0s，管线模型加载 33~46s） | docling 慢约 **400×** |
| 装机体积增量 | 0（现状） | **进包 53.36MB unpacked**（JS 壳 0.09 + win32 原生件 53.27）；原生件 gzip-9 18.89MB → **安装包增量估算 +18.98MB**；开发机另需模型 407.82MB + pdfium 14.08MB（**零进包**） | 投影双门禁通过（Setup 99.16→118.14/500MB ✓，unpacked 368.96→422.32/1GB ✓） |

### 3.5 docling 失败模式观察（样例产物 `out-docling.md` vs `out-aRoute.md`）

1. **跨页表格断裂（主失分项）**：P3 表格正常还原 5 行，**P4 续行整段退化为散文**（`East Widget 142 150 +8 ...`），不识别为表格 → 无法合并回 9 行真值表；A 路线跨页链式合并 45/45。docling 按页独立处理、无跨页续表合并。
2. **左栏伪表格（新增噪声）**：P1 左栏 20 行散文被判成 **1 列 20 行的伪表格**（TableFormer 每行一格）；右栏正常成段。不污染本次两项指标（标记顺序仍正确），但产物多出伪表格。
3. 双栏阅读顺序本身：docling 与 A 路线均全对（先左后右）。
4. 单页表（P2 4×3）两边都满分——docling 的 TableFormer 对单页有框线/无框线表可靠，**短板在跨页**。

**中间态记录**：模型不全时（无 TableFormer，docling 自动降级几何重建）表格准确率同为 64.9%、且伪表格形态不同——最终数据取完整标准管线（layout+TableFormer+OCR en 齐备，`checkDependencies().ready=true, missing=[]`）。

## 4. 工程评估（二-5② 全项）

### 4.1 `asarUnpack`（Windows 原生件）

以本仓 **electron-builder 24.13.3** 本地源码 + `release/win-unpacked` 实物核验：

- `unpackDetector.isLibOrExe` 只认 `.dll/.exe/.dylib/.so`；node_modules 包内含这些文件 → **整包 auto-unpack**（现状：`@llamaindex/liteparse-win32-x64-msvc`（含 `pdfium.dll`）实测在 `app.asar.unpacked`，而 `package.json` **并无任何 `asarUnpack` 配置**）；
- 纯 `.node` 会被打进 asar 且**可正常加载**（现状：`better_sqlite3.node` 实测 `[in-asar]`，应用正常运行——Electron 对 asar 内 `process.dlopen` 有提取回退）；
- `docling.rs-win32-x64-msvc` 包内只有 `.node`+README → 按现状会被打进 asar，走与 better-sqlite3 相同的已验证路径。
- **转正建议（必做验证项，本期不改）**：显式 `asarUnpack: ["**/node_modules/docling.rs*/**"]` 让形态与 liteparse 一致，并在 `sizeGate` 补一条 unpacked 目录存在断言；转正批次打包后实测启动 + `npm run size`。

### 4.2 签名

- **现状**：`package.json` `build.win` 无任何证书配置 → 本项目 Windows 包**整体未签名**，`.node` 签名问题当前不存在；
- **若将来启用签名**：`winPackager.shouldSignFile`（本地源码 :300-305）= `.exe` 默认签、`.dll` 需 `signDlls: true`、**`.node` 仅当 `win.signExts` 显式列出才签** → 届时须加 `signExts: ['.node']`；
- 用户态未签名 DLL 在 Windows 可正常加载（无驱动签名强制），风险仅为 SmartScreen 声誉，不影响功能。

### 4.3 体积门禁影响（数字明确）

- 进包增量（unpacked）**53.36MB**；安装包增量估算 **+18.98MB**（gzip-9 口径，NSIS LZMA 同量级，作下限估算）；
- 投影：Setup 99.16 → **118.14MB**（门禁 500MB，余量 381.86MB）；win-unpacked 368.96 → **422.32MB**（门禁 1GB，余量 601.68MB）——**增量本身不击穿门禁**；
- **红线不变**：投影 ≠ 实测。转正决策必须先重跑 B10 的七-3（`npm run build` → `postbuild` 自动 sizeGate / `npm run size`），未过不得替换。

### 4.4 模型分发与运行时路径（转正才需要，本期仅记录）

- 模型共 **407.82MB**（layout 165MB、TableFormer encoder/decoder/bbox ≈216MB、OCR 三件 ≈30MB、词典若干）+ pdfium **14.08MB**——按红线**全部零进包**；
- docling.rs 以 **process cwd 相对路径**找 `./models`/`./.pdfium`（`checkDependencies().home` 实测 = 脚本工作目录）——打包后 cwd 不可控（快捷方式/文件关联启动），**转正必须改走环境变量**（`DOCLING_LAYOUT_ONNX`、`DOCLING_TABLEFORMER_*`、`PDFIUM_DYNAMIC_LIB_PATH` 等）指向 `userData`，配合首启下载或安装期下发（产品决策项）；
- Windows pdfium：上游脚本在 Git-Bash 下 `uname -s` 返回 `MINGW64_NT-*` 被误判进 Linux 分支（拉成 `libpdfium.so`），**上游脚本不认 Windows**；本 PoC 复用根项目已有 `@llamaindex/liteparse-win32-x64-msvc/pdfium.dll`（pdfium C ABI 稳定，pdfium-render 动态加载）实测可用。

## 5. 红线核对（逐条）

1. **模型与 pdfium 一个字节不进安装包** —— ✅ 结构性成立（§1 表）：依赖隔离 + 不在根 dependencies + `scripts/**` 不在 `build.files`；`.models/`/`.pdfium/` 在 PoC 目录且 gitignore。
2. **替换 A 路线前必须先重跑七-3 体积门禁（500MB/1GB），未过不得替换** —— ⚠️ 已写死于本报告 §4.3 与 §6；本 PoC **不触发**替换，因此本期未重跑门禁（打包配置零改动，门禁语义无变化）。
3. **不改 `parseDocument`、不动打包配置** —— ✅ 零改动（git status 可验）。
4. **不达标即关闭本任务、主线不受影响** —— ✅ 结论见 §6。

## 6. 结论：**不达标（关闭本任务）**

- **决定性理由**：表格行列还原 **64.9% < 95% 阈值、且 64.9% < A 路线 100%**（跨页表断裂是硬伤，恰好是 A 路线已解决的场景）；
- **佐证**：warm 单页 5.0~5.3s，约为 A 路线（12.5ms）的 **400 倍**；另引入 407.82MB 运行时模型分发、cwd→env var 改造、asarUnpack/签名后续项——工程成本显著；
- 双栏阅读顺序与体积门禁两项通过，但不足以支撑转正（质量无增益 + 成本高）；
- **动作**：按 Q6 关闭本任务；`parseDocument` A 路线（liteparse + `pdfLayout.ts`）维持现状；Docling 转正列入范围外清单（`plan.md` §5 已有该行），重启条件 = 需要真实复杂版面增益时另立任务并**先重跑七-3**。

## 7. 过程记录（网络与环境坑，供复现）

- **GitHub 直连间歇封锁**（`github.com` 443 超时，`raw.githubusercontent.com` 与 `api.github.com` 可用）：`download_dependencies.sh` 拉到 layout/OCR 后在 `ocr_rec_en` fatal 退出（脚本顺序卡住后续 tableformer）——改用 **GitHub API asset 通道**（`api.github.com/.../releases/assets/{id}` + `Accept: application/octet-stream`，直跳 `objects.githubusercontent.com`，按 rel.json 字节数校验）补齐 tableformer/OCR en/ocr_det 全部模型，零校验失败。
- `docling.rs` 一次转换输出的告警即缺口清单（缺 TableFormer → "geometric reconstruction"；缺 OCR en → 回退多语言 ch 模型），PoC 以 `checkDependencies().ready=true, missing=[]` 为完整管线判据。
- 评分器自纠：markdown 表格分隔行初版被计入数据行，两后端同被低估——`parseMdTables` 跳过分隔行后重跑，A 路线恢复 57/57。

## 8. 复现步骤

```bash
# 1) 隔离安装（主仓库 package.json 不动）
cd scripts/docling-poc && npm install

# 2) 模型/pdfium 落开发机（零进包；GitHub 直连不畅时用 §7 的 API asset 通道）
curl -fsSL https://raw.githubusercontent.com/docling-project/docling.rs/master/scripts/install/download_dependencies.sh | sh -s -- --no-asr --no-chunk
# Windows pdfium：cp ../../node_modules/@llamaindex/liteparse-win32-x64-msvc/pdfium.dll .pdfium/lib/

# 3) 生成样例 + 双后端对比
node genSample.mjs
node runPoc.mjs                  # 或 --backend=aRoute / --backend=docling

# 4) 产物
#    poc-result.json  量化四项原始数据
#    out-aRoute.md / out-docling.md  两后端完整产物对照
```

## 9. 产物清单

- `scripts/docling-poc/package.json` + `package-lock.json` — 隔离依赖（`docling.rs`、`pdf-lib`）
- `scripts/docling-poc/genSample.mjs` — 样例与真值生成
- `scripts/docling-poc/runPoc.mjs` — 可插拔后端 runner + 量化四项评估
- `scripts/docling-poc/sample.pdf` / `sample-truth.json` — 样例与真值
- `scripts/docling-poc/poc-result.json` / `out-aRoute.md` / `out-docling.md` — 实测数据与产物对照
- `scripts/docling-poc/.gitignore` — `node_modules/`、`.models/`、`.pdfium/` 不入库
