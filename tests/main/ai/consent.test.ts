import { describe, expect, it, vi } from 'vitest';
import { needsConsent } from '@shared/ai';
import type { IAIConfig, IAIConsent, IKbSearchResult } from '@shared/ai';

// --- 顶层依赖隔离（kbSearch 链 db/index → electron；与 kbSearch.test 同惯例） ---
vi.mock('better-sqlite3', () => ({ default: class FakeDatabase {} }));
vi.mock('@main/db/index', () => ({ getDatabase: () => null }));
vi.mock('@main/db/embeddingConfig', () => ({ getEmbeddingConfig: () => null }));
const attachMock = vi.hoisted(() => ({
  getParsedAttachment: vi.fn(() => null),
  removeParsedAttachmentsByConversation: vi.fn(() => 0),
  removeParsedAttachment: vi.fn(() => false),
}));
vi.mock('@main/db/attachments', () => attachMock);

import { needsKbSendConsent } from '@main/ai/consent';
import { filterKbEgressResults } from '@main/ai/knowledge/kbSearch';
import { toolsForIntent } from '@main/ai/agent/agentToolSelector';

function makeConfig(): IAIConfig {
  return {
    backend: 'remote',
    remoteBaseUrl: 'https://api.deepseek.com',
    model: '',
    hasApiKey: false,
  };
}

function makeConsent(allowNetwork: boolean, allowSend: boolean): IAIConsent {
  return { allowNetwork, allowSend, consentUpdatedAt: null };
}

/** 极简 KB 检索命中（矩阵测试只消费 docId，其余字段按类型补齐）。 */
function hit(docId: string): IKbSearchResult {
  return {
    docId,
    chunkId: `c-${docId}`,
    fileName: docId,
    content: 'content',
    seq: 0,
    score: 1,
    pinned: false,
    sourceRef: null,
  };
}

/** 外发结果信封（filterKbEgressResults 消费的最小结构）。 */
function envelope(results: IKbSearchResult[], best?: IKbSearchResult) {
  return {
    refused: false,
    threshold: 0.6,
    best: best ?? results[0] ?? null,
    results,
  };
}

describe('needsConsent（联网闸已停用，恒 false）', () => {
  it('未授权联网 -> false（三配置齐全即视为联网许可）', () => {
    expect(needsConsent(makeConsent(false, false))).toBe(false);
    expect(needsConsent(makeConsent(true, false))).toBe(false);
  });

  it('已授权联网 -> false', () => {
    expect(needsConsent(makeConsent(true, true))).toBe(false);
    expect(needsConsent(makeConsent(false, true))).toBe(false);
  });

  it('consent 为 null -> false（联网闸不拦截；笔记外发由 needsKbSendConsent 单独把关）', () => {
    expect(needsConsent(null)).toBe(false);
  });
});

describe('needsKbSendConsent', () => {
  it('未授权外发 -> true（KB 外发需单独同意）', () => {
    expect(needsKbSendConsent(makeConfig(), makeConsent(true, false))).toBe(true);
    expect(needsKbSendConsent(makeConfig(), makeConsent(false, false))).toBe(true);
  });

  it('已授权外发 -> false', () => {
    expect(needsKbSendConsent(makeConfig(), makeConsent(true, true))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B11 八-1②：外发结果过滤矩阵（allowSend × 勾选授权 × source_type）
//
// Q1 取舍（入 KB + 过滤）：附件照常入 KB（本地检索价值）；allowSend=false 时
// 外发结果只放行「勾选授权的附件文档」（consent_granted=1），
// 笔记（db/import）与未授权附件一律滤除——不追溯放宽其他笔记。
// ---------------------------------------------------------------------------
describe('filterKbEgressResults — 外发结果过滤矩阵（B11 八-1②）', () => {
  const note = hit('doc-note'); // 笔记（source_type db/import）
  const grantedAtt = hit('doc-att-granted'); // 勾选授权附件
  const ungrantedAtt = hit('doc-att-ungranted'); // 未授权附件
  const grantedIds = new Set(['doc-att-granted']);

  it('allowSend=true → 全量原样（笔记/授权附件/未授权附件均保留，不过滤）', () => {
    const input = envelope([note, grantedAtt, ungrantedAtt]);
    const out = filterKbEgressResults(input, true, grantedIds);
    expect(out.results.map((r) => r.docId)).toEqual([
      'doc-note',
      'doc-att-granted',
      'doc-att-ungranted',
    ]);
    expect(out.best).toBe(note);
  });

  it('allowSend=false → 仅保留勾选授权附件（笔记滤除、未授权附件滤除）', () => {
    const input = envelope([note, grantedAtt, ungrantedAtt]);
    const out = filterKbEgressResults(input, false, grantedIds);
    expect(out.results.map((r) => r.docId)).toEqual(['doc-att-granted']);
  });

  it('allowSend=false 且无任何勾选授权 → 结果全空（现状语义：笔记绝不外发）', () => {
    const input = envelope([note, ungrantedAtt]);
    const out = filterKbEgressResults(input, false, new Set());
    expect(out.results).toEqual([]);
    expect(out.best).toBeNull();
  });

  it('best 被滤除时置 null（不残留未授权内容引用）', () => {
    const input = envelope([note, grantedAtt], note);
    const out = filterKbEgressResults(input, false, grantedIds);
    expect(out.best?.docId).toBe('doc-att-granted');
    expect(out.results).toHaveLength(1);
  });

  it('空结果信封不抛错（refused/threshold 原样透传）', () => {
    const input = { refused: true, threshold: 0.6, best: null, results: [] as IKbSearchResult[] };
    const out = filterKbEgressResults(input, false, grantedIds);
    expect(out.refused).toBe(true);
    expect(out.results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B11 八-1②：searchKB 工具注入矩阵（与 agentContext 既有语义交互的测试锁定）
// - allowSend=false 且无勾选授权附件 → searchKB 整体不注入（现状保持）
// - allowSend=false 且存在勾选授权附件 → 注入（结果由过滤层收敛到授权附件）
// ---------------------------------------------------------------------------
describe('toolsForIntent — searchKB 注入矩阵（B11 八-1②）', () => {
  const kbQa = { intent: 'kbQa' as const, confidence: 0.9 };

  function names(useKB: boolean, egress: boolean, granted: boolean): string[] {
    return toolsForIntent(kbQa, useKB, egress, undefined, false, false, granted).map(
      (t) => t.function.name
    );
  }

  it('kbEgressAuthorized=false 且无勾选授权 → 不注入 searchKB（现状锁定）', () => {
    expect(names(true, false, false)).not.toContain('searchKB');
  });

  it('kbEgressAuthorized=false 且有勾选授权附件 → 注入 searchKB（该文档显式授权）', () => {
    expect(names(true, false, true)).toContain('searchKB');
  });

  it('kbEgressAuthorized=true → 注入 searchKB（既有行为不回归）', () => {
    expect(names(true, true, false)).toContain('searchKB');
  });

  it('未启用知识库时勾选授权不注入（useKnowledgeBase 前置不放宽）', () => {
    expect(names(false, false, true)).not.toContain('searchKB');
  });
});

// ---------------------------------------------------------------------------
// B11 硬规则：不新增任何放宽 allowSend 语义的代码路径（断言锁定）
// ---------------------------------------------------------------------------
describe('allowSend 语义无放宽路径（B11 硬规则断言）', () => {
  it('needsKbSendConsent 只由 allowSend 决定（勾选授权不影响全局外发闸判定）', () => {
    expect(needsKbSendConsent(makeConfig(), makeConsent(true, false))).toBe(true);
    expect(needsKbSendConsent(makeConfig(), makeConsent(false, false))).toBe(true);
    expect(needsKbSendConsent(makeConfig(), makeConsent(true, true))).toBe(false);
  });

  it('allowSend=false 时放行结果 ⊆ 勾选授权附件集合（白盒穷举）', () => {
    const notes = [hit('a'), hit('b'), hit('c')];
    const granted = new Set(['b']);
    const out = filterKbEgressResults(envelope(notes), false, granted);
    expect(out.results.map((r) => r.docId)).toEqual(['b']);
    for (const r of out.results) expect(granted.has(r.docId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R3：chat 意图不注入 searchKB（任意组合）+ 过滤矩阵补授权导入行
// ---------------------------------------------------------------------------
describe('toolsForIntent — chat 意图任意组合不注入 searchKB（R3）', () => {
  const chat = { intent: 'chat' as const, confidence: 0.9 };

  function names(useKB: boolean, egress: boolean, granted: boolean): string[] {
    return toolsForIntent(chat, useKB, egress, undefined, false, false, granted).map(
      (t) => t.function.name
    );
  }

  it('chat + KB 开 + allowSend + 勾选授权 → 不注入', () => {
    expect(names(true, true, true)).not.toContain('searchKB');
  });

  it('chat + KB 开 + 无授权 → 不注入', () => {
    expect(names(true, false, false)).not.toContain('searchKB');
  });

  it('chat + KB 关 + 勾选授权 → 不注入', () => {
    expect(names(false, false, true)).not.toContain('searchKB');
  });
});

describe('filterKbEgressResults — 授权导入行进白名单（R3 口径）', () => {
  const grantedImport = hit('doc-import-granted'); // 已授权导入行
  const note = hit('doc-note'); // db 笔记
  const grantedIds = new Set(['doc-import-granted']);

  it('allowSend=false + granted 含导入 docId → 该行放行', () => {
    const out = filterKbEgressResults(envelope([grantedImport, note]), false, grantedIds);
    expect(out.results.map((r) => r.docId)).toEqual(['doc-import-granted']);
  });

  it('allowSend=false + 导入行未授权 → 滤除', () => {
    const out = filterKbEgressResults(envelope([grantedImport]), false, new Set());
    expect(out.results).toEqual([]);
    expect(out.best).toBeNull();
  });

  it('allowSend=true → 导入行原样（不过滤）', () => {
    const out = filterKbEgressResults(envelope([grantedImport, note]), true, grantedIds);
    expect(out.results.map((r) => r.docId)).toEqual(['doc-import-granted', 'doc-note']);
  });
});
