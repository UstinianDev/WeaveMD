// ============================================
// WeaveMD — AI 面板共享 Composer（三视图复用）
// ============================================
// 底部 composer：模式下拉（chat/agent）+ 模型下拉（ModelDropdown）+ textarea + 发送/停止 +
// CompletionMenu（`/` 技能、`@` 引用补全）。
// handleSendAgent 分流逻辑**从 AgentTab 原样移入**（选区改写 / `/技能` / `@文档` / `@知识库` /
// 整篇写 / 纯 agent），不改写协议。铁律：AI 无直接落盘——改写/整篇写走预览确认，agent 工具只读。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useEffect, useState } from 'react';
import type { AgentSkillInfo } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';
import { useEditorStore } from '@render/stores/editorStore';
import { useRewriteStore } from '@render/stores/rewriteStore';
import CompletionMenu, { type CompletionMenuItem } from './CompletionMenu';
import ModelDropdown from './ModelDropdown';

/** 引用前缀常量（B1 注入协议，与 handleSend 分流/意图消费对齐）。 */
const DOC_SCOPE_PREFIX = '@文档';
const KB_SCOPE_PREFIX = '@知识库';
/** `/技能名 ` 前缀剥除（runSkill 技能指令）。 */
const SLASH_SKILL_RE = /^\/[a-z_]+\s+/;

/**
 * A1c：整篇从 0 到 1 写文档的检测启发式。
 * 命中（含中英文「从头写整篇」意图）→ 走 runFullDocumentRewrite（document scope 整篇生成），
 * 未打开文档则给出引导（no-document），不产生空写。与 @ / 选区协议错开。
 */
const WRITE_WHOLE_DOC_RE =
  /从\s*0\s*到\s*1|从零|从头|整篇|全文|写一篇|写整篇|写一份|写个文档|write\s+(a\s+)?(full|entire|complete)|create\s+(a\s+)?document|write\s+a\s+doc/;

interface AIPanelComposerProps {
  /**
   * 受控草稿（M4）：草稿提升到 AIAgentPanel state，本组件为受控 textarea，
   * 视图切换（home/session/settings 互跳）不再卸载即丢草稿。
   */
  value: string;
  /** 受控变更：父级持有草稿，写在 onChange 里。 */
  onChange: (value: string) => void;
  /**
   * 发送调度成功后触发（由父级清空草稿 setDraft('')）。
   * home / session / 面板发送成功都走它清空。
   */
  onSend?: () => void;
  /**
   * 发送（user/agent 消息调度成功后）触发的回调（兼容原 onCompose）。
   * home 视图用它切到 session 视图（发送即自动建会话并入会话视图）。
   */
  onCompose?: () => void;
}

const AIPanelComposer: React.FC<AIPanelComposerProps> = ({ value, onChange, onSend, onCompose }) => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);

  const activeMode = useAgentStore((s) => s.activeMode);
  const toggleMode = useAgentStore((s) => s.toggleMode);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const sendAgentMessage = useAgentStore((s) => s.sendAgentMessage);
  const stopStream = useAgentStore((s) => s.stopStream);

  // 改写状态：选区改写模式（selectionContext 非空 → composer 输入改写指令）
  const selectionContext = useRewriteStore((s) => s.selectionContext);

  // —— 第 7 期 B1：/ 与 @ 自动补全（仅智能体模式可用） ——
  const [skills, setSkills] = useState<AgentSkillInfo[]>([]);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionTrigger, setCompletionTrigger] = useState<'/' | '@'>('/');
  const [completionItems, setCompletionItems] = useState<CompletionMenuItem[]>([]);
  const [completionActive, setCompletionActive] = useState(0);
  /** 触发补全时，前缀字符在 input 中的下标（选中后从此处替换 insertText）。 */
  const [completionInsertAt, setCompletionInsertAt] = useState(0);

  // 挂载时加载技能清单（B1 `/` 数据源；失败静默，仅技能补全不可用）。
  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const res = await window.weaveMD?.ai.listSkills(user?.id ?? '');
        if (res?.success && res.data) setSkills(res.data);
      } catch {
        /* 静默：listSkills 不可用仅影响 / 补全，不阻断其余功能 */
      }
    };
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 构建补全菜单项（`/` = 技能；`@` = 引用目标（当前文档 / 知识库））。 */
  const buildCompletionItems = (trigger: '/' | '@', query: string): CompletionMenuItem[] => {
    let items: CompletionMenuItem[];
    if (trigger === '/') {
      items = skills.map((s) => ({
        value: s.name,
        label: s.name,
        description: s.description,
        insertText: `/${s.name} `,
      }));
    } else {
      items = [
        {
          value: 'doc',
          label: t('ai.completion.currentDoc'),
          description: t('ai.completion.currentDocDesc'),
          insertText: `${DOC_SCOPE_PREFIX} `,
        },
        {
          value: 'kb',
          label: t('ai.completion.kbDoc'),
          description: t('ai.completion.kbDocDesc'),
          insertText: `${KB_SCOPE_PREFIX} `,
        },
      ];
    }
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((it) =>
      it.insertText.slice(1).toLowerCase().includes(q)
    );
  };

  /** 变更 input 时检测光标处 token 是否以 / 或 @ 开头，从而开/关补全菜单（仅 agent 模式）。 */
  const refreshCompletion = (value: string) => {
    if (activeMode !== 'agent') {
      setCompletionOpen(false);
      return;
    }
    const match = /(^|\s)([/@])([^\s/@]*)$/.exec(value);
    if (!match) {
      setCompletionOpen(false);
      return;
    }
    const trigger = match[2] as '/' | '@';
    const query = match[3] ?? '';
    const items = buildCompletionItems(trigger, query);
    if (items.length === 0) {
      setCompletionOpen(false);
      return;
    }
    setCompletionTrigger(trigger);
    setCompletionItems(items);
    setCompletionActive(0);
    setCompletionInsertAt(value.length - query.length - 1);
    setCompletionOpen(true);
  };

  const handleInputChange = (v: string) => {
    onChange(v);
    refreshCompletion(v);
  };

  const handleCompletionSelect = (item: CompletionMenuItem) => {
    // 用 insertText 替换从触发符到当前结尾的不完整 token（prefix 结尾带空格，避免误再开菜单）
    onChange(value.slice(0, completionInsertAt) + item.insertText);
    setCompletionOpen(false);
  };

  const handleCompletionMove = (dir: 1 | -1) => {
    setCompletionActive((prev) => {
      if (completionItems.length === 0) return prev;
      return (prev + dir + completionItems.length) % completionItems.length;
    });
  };

  // 技能就绪后重估当前 `/` 补全（避免首挂载空技能导致输入 `/` 时菜单未开）
  useEffect(() => {
    if (skills.length > 0) refreshCompletion(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills]);

  /** agent 模式发送分流（改写 / 技能 / 引用 / 整篇写 / 纯 agent 对话）。逐字保留自 AgentTab。 */
  const handleSendAgent = (text: string) => {
    // 分流（第 7 期 B1：/ 与 @ 前缀优先于 WRITE_WHOLE_DOC_RE 启发式判断）：
    // 1) 有选区上下文（编辑器「AI 改写」触发）→ 选区改写
    // 2) `/技能名 ` → 剥前缀后指令走 agent 对话（runSkill / tech 意图由 intentRouter + runSkill 工具消费）
    // 3) `@文档 `（B1 注入）→ document scope 块级改写
    // 4) `@知识库 `（B1 注入）→ kbQa 意图（sendAgentMessage，intentRouter 识别「知识库」关键词）
    // 5) `@ + 描述`（手写协议）→ document scope 块级改写
    // 6) 整篇写诉求（A1c）→ runFullDocumentRewrite
    // 7) 否则 → 既有 agent 对话
    if (selectionContext) {
      void useRewriteStore.getState().runSelectionRewrite(text);
      return;
    }
    if (SLASH_SKILL_RE.test(text)) {
      const instruction = text.replace(SLASH_SKILL_RE, '').trim();
      if (instruction) void sendAgentMessage(instruction);
      return;
    }
    if (text.startsWith(DOC_SCOPE_PREFIX)) {
      const instruction = text.replace(DOC_SCOPE_PREFIX, '').trim();
      if (instruction) {
        useRewriteStore.getState().startDocumentRewrite(
          useEditorStore.getState().content,
          instruction
        );
        return;
      }
    }
    if (text.startsWith(KB_SCOPE_PREFIX)) {
      const instruction = text.replace(KB_SCOPE_PREFIX, '').trim();
      if (instruction) void sendAgentMessage(instruction);
      return;
    }
    if (text.startsWith('@')) {
      const instruction = text.slice(1).trim();
      if (instruction) {
        useRewriteStore.getState().startDocumentRewrite(
          useEditorStore.getState().content,
          instruction
        );
        return;
      }
    }
    if (WRITE_WHOLE_DOC_RE.test(text)) {
      void useRewriteStore.getState().runFullDocumentRewrite(text);
      return;
    }
    void sendAgentMessage(text);
  };

  const handleSend = () => {
    const text = value.trim();
    if (!text || isStreaming) return;
    setCompletionOpen(false);
    if (activeMode === 'agent') {
      handleSendAgent(text);
    } else {
      void sendMessage(text);
    }
    // M4：清空由父级 onSend 回调执行（setDraft('')）；不再组件本地清空，保证草稿归属唯一。
    onSend?.();
    onCompose?.();
  };

  return (
    <div className="border-t border-border px-2.5 pt-2 pb-2.5 space-y-1.5">
      <div className="relative">
        {/* agent 模式：B1 `/` 与 `@` 自动补全菜单（渲染在 textarea 上方） */}
        {activeMode === 'agent' && (
          <CompletionMenu
            open={completionOpen}
            trigger={completionTrigger}
            title={
              completionTrigger === '/'
                ? t('ai.completion.skillsTitle')
                : t('ai.completion.refTitle')
            }
            items={completionItems}
            activeIndex={completionActive}
            onMove={handleCompletionMove}
            onSelect={handleCompletionSelect}
            onClose={() => setCompletionOpen(false)}
          />
        )}
        <textarea
          value={value}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              // agent 模式补全菜单打开时 Enter 由 CompletionMenu 的 capture 监听确认选中，此处不发送
              if (activeMode === 'agent' && completionOpen) {
                e.preventDefault();
                return;
              }
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            activeMode === 'agent' && selectionContext
              ? t('ai.rewrite.selectionHint')
              : t('ai.placeholder')
          }
          rows={3}
          className="w-full resize-none bg-bg-primary border border-border rounded-input px-2.5 py-1.5 text-[15px] text-text-primary placeholder-text-muted outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors"
        />
      </div>
      {/* 底部控制条：左→右 模式下拉 + 模型下拉 …… 发送/停止 */}
      <div className="flex items-center gap-1.5">
        <select
          data-testid="ai-mode-select"
          value={activeMode}
          onChange={(e) => toggleMode(e.target.value as 'chat' | 'agent')}
          aria-label={t('ai.modeSelectLabel')}
          className="text-[13px] px-2 py-1 rounded-input bg-bg-secondary border border-border text-text-primary focus:border-[var(--accent)] outline-none cursor-pointer"
        >
          <option value="chat">{t('ai.tab.chat')}</option>
          <option value="agent">{t('ai.tab.agent')}</option>
        </select>
        <ModelDropdown />
        <div className="ml-auto flex items-center gap-1.5">
          {isStreaming ? (
            <button
              type="button"
              onClick={stopStream}
              className="px-3 py-1 text-[15px] rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
            >
              {t('ai.stop')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!value.trim()}
              data-testid="ai-composer-send"
              className="px-3.5 py-1 text-[15px] rounded-input bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {t('ai.send')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AIPanelComposer;
