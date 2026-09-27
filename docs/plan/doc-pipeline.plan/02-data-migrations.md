# doc-pipeline — 数据变更专章（§3，D1~D8）

> 拆分自 [doc-pipeline.plan.md](../doc-pipeline.plan.md)，原 §3 数据变更专章；2026-09-27 按渐进式披露拆分，正文未改动。
> 返回索引：[doc-pipeline.plan.md](../doc-pipeline.plan.md)

---

## 3. 数据变更专章

> 涉及批次：B3（D1/D2）、B4（D3）、B5（D4）、B8（D6）、B11（D5）、B7（D7）、remedial（D8）。共 **9 个数据变更点**
> （D5b consent_granted 为 B11 实现中补充、D7 structure_json 为 B7 落库要求补充、D8 vision_override 为遗留修复批次补充——原稿写 6，阶段 7 合规核对后回填 8，remedial 批次回填 9）。

### 统一迁移纪律（适用于全部 D 项）

1. **写法**：只用既有范式——`addColumnIfMissing()`（`src/main/db/index.ts:309`，PRAGMA table_info 探测缺失才 `ALTER TABLE ADD COLUMN`，重复执行 no-op）与 `CREATE TABLE/INDEX IF NOT EXISTS`；**照 :247-257 现成范式**，不引迁移框架。
2. **幂等**：空库（全新 `CREATE` 链路跑一遍）与旧版本升级（已有库补列）落到同一终态；重复启动零副作用。
3. **不动历史迁移**：不修改、不删除任何已应用过的迁移块（红线）；新变更只追加。
4. **回滚方式（通用）**：全部为**追加式、可空或带 DEFAULT** 的列/取值扩展 → 旧版本代码 SELECT 明确列名、不读新列，**旧版本可直接打开升级后的库**；回滚 = 代码 revert + 列保留无害；**禁止写 DROP 迁移**。JSON 级变更（D6）按可选字段解析，天然双向兼容。
5. **验收**：每项迁移配"空库首建 + 旧库升级 + 重复执行"三断言单测。

### D1 `ai_messages.attachments_json` 补列（B3）

- **现状**：`ai_messages`（`db/index.ts:188-199`）仅 id/conversation_id/user_id/role/content/refs_json/tool_call_id/tool_calls/created_at，无任何附件字段；`appendMessage`（`db/ai.ts:523-555`）只写 `content`。
- **目标模型**：`attachments_json TEXT DEFAULT NULL`，JSON 数组仅存轻量元数据 `[{id,type,name,path,size,parseStatus}]`；正文内容不入消息表（存 D2），`content` 只留 `[文件: xxx]`/`[图片: xxx]` 占位符（一物两表，避免消息表膨胀）。
- **迁移写法**：`addColumnIfMissing(database, 'ai_messages', 'attachments_json', 'attachments_json TEXT DEFAULT NULL')`，紧邻 :247-251 既有两行之后。
- **回滚**：旧版本不读该列，直接兼容；列保留无害。

### D2 `parsed_attachments` 启用 + 补列（B3）

- **现状**：表已建（`db/index.ts:543-556`，注册 :266）：id/user_id/conversation_id/file_name/file_type/content/created_at；**全库无任何 INSERT/SELECT**（死表）。
- **目标模型**：补 `parse_status TEXT DEFAULT 'done'`（pending/processing/done/error 三态渲染来源）、`parse_version INTEGER DEFAULT 1`（二-6② 回填重建依据）；新增 DAO `src/main/db/attachments.ts` 承担全部读写；`content` 列存解析产物全文。
- **迁移写法**：`CREATE TABLE IF NOT EXISTS`（建表语句保持幂等，新列可不回写建表段）+ `addColumnIfMissing` 补两列；空库与旧库同路径收敛。
- **回滚**：旧版本本就不读该表，零影响。

### D3 `kb_documents` 附件关联（B4 通道，B11 过滤复用）

- **现状**：`kb_documents`（:201-210）`source_type TEXT`（实际取值 `'db'`/`'import'`）+ `file_id`（导入时恒 NULL），无附件关联列。
- **目标模型**：补 `attachment_id TEXT DEFAULT NULL`（关联 `parsed_attachments.id`，删除附件→清理 KB，对齐 `ipc-handlers.ts:74-84`）+ `idx_kb_doc_user_attachment` 索引；`source_type` 增加取值 **`'attachment'`**（TEXT 取值扩展，无 DDL）——B11 的 Q1 过滤键。
- **迁移写法**：`addColumnIfMissing` + `CREATE INDEX IF NOT EXISTS`；取值扩展零迁移。
- **回滚**：列可空旧版忽略；旧版代码遇 `source_type='attachment'` 仅列表展示（TEXT 不校验），行为安全；回滚后新数据不再写入。

### D4 `kb_chunks.heading_path` 写入（B5）— 无 schema 变更

- **现状**：列已建（`db/index.ts:479`）**从无写入**；`kbSearch.ts:280/489/542/608` 只读，`aggregateAndExpand`（:190）因此失效。
- **目标模型**：`splitNote` 输出 `headingPath` → `insertChunksBatch` 写列；`NoteChunk` 类型同步扩展。
- **迁移写法**：无 DDL；**历史 chunk 不强制回填**——读侧按 NULL 降级（老数据、纯文本 txt，四-2②），随保存 reindex 自然补齐；如需主动回填与 D5 向量回填共用后台任务。
- **回滚**：列早已存在，停止写入即回滚；读侧 NULL 容错现状已具备。

### D5 `ai_config.upload_kb_default` 补列（B11 / Q2）

- **现状**：`ai_config`（:162-175 + 补列链 :226-257）无勾选默认字段。
- **目标模型**：`upload_kb_default INTEGER DEFAULT 1`（**默认勾选**「加入知识库」，Q2 与"勾选=显式授权"语义自洽）。
- **迁移写法**：`addColumnIfMissing`，追加在 :253-257 补列组之后。
- **回滚**：DEFAULT 1 可空列，旧版不读，直接兼容。

### D6 `refs_json` 结构扩展（B8 / 六-2）— JSON 级，无 DDL

- **现状**：`IAIMessage.refsJson`（`conversation.ts:30-43`）已存在，气泡解析渲染（`AIMessageBubble.tsx:49-91/398-430`）。
- **目标模型**：JSON 内扩展页码/附件锚点字段（真实页码回链、附件跳转）；历史消息无新字段按可选解析（六-2②向后兼容）。
- **迁移写法**：无 schema 变更；读写均按可选字段。
- **回滚**：旧渲染忽略新增字段，双向兼容。

### D8 `ai_config.vision_override` 补列（remedial Bug B）

- **现状**：`ai_config` 无 vision 覆盖字段；`supportsVision` 仅按模型 id 模式猜且未知恒 false（诊断报告 B-1）。
- **目标模型**：`vision_override INTEGER DEFAULT NULL` 三态 —— NULL=自动判定（已知能力表 → 未知模型乐观注入）、1=强制支持、0=强制不支持；注入与识别两链路经 `resolveVisionSupport` 统一消费。
- **迁移写法**：`addColumnIfMissing` 追加在 D5/D8 同组补列之后（remedial 批次实现为独立导出 `addVisionOverrideColumn`，三断言 `tests/main/db/migrations.test.ts`）。
- **回滚**：可空列旧版不读，直接兼容；回滚 = 代码 revert + 列保留无害。

---
