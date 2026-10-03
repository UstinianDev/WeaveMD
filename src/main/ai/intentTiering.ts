// ============================================
// WeaveMD — 三层意图路由分层（agent-multi-intent 任务 4 / Q20）
// ============================================
// L1 规则底线：classifyIntent 同步、零成本，降级永不低于规则。
// L2 tier2：仅规则低置信（confidence<0.7 || needsClarification）时经
//    lazy opts（调用方工厂，apiKeyEnc 非空才构造）调远程小模型 one-shot，
//    1.5s deadline 硬闸；超时/抛错/非法标签一律落回规则。
// L3 = 已建 runTaskSplit（大模型规划，本模块不涉及）。
// 三调用点（agentContext 主分类 / 技能推断 / kbSearch isFallthrough）经
// classifyIntentShared 共享 sha256(hasHistory|input) 短 TTL 缓存（10s / 200 条 LRU）；
// 缓存仅由 prefetchIntentTiered 在 tier2 成功时写入 —— 规则结果不入缓存，
// 保证既有测试的 classifyIntent 调用计数/参数断言零回归。

import { createHash } from 'crypto';
import type { IIntent, IntentName } from '@shared/ai';
// namespace 导入：vi.mock factory 可能缺导出（属性访问即抛），须在调用处
// try/catch fail-closed —— P0 gate 同款坑
import * as intentRouter from './intentRouter';
import * as llmClient from './llm/llmClient';

/** tier2 整体 deadline（连接 + 推理），Q20 裁定 1.5s。 */
const TIER2_TIMEOUT_MS = 1500;
/** 共享缓存 TTL：10s。 */
const CACHE_TTL_MS = 10_000;
/** 共享缓存容量上限，超出按 LRU 淘汰。 */
const CACHE_MAX_ENTRIES = 200;
/** 合法意图标签（tier2 输出必须 ∈ 此集合，否则回规则）。 */
const INTENT_LABELS: readonly IntentName[] = ['create', 'rewrite', 'kbQa', 'tech', 'web', 'chat'];
/** tier2 结果置信下限：永不低于规则（Q20）。 */
const TIER2_CONFIDENCE_FLOOR = 0.7;

const TIER2_SYSTEM_PROMPT =
  '你是意图分类器。根据用户输入输出唯一意图标签，' +
  `只能输出以下之一：${INTENT_LABELS.join('、')}。只输出标签本身，不要输出其他内容。`;

/** tier2 懒构造的 LLM 选项（仅触发 tier2 且 apiKeyEnc 非空时由调用方构造）。 */
export interface IntentTier2Options {
  baseUrl: string;
  model: string;
  apiKey: string;
  protocol?: string;
}

interface CacheEntry {
  value: IIntent;
  expiresAt: number;
}

const tierCache = new Map<string, CacheEntry>();

/**
 * 超过该长度的输入改用 sha256 作键（避免缓存持有长文本，见下）。
 * 取值依据：意图分类的实际输入是用户的一句话（数十至数百字），
 * 512 已远超典型长度，同时把缓存最坏持有量钉在 `200 × 512 字符 ≈ 200 KB`。
 */
const CACHE_KEY_INLINE_MAX_CHARS = 512;

/**
 * 缓存键：
 * - 短输入（≤ {@link CACHE_KEY_INLINE_MAX_CHARS}）：`{0|1}\0{长度}\0{原文}`
 * - 长输入：`{0|1}\0h\0{sha256 hex}`
 *
 * 性能（INT-2）：原实现**每次调用都做一次 sha256**（同步 CPU，走 Node crypto），
 * 而这里只是拿键去比 Map —— 输入通常是几十字的短句，哈希开销远超键本身的构造成本。
 *
 * **为什么长输入仍走哈希**：缓存以键本身作为 Map 的 key，`CACHE_MAX_ENTRIES = 200`
 * 意味着「键多长，缓存就持有多少文本」。原文直接作键会让 200 条缓存长驻
 * `200 × 输入长度` 的文本（用户粘贴长文时可观）；sha256 定长 64 字符，把上界钉死
 * 在 `200 × 512 ≈ 200 KB` 量级。
 *
 * **单射性（关键）**：第 2 个字段在短路径是**十进制长度**、在长路径是字面量 `h`，
 * 两者字符集不相交 → 两条键空间不可能撞键。仅靠「加个 `#` 前缀」是不够的：
 * 短路径逐字复制原文，若原文本身以 `#`+hex 开头就会伪造出长路径的键。
 * 短路径内部也不会自撞：长度由原文唯一决定，`\0` 位置固定，键可唯一解码。
 */
function cacheKey(input: string, hasHistory: boolean): string {
  const prefix = hasHistory ? '1' : '0';
  if (input.length <= CACHE_KEY_INLINE_MAX_CHARS) {
    return `${prefix}\u0000${input.length}\u0000${input}`;
  }
  return `${prefix}\u0000h\u0000${createHash('sha256').update(input).digest('hex')}`;
}

function cacheGet(key: string): IIntent | null {
  const entry = tierCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    tierCache.delete(key);
    return null;
  }
  // LRU 触达刷新：删除后重插到队尾
  tierCache.delete(key);
  tierCache.set(key, entry);
  return entry.value;
}

function cacheSet(key: string, value: IIntent): void {
  tierCache.delete(key);
  tierCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  while (tierCache.size > CACHE_MAX_ENTRIES) {
    const oldest = tierCache.keys().next().value;
    if (oldest === undefined) break;
    tierCache.delete(oldest);
  }
}

/** 规则基线（L1）：经 namespace 访问，mock 缺导出时抛给调用方 fail-closed。 */
function ruleClassify(input: string, hasHistory: boolean): IIntent {
  return intentRouter.classifyIntent(input, { hasHistory });
}

/**
 * 三调用点共享分类（同步）：读缓存命中即返回；miss 即规则重算。
 * 只读不写 —— 规则结果不入缓存（否则既有 classifyIntent 调用计数断言失真）。
 */
export function classifyIntentShared(input: string, hasHistory = false): IIntent {
  const text = (input ?? '').trim();
  const cached = cacheGet(cacheKey(text, hasHistory));
  if (cached) return cached;
  return ruleClassify(text, hasHistory);
}

/** 解析 tier2 输出为合法 IntentName；非法返回 null（回规则）。 */
function parseLabel(raw: string): IntentName | null {
  const cleaned = raw.trim().replace(/^["'`*]+|["'`*]+$/g, '').trim();
  if (!cleaned) return null;
  const exact = INTENT_LABELS.find((l) => l === cleaned);
  if (exact) return exact;
  const lower = cleaned.toLowerCase();
  return INTENT_LABELS.find((l) => l.toLowerCase() === lower) ?? null;
}

/**
 * tier2 one-shot 分类：1.5s deadline 包裹连接 + 推理。
 * 超时 / 抛错 / 非法标签 → null（调用方落回规则）。
 */
async function tier2Classify(input: string, opts: IntentTier2Options): Promise<IntentName | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), TIER2_TIMEOUT_MS);
  });
  try {
    const call = (async (): Promise<string> => {
      const gen = llmClient.streamChatCompletion({
        baseUrl: opts.baseUrl,
        model: opts.model,
        apiKey: opts.apiKey,
        messages: [
          { role: 'system', content: TIER2_SYSTEM_PROMPT },
          { role: 'user', content: input },
        ],
      });
      let out = '';
      for await (const chunk of gen) {
        if (typeof chunk.delta === 'string') out += chunk.delta;
      }
      return out;
    })();
    const result = await Promise.race([call, deadline]);
    if (result === null) return null;
    return parseLabel(result);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function querySummary(input: string): string {
  return input.length > 24 ? `${input.slice(0, 24)}…` : input;
}

/**
 * tier2 预取（异步）：写共享缓存供三调用点命中。
 * - 高置信规则输入：零 LLM、零缓存写入（规则高置信零新增调用口径）；
 * - 仅 `confidence < 0.7 || needsClarification` 且非空输入才调 tier2；
 * - lazy opts 工厂仅在触发 tier2 后调用（apiKeyEnc 非空才构造，抛错 fail-closed）；
 * - 仅 openai 协议走 tier2（anthropic / 协议缺省回规则 —— tier2 是
 *   OpenAI 兼容 one-shot，生产 toIAIConfig 恒归一化协议，缺省仅测试环境）；
 * - tier2 成功按 keys（缺省 true/false 双键；显式 hasHistory 则单键）写缓存；
 * - 整体 try/catch fail-closed：任何异常不写缓存、落回规则。
 *
 * @param input 用户输入（内部 trim，与 prepareAgentContext 口径一致）
 * @param getLlmOpts lazy 工厂：仅 tier2 触发后调用一次
 * @param hasHistory 省略 = 双键写入（agentLoop 预取时未知 history）；
 *                   显式传值 = 只写该键（键隔离测试/定向预取）
 */
export async function prefetchIntentTiered(
  input: string,
  getLlmOpts?: () => IntentTier2Options | null,
  hasHistory?: boolean
): Promise<void> {
  try {
    const text = (input ?? '').trim();
    if (!text) return;
    const keys = hasHistory === undefined ? [false, true] : [hasHistory];
    if (keys.every((k) => cacheGet(cacheKey(text, k)) !== null)) return;

    // 触发判定用缺省口径（hasHistory=false 是 needsClarification 的超集）
    const rule = ruleClassify(text, hasHistory ?? false);
    const ruleSummary = `${rule.intent}@${rule.confidence.toFixed(2)}`;
    const needsTier2 = rule.confidence < 0.7 || rule.needsClarification === true;
    if (!needsTier2) {
      console.warn(`[intentTier] q="${querySummary(text)}" rule=${ruleSummary} tier2=skip(high-conf)`);
      return;
    }
    if (!getLlmOpts) return;
    const opts = getLlmOpts();
    if (!opts || !opts.apiKey || !opts.baseUrl || !opts.model || opts.protocol !== 'openai') {
      console.warn(`[intentTier] q="${querySummary(text)}" rule=${ruleSummary} tier2=skip(no-opts)`);
      return;
    }

    const label = await tier2Classify(text, opts);
    if (!label) {
      console.warn(`[intentTier] q="${querySummary(text)}" rule=${ruleSummary} tier2=fallback(rule)`);
      return;
    }
    const value: IIntent = {
      intent: label,
      confidence: Math.max(rule.confidence, TIER2_CONFIDENCE_FLOOR),
      reason: `tier2:${label}`,
    };
    for (const k of keys) cacheSet(cacheKey(text, k), value);
    console.warn(`[intentTier] q="${querySummary(text)}" rule=${ruleSummary} tier2=${label}`);
  } catch (err) {
    // fail-closed：预取失败不影响主流程，shared 未命中缓存即回规则
    console.warn(
      '[intentTier] prefetch failed, falling back to rules:',
      err instanceof Error ? err.message : String(err)
    );
  }
}

/** 测试专用：清空 tier2 共享缓存。 */
export function __resetIntentTierCacheForTest(): void {
  tierCache.clear();
}

/**
 * 测试专用：暴露缓存键构造函数，用于断言「短路径与长路径键空间不相交」这一
 * 单射性不变式（键撞了会把不同输入的错误分类结果喂给用户，属正确性问题）。
 */
export function __cacheKeyForTest(input: string, hasHistory = false): string {
  return cacheKey(input, hasHistory);
}
