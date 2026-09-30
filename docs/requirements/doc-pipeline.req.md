# doc-pipeline — 需求文档（文档处理优化方向）

> 权威需求源：`C:\Users\lenovo\Desktop\优化方向\优化方向.md`（含 §0 决策基线与全部 29 任务的拷问细节）。
>
> ⚠️ **2026-10-01 核实：该桌面路径已于 2026-09-30 被《Agent Memory 优化方向》覆盖，原件内容全机 0 副本。** 后续以本仓库为准 —— 需求清单见本文 §1、14 条决策基线见 `docs/plan/doc-pipeline.status.md:31`、29 任务→12 批覆盖核对见 `docs/plan/doc-pipeline.plan.md:162`；仅「逐任务拷问细节」原文无副本（该批已于 2026-09-27 交付完成，见 status §阶段 8）。
> 本文档不复制源文档内容，只做结构化索引 + 执行级补充，二者冲突时以源文档为准。

## 1. 需求清单（8 模块 29 任务）

| 模块 | 任务 | 一句话目标 |
|---|---|---|
| 一 会话附件上传 | 1. 7 格式白名单 | `DIALOG_OPEN_FILE` 放开到 7 格式，composer 不再 `readFileSync`，内容交解析层 |
| | 2. 多选批量 | `multiSelections` + 保持选择顺序 + chips 折叠 + 解析限流 |
| | 3. 粘贴上传 | 修 `handlePaste` 图片/文件分支（照抄 ContentBlock 双兜底） |
| | 4. 持久化与渲染 | `attachments_json` 幂等迁移 + `parsed_attachments` 启用 + 气泡三态渲染，正文只留占位符 |
| 二 文档解析层 | 1. 统一解析入口 | `parseDocument` 返回结构化产物（标题/表格/页码/章节路径），`KB_PARSE_DOCUMENT` 接线 |
| | 2. xls/xlsx | SheetJS 多 sheet、合并单元格、公式取值 |
| | 3. PDF 版面还原 | 坐标分栏、无框线表格、跨页合并、页眉页脚、无文本层检测（本期无 OCR） |
| | 4. D 路线兜底 | 复杂版面/扫描件走远程多模态，vision 降级显式提示，token 成本覆盖 |
| | 5. Docling PoC | 仅验证、可插拔后端、量化判定、不阻塞主线 |
| | 6. 溯源 metadata | 页码/章节/表格序号 + `parseVersion`，`source_ref` 换真实页码 |
| 三 目录文件树 | 1. 超长 md 发送 | 不整篇内联，带文件名+路径+摘要；`FOLDER_READ` `.md` 过滤保持并注释 |
| | 2. 大表格 md | `splitNote` 表格边界识别、整表独立 chunk、`heading_path` 真实写入 |
| | 3. 相对路径图片 | 解析基准 md 所在目录、越界拦截、可被 Agent 识别；图片向量后续 |
| 四 知识库/RAG | 1. Embedding 接通 | `kbIndexOpts()` 返回真实配置、贯通 3 入口、历史回填限速、FTS5 降级 |
| | 2. heading_path | `splitNote` 携带标题路径写入，`aggregateAndExpand` 生效验证 |
| | 3. 批量导入通道 | `importDirAsKb` 扩 7 格式且先解析再入索引，失败 `status='error'` 可见 |
| | 4. 检索质量 | chunk 上下文前缀取舍、页码入 `source_ref`、HyDE 收益复核 |
| 五 多模态图片 | 1. content 数组 | `LlmMessage.content` 贯通全调用点，两套协议分流，压缩丢图显式设计 |
| | 2. 落盘与引用 | `userData/attachments/...` 相对路径、清理、svg/gif 处理 |
| | 3. 死代码接活 | `agentMedia`/`imageRecognition` 主进程接线 + 测试覆盖 + 缩略图 lightbox |
| 六 工具与引用 | 1. 文档工具集 | search/read_page/extract_table/analyze_chart 只读区 + concurrency 注册 + 陈旧工具名清理 |
| | 2. citation 回链 | 真实页码回链、附件引用跳转、refsJson 向后兼容 |
| | 3. 评测闭环 | 表格还原/页码溯源/检索命中/降级路径可自动化指标 + TDD 报告 |
| 七 打包体积 | 1. 四项瘦身 | files 反向排除 + clean 脚本 + react-icons 按需 + jieba/liteparse 平台件排除 |
| | 2. monaco 死重 | 运行时验证后再剔除，验证不过即作废 |
| | 3. 体积门禁 | 双口径断言脚本（500MB/1GB）超限 fail build |
| 八 写控制与外发 | 1. 外发同意闸 | B+C：`allowSend` 不放宽 + 上传勾选入 KB + 显式授权边界 |
| | 2. write_mode 核查 | 如实记录文档差异、附件写路径按 manual 确认语义、不补完整接线 |
| | 3. 死通道清理 | `agent:upload:*` 二选一 + 同步 IPC 文档、`parsed_attachments` DAO、陈旧工具名 |

## 2. 已对齐问题清单

- 源文档 §0「决策基线」14 条 + 每任务「拷问细节」= 预对齐完成，执行中不得推翻。
- 源文档 §附「执行纪律」5 条 = 执行级硬约束（含模块依赖顺序、质量门禁、每模块进度更新）。

### 执行级开放问题与处置（源文档留白处，本执行方案的决定）

| # | 问题 | 处置 | 依据 |
|---|---|---|---|
| Q1 | 八-1 两条路：入 KB 后按 `source=attachment` 过滤 vs 干脆不入 KB | **推荐「入 KB + 过滤」**：`allowSend=false` 时附件仍索引，`searchKB` 结果按外发闸过滤不返回——保住本地检索价值且不放宽 `allowSend`；实现时在计划中写明取舍 | 源文档 8-1 ②"两条路都要在任务里写清取舍" |
| Q2 | 八-1 勾选默认值 | 默认**勾选**「加入知识库」，存 `ai_config` 新字段（幂等补列） | 与"勾选=该文档显式授权"语义自洽 |
| Q3 | 二-1 `.doc` 降级 | D 路线多模态优先，不支持 vision 时提示"另存为 docx" | 源文档二-1②两选项中与 A+D 路线一致 |
| Q4 | 五-1 上下文压缩丢图 | **保留最近 N 张（建议 3），更早的图片降级为占位符并提示** | 源文档五-1②三选项中最不易破坏压缩链路 |
| Q5 | 七-2 monaco 验证结论 | 运行时验证不通过（确在加载）→ **任务作废、记录结论**，不动配置 | 源文档七-2②唯一判定出口 |
| Q6 | 二-5 Docling PoC | 放在主线（一~六）完成后执行；量化不达标即关任务 | 源文档"随时可做可停" |

## 3. 验收标准

- 29 任务按依赖顺序逐条实现，每条以其「拷问细节」为验收点。
- 全量质量门禁 5 项全绿（tsc + vitest + eslint 0 error + vite build + playwright）。
- 新增行为同步 TDD 报告到 `docs/testing/`，进度同步 `docs/plan/doc-pipeline.status.md`。
- 红线：体积 ≤1GB、瘦身不改功能、`allowSend` 不放宽、不删测试、不动已应用历史迁移。
