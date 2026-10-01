// ============================================
// WeaveMD — agent-multi-intent 任务 11：风险分档确认矩阵（confirmTierFor）
// ============================================
// 计划 §1.6 / §4.2 任务 11：
//   1) intent（6）× WRITE_TOOLS（7）全组合 42 例：delete* → force、其余 5 → batch；
//   2) 只读样例 + 已登记非写工具（memory_write / ask_question_card 等现口径）→ none；
//   3) fail-closed：未知 intent → batch、未登记工具名 → batch（向确认方向兜底，
//      禁止向放行方向兜底；删除类即使 intent 未知仍恒 force —— 只强不弱）；
//   4) confirmSkipSet 派生：非链 = force 集合（= 现 FORCE_CONFIRM_TOOLS 行为等价）；
//      链态 = force ∪ batch。
// mock 基座：仅 @main/ai/toolRegistry（agentToolSelector 依赖其 defineCoreTools /
// buildToolListForPrompt；mock 后 confirmMatrix 保持纯函数直测，不触 db/electron）。

import { describe, expect, it, vi } from 'vitest';

vi.mock('@main/ai/toolRegistry', () => ({
  defineCoreTools: vi.fn(() => []),
  buildToolListForPrompt: vi.fn((tools: unknown[]) => tools),
}));

import { confirmSkipSet, confirmTierFor, writeToolsByTier } from '@main/ai/agent/confirmMatrix';
import { FORCE_CONFIRM_TOOLS, WRITE_TOOLS } from '@main/ai/agent/agentToolSelector';
import type { IntentName } from '@shared/ai';

const INTENTS: IntentName[] = ['create', 'rewrite', 'kbQa', 'tech', 'web', 'chat'];
const WRITE_TOOL_NAMES = [
  'createFile', 'createFolder', 'renameFile', 'moveFile',
  'deleteFile', 'editLocalFile', 'deleteLocalFile',
];
const FORCE_NAMES = ['deleteFile', 'deleteLocalFile'];
/** 只读样例（READ_ONLY_TOOLS 抽样，覆盖本地文件 / KB / 联网 / 附件四类）。 */
const READ_SAMPLES = ['listFiles', 'readFile', 'searchKB', 'readLocalFile', 'web_search', 'searchDocument'];
/** 已登记非写但也不在 READ_ONLY_TOOLS 的工具（现口径 none，memory_write 不进强制档）。 */
const KNOWN_NON_WRITE_SAMPLES = ['ask_question_card', 'memory_write', 'runSkill', 'preview_file_revision'];

describe('confirmTierFor — intent × WRITE_TOOLS 全组合 42 例', () => {
  it('矩阵源常量与 WRITE_TOOLS / FORCE_CONFIRM_TOOLS 同步（7 项 / 2 项）', () => {
    expect([...WRITE_TOOLS].sort()).toEqual([...WRITE_TOOL_NAMES].sort());
    expect([...FORCE_CONFIRM_TOOLS].sort()).toEqual([...FORCE_NAMES].sort());
  });

  for (const intent of INTENTS) {
    for (const tool of WRITE_TOOL_NAMES) {
      const expected = FORCE_NAMES.includes(tool) ? 'force' : 'batch';
      it(`${intent} × ${tool} → ${expected}`, () => {
        expect(confirmTierFor(intent, tool)).toBe(expected);
        // 铁律一：写工具对任何 intent 都不省略确认
        expect(confirmTierFor(intent, tool)).not.toBe('none');
      });
    }
  }
});

describe('confirmTierFor — 只读与已登记非写工具 → none', () => {
  for (const intent of INTENTS) {
    for (const tool of READ_SAMPLES) {
      it(`${intent} × ${tool} → none`, () => {
        expect(confirmTierFor(intent, tool)).toBe('none');
      });
    }
  }

  for (const tool of KNOWN_NON_WRITE_SAMPLES) {
    it(`chat × ${tool} → none（现口径：不进确认拦截）`, () => {
      expect(confirmTierFor('chat', tool)).toBe('none');
    });
  }
});

describe('confirmTierFor — fail-closed（向确认方向兜底）', () => {
  it('未知 intent × 只读工具 → batch（不向放行方向兜底）', () => {
    expect(confirmTierFor('unknown_intent' as IntentName, 'searchKB')).toBe('batch');
  });

  it('未知 intent × 写工具 → batch（绝不 none，也绝不 force 之外的放行）', () => {
    expect(confirmTierFor('unknown_intent' as IntentName, 'createFile')).toBe('batch');
    expect(confirmTierFor('unknown_intent' as IntentName, 'editLocalFile')).toBe('batch');
  });

  it('未知 intent × 删除工具 → 仍 force（拦截强度只强不弱）', () => {
    expect(confirmTierFor('unknown_intent' as IntentName, 'deleteFile')).toBe('force');
    expect(confirmTierFor('unknown_intent' as IntentName, 'deleteLocalFile')).toBe('force');
  });

  it('合法 intent × 未登记工具名 → batch', () => {
    expect(confirmTierFor('create', 'some_unregistered_tool')).toBe('batch');
    expect(confirmTierFor('chat', '')).toBe('batch');
  });
});

describe('writeToolsByTier — 写工具按档拆分（提示词一致性数据源）', () => {
  it('force ∪ batch 与 WRITE_TOOLS 完全一致且不相交', () => {
    const { force, batch } = writeToolsByTier();
    expect(new Set([...force, ...batch])).toEqual(new Set(WRITE_TOOLS));
    expect(force.some((t) => batch.includes(t))).toBe(false);
    expect(force.sort()).toEqual([...FORCE_NAMES].sort());
    expect(batch).toHaveLength(5);
  });
});

describe('confirmSkipSet — waitForAll skip-set 由矩阵派生', () => {
  it('非链态 = force 集合（与现 FORCE_CONFIRM_TOOLS 行为等价）', () => {
    for (const intent of INTENTS) {
      expect([...confirmSkipSet(intent, false)].sort()).toEqual([...FORCE_CONFIRM_TOOLS].sort());
    }
  });

  it('链态 = force ∪ batch（全部 7 个写工具进 skip-set）', () => {
    for (const intent of INTENTS) {
      expect([...confirmSkipSet(intent, true)].sort()).toEqual([...WRITE_TOOL_NAMES].sort());
    }
  });

  it('skip-set 派生不放行任何写工具（每项档位均非 none）', () => {
    for (const tool of confirmSkipSet('create', true)) {
      expect(confirmTierFor('create', tool)).not.toBe('none');
    }
  });
});
