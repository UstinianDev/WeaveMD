# doc-pipeline 技术调研：存储 / 引用 / 向量回填

> 调研日期：2026-09-25。只读调研，未改业务代码。
> 索引状态：`npx @arabold/docs-mcp-server@latest list` 中无 `better-sqlite3`，已执行
> `scrape better-sqlite3 https://github.com/WiseLibs/better-sqlite3`，抓取 85 页、status=completed。
> 检索工具说明：`crw search` 本地后端不可用（需 Docker + SearXNG，本机无 Docker；云 key 未配置），
> 改用 `crw scrape` 抓取 Bing 结果页 + `gh search`/`gh api` + 直接抓取已知文档 URL 作为替代，
> 下列所有 API 均来自实际抓取到的页面原文，未检索到的项已明确标注。

## 一、better-sqlite3 关键 API（均出自已索引的 docs/api.md、docs/performance.md）

### 1. 事务批量写入 `db.transaction()`

- `db.transaction(fn)` 返回一个函数，调用时自动 `BEGIN`，正常返回 `COMMIT`，抛异常 `ROLLBACK`，异常继续向外传播。
- 批量插入标准写法：`const insertMany = db.transaction((rows) => { for (const r of rows) insert.run(r); })`。
- 三种变体：`fn.deferred()` / `fn.immediate()` / `fn.exclusive()`，分别对应 `BEGIN DEFERRED/IMMEDIATE/EXCLUSIVE`。
- 嵌套调用内层自动降级为 savepoint；内层回滚到 savepoint 并重抛，外层未捕获则整体回滚。
- 参数/返回值/`this` 透传；`db.inTransaction` 可读当前是否在事务中。
- 硬性限制（官方 Caveats 原文）：
  - **不支持 async 函数**——async 在首个 `await` 处就返回，事务已提交；且 SQLite 串行化事务，跨事件循环持有事务是坏味道。
  - 事务函数内部禁止混用裸 `BEGIN/COMMIT/ROLLBACK`。
  - SQLite 可能因 `ON CONFLICT`、`RAISE()`、`SQLITE_FULL`/`SQLITE_BUSY` **悄悄回滚事务**；在事务内 catch 错误后必须 `if (!db.inTransaction) throw err;` 再决定是否继续。
- 批量写入性能路径：`docs/performance.md` 建议开 WAL（`db.pragma('journal_mode = WAL')`），并提示 WAL 默认 `synchronous=NORMAL`，需要更强持久性可 `db.pragma('synchronous = FULL')`。

### 2. 幂等 DDL 范式

- better-sqlite3 官方文档**未记载**「先查 `pragma table_info` 再 `ALTER`」范式（api.md 全文检索无相关段落）——该范式为 SQLite 通用实践，本调研从真实代码取证：
  - `Database#pragma(string, [options])` 是官方推荐的 PRAGMA 执行入口（比裸 prepare 稳，能归一化怪异返回）；`{ simple: true }` 取首行首列。
  - 列存在性检查：`db.pragma('table_info(attachments)')` 返回 `{name, type, notnull, ...}` 行数组（样例：bikeshaving/ZenDB `src/sqlite.ts` 的 `getColumns()` 用 `PRAGMA table_info(...)` + `sqlite_master` 判表存在）。
  - 桌面应用迁移范例（AIDotNet/NextCoWork，Electron 主进程 `src/main/db/schema.ts`）：
    - 迁移文件头注释「**只增不改**——每条迁移一旦发布过就是历史」，`Migration { version, name, sql }` 数组顺序执行；
    - 加列统一 `ALTER TABLE attachments ADD COLUMN ... DEFAULT ...`（利用默认值完成历史行回填），并说明**为何不重建表**：`PRAGMA foreign_keys` 是连接级、事务里改它不生效，有 FK 的表重建风险高；
    - 表设计按「查询形状」分：整行读写的小表用 `json TEXT` 一列，需要过滤/排序/聚合的字段才提真列。
  - Signal-Desktop（Electron）用编号迁移 `1650-*.ts` + `db.exec(CREATE TABLE ...)`，同样只追加不修改。

### 3. BLOB 读写

- 类型映射（api.md「Binding Parameters」表）：SQLite `BLOB` ↔ JS `Buffer`；`INTEGER` ↔ `number`/`BigInt`（`safeIntegers()` 相关见 integer.md）；`TEXT` ↔ `string`；`REAL` ↔ `number`；`NULL` ↔ `null`。
- 绑定支持匿名 `?`、命名 `@name`/`:name`/`$name`、数组与对象混绑；`stmt.run()` 返回 `{ changes, lastInsertRowid }`，可据此做「影响行数=0 视为幂等命中」的判断。
- 相关能力：`db.serialize()` 返回 `Buffer`（整库序列化/备份用）；`Database#backup(dest)` 返回 Promise。
- 结论：附件小文件可直接以 `Buffer` 存 BLOB；大文件存磁盘 + DB 只存路径/哈希（见第二节），better-sqlite3 两种都无 API 障碍。

## 二、附件元数据方案建议

未检索到成文的「Electron 附件元数据设计」专文，改以两个真实 Electron/Tauri 桌面项目的 schema 取证：

- **NextCoWork（Electron 主进程）`attachments` 表**：
  ```sql
  CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
    message_id  TEXT REFERENCES messages (id) ON DELETE CASCADE,
    path TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0,
    checksum TEXT, created_at INTEGER NOT NULL
  );
  ```
  后续迁移追加：`scope`（会话附件/主题图子树分治）、`status`（`committed`/可回收，配合宽限期）、`owner_id`、`display_name`；索引 `attachments_by_checksum (checksum, scope, owner_id)` 用于去重。
  关键教训（其迁移注释原文）：清理规则不能假设「表覆盖附件根目录全集」，否则会**静默删掉**未入表/未提交的文件——孤儿判定必须收紧为「表里标记为可回收且过宽限期」。
- **Signal-Desktop（Electron）`message_attachments` 表**（DATABASE_SCHEMA.md）：`messageId` FK ON DELETE CASCADE、`attachmentType`、`size`、`contentType`、**`path`（文件在磁盘，不存 BLOB）**、`plaintextHash`（去重/校验）、`localKey`、`fileName`、`blurHash`、`height/width` 等，STRICT 表。

建议落地形态（综合上述 + better-sqlite3 能力）：
1. 文件本体落磁盘（沿用 `media://` 约定），DB 存元数据行：`id, rel_path, mime, size, checksum(md5/sha1), width/height, created_at, owner(文档/会话), status`。
2. `checksum` 唯一索引做引用计数式去重；`status`（pending/committed/orphan）+ 宽限期防孤儿清扫误删。
3. 迁移用「只增不改」版本数组 + `ALTER TABLE ADD COLUMN ... DEFAULT`；加列前用 `db.pragma('table_info(t)')` 判列是否存在，保证重复启动幂等。
4. 批量回填/清理放 `db.transaction()` 内、同步函数执行，禁止 async。

## 三、citation 数据结构建议

未检索到可抓取的成文设计文章（Anthropic/OpenAI 官方 citations 文档页为 JS 渲染或被地域封锁，见第五节），以下结构出自**官方 SDK 类型定义原文**（GitHub 可取证）：

- **Anthropic citations（`anthropics/anthropic-sdk-csharp` 模型，JSON 字段名与 API 一致）**：
  - `cited_text`（被引用的原文片段，required）、`document_index`、`document_title`、`file_id`、`type`；
  - 字符定位：`CitationCharLocation { start_char_index, end_char_index }`；
  - 页码定位：`CitationPageLocation { start_page_number, end_page_number }`（另有 content block 定位变体）。
- **Pinecone Nexus**（`how-queries-work`）：行内引用标记「map back to real source spans: the file, page, and verbatim text behind every claim」——即 file + page + verbatim text 三元组回溯。

建议的数据结构（对齐 Anthropic 形状，兼容 WeaveMD 的 chunk/页码）：

```text
citation {
  chunk_id,            -- 指向 kb_chunks
  doc_id / file_path,  -- 出处文档
  quoted_text,         -- cited_text，verbatim 片段，用于校验与展示
  loc_type,            -- 'char' | 'page' | 'block'
  start, end,          -- char 定位（相对原文全文）
  page_start, page_end -- 页码定位（PDF 解析出页码时填）
}
```

要点：存 verbatim `quoted_text` 而非只存 offset——检索结果展示与「出处可跳转」都不依赖偏移是否漂移；偏移保留用于点击定位。

## 四、向量回填与重建策略要点

出处为 Pinecone Nexus API 文档（两页已抓取原文）：

1. **增量默认、全量显式**：`POST /contexts/{slug}/curate` 的 body `{}` 即增量构建；`force: true` 才是 full rebuild；`batch_size` 控制每轮读取的源数。查询前置条件：「Curate is explicit — nothing is queryable until you run it」。
2. **哈希跳过未变更源**：curation ledger 的 `SourceManifestEntry { hash, curated_at, size, mtime }`——「The hash is what makes an incremental curate possible — a source whose hash is unchanged is skipped」。对应本项目：`kb_chunks` 用 MD5 staleness detection 决定是否重算 embedding。
3. **版本化原子切换**：`live_version`（查询读取的索引版本）+ `versions_stamped`（每条索引条目带版本戳，「lets a curate flip versions atomically」）——回填写新版本，完成后一次切换，避免半新半旧。
4. **删除走墓碑**：`source_removed` 延迟墓碑，「index entries are dropped on the next curate rather than at delete time」，删除不阻塞写入。
5. **断点续跑**：`redispatch_count`（被杀任务恢复而非重启）+ `source_pointers`/`source_glossary` resume cursor——回填任务幂等重启的关键。
6. SQLite 内向量存储可用 sqlite-vec（`vec0` 虚拟表，float/int8/binary 向量，KNN 查询 `order by distance`）。sqlite-vec README **未检索到**专门的「向量索引重建/回填」章节，重建策略以第 1–5 条的通用模式为准。

## 五、文章出处 URL

| 主题 | URL | 备注 |
| --- | --- | --- |
| better-sqlite3 API | https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md | transaction/pragma/绑定与 BLOB 映射原文 |
| better-sqlite3 性能 | https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md | WAL、checkpoint starvation、synchronous |
| RRF 官方文档 | https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking | `1/(rank + k)`，k 建议取 60，支持 weight 加权 |
| RRF 中文解读 | https://cloud.tencent.com/developer/article/2638995 | RRF 定义与直觉（正文较短，仅概述+定义可读） |
| RRF 中文详解 | https://zhuanlan.zhihu.com/p/1914270914654237406 | Bing 结果标题可确认主题（页面内容未抓取验证） |
| citation 结构 | https://github.com/anthropics/anthropic-sdk-csharp/blob/main/src/Anthropic/Models/Messages/CitationCharLocation.cs | cited_text/start_char_index/end_char_index |
| citation 页码 | https://github.com/anthropics/anthropic-sdk-csharp/blob/main/src/Anthropic/Models/Messages/CitationPageLocation.cs | start_page_number/end_page_number |
| 引用回溯 | https://docs.pinecone.io/guides/nexus/how-queries-work.md | file + page + verbatim text 回溯 |
| 向量增量/全量重建 | https://docs.pinecone.io/api-reference/curation/build-or-rebuild-the-contexts-index-from-its-sources.md | `{}` 增量 / `force:true` 全量 / batch_size |
| 回填账本（哈希跳过/墓碑/断点） | https://docs.pinecone.io/api-reference/curation/get-the-curation-ledger.md | hash skip、tombstone、version flip、resume cursor |
| SQLite 向量存储 | https://github.com/asg017/sqlite-vec | vec0 虚拟表 + KNN |
| 附件 schema（Electron） | https://github.com/AIDotNet/NextCoWork/blob/main/src/main/db/schema.ts | attachments 表 + 只增不改迁移 + ALTER 加列 |
| 附件 schema（Electron） | https://github.com/signalapp/Signal-Desktop/blob/main/DATABASE_SCHEMA.md | message_attachments：path/hash/contentType |
| 幂等 DDL 实例 | https://github.com/bikeshaving/ZenDB/blob/main/src/sqlite.ts | `PRAGMA table_info` 取列存在性 |

### 未检索到 / 受限项

- `crw search` 本地搜索后端（Docker/SearXNG）未配置，云 key 未配置——四组主题检索改用 Bing（经 `crw scrape`）+ `gh search` + 定点抓取替代。
- sqlite.org 官方站（faq.html 等）网络不可达；OpenAI citations 文档被 Cloudflare 拦截；Anthropic/claude 官方 citations 文档页 JS 渲染，抓取只得导航栏。
- 「Electron 附件元数据存储设计」「向量索引回填重建」两个主题未检索到成文博客，已用真实开源 schema 与厂商 API 文档替代取证。
- better-sqlite3 官方文档未记载幂等 DDL（table_info → ALTER）范式。
