// ============================================
// WeaveMD — AI 代理面板统一 body（第 7 期批次⑥ B3：双 Tab 合并单面板）
// ============================================
// 单一消息流 + 单一 composer；模式下拉切换「对话 / 智能体」（activeMode 域隔离）。
// - chat 模式：纯对话（消息流 + composer，sendMessage），无 agent 专属控件。
// - agent 模式：会话列表（mode='agent'）+ KB 开关 + 压缩 + KB 设置 + 后端降级提示 +
//   ToolCallTrace + IntentCard + RewritePreviewCard + `/` `@` 自动补全 + 改写分流。
// 各模式专属控件随 activeMode 条件渲染；assistant 走安全富文本渲染。

import React, { useEffect, useRef, useState } from 'react';
import type { AgentSkillInfo, IntentName } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';
import { useEditorStore } from '@render/stores/editorStore';
import { useRewriteStore } from '@render/stores/rewriteStore';
import AIMessageBubble from './AIMessageBubble';
import IntentCard from './IntentCard';
import ToolCallTrace from './ToolCallTrace';
import KnowledgeBaseSettings from './KnowledgeBaseSettings';
import RewritePreviewCard from './RewritePreviewCard';
import CompletionMenu, { type CompletionMenuItem } from './CompletionMenu';

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

const AgentTab: React.FC = () => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);

  // B3：统一 body 随 activeMode 域切换（chat / agent），会话/消息按域隔离
  const activeMode = useAgentStore((s) => s.activeMode);
  const conversations = useAgentStore((s) => s.conversations);
  const activeConversationId = useAgentStore((s) => s.activeConversationId);
  const messages = useAgentStore((s) => s.messages);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const streamBuffer = useAgentStore((s) => s.streamBuffer);
  const toolCalls = useAgentStore((s) => s.toolCalls);
  const intentCard = useAgentStore((s) => s.intentCard);
  const agentBackendHint = useAgentStore((s) => s.agentBackendHint);
  const useKnowledgeBase = useAgentStore((s) => s.useKnowledgeBase);

  const newChat = useAgentStore((s) => s.newChat);
  const loadConversation = useAgentStore((s) => s.loadConversation);
  const deleteConversation = useAgentStore((s) => s.deleteConversation);
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const sendAgentMessage = useAgentStore((s) => s.sendAgentMessage);
  const stopStream = useAgentStore((s) => s.stopStream);
  const setUseKnowledgeBase = useAgentStore((s) => s.setUseKnowledgeBase);
  const runManualCompress = useAgentStore((s) => s.runManualCompress);
  const loadConversations = useAgentStore((s) => s.loadConversations);

  // 改写状态：选区改写模式（selectionContext 非空 → composer 输入改写指令）+ 预览卡片
  const selectionContext = useRewriteStore((s) => s.selectionContext);
  const runSelectionRewrite = useRewriteStore((s) => s.runSelectionRewrite);
  const previewDocumentFromReply = useRewriteStore((s) => s.previewDocumentFromReply);
  const currentFile = useEditorStore((s) => s.currentFile);

  const [showKbSettings, setShowKbSettings] = useState(false);
  const [input, setInput] = useState('');
  const messageListRef = useRef<HTMLDivElement>(null);

  // —— 第 7 期 B1：/ 与 @ 自动补全（仅智能体模式可用） ——
  const [skills, setSkills] = useState<AgentSkillInfo[]>([]);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionTrigger, setCompletionTrigger] = useState<'/' | '@'>('/');
  const [completionItems, setCompletionItems] = useState<CompletionMenuItem[]>([]);
  const [completionActive, setCompletionActive] = useState(0);
  /** 触发补全时，前缀字符在 input 中的下标（选中后从此处替换 insertText）。 */
  const [completionInsertAt, setCompletionInsertAt] = useState(0);

  // 挂载时加载技能清单（B1 `/` 数据源；失败静默，仅技能补全不可用）。
  // 技能为全局（内置 + userData/skills），非按户数据，挂载即取；userId 仅作 IPC 参数。
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

  // B3：模式切换 → 清空当前域状态（newChat）+ 加载目标域会话列表（chat/agent 不串号）
  // 首挂载也走此 effect 加载当前域会话。
  const modeSwitchedRef = useRef(false);
  useEffect(() => {
    if (!user) return;
    if (!modeSwitchedRef.current) {
      modeSwitchedRef.current = true;
    } else {
      newChat();
    }
    void loadConversations(activeMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode, user]);

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

  const handleInputChange = (value: string) => {
    setInput(value);
    refreshCompletion(value);
  };

  const handleCompletionSelect = (item: CompletionMenuItem) => {
    // 用 insertText 替换从触发符到当前结尾的不完整 token（prefix 结尾带空格，避免误再开菜单）
    setInput((prev) => prev.slice(0, completionInsertAt) + item.insertText);
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
    if (skills.length > 0) refreshCompletion(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills]);

  // 流式时自动滚动到底部
  useEffect(() => {
    const el = messageListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, toolCalls.length, streamBuffer, isStreaming]);

  /** agent 模式发送分流（改写 / 技能 / 引用 / 整篇写 / 纯 agent 对话）。 */
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
      void runSelectionRewrite(text);
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
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    if (activeMode === 'agent') {
      handleSendAgent(text);
    } else {
      void sendMessage(text);
    }
  };

  // 意图卡片点击：按选中意图的提示模板重发（仅 agent 模式存在）
  const handlePickIntent = (intent: IntentName) => {
    const prompt = t(`ai.intent.${intent}.prompt`, '');
    void sendAgentMessage(prompt || `意图: ${intent}`);
  };

  const hasConversation = conversations.length > 0 || activeConversationId !== null;
  const isAgentMode = activeMode === 'agent';

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* 顶部：会话列表（新建/切换/删除），agent 模式附加专属控件 */}
      <div className="px-3 pt-2 pb-1 border-b border-border space-y-2">
        {isAgentMode && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-text-sub cursor-pointer">
              <input
                type="checkbox"
                checked={useKnowledgeBase}
                onChange={(e) => setUseKnowledgeBase(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              {t('ai.agent.useKnowledgeBase')}
            </label>
            <button
              type="button"
              onClick={() => void runManualCompress()}
              disabled={isStreaming}
              className="text-xs px-2 py-1 rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary disabled:opacity-40 transition-colors"
            >
              {t('ai.agent.compress')}
            </button>
            <button
              type="button"
              onClick={() => setShowKbSettings((prev) => !prev)}
              className="ml-auto text-xs px-2 py-1 rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
            >
              {t('ai.agent.kbSettings')}
            </button>
          </div>
        )}

        {/* agent 模式：后端降级提示条 */}
        {isAgentMode && agentBackendHint && (
          <div className="text-[11px] px-2 py-1 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/20">
            {agentBackendHint}
          </div>
        )}

        {/* agent 模式：知识库设置抽屉 */}
        {isAgentMode && showKbSettings && <KnowledgeBaseSettings />}

        {/* 会话列表 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={newChat}
            className="flex-shrink-0 text-xs px-3 py-1.5 rounded-input bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
          >
            {t('ai.newChat')}
          </button>
          <div className="flex-1 flex gap-1 overflow-x-auto">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1 flex-shrink-0 rounded-input px-2 py-1 text-xs cursor-pointer transition-colors ${
                  c.id === activeConversationId
                    ? 'bg-[var(--accent)]/15 text-text-primary'
                    : 'bg-bg-primary hover:bg-bg-tertiary text-text-sub'
                }`}
                onClick={() => void loadConversation(c.id, activeMode)}
              >
                <span className="max-w-[8rem] truncate">
                  {c.summary || (isAgentMode ? t('ai.tab.agent') : t('ai.tab.chat'))}
                </span>
                <button
                  type="button"
                  title={t('navbar.confirmDeleteFile')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteConversation(c.id);
                  }}
                  className="text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 消息列表 / 空态 */}
      <div ref={messageListRef} className="chat-scroll flex-1 overflow-y-auto py-2 space-y-1">
        {/* agent 模式：改写预览卡片（选区/@ 改写提案确认，红删绿增 + 确认/取消） */}
        {isAgentMode && <RewritePreviewCard />}

        {messages.length === 0 && (isAgentMode ? toolCalls.length === 0 : true) ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 space-y-2">
            {!hasConversation ? (
              <p className="text-sm text-text-muted">{t('ai.empty.noConversation')}</p>
            ) : (
              <p className="text-sm text-text-muted">{t('ai.empty.noMessage')}</p>
            )}
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <div key={m.id}>
                <AIMessageBubble
                  role={m.role}
                  content={m.content}
                  refsJson={isAgentMode ? m.refsJson : null}
                />
                {/* agent 模式：A1c 回复可「预览写入文档」——文档已打开且回复非空才显示 */}
                {isAgentMode &&
                  m.role === 'assistant' &&
                  m.content.trim() &&
                  currentFile && (
                    <button
                      type="button"
                      onClick={() => previewDocumentFromReply(m.content)}
                      className="ml-10 mt-0.5 text-[11px] px-2 py-0.5 rounded-md bg-bg-tertiary border border-border text-text-sub hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors"
                    >
                      {t('ai.rewrite.previewWrite')}
                    </button>
                  )}
              </div>
            ))}

            {/* agent 模式：工具轨迹（当前轮累积） */}
            {isAgentMode &&
              toolCalls.length > 0 && (
                <div className="space-y-1.5">
                  {toolCalls.map((call) => (
                    <ToolCallTrace key={call.toolCallId} call={call} />
                  ))}
                </div>
              )}

            {/* 流式增量打字指示 */}
            {isStreaming && (
              <AIMessageBubble role="assistant" content={streamBuffer} isStreaming />
            )}
          </>
        )}

        {/* agent 模式：意图候选提问卡片 */}
        {isAgentMode && intentCard && !isStreaming && (
          <div className="px-4 pt-1">
            <IntentCard intent={intentCard} onPick={handlePickIntent} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border px-3 py-3 space-y-2">
        <div className="relative">
          {/* agent 模式：B1 `/` 与 `@` 自动补全菜单（渲染在 textarea 上方） */}
          {isAgentMode && (
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
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                // agent 模式补全菜单打开时 Enter 由 CompletionMenu 的 capture 监听确认选中，此处不发送
                if (isAgentMode && completionOpen) {
                  e.preventDefault();
                  return;
                }
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              isAgentMode && selectionContext
                ? t('ai.rewrite.selectionHint')
                : t('ai.placeholder')
            }
            rows={3}
            className="w-full resize-none bg-bg-primary border border-border rounded-input px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-[var(--accent)] transition-colors"
          />
        </div>
        <div className="flex justify-end">
          {isStreaming ? (
            <button
              type="button"
              onClick={stopStream}
              className="px-3 py-1.5 text-sm rounded-input bg-bg-tertiary text-text-sub hover:bg-bg-quaternary transition-colors"
            >
              {t('ai.stop')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-3 py-1.5 text-sm rounded-input bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {t('ai.send')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentTab;
