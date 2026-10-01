// ============================================
// WeaveMD — Agent Prompt Builder
// ============================================
// 从 agentLoop.ts 提取：系统提示组装 + 文档上下文构建。
// 纯函数，不依赖 IPC / 数据库（listFiles 由调用方注入快照）。
// 性能优化：文件列表缓存（避免每次 Agent 调用都查询 DB）。

import type { AgentTaskPlan, IAttachmentMeta, IntentName, SubtaskDef } from '@shared/ai';
import { estimateTokens } from '../utils/tokenEstimator';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 文档上下文注入：估算 >5000 tokens（约 2 万字符）时截断到 20000 字符 + 尾部标记。 */
const DOC_CONTEXT_TOKEN_LIMIT = 5000;
const DOC_CONTEXT_CHAR_LIMIT = 20_000;
const DOC_CONTEXT_CUT_MARKER = '\n\n[文档过长已截断…]';

/** 文件列表截断限制。 */
const MAX_FILE_LIST = 50;
const MAX_LOCAL_TREE = 30;

// ---------------------------------------------------------------------------
// 全局 Agent 文件注入（agent-memory-optimize-2 A1）
// ---------------------------------------------------------------------------

/**
 * 全局 Agent 文件（soul/memory/style）注入块 token 硬上限（Q4 裁定 2000）。
 * 设置页 recommendedChars 本批不改，此处为发送侧兜底闸。
 */
export const GLOBAL_FILES_TOKEN_LIMIT = 2000;

/** 超限截断后的块尾标注（Q4）。 */
const GLOBAL_FILES_CUT_MARKER = '\n(已截断，完整内容见设置页)';

/**
 * 通用超限截断：按 token 上限二分裁剪，块尾追加截断标注。
 * 保证返回值 `estimateTokens(结果) <= limit`（标注计入上限）。
 */
function truncateBlockWithMarker(block: string, limit: number, marker: string): string {
  if (estimateTokens(block) <= limit) return block;
  // 前缀越短 token 越少 → 谓词单调，二分取满足上限的最大前缀
  let lo = 0;
  let hi = block.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(block.slice(0, mid) + marker) <= limit) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return `${block.slice(0, lo)}${marker}`;
}

/** 全局 Agent 文件块截断（A1 口径，标注指向设置页）。 */
function truncateGlobalFilesBlock(block: string, limit: number): string {
  return truncateBlockWithMarker(block, limit, GLOBAL_FILES_CUT_MARKER);
}

// ---------------------------------------------------------------------------
// 用户画像注入（agent-memory-optimize-2 B4）
// ---------------------------------------------------------------------------

/**
 * 画像块 token 硬上限（B4）：与 A1 的 `GLOBAL_FILES_TOKEN_LIMIT` 同为 2000。
 * 取值理由：画像与三文件块同属「用户个性化层」、走同一注入通道，共用同一预算
 * 刻度便于叠加核算（两块合计 ≤4000 token，仍在 64000 窗口内）；本批没有画像
 * 体量的实测数据，故不凭空另设更小值 —— 数量侧已先由条数上限 40 兜住。
 */
export const PROFILE_TOKEN_LIMIT = 2000;

/** 画像块超限截断后的块尾标注（B4）。 */
const PROFILE_CUT_MARKER = '\n(画像过长已截断)';

/** 画像块超限截断（口径同 A1，标注改为画像语义）。 */
function truncateProfileBlock(block: string): string {
  return truncateBlockWithMarker(block, PROFILE_TOKEN_LIMIT, PROFILE_CUT_MARKER);
}

// ---------------------------------------------------------------------------
// 经验注入（agent-memory-optimize-3 D4 六.2：结构化经验 + 任务类型识别注入）
// ---------------------------------------------------------------------------

/**
 * 可注入经验块的任务类型白名单 —— **5 个有关键词规则的显式意图**（总指挥裁定 3）。
 *
 * `chat` 不在其中：它是 `intentRouter` 的**无规则 fallback**（`scores.size===0` 即落 chat），
 * 无法区分「闲聊」与「未知任务类型」，故一律不注入，绕开该歧义。
 *
 * 本常量是**唯一口径**：注入侧（agentContext.buildExperienceBlock）与技能侧
 * （skillLoader front matter 解析、skillAutoStore 草稿校验）共用，避免两份白名单漂移。
 */
export const EXPERIENCE_INTENTS: readonly IntentName[] = [
  'rewrite',
  'kbQa',
  'tech',
  'web',
  'create',
] as const;

/** 判断某意图是否允许注入经验块（chat / 未知值一律 false）。 */
export function isExperienceIntent(intent: string | undefined): boolean {
  return !!intent && (EXPERIENCE_INTENTS as readonly string[]).includes(intent);
}

/**
 * 经验块 token 硬上限（D4 六.2）。
 *
 * 取值依据（**按 `CONTEXT_WINDOW = 64000` 实测调优，非照抄外部资料**；实测工具
 * `estimateTokens`，CJK 0.75 token/字）：
 * 1. **同一预算刻度**：与 A1 `GLOBAL_FILES_TOKEN_LIMIT` / B4 `PROFILE_TOKEN_LIMIT` 同为 2000，
 *    三层个性化块合计 ≤6000 token = **9.4% 窗口**（B4 注释的「两块合计 ≤4000」自然续接）；
 * 2. **实测量级**：典型提炼技能 instructions ≈ **188 token**（含 4 步 + 避坑小节），
 *    2000 可容纳约 10 条典型经验或多技能叠加；单条技能 `SKILL_INSTRUCTIONS_MAX_CHARS = 4000`
 *    字的极限体现实测 **2521 token** → 保留前 2000（约 79%），尾部由截断标注兜底；
 * 3. **窗口实测**：主提示无三块 **1563 token**、三块典型满载 **3150（4.92%，余量 60850）**、
 *    三块全部顶格最坏 **7562（11.8%，余量 56438）** —— 距 64000 仍有 5 万余量；
 * 4. **[待校准]**：单次会话内匹配到的技能条数分布尚无线上实测数据，超限统一走截断 + 标注。
 */
export const EXPERIENCE_TOKEN_LIMIT = 2000;

/** 经验块超限截断后的块尾标注（D4）。 */
const EXPERIENCE_CUT_MARKER = '\n(经验过长已截断)';

/** 经验块超限截断（口径同 A1/B4）。 */
function truncateExperienceBlock(block: string): string {
  return truncateBlockWithMarker(block, EXPERIENCE_TOKEN_LIMIT, EXPERIENCE_CUT_MARKER);
}

// ---------------------------------------------------------------------------
// 叙述长度上限（agent-cost-optimize A4）
// ---------------------------------------------------------------------------

/** 文件操作叙述长度可调档位（tokens）：0 = 只报结果、160 = 允许完整说明。 */
export const FILE_OP_NARRATION_TOKEN_LIMITS = [0, 40, 80, 160] as const;

/** 默认档位：单次文件操作回复不超过 80 tokens（约 2 行）。 */
export const FILE_OP_NARRATION_TOKEN_LIMIT = 80;

/** 需要读取当前文档作参考的写作意图（chat / kbQa / web 与当前文档无关）。 */
const DOC_CONTEXT_INTENTS: ReadonlySet<string> = new Set(['rewrite', 'create', 'tech']);

/** 会产出文件变更的写工具（叙述域规则的适用范围）。 */
const FILE_OP_WRITE_TOOLS = [
  'createFile', 'createFolder', 'editBlocks', 'editLocalFile',
  'renameFile', 'moveFile', 'deleteFile', 'deleteLocalFile',
  'preview_file_revision', 'preview_patch_files',
] as const;

// ---------------------------------------------------------------------------
// 文件列表缓存（性能优化）
// ---------------------------------------------------------------------------

/** 文件列表缓存条目。 */
interface FileListCacheEntry {
  snapshot: string;
  timestamp: number;
}

/** 文件列表缓存：会话级缓存，5 分钟 TTL。 */
const fileListCache = new Map<string, FileListCacheEntry>();

/** 缓存 TTL（5 分钟）。 */
const FILE_LIST_CACHE_TTL = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// 文档上下文构建
// ---------------------------------------------------------------------------

/** B9 三-1②：文件引用（文件名+路径随载荷，正文由工具按需读取）。 */
export interface CurrentFileRef {
  name: string;
  path: string;
}

/** 引用模式摘要：前 N 行 + 字符上限（防单行/超长文档爆量）。 */
const REF_SUMMARY_MAX_LINES = 20;
const REF_SUMMARY_MAX_CHARS = 1200;
/** 引用模式标题大纲上限。 */
const REF_OUTLINE_MAX = 10;
/** 大纲单条字符上限（防超长标题行爆量）。 */
const REF_OUTLINE_MAX_CHARS = 120;

/** 摘要头：取前 N 行并按字符上限截断。 */
function takeSummaryHead(doc: string): string {
  const lines = doc.split(/\r?\n/).slice(0, REF_SUMMARY_MAX_LINES);
  const head = lines.join('\n');
  return head.length > REF_SUMMARY_MAX_CHARS
    ? `${head.slice(0, REF_SUMMARY_MAX_CHARS)}…`
    : head;
}

/**
 * 组装当前文档上下文 system 消息（只读，供 LLM 优化/改写整篇参考）。
 * - 带 fileRef（文件树磁盘 md）→ **引用模式**：只带文件名+路径+摘要
 *   （规模统计 + 标题大纲 + 前 N 行），正文由 `readLocalFile` 按需读取，不整篇内联（三-1②）；
 * - 无 fileRef（DB 文档无磁盘路径，工具读不到正文）→ 旧行为：整篇注入 + 超长截断。
 * 无文档 / 空文档 → 返回 null（不注入）。
 */
export function buildDocumentContext(
  currentDocument: string | undefined,
  fileRef?: CurrentFileRef
): string | null {
  const doc = (currentDocument ?? '').trim();
  if (!doc) return null;

  if (fileRef && fileRef.path) {
    const lines = doc.split(/\r?\n/);
    const outline = lines
      .filter((l) => /^#{1,6}\s+\S/.test(l.trim()))
      .slice(0, REF_OUTLINE_MAX)
      .map((l) => {
        const t = l.trim();
        return `  ${t.length > REF_OUTLINE_MAX_CHARS ? `${t.slice(0, REF_OUTLINE_MAX_CHARS)}…` : t}`;
      });
    const parts = [
      '以下为当前编辑文档引用（只读，供改写/优化参考）：不注入全文，正文请用 readLocalFile 按路径读取后再改写。',
      `- 文件名：${fileRef.name}`,
      `- 路径：${fileRef.path}`,
      `- 规模：共 ${lines.length} 行 / ${doc.length} 字`,
      ...(outline.length > 0 ? [`- 标题大纲（前 ${REF_OUTLINE_MAX} 条）：`, ...outline] : []),
      `- 开头（前 ${REF_SUMMARY_MAX_LINES} 行内）：`,
      takeSummaryHead(doc),
    ];
    return parts.join('\n');
  }

  if (estimateTokens(doc) > DOC_CONTEXT_TOKEN_LIMIT) {
    return `以下为当前编辑文档内容（只读，供改写/优化参考）：\n\n${doc.slice(
      0,
      DOC_CONTEXT_CHAR_LIMIT
    )}${DOC_CONTEXT_CUT_MARKER}`;
  }
  return `以下为当前编辑文档内容（只读，供改写/优化参考）：\n\n${doc}`;
}

/**
 * 是否注入当前文档上下文（agent-cost-optimize B1 意图门控）。
 *
 * 仅 rewrite / create / tech 三个写作意图需要当前文档作参考
 * （editBlocks 在 create / tech 可用）；chat / kbQa / web 的回答来源
 * 分别是对话、知识库、搜索结果，当前文档对它们是纯冗余。
 * 缺文档或空白文档一律不注入。
 */
export function shouldInjectDocumentContext(
  intent: string | undefined,
  currentDocument: string | undefined
): boolean {
  if (!intent || !DOC_CONTEXT_INTENTS.has(intent)) return false;
  return !!(currentDocument ?? '').trim();
}

// ---------------------------------------------------------------------------
// 文件列表快照构建
// ---------------------------------------------------------------------------

/** 文件列表项。 */
interface FileEntry {
  id: string;
  name: string;
}

/**
 * 构建数据库文件列表快照（注入 system prompt）。
 * 文件列表由调用方从 DB 查询后传入。
 */
export function buildFileListSnapshot(files: FileEntry[]): string {
  if (files.length === 0) return '';
  const truncated = files.slice(0, MAX_FILE_LIST);
  const fileList = truncated.map((f) => `- ${f.name} (id: ${f.id})`).join('\n');
  const suffix = files.length > MAX_FILE_LIST
    ? `\n- ...（还有 ${files.length - MAX_FILE_LIST} 个文件，用 listFiles 工具查看完整列表）`
    : '';
  return `\n\n以下是你可访问的工作区文件列表（数据库）：\n${fileList}${suffix}`;
}

/**
 * 构建数据库文件列表快照（带缓存，性能优化）。
 * 同一用户在缓存有效期内（5 分钟）复用缓存结果。
 * @param userId 用户 ID（缓存键）
 * @param files 文件列表（由调用方从 DB 查询后传入）
 * @returns 文件列表快照字符串
 */
export function buildFileListSnapshotCached(
  userId: string,
  files: FileEntry[]
): string {
  const cached = fileListCache.get(userId);
  if (cached && Date.now() - cached.timestamp < FILE_LIST_CACHE_TTL) {
    return cached.snapshot;
  }

  const snapshot = buildFileListSnapshot(files);
  fileListCache.set(userId, { snapshot, timestamp: Date.now() });
  return snapshot;
}

/**
 * 清除文件列表缓存（文件创建/删除/重命名时调用）。
 * @param userId 用户 ID
 */
export function invalidateFileListCache(userId: string): void {
  fileListCache.delete(userId);
}

/**
 * 构建本地文件/文件夹快照（注入 system prompt）。
 * 路径由调用方从 payload.fileTreePaths 传入。
 */
export function buildLocalTreeSnapshot(
  fileTreePaths?: { files: string[]; folders: string[] }
): string {
  if (!fileTreePaths) return '';
  const { files: localFiles, folders: localFolders } = fileTreePaths;
  const parts: string[] = [];

  if (localFiles.length > 0) {
    const truncated = localFiles.slice(0, MAX_LOCAL_TREE);
    let list = truncated.map((p) => `- ${p}`).join('\n');
    if (localFiles.length > MAX_LOCAL_TREE) {
      list += `\n- ...（还有 ${localFiles.length - MAX_LOCAL_TREE} 个文件）`;
    }
    parts.push(`本地文件（可用 readLocalFile 读取，用 editBlocks 改写）：\n${list}`);
  }
  if (localFolders.length > 0) {
    parts.push(`本地文件夹（可用 listLocalDirectory 浏览）：\n${localFolders.map((p) => `- ${p}`).join('\n')}`);
  }

  return parts.length > 0 ? `\n\n用户已打开/导入的本地资源：\n${parts.join('\n\n')}` : '';
}

// ---------------------------------------------------------------------------
// 附件清单快照（Bug A-1）
// ---------------------------------------------------------------------------

/**
 * 构建本会话附件清单（注入 system prompt）：
 * 文件给绝对路径（readLocalFile 可直接消费）、图片只给 id（已随消息作为图像
 * 注入或走 analyzeChart 定位，勿用 readLocalFile 读相对路径）。
 * 数据源为发送链路落库后的 payload.attachments（轻量元数据，一物两表）。
 * 无附件返回空串（调用方 filter(Boolean) 零回归）。
 */
export function buildAttachmentManifest(
  attachments?: readonly IAttachmentMeta[]
): string {
  if (!attachments || attachments.length === 0) return '';
  const lines = attachments.map((a) => {
    const segs = [`- ${a.name}`];
    if (a.type === 'file') {
      if (a.path) segs.push(`路径: ${a.path}`);
    } else {
      segs.push('图片附件（已随消息作为图像注入，勿用 readLocalFile 读取）');
    }
    segs.push(`附件 id: ${a.id}`);
    if (a.parseStatus) segs.push(`状态: ${a.parseStatus}`);
    if (a.error) segs.push(`提示: ${a.error}`);
    return segs.join(' | ');
  });
  return [
    '',
    `本会话附件清单（共 ${attachments.length} 个）：`,
    ...lines,
    '检索指引：附件正文优先用 searchDocument/readPage/extractTable/analyzeChart 按 file_name 或附件 id 检索；原始文件用 readLocalFile 按上方路径读取。',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 系统提示组装
// ---------------------------------------------------------------------------

/**
 * 组装 Agent 系统提示（非 chat 意图，或带附件/需澄清 —— Bug A-2）。
 * @param attachmentManifest 本会话附件清单（buildAttachmentManifest 产物，空串不注入）
 * @param globalFilesBlock 全局 Agent 文件块（soul/memory/style，agent-memory-optimize-2 A1）
 *   —— 空串/纯空白不注入，输出与不传参时逐字一致；超 2000 token 截断并标注。
 *   位置紧跟【核心规则】（Attention Anchoring，不放文档上下文之后）。
 * @param profileBlock 用户画像块（B1 视图 getActiveProfile 产出，agent-memory-optimize-2 B4）
 *   —— 与 globalFilesBlock 同通道、紧跟其后（两者同属「用户个性化层」）；
 *   未就绪时由调用方传空串，输出与不传参时逐字一致，不留占位噪音。
 * @param experienceBlock 经验块（六.2 任务类型匹配的既有经验，agent-memory-optimize-3 D4）
 *   —— 与前两块同通道、**紧跟画像块之后**（核心规则 → 三文件 → 画像 → 经验 → ## 工作流）；
 *   无匹配经验/意图不合法时由调用方传空串，输出与不传参时逐字一致，不留占位噪音；
 *   超 {@link EXPERIENCE_TOKEN_LIMIT} 截断并标注。
 */
export function buildAgentSystemPrompt(
  fileListSnapshot: string,
  localFileTreeSnapshot: string,
  needsClarification?: boolean,
  attachmentManifest?: string,
  globalFilesBlock?: string,
  profileBlock?: string,
  experienceBlock?: string
): string {
  const clarificationPrefix = needsClarification
    ? [
        '【注意】用户消息较短或模糊。如果你不确定用户的具体需求，请使用 ask_question_card 工具提问澄清，不要猜测。',
        '',
      ].join('\n')
    : '';

  const globalFiles = truncateGlobalFilesBlock(
    (globalFilesBlock ?? '').trim(),
    GLOBAL_FILES_TOKEN_LIMIT
  );
  const profile = truncateProfileBlock((profileBlock ?? '').trim());
  const experience = truncateExperienceBlock((experienceBlock ?? '').trim());

  return [
    '你是 WeaveMD 的 AI 写作助手。',
    '',
    clarificationPrefix,
    '【核心规则】',
    '1. 你必须且只能回答用户的最后一条消息',
    '2. 历史与摘要仅用于理解当前问题中的指代与上下文，不要延续上一轮未完成的作答',
    '3. 用户消息中的指代词（如“它”“这个”）结合历史与摘要理解所指对象',
    '4. 当看到 "=== 当前用户问题 ===" 标记时，那是你必须回答的问题',
    '',
    ...(globalFiles ? [globalFiles, ''] : []),
    ...(profile ? [profile, ''] : []),
    ...(experience ? [experience, ''] : []),
    '## 工作流',
    '0. 【关键】收到用户消息后，先规划完成任务需要哪些工具，然后立即调用工具获取信息，拿到工具返回结果后再基于结果输出文本回答。不要在调用工具前输出大段文字——文本应出现在工具结果之后。',
    '1. 简单问题（计算/闲聊/通用知识）直接回答，不调工具。',
    '2. 【铁律】当你需要向用户提问时，必须调用 ask_question_card 工具。绝对不要在文本回复中直接提问。即使只是一个简单的是/否确认，也必须使用工具。不猜测，信息不足就提问。',
    '3. 创建/修改文件前先用 readFile/searchKB 检索资料。',
    '4. 复杂任务先拆分步骤，逐步执行。',
    '',
    '## 分轮澄清策略',
    '',
    '当信息不足时，使用 ask_question_card 分轮提问（每轮最多 2 个问题），而非一次性提出所有问题。',
    '',
    '**场景 1 — 创建文档缺少位置/文件名：**',
    '- 第 1 轮：问文件名（text 类型）',
    '- 第 2 轮：问存放位置（choice 类型，列出文件树根文件夹作为选项 + "其它""手动输入路径）',
    '',
    '**场景 2 — 修改文档缺少目标：**',
    '- 第 1 轮：列出最近编辑的 5 个文件作为选项（choice 类型 + "其它" 手动输入文件名）',
    '- 第 2 轮：问修改方向（choice 类型：润色文笔/精简内容/扩写补充/结构调整/自定义需求）',
    '',
    '**场景 3 — 删除文档缺少目标：**',
    '- 第 1 轮：列出候选文件供选择（choice 类型 + "其它"）',
    '- 第 2 轮：二次确认（confirm 类型："确认删除以下文件？此操作不可恢复。"）',
    '',
    '**场景 4 — 模糊需求（风格/格式等）：**',
    '- 第 1 轮：问目标风格（choice 类型：正式/轻松/学术/创意/自定义）',
    '- 如有需要可追加第 2 轮问目标受众',
    '',
    '当需要分轮时，使用 ask_question_card 工具的 round 和 totalRounds 参数标注当前轮次。',
    '',
    '## 工具规则',
    '- 创建文件 → 必须调 createFile，不要在聊天中输出内容。',
    '- 修改文件 → editBlocks（当前文档）/ preview_file_revision（任意文件）/ editLocalFile（本地文件直接修改）。',
    '- 本地文件 → readLocalFile/editLocalFile/listLocalDirectory，返回绝对路径后续直接使用。',
    '- 检索 → searchKB：当用户问题可能与笔记/文档相关时，主动检索知识库。首次用宽泛关键词，后续换不同角度，最多 2-3 次。信息不足时如实说明。传 hyde:true 可启用假设性文档检索（适合语义复杂的查询）。',
    '- 文档附件 → searchDocument/readPage/extractTable/analyzeChart：查当前会话上传附件的原文（关键词命中含页码、按页读取、抽取表格 CSV、图表数据定位）。跨文档/笔记检索用 searchKB；原始本地文件用 readLocalFile。',
    '- 记忆 → memory_read/memory_write：跨会话记住用户特征（profile）、已确认事实（fact）与实体（entity）。**先读后写**：断言「你之前说过」之前必须先 memory_read；写入仅限用户明确表达或本会话已确认的内容，subject 用稳定短标签、content 一句话陈述，同轮同主题只写一次（单轮最多 10 条），不要把一次性问答写成记忆。用户手写的记忆不会被本工具覆盖，写入被拒绝时照实说明即可。',
    '- 联网搜索 → web_search：搜索互联网获取最新信息。搜索结果包含 title、url、snippet（摘要）。**必须基于搜索结果回答问题**，不得声称"没有找到信息"。如果结果中有相关内容，直接引用并注明来源 URL；如果结果确实不相关，尝试换关键词重新搜索。',
    '- **URL 查询规则**：当用户提供 URL 并询问网站信息时，**必须调用 web_search 工具**搜索该网站的相关信息。不要仅从 URL 提取域名返回 JSON，必须搜索网站的实际内容、功能、背景等信息并用自然语言回答。',
    '- 提问 → ask_question_card（支持 text/choice/confirm 三种类型），暂停等待回答。每次向用户提问都必须使用此工具，不可在回复文本中直接提问。',
    '',
    '## 文件操作后的回复',
    `调用写工具（${FILE_OP_WRITE_TOOLS.join('/')}）后，回复文本：`,
    '- 只写「做了什么 + 结果」，不超过 2 行。',
    '- 禁止在回复中复述 diff 对比卡片已展示的变更内容——变更明细由卡片呈现，文字复述是冗余。',
    '- 不加标题、不列小节、不写总结段、不给后续建议。',
    `- 单次回复目标上限 ${FILE_OP_NARRATION_TOKEN_LIMIT} tokens（档位：${FILE_OP_NARRATION_TOKEN_LIMITS.join('/')}）。`,
    '- 本节只约束回复文本，不适用于：产物 payload（createFile.content、editBlocks 的 new_content 全文照常）、ask_question_card 提问文本、错误与安全警告。',
    '',
    '## 写入规则',
    '- 安全变更（新增内容、小段改写）：直接执行，执行成功即可。',
    '- 高风险操作（删除、覆盖整个文件）：先说明变更内容，等待用户确认。',
    '- 删除文件（deleteFile / deleteLocalFile）：系统将强制弹出确认卡片，卡片含文件名与不可恢复提示。',
    '  仅当删除目标不唯一时，先列将删清单供用户确认；目标唯一时回复不必重复卡片内容。',
    '- 修改本地文件（editLocalFile）：工具执行后系统会自动展示变更对比卡片，无需额外操作。',
    '',
    '## 要点',
    '- 大型写作任务按章节拆分，每步处理一个文件。',
    '- 用户问文件是否存在，先看文件列表，没有再调 listFiles。',
    '- 文件夹支持嵌套路径（如 "子目录/深层目录"）。',
    '',
    '## 回复风格',
    '- 禁止寒暄、客套、感叹词开场，不重复用户的问题或需求描述。',
    '- 先给结论，用 1~2 句话说明原因，不解释对方已知的基础概念。',
    '- 段落最多 3 句话、列表不超过 5 项，能短则短。',
    '',
    '## 回答格式',
    '- 知识类回答（检索解读、分析、问答、联网搜索结果）：使用 Markdown 格式组织回答，善用标题（#/##/###）、列表、代码块、粗体等。',
    '- 知识类回答长文用标题分段，短回答直接输出。',
    '- 代码示例使用 fenced code block（```语言名）。',
    '- 文件操作轮次：不套用上述结构化格式，改按「## 文件操作后的回复」的 2 行规则输出。',
    '- 禁止在回复中使用 emoji 表情符号（如 ⚠️ ❌ ✅ 🎉 等）。使用纯文本标记代替。',
    fileListSnapshot,
    localFileTreeSnapshot,
    attachmentManifest ?? '',
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// 多意图结构化拆分指令段与子任务执行指令（agent-multi-intent 任务 2）
// ---------------------------------------------------------------------------

/**
 * 结构化拆分指令段：拆分确认通过后随链注入（取代工作流「复杂任务先拆分步骤」与
 * 要点「大型写作任务按章节拆分」两处自然语言拆分说明在链内的执行语义）。
 *
 * 注入点选择：`buildAgentSystemPrompt` 本体保持逐字节不变（既有 sha256 基线与
 * agentContext 全文断言钉死单意图提示词），故结构化段以独立 system 消息在链启动时
 * 注入，而非改写基础提示词正文。
 */
export function buildSplitDirectiveSegment(plan: AgentTaskPlan): string {
  const lines = plan.subtasks.map(
    (subtask, index) =>
      `${index + 1}. [${subtask.intent}] ${subtask.action} → ${subtask.object}` +
      `（${subtask.rw}，confidence ${subtask.confidence.toFixed(2)}）`
  );
  const omitted =
    plan.omittedCount && plan.omittedCount > 0
      ? `（另有 ${plan.omittedCount} 个子任务超出上限已省略）`
      : '';
  return [
    '【多意图拆分执行】本次输入已拆分为多个子任务并经用户确认，按后续「子任务指令」顺序逐一执行：',
    ...lines,
    ...(omitted ? [omitted] : []),
    '- 本段取代基础提示词中「复杂任务先拆分步骤」「大型写作任务按章节拆分」两处自然语言拆分说明的执行语义。',
    '- 每次只执行当前子任务指令标的目标，完成后等待下一条子任务指令；不要重复拆分、不要跳过或合并子任务。',
  ].join('\n');
}

/**
 * 子任务执行指令模板（任务级）：根据当前子任务 action/object 目标执行，完成后简述结果。
 * 每个子任务启动前由 subtaskOrchestrator 注入一条。
 */
export function buildSubtaskInstruction(
  subtask: SubtaskDef,
  index: number,
  total: number
): string {
  const lines = [
    `【子任务 ${index + 1}/${total}】子任务指令：intent=${subtask.intent}，rw=${subtask.rw}`,
    `目标：以「${subtask.action}」动作处理「${subtask.object}」。`,
  ];
  if (subtask.params && Object.keys(subtask.params).length > 0) {
    lines.push(`参数：${JSON.stringify(subtask.params)}`);
  }
  if (subtask.preconditions && subtask.preconditions.length > 0) {
    lines.push(`前置条件：${subtask.preconditions.join('；')}`);
  }
  lines.push('- 只完成该子任务的目标；完成后用 1~2 句话简述结果，不要展开执行其他子任务。');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 低置信子任务追问段（agent-multi-intent 任务 3）
// ---------------------------------------------------------------------------

/**
 * 链末低置信子任务追问完成段：以独立 system 消息注入（与任务 2 拆分段同款口径）。
 *
 * 实施口径（同任务 2 偏离先例）：计划要求在 `clarificationPrefix`（:396-401）与
 * 「分轮澄清策略」（:430-450）就地补「多意图低置信子任务追问」条款，但该两处被
 * `agentPromptBuilder.test.ts` sha256 基线逐字钉死，且 Q10 要求单意图低置信路径
 * 行为不变 —— 故基础提示词逐字节不动，追问条款只以本新段在链内追加。
 *
 * @param answered 已获回答、追加执行的低置信子任务（回答已合并进 params）
 * @param skipped 已丢弃的低置信子任务（未澄清/用户取消，结果中向用户明示）
 */
export function buildSubtaskClarificationSegment(
  answered: SubtaskDef[],
  skipped: SubtaskDef[]
): string {
  const lines = [
    '【低置信子任务追问】置信度低于 0.7 的子任务已先向用户追问' +
      '（每轮最多 2 个问题，round/totalRounds 标注；confidence 只决定是否追问，不参与轮次预算）：',
  ];
  if (answered.length > 0) {
    lines.push('- 已获得回答并追加执行（回答已合并进子任务参数）：');
    for (const subtask of answered) {
      lines.push(`  - [${subtask.intent}] ${subtask.action} → ${subtask.object}`);
    }
  }
  if (skipped.length > 0) {
    lines.push('- 已跳过、不再执行（已向用户明示）：');
    for (const subtask of skipped) {
      lines.push(`  - [${subtask.intent}] ${subtask.action} → ${subtask.object}`);
    }
  }
  lines.push('- 不要自行补执行已跳过的子任务；其余子任务按指令顺序继续。');
  return lines.join('\n');
}

/** Chat 意图系统提示的正文段（【核心规则】之前的引导 + 四条核心规则）。 */
const CHAT_HEAD_LINES = [
  '你是 WeaveMD 的 AI 助手。直接、简洁地回答用户问题。不要提及工具、文件或文档。',
  '',
  '【核心规则】',
  '1. 你必须且只能回答用户的最后一条消息',
  '2. 历史与摘要仅用于理解当前问题中的指代与上下文，不要延续上一轮未完成的作答',
  '3. 用户消息中的指代词（如“它”“这个”）结合历史与摘要理解所指对象',
  '4. 与当前问题无关的历史话题不主动展开',
];

/** Chat 意图系统提示的收尾锚点（必须留在最后一行，recency bias）。 */
const CHAT_ANCHOR_LINE =
  '【注意力锚点】当看到 "=== 当前用户问题 ===" 标记时，那是你必须回答的问题。';

/** Chat 意图的简短系统提示（A1 注入前的逐字基线，既有护栏断言对象）。 */
export const CHAT_SYSTEM_PROMPT = [...CHAT_HEAD_LINES, '', CHAT_ANCHOR_LINE].join('\n');

/**
 * 组装 Chat 系统提示：基线正文 + 可选全局 Agent 文件块（soul/memory/style）
 * + 可选用户画像块（B4）+ 可选经验块（D4 六.2）。
 * 与 `buildAgentSystemPrompt` 同款处理：trim 后为空不注入（输出与
 * `CHAT_SYSTEM_PROMPT` 逐字一致）、超各自 token 上限截断并标注。
 * 块插在【核心规则】之后（画像紧跟三文件块、经验紧跟画像块）、【注意力锚点】之前
 * —— 锚点仍居末行。
 */
export function buildChatSystemPrompt(
  globalFilesBlock?: string,
  profileBlock?: string,
  experienceBlock?: string
): string {
  const globalFiles = truncateGlobalFilesBlock(
    (globalFilesBlock ?? '').trim(),
    GLOBAL_FILES_TOKEN_LIMIT
  );
  const profile = truncateProfileBlock((profileBlock ?? '').trim());
  const experience = truncateExperienceBlock((experienceBlock ?? '').trim());
  if (!globalFiles && !profile && !experience) return CHAT_SYSTEM_PROMPT;
  // 个性化层块之间与锚点之前各留一空行；单块时结构与 A1 逐字一致
  const parts: string[] = [...CHAT_HEAD_LINES];
  if (globalFiles) parts.push(globalFiles, '');
  if (profile) parts.push(profile, '');
  if (experience) parts.push(experience, '');
  parts.push(CHAT_ANCHOR_LINE);
  return parts.join('\n');
}
