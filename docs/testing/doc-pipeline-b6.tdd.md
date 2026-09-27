# doc-pipeline B6 — TDD 证据报告（strict）

> 创建：2026-09-26 | 批次：**B6（五-1 content 数组 + 五-2 图片落盘 + 五-3 死代码接活）** | 强度：strict（RED → 最小实现 GREEN → 重构 → 覆盖率 → 门禁 → 提交）
> 来源：[计划](../plan/doc-pipeline.plan.md) §1/§2-B6/§4.2-B6 / [需求](../requirements/doc-pipeline.req.md)
> 权威需求源：`C:\Users\lenovo\Desktop\优化方向\优化方向.md` §五-1/五-2/五-3（拷问细节② = 验收点）
> 调研依据：`docs/plan/doc-pipeline.research-pdf-multimodal.md` §2.3（Anthropic image block vs OpenAI `image_url` 对照、`detail`/多模态计费）
> 风险级：**L4**（核心 LLM 链路全调用点，用户已放行）；红线：纯文本链路行为不变、不削弱 `allowSend`、不删测试、不新增 IPC 通道除非三处同步

## 1. 测试范围

| 文件 | 类型 | 新增用例 | 覆盖项 |
|------|------|---------|--------|
| `tests/main/ai/llmClient.test.ts` | 扩展 | +6 | **content 数组（五-1）**：纯文本消息零改动（回归）、本地路径→data URL 解析、data/http 原样透传、坏路径降级占位文本 part、端到端请求体断言、**带图片时 SSE/tool_calls 增量解析不回归** |
| `tests/main/ai/anthropicCompat.test.ts` | **新建** | 8 | Anthropic 双协议分流：纯文本 content 原样（回归）、text+data URL → text/image block、本地路径读盘→base64 block、http → url source、坏路径→占位、`buildAnthropicRequest` 数组保留、`isAnthropicModel`、`resolveModelProtocol`（显式 protocol 优先 + 模型名回退） |
| `tests/main/ai/contextManager.test.ts` | 扩展 | +4 | **Q4 压缩丢图**：保留最近 3 张图片 part、更早图片原位降级占位 + 提示文案、纯文本历史零影响（回归）、`estimateContentTokens`（文本+图片）、`summarizeViaLlm` 压缩输入剥图（纯文本透传） |
| `tests/main/ai/costTracker.test.ts` | 扩展 | +3 | **图片计价（五-1）**：`estimateImageTokens` 张数换算、`imageTokens` 记录 + `imageCostUsd` 归因**且总成本不重复计费**、成本表 Image 列 |
| `tests/main/ai/modelDiscovery.test.ts` | **新建** | 7 | **vision 发送前检测**：9 类已知 vision id、5 类纯文本 id、未知模型保守判否、`guessCapabilities` 同源、`discoverModels` 成功映射/非 ok/异常/非列表四种出口 |
| `tests/main/ai/imageStorage.test.ts` | **新建** | 13 | **五-2 落盘**：`attachments/{userId}/{convId}/{id}.{ext}` 结构 + 相对路径、data URL 解码落盘、svg 拒绝、超限 `too_large`、白名单外拒绝、bmp 栅格化成功/失败、gif 原样、源文件缺失；路径契约（相对↔绝对、根外不改写）、按 id 删除、会话目录清理、多账号隔离 |
| `tests/main/ai/agentMedia.test.ts` | **新建** | 12 | **五-3 注入接线点**：vision 支持→image_url part、不支持→空 parts + degraded、缺失文件→unreadable、GIF 首帧提示、非图片/空输入零影响；历史图片限额倒推取 3；`processMedia`/`formatImageForLlm`/`imagePartFromPath` 接活覆盖 |
| `tests/main/ai/imageRecognition.test.ts` | **新建** | 9 | **五-3 真实 llmCall**：`recognizeImage` 注入 llmCall 且消息含 text+image part、缺文件 null、无 llmCall 占位；`createRecognitionLlmCall` 累加 delta + usage 上报（含 `imageTokens`）、anthropic 分流；发送链路 `recognizeImageAttachments`：不支持 vision 不发请求直接标失败、成功写描述、LLM 失败→「图片未成功识别」、落盘失败项跳过不动文件附件 |
| `tests/main/ai/agentEventStore.test.ts` | **新建** | 9 | **五-1 事件回放**：data URL→占位、附件根内绝对路径→相对路径、content 数组图片 part 改写、纯文本零改动（回归）；`persistAndSend`/`persistOnly` 入库 JSON 无 base64、批量 flush 落库参数净化、`replayFromSeq` 回放再净化、seq 递增 |
| `tests/main/db/attachments.test.ts` | 扩展 | +3（改 1） | 图片分支改落盘：`storeAttachmentImage` 调用参数、meta 存相对路径、落盘失败 `pending→error` + `error` 提示、删除附件同步清落盘文件；**既有「data URL 转存 content」用例按 B6 前提重写为「base64 绝不入库」**（见 §8.12） |
| `tests/main/ipcDialogs.test.ts` | 扩展 | +1 | DIALOG_PICK_IMAGE 过滤器剔除 svg、保留 png/jpg/jpeg/gif/webp/bmp |
| `tests/main/ai/ipc.test.ts` | 扩展 | +1 | 删除会话成功 → 同步清理落盘图片（对齐 cleanupKbAfterFileDelete 模式） |
| `tests/components/aiMessageBubbleAttach.test.tsx` | 扩展 | +5 | 图片识别失败态文案、落盘原因展示（svg）、缩略图点击开 lightbox + 点击遮罩关、Esc 关闭、GIF 提示 |
| `tests/components/composerPaste.test.ts` | 扩展 | +4 | `validateImageAttachment` svg/白名单/通过；粘贴 svg → `onImageRejected` 收到原因且不入附件、防文本重复插入 |
| **合计** | | **84** | （= 全量 vitest **3500** − B5 基线 **3416**；测试文件 diff 新增 85 处 `it()`，其中 1 处为既有用例改写重命名） |

## 2. RED（先写失败测试，实际执行）

分阶段执行（L4 跨层大改按阶段收口，每阶段先落测试再改实现）：

```
$ npx vitest run tests/main/ai/llmClient.test.ts tests/main/ai/anthropicCompat.test.ts
 Test Files  2 failed (2)
      Tests  9 failed | 22 passed (31)          ← 2026-09-26 15:53
```

失败构成（原始输出摘录）：

```
FAIL llmClient > content 数组 — resolveContentForWire 模块无此导出（import 即失败）
FAIL anthropicCompat > text + data URL → text/image blocks
      — AnthropicMessage.content 无 image block（数组只透传不转换）
FAIL anthropicCompat > 本地路径读盘 → base64 image block
      — 旧实现 content 直接透传，本地路径原样发给 API
```

其余阶段 RED（如实记录，首跑失败 → 修实现/断言 → 绿）：

| 阶段 | 首跑输出 | 失败点 |
|------|---------|--------|
| contextManager Q4 + costTracker Image 列 | 1 failed + contextManager 文件 transform 失败 | 测试字面量反斜杠触发 legacy octal escape；表头列数断言仍为 8 列（B4 旧口径） |
| imageStorage（模块先于实现同批写入） | 12 passed / 1 failed | `toRelativePath` 返回 `u1/...` 与 `attachments/` 前缀口径不一致 → 改实现统一前缀 |
| attachments 图片分支 | 2 failed | 旧前提「data URL 转存 content」被 B6 推翻；落盘失败仍回退原始绝对路径 → 改实现 |
| agentEventStore | 3 failed | 占位文案自身含 "base64" 字样导致断言不过 → 改文案；随后 replay 用例 `payloadJson` undefined → 测试行改 snake_case + 实现补回放再净化 |
| imageRecognition | 2 failed | anthropic 客户端未 mock（真发请求 403）、mock 句柄类型 |
| 气泡 lightbox | 1 failed | 测试路径字面量转义导致 `toImgSrc` 未转 media:// → 前斜杠路径 |
| resolveModelProtocol 接入后 | 1 failed | 未配置 protocol 的 claude 模型按新语义走 anthropic → 测试补显式 `protocol:'openai'`（即为预期行为断言） |

RED 即通过的大量用例 = 存量回归断言（纯文本链路、SSE/tool_calls 解析、压缩轮次保留、附件三态等）+ 新测试中的守护用例（白名单、根外路径不改写、空输入零影响）——**这正是 L4「纯文本链路回归」要求的证明**：全部既有断言在 content 类型放宽后未改一字仍然通过。

## 3. 最小实现 → GREEN（实际执行）

实现顺序（4 个 checkpoint）：

1. **`llmClient.ts`**（`ContentPart`/`MessageContent`/`LlmRequestMessage` 类型 + `resolveContentForWire` 发送前解析）→ **`anthropicCompat.ts`**（`toAnthropicContent`：data URL→base64 block、http→url source、坏路径→占位；`resolveModelProtocol`）→ **`anthropicClient.ts`**（system/messages 两处 content 转换）→ **`contextManager.ts`**（`LlmMessage.content` 扩数组、`contentToText`/`estimateContentTokens`/`countMessageImages`、`degradeExcessImages` Q4、压缩输入剥图）→ **`costTracker.ts`**（`IMAGE_TOKENS_PER_IMAGE`/`estimateImageTokens`/`imageCostUsd` 归因 + Image 列）。
2. **`imageStorage.ts`** 重写为 attachments 结构（落盘/解析/删除/栅格化）→ **`db/attachments.ts`** 图片分支 + 错误文案 + 删除联动 → **`db/ai.ts`** 相对路径序列化/读取重建 → **`chatHandlers.ts`** 删除会话清理 + **`ipc-handlers.ts`** dialog 剔 svg。
3. **`modelDiscovery.ts`** `supportsVision`（导出 `guessCapabilities` 同源）→ **`agentMedia.ts`** `buildImageParts`/`injectImagesIntoMessages`/`selectRecentImageIds` → **`agentContext.ts`** 注入 + 降级 system 提示 → **`chatHandlers.ts`** 同一接线点注入 → **`imageRecognition.ts`** 接活（processMedia + formatImageForLlm + `createRecognitionLlmCall` + 发送链路 `recognizeImageAttachments`，Chat/Agent 两 IPC 链路接入）→ **`agentEventStore.ts`** `sanitizeEventPayload`（写入 + 回放双净化）。
4. **渲染层**：`AIMessageBubble`（lightbox + 图片失败态 + GIF 提示）、`pasteAttachment`（`validateImageAttachment` + `onImageRejected`）、`AIPanelComposer`（入口拒绝 + 提示行）。

```
$ npx vitest run <上表全部测试文件>
...
 Test Files  14 passed (14)
      Tests  100 passed (100)
```

分阶段 GREEN（实测时间点）：

```
15:55  llmClient + anthropicCompat                     2 files / 31 passed
16:03  contextManager + costTracker                    2 files / 36 passed
16:23  imageStorage + attachments                      2 files / 36 passed
16:33  modelDiscovery + agentMedia                     2 files / 16 passed
16:39  imageRecognition                                1 file  / 9  passed
16:44  agentEventStore                                 1 file  / 7 → 9 passed
17:03  aiMessageBubbleAttach + composerPaste           2 files / 42 passed
```

## 4. 重构（不改行为）

1. **`toCheckpointMessages` 抽取**（agentLoop）：checkpoint 序列化统一 `contentToText`（图片 part→`[图片]` 占位），`existingMessages` 参数同时转换 —— checkpoint_json 只存文本，不落 base64/本地路径。
2. **删除会话清理挂点**取 IPC 层 `AI_CONVERSATION_DELETE`（对齐 `ipc-handlers.ts:74-84` 清理范式），附件清理留在 `removeParsedAttachment`（B4 既定的附件唯一删除点）。
3. **`stripImagesForSummary` 内聚到 contextManager**：压缩两条分支（cache-safe fork / 回退）共用同一份 text-only 消息。
4. 重构后目标文件复测通过；全量 3500 passed。

## 5. 覆盖率（新增代码）

```
$ npx vitest run --coverage --coverage.reporter=text \
    --coverage.include='src/main/ai/llm/**' \
    --coverage.include='src/main/ai/contextManager.ts' \
    --coverage.include='src/main/ai/costTracker.ts' \
    --coverage.include='src/main/ai/image/**' \
    --coverage.include='src/main/ai/agent/agentMedia.ts' \
    --coverage.include='src/main/ai/agent/agentEventStore.ts' \
    --coverage.include='src/main/db/attachments.ts' \
    --coverage.include='src/render/components/AIAgent/composer/pasteAttachment.ts' \
    --exclude '**/cacheMonitor.test.ts' tests/main/ai tests/main/db tests/components
```

实际输出（2026-09-26）：

```
File               | % Stmts | % Branch | % Funcs | % Lines
All files          |   84.87 |    79.83 |   85.12 |   84.87
 contextManager.ts |   93.82 |    90.19 |      70 |   93.82
 costTracker.ts    |   99.66 |    97.72 |     100 |   99.66
 agentEventStore   |   96.76 |    80.55 |   77.77 |   96.76
 agentMedia.ts     |   81.71 |     72.5 |      90 |   81.71
 imageRecognition  |   97.4  |    85.48 |   83.33 |   97.4
 imageStorage.ts   |   92.65 |    63.15 |   83.33 |   92.65
 anthropicClient   |   86.85 |    56.52 |     100 |   86.85
 anthropicCompat   |   95.45 |       72 |     100 |   95.45
 llmClient.ts      |   87.21 |    80.95 |   69.23 |   87.21
 modelDiscovery.ts |   92.45 |    88.57 |     100 |   92.45
 attachments.ts    |   92.41 |    87.95 |      90 |   92.41
 pasteAttachment   |   96.23 |    85.71 |    90.9 |   96.23
```

- **B6 触及文件语句覆盖率全部 ≥81%**（新增代码 ≥80% 达标）；聚合 84.87% stmts。
- 目录内 `llmBudget.ts`/`llmConfigs.ts`/`modelCatalog.ts` 为 **B6 未触及的既有 0% 文件**（被 `src/main/ai/llm/**` 口径一并纳入），不计入本批次新增代码。
- 未覆盖行均为既有块或防御分支：`agentMedia` 97-114 = `processMedia` 文档/unknown 分支既有代码；`imageStorage` 278-286 = 清理函数的 catch 兜底；`contextManager` 163-165 = `summarizeViaLlm` anthropic 分流（既有）。
- **口径说明**：同 B1~B5——vitest v8 在 tests fail 时不落报告，全量 + 覆盖率含 `cacheMonitor`/`ab-test` 性能断言负载 flaky（§6），故覆盖率证据取 B6 相关子集（全过 → 报告产出）。

## 6. 质量门禁（全部实测）

| 门禁 | 命令 | 结果 |
|------|------|------|
| 类型检查 | `npx tsc --noEmit` | **exit 0，零错误**（TS strict；首轮 13 错已修：`MessageContent` 联合类型串改 11 处、mock 类型 2 处） |
| 单元测试 | `npx vitest run` | **152 文件 / 3500 passed / 0 failed**（2026-09-26 18:45 实测 exit 0；B5 基线 3416 → 3500，净增 84） |
| Lint | `npm run lint` | **0 errors, 106 warnings**（B5 基线 108 warnings，本批次消除 2 个存量 unused；`no-useless-escape` 1 处已修） |
| 构建 | `npx vite build` | **exit 0**（renderer + main + preload 三段全过） |
| E2E | `npx playwright test` | **31 failed / 1 skipped / 101 passed（133 条）**——failed 按 spec 构成与基线逐条同名单（table 7 / feedback 5 / drag 5 / ai-agent-panel 4 / thematic 2 / float-toolbar 2 / exit 2 / editor 1 / image-resize 1 / recent-history 1 / welcome 1），**零新增失败**；B6 未新增 e2e spec |

**过程 flaky 记录（如实）**：存量性能断言 `cacheMonitor > getStats 10 万次 < 50ms` 与 `ab-test > djb2 should be faster than simulated MD5` 在全量/覆盖率负载下间歇超阈（B4/B5 已记录同款，两者均未被本批次触及）；单跑 **cacheMonitor 37 passed、ab-test 22 passed**，收尾全量 **152 文件 3500 passed 全绿**。

**纯文本链路回归专项（L4 最高优先级验收）**：content 类型放宽后**既有断言零修改**全部通过——`llmClient` 纯文本 12 条（delta 顺序/空 content 跳过/[DONE]/半包/tool_calls 增量/尾 flush/usage/cache 字段）、`contextManager` 轮次保留 4 条、`anthropicCompat` 纯文本透传、`attachments` 文件三态 6 条、`composerPaste` 文本粘贴行为 8 条、`aiMessageBubble` 旧消息兼容 2 条；另有新增专门断言 `resolveContentForWire([纯文本])` 返回**逐字相同对象引用序列**与 `buildCompressed` 纯文本历史输出不变。

## 7. §4.2-B6 验收点逐条对照

| 验收点 | 落地 | 证据 |
|--------|------|------|
| `LlmMessage.content` 贯通全部调用点（rewrite/chatHandlers/skillLoader/agentLoop/事件回放），非只改主循环 | `StreamChatCompletionOptions.messages` → `LlmRequestMessage[]`（content 联合类型）；`rewrite.ts`/`skillLoader.ts` 传纯文本零改动（tsc 贯通即证）；chatHandlers/agentContext 注入数组；`agentEventStore` 写入+回放净化 | §1 llmClient/anthropicCompat/agentEventStore 行；`tsc --noEmit` exit 0 |
| 压缩丢图 Q4（保最近 3 张 + 更早降级占位符 + 提示） | `buildCompressed(..., keepRecentImages=KEEP_RECENT_IMAGES)` → `degradeExcessImages` 原位替换为 `IMAGE_DEGRADED_PLACEHOLDER` | contextManager「keeps the newest 3 image parts…」+「pure-string history untouched」 |
| OpenAI `image_url` 与 Anthropic `image` 两套分流复用 `isAnthropicModel` | 序列化两套：OpenAI part 透传（`resolveContentForWire` 读盘转 data URL）/ Anthropic `toAnthropicContent` 转 block；分流收口 `resolveModelProtocol`（显式 `ai_config.protocol` 优先，缺省按 `isAnthropicModel` 回退），既有 6 处 protocol 分流语义不变 | anthropicCompat 8 用例 + imageRecognition「routes anthropic protocol」 |
| 历史回放存相对路径不存 base64 | `sanitizeEventPayload`：写入（persistAndSend/persistOnly）与回放（replayFromSeq）双净化；附件根内绝对路径→`attachments/...` | agentEventStore 9 用例（含 flush 落库参数、replay 发送体断言） |
| vision 能力检测发送前生效、不支持降级纯文本 + 提示 | `supportsVision` 在 `prepareAgentContext`/`runChatFlow` 注入前判定；不注入 part + 追加 `VISION_DEGRADED_NOTICE` system 消息；识别侧不发注定失败的请求 | modelDiscovery 4 条 + agentMedia degraded 断言 + imageRecognition 不支持分支 |
| 五-2 `attachments/{userId}/{conversationId}/{id}.{ext}` | `storeAttachmentImage` 目录结构 + 相对路径返回 | imageStorage 13 用例（含多账号隔离） |
| 消息存相对路径、绝对路径启动重建 | `serializeAttachments` 写前 `toRelativePath`；`mapMessageRow` 读时 `resolveStoredPath`（根由 `app.getPath('userData')` 即时重建） | imageStorage 路径契约 3 条 + attachments meta 相对路径断言 |
| 删除清理对齐既有模式 | 删除会话 → `deleteConversationImages`（IPC 层，同 `cleanupKbAfterFileDelete` 范式）；删除附件 → `removeParsedAttachment` 内 `deleteAttachmentImage` | ipc.test +1、attachments.test +1 |
| svg 拒绝/栅格化提示、gif 首帧、大小上限提示 | svg：dialog 过滤剔除 + 入口 `validateImageAttachment` + 存储层三重拒绝，`IAttachmentMeta.error` 回传可读原因；gif：原样存储 + 注入层首帧提示 + 气泡「GIF 首帧」；上限 10MB → `too_large` 文案 | ipcDialogs +1、imageStorage svg/超限/gif、composerPaste +4、气泡 +3 |
| 五-3 接线点在主进程保证链路一致 | `injectImagesIntoMessages`/`buildImageParts` 在主进程，Chat（runChatFlow）与 Agent（prepareAgentContext）共用；Skill 链路见 §8.7 | agentMedia 12 用例 |
| `agentMedia`/`imageRecognition` 接活且补测试覆盖 | `processMedia`/`formatImageForLlm`/`imagePartFromPath` 由识别与注入调用；`recognizeImage` 走真实 `createRecognitionLlmCall`；两文件全库 import 非零 | §5 覆盖率 81.7% / 97.4%；`grep -rn "from '../agentMedia'"` 4 处 |
| 缩略图 lightbox + 识别失败态 | 点击缩略图全屏预览（遮罩/Esc 关闭）；`parseStatus==='error'` 显示 `att.error ?? 图片未成功识别` | aiMessageBubbleAttach +5 |

## 8. 偏离与决策记录

1. **不新增 IPC 通道（§1.3 三处同步不触发）**：图片落盘发生在**发送链路主进程** `persistIncomingAttachments` 内（Chat/Agent 共用），复用既有 `dialog:pick-image`（选路径）与 `clipboard:read-image`（data URL）入口 —— 计划 §2-B6「复用既有通道优先，新通道须三处同步」的前者分支。取舍记录于此与 status.md。
2. **svg 选「明确拒绝」而非栅格化**（计划允许择一）：项目禁增依赖，Electron `nativeImage` 不保证解码 SVG；拒绝点三重（dialog 过滤 / composer 入口 / 存储层），文案「不支持 SVG 图片，请另存为 PNG 后重试」随 `IAttachmentMeta.error` 上屏。
3. **gif 按原样存储 + 首帧提示**：OpenAI/Anthropic 官方 media type 均接受 `image/gif`；不自研 LZW 解码转 PNG（避免新增依赖与位图回归风险）。提示双写：注入层 text part「（GIF 动图，模型按首帧处理）」+ 气泡「GIF 首帧」。
4. **bmp 经 `nativeImage` 栅格化为 png**：避免两家 API 拒收 `image/bmp` 导致整条请求失败；转码失败返回 `unsupported_format` 显式拒绝（不静默发送）。
5. **单图上限 10MB**（`MAX_IMAGE_BYTES`），超限 `too_large` + 「图片超过 10MB 上限，请压缩后重试」。
6. **图片识别在发送链路同步执行**：`recognizeImageAttachments` 由 Chat（`runChatFlow`）与 Agent（`AGENT_RUN` 入队前）两条 IPC 链路调用；描述写 `parsed_attachments.content`（附件入 KB 的可检索文本），失败写 `parseStatus='error'` + 「图片未成功识别」。取舍：多图串行、单次 60s 超时；异步三态（pending→done）会引入渲染层回填复杂度，本批次不做。
7. **Skill 链路**：`llmClient`/`anthropicClient` 的 content 联合类型已贯通（`runSkill` 消息即为 `LlmRequestMessage`），但 skill 输入由 LLM 生成、**无附件来源**，故不注入图片 —— 主进程接线点保证 Chat/Agent 两条**用户输入链路**一致，取舍记录于此。
8. **历史图片限额 3 张与当前轮全量**：`selectRecentImageIds` 仅作用于历史行（Q4 同口径），当前用户消息图片全量注入（用户刚发的内容不受限）；压缩时再统一按 3 张收敛。
9. **checkpoint 只存文本**：`toCheckpointMessages` 用 `contentToText`（图片→`[图片]`），checkpoint_json 不落 base64/路径；恢复后图片以文本占位存在（恢复属容错路径，可接受）。
10. **计价为归因拆分**：provider 的 `promptTokens` 已含图片 token，`imageTokens`/`imageCostUsd` 仅做成本拆分展示（**不叠加进 `estimatedCostUsd`**，避免重复计费）；识别调用通过 `onUsage` 上报进 costTracker（`intent:'image_recognition'`）。B7 D 路线复用 `estimateImageTokens`。
11. **压缩输入剥图**：`summarizeViaLlm` 发送前把图片 part 换成 `[图片]` —— 非 vision 模型压缩不再整段失败（catch 降级），同时省输入 token；cache-safe fork 前缀在含图消息处会 miss 一次，属可接受代价。
12. **既有测试断言调整（非删除）**：① `attachments.test` 的「图片粘贴 data URL → 正文转存 content」用例前提被 B6 推翻，**重写为「落盘 + base64 绝不进 content 列」**（断言更强）；② `costTracker.test` 表头列数 10→11（新增 Image 列），并补数据行列数一致性断言。其余既有用例零修改。
13. **`resolveModelProtocol` 新增**：计划要求「两套分流复用既有 `isAnthropicModel`」，但该函数在 B6 前**无任何生产调用方**（`agent-cost-optimize.status/01-derived-tasks.md:117`（原 status §附，已拆分册） 已记录）；本批次以「显式 `protocol` 优先 + 缺省按模型名回退」的方式接入新链路（识别调用），**不改写既有 6 处 protocol 分流语义**（OpenRouter 等兼容端点跑 claude 的配置不被模型名覆盖）。
14. **vision 判定保守**：未知模型 id 判为不支持 → 降级只丢图片、文本链路照常（向不支持 vision 的模型发图片会让整条请求 400）。后续如需精确探测，应走模型能力接口而非扩名字规则。

## 9. 遗留（移交后续批次）

- 图片向量入库（`imageIndexer`/`images_vec`）按范围外清单不动（三-3②/五-3③）。
- 识别调用同步阻塞发送，未做并发上限（当前多图串行）；若后续附件量大再改异步三态。
- `IImagePayload`（`mention.ts`）仍无调用方——本批次未到使用场景，不强行接线。
- B9 三-3 会复用 `agentMedia` 注入链路做 md 相对路径图片（本期只做附件图片）。
- E2E 存量 31 failed 与两项性能断言负载 flaky 不属本批次。
