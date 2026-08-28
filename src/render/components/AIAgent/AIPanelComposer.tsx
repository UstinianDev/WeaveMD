// ============================================
// WeaveMD — AI 面板共享 Composer（三视图复用）
// ============================================
// 底部 composer：模式下拉（chat/agent）+ 模型下拉（ModelDropdown）+ textarea + 发送/停止 +
// CompletionMenu（`/` 技能、`@` 引用补全）。
// handleSendAgent 分流逻辑**从 AgentTab 原样移入**（选区改写 / `/技能` / `@文档` / `@知识库` /
// 整篇写 / 纯 agent），不改写协议。铁律：AI 无直接落盘——改写/整篇写走预览确认，agent 工具只读。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentSkillInfo, IMentionItem } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';
import { useEditorStore } from '@render/stores/editorStore';
import { useRewriteStore } from '@render/stores/rewriteStore';
import CompletionMenu, { type CompletionMenuItem } from './CompletionMenu';
import ContextRing from './ContextRing';
import ModelDropdown from './ModelDropdown';
import MentionList from './MentionList';
import {
  DOC_SCOPE_PREFIX,
  KB_SCOPE_PREFIX,
  SEND_ROUTES,
  type SendContext,
} from './sendRoutes';
import Icon from '../Common/Icon';

/** `/技能名 ` 前缀剥除（runSkill 技能指令）。 */
const SLASH_SKILL_RE = /^\/[a-z_]+\s+/;
/** 上下文 token 估算上限（128k）。 */
const MAX_CONTEXT_TOKENS = 128000;

/** 附件类型（文件/图片）。 */
interface Attachment {
  id: string;
  type: 'file' | 'image';
  name: string;
  content?: string;
  path?: string;
}

/** 联网搜索引擎选项。 */
const WEB_SEARCH_ENGINES = ['Firecrawl', 'Zhipu', 'Tavily', 'Exa'] as const;
type WebSearchEngine = (typeof WEB_SEARCH_ENGINES)[number];

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
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const sendAgentMessage = useAgentStore((s) => s.sendAgentMessage);
  const stopStream = useAgentStore((s) => s.stopStream);
  const messages = useAgentStore((s) => s.messages);
  const streamBuffer = useAgentStore((s) => s.streamBuffer);
  const writeMode = useAgentStore((s) => s.writeMode);
  const setWriteMode = useAgentStore((s) => s.setWriteMode);

  // 改写状态：选区改写模式（selectionContext 非空 → composer 输入改写指令）
  const selectionContext = useRewriteStore((s) => s.selectionContext);

  // 阶段 3：搜索配置（从 store 读取实际配置）
  const searchConfig = useAgentStore((s) => s.searchConfig);

  // —— 控制条状态 ——
  /** 联网搜索菜单开关。 */
  const [searchMenuOpen, setSearchMenuOpen] = useState(false);
  /** 已选中的搜索引擎（从配置初始化）。 */
  const [selectedEngine, setSelectedEngine] = useState<WebSearchEngine | null>(() => {
    // 从配置初始化，配置存在且已启用时显示当前提供商
    if (searchConfig?.enabled && searchConfig.provider) {
      const providerMap: Record<string, WebSearchEngine> = {
        firecrawl: 'Firecrawl',
        zhipu: 'Zhipu',
        tavily: 'Tavily',
        exa: 'Exa',
      };
      return providerMap[searchConfig.provider] ?? null;
    }
    return null;
  });
  /** 搜索菜单引用（点击外部关闭）。 */
  const searchMenuRef = useRef<HTMLDivElement>(null);

  // R5: 上下文 token 估算
  const contextEstimate = useMemo(() => {
    const totalChars = messages.reduce((acc, m) => acc + m.content.length, 0) + streamBuffer.length;
    const usedTokens = Math.round(totalChars / 4);
    const ratio = usedTokens / MAX_CONTEXT_TOKENS;
    return { usedTokens, ratio };
  }, [messages, streamBuffer]);

  const contextTooltip = t(
    'ai.context.tooltip',
    `Token 使用：${contextEstimate.usedTokens} / ${MAX_CONTEXT_TOKENS}`
  )
    .replace('{used}', String(contextEstimate.usedTokens))
    .replace('{total}', String(MAX_CONTEXT_TOKENS));

  // —— 第 7 期 B1：/ 与 @ 自动补全（仅智能体模式可用） ——
  const [skills, setSkills] = useState<AgentSkillInfo[]>([]);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionTrigger, setCompletionTrigger] = useState<'/' | '@'>('/');
  const [completionItems, setCompletionItems] = useState<CompletionMenuItem[]>([]);
  const [completionActive, setCompletionActive] = useState(0);
  /** 触发补全时，前缀字符在 input 中的下标（选中后从此处替换 insertText）。 */
  const [completionInsertAt, setCompletionInsertAt] = useState(0);

  // —— 附件状态（文件/图片上传） ——
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // —— 阶段 2：@ Mention 三维补全（文件/目录/技能） ——
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');

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
    // 阶段 3：刷新搜索配置（确保使用最新提供商）
    void useAgentStore.getState().refreshSearchConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // —— 联网搜索菜单：点击外部关闭 ——
  useEffect(() => {
    if (!searchMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (searchMenuRef.current && !searchMenuRef.current.contains(e.target as Node)) {
        setSearchMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [searchMenuOpen]);

  /** 构建补全菜单项（`/` = 技能；`@` = 引用目标（当前文档 / 知识库））。 */
  const buildCompletionItems = (trigger: '/' | '@', query: string): CompletionMenuItem[] => {
    let items: CompletionMenuItem[];
    if (trigger === '/') {
      items = [
        ...skills.map((s) => ({
          value: s.name,
          label: s.name,
          description: s.description,
          insertText: `/${s.name} `,
        })),
      ];
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

  /** 变更 input 时检测光标处 token 是否以 / 或 @ 开头，从而开/关补全菜单。 */
  const refreshCompletion = (value: string) => {
    const match = /(^|\s)([/@])([^\s/@]*)$/.exec(value);
    if (!match) {
      setCompletionOpen(false);
      setMentionOpen(false);
      return;
    }
    const trigger = match[2] as '/' | '@';
    const query = match[3] ?? '';

    // @ 触发时使用 MentionList（文件/目录/技能三维补全）
    if (trigger === '@') {
      setMentionOpen(true);
      setMentionQuery(query);
      setCompletionOpen(false);
      return;
    }

    // / 触发时使用 CompletionMenu（技能补全）
    const items = buildCompletionItems(trigger, query);
    if (items.length === 0) {
      setCompletionOpen(false);
      return;
    }
    setMentionOpen(false);
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

  /** @ mention 选中处理：将选中项插入到输入框（仅文件/目录，技能由 `/` 负责）。 */
  const handleMentionSelect = (item: IMentionItem) => {
    const atIndex = value.lastIndexOf('@');
    if (atIndex === -1) return;
    const prefix = value.slice(0, atIndex);
    onChange(prefix + `@${item.name} `);
    setMentionOpen(false);
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

  /** agent 模式发送分流（路由表驱动，逻辑与原 7 路 if-branch 完全一致）。 */
  const handleSendAgent = (text: string): void => {
    const store = useAgentStore.getState();
    const ctx: SendContext = {
      userId: user?.id,
      selectionContext,
      activeConversationId: store.activeConversationId,
      messages: store.messages,
      sendAgentMessage: (msg) => { void sendAgentMessage(msg); },
      startDocumentRewrite: (content, instruction) => {
        useRewriteStore.getState().startDocumentRewrite(content, instruction);
      },
      runFullDocumentRewrite: (t) => { void useRewriteStore.getState().runFullDocumentRewrite(t); },
      runSelectionRewrite: (instruction) => { void useRewriteStore.getState().runSelectionRewrite(instruction); },
      editorContent: useEditorStore.getState().content,
      createConversation: async (userId) => {
        const ai = window.weaveMD?.ai;
        const res = await ai?.createConversation(userId, 'agent');
        return (res?.success && res.data) ? res.data.id : null;
      },
      setAgentState: (patch) => { useAgentStore.setState(patch); },
    };
    for (const route of SEND_ROUTES) {
      const handled = route(text, ctx);
      if (handled) return;
    }
  };

  const handleSend = () => {
    const text = value.trim();
    if (!text || isStreaming) return;
    setCompletionOpen(false);

    // 拼接附件信息到消息内容
    let fullText = text;
    if (attachments.length > 0) {
      const parts: string[] = [text];
      for (const att of attachments) {
        if (att.type === 'file' && att.content) {
          parts.push(`[文件: ${att.name}]\n\`\`\`\n${att.content}\n\`\`\``);
        } else if (att.type === 'image') {
          parts.push(`[图片: ${att.name}]`);
        }
      }
      fullText = parts.join('\n\n');
      setAttachments([]);
    }

    void handleSendAgent(fullText);
    // M4：清空由父级 onSend 回调执行（setDraft('')）；不再组件本地清空，保证草稿归属唯一。
    onSend?.();
    onCompose?.();
  };

  // —— 文件/图片上传 ——
  const handleUploadFile = useCallback(async () => {
    try {
      const result = (await window.weaveMD?.dialog.openFile()) as unknown as {
        success?: boolean;
        data?: { name: string; content: string };
      };
      if (result?.success && result.data) {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        setAttachments((prev) => [
          ...prev,
          { id, type: 'file', name: result.data!.name, content: result.data!.content },
        ]);
      }
    } catch {
      /* 取消或失败，静默 */
    }
  }, []);

  const handleUploadImage = useCallback(async () => {
    try {
      const path = await window.weaveMD?.dialog.pickImage();
      if (path) {
        const name = path.split(/[/\\]/).pop() ?? path;
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        setAttachments((prev) => [...prev, { id, type: 'image', name, path }]);
      }
    } catch {
      /* 取消或失败，静默 */
    }
  }, []);

  /** 删除附件。 */
  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // —— 联网搜索引擎选择 ——
  const handleToggleEngine = useCallback((engine: WebSearchEngine) => {
    setSelectedEngine((prev) => (prev === engine ? null : engine));
    setSearchMenuOpen(false);
    // 阶段 3：切换提供商时同步到搜索配置
    const providerMap: Record<WebSearchEngine, string> = {
      Firecrawl: 'firecrawl',
      Zhipu: 'zhipu',
      Tavily: 'tavily',
      Exa: 'exa',
    };
    const provider = providerMap[engine];
    if (provider && user?.id) {
      void window.weaveMD?.ai.searchConfig.set(user.id, { provider: provider as 'firecrawl' | 'zhipu' | 'tavily' | 'exa' });
      void useAgentStore.getState().refreshSearchConfig();
    }
  }, [user?.id]);

  return (
    <div className="border-t border-border px-2.5 pt-2 pb-2.5 space-y-1.5">
      <div className="relative">
        {/* B1 `/` 技能补全菜单（渲染在 textarea 上方） */}
          <CompletionMenu
            open={completionOpen}
            trigger={completionTrigger}
            title={t('ai.completion.skillsTitle')}
            items={completionItems}
            activeIndex={completionActive}
            onMove={handleCompletionMove}
            onSelect={handleCompletionSelect}
            onClose={() => setCompletionOpen(false)}
          />
        {/* 阶段 2：@ Mention 三维补全（文件/目录/技能） */}
          <MentionList
            open={mentionOpen}
            query={mentionQuery}
            onSelect={handleMentionSelect}
            onClose={() => setMentionOpen(false)}
          />
        {/* 附件预览条 */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-bg-tertiary border border-border text-[12px] text-text-sub"
              >
                <Icon
                  icon={att.type === 'file' ? 'file-outline' : 'image'}
                  size={14}
                  className="text-text-muted"
                />
                <span className="max-w-[120px] truncate">{att.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  className="ml-0.5 text-text-muted hover:text-red-400 transition-colors"
                >
                  <Icon icon="close" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          value={value}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              // 补全菜单打开时 Enter 由 CompletionMenu 的 capture 监听确认选中，此处不发送
              if (completionOpen) {
                e.preventDefault();
                return;
              }
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            selectionContext
              ? t('ai.rewrite.selectionHint')
              : t('ai.placeholder')
          }
          rows={3}
          className="w-full resize-none bg-bg-primary border border-border rounded-input px-2.5 py-1.5 text-[15px] text-text-primary placeholder-text-muted outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors"
          style={{ fontFamily: "'Consolas', 'Alibaba PuHuiTi 2.0', '阿里巴巴普惠体', sans-serif" }}
        />
      </div>
      {/* 底部控制条：左→右 上传/开关/联网搜索 …… 模型/上下文/发送 */}
      <div className="flex items-center gap-1.5">
        {/* 上传文件 */}
        <button
          type="button"
          onClick={handleUploadFile}
          title="上传文件"
          className="flex items-center justify-center w-7 h-7 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        >
          <Icon icon="attach" size={18} />
        </button>

        {/* 上传图片 */}
        <button
          type="button"
          onClick={handleUploadImage}
          title="上传图片"
          className="flex items-center justify-center w-7 h-7 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        >
          <Icon icon="image" size={18} />
        </button>

        {/* 写模式切换：auto 自动 / manual 手动 */}
        <div className="flex items-center gap-1 text-[12px]">
          <button
            type="button"
            onClick={() => void setWriteMode('auto')}
            className={`px-1.5 py-0.5 rounded transition-colors ${
              writeMode === 'auto'
                ? 'text-[var(--accent)] font-medium'
                : 'text-text-muted hover:text-text-sub'
            }`}
          >
            自动
          </button>
          <button
            type="button"
            onClick={() => void setWriteMode(writeMode === 'auto' ? 'manual' : 'auto')}
            className={`relative w-8 h-4 rounded-full transition-colors ${
              writeMode === 'auto' ? 'bg-[var(--accent)]' : 'bg-text-muted'
            }`}
            role="switch"
            aria-checked={writeMode === 'manual'}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                writeMode === 'auto' ? 'translate-x-0' : 'translate-x-4'
              }`}
            />
          </button>
          <button
            type="button"
            onClick={() => void setWriteMode('manual')}
            className={`px-1.5 py-0.5 rounded transition-colors ${
              writeMode === 'manual'
                ? 'text-[var(--accent)] font-medium'
                : 'text-text-muted hover:text-text-sub'
            }`}
          >
            手动
          </button>
        </div>

        {/* 联网搜索按钮 */}
        <div className="relative" ref={searchMenuRef}>
          <button
            type="button"
            onClick={() => setSearchMenuOpen((v) => !v)}
            title={
              searchConfig?.enabled
                ? `联网搜索 (${selectedEngine ?? '未配置'})`
                : '联网搜索 (未启用)'
            }
            className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
              searchConfig?.enabled && selectedEngine
                ? 'text-[var(--accent)] bg-[var(--accent)]/10'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
            }`}
          >
            <Icon icon="web" size={18} />
          </button>
          {searchMenuOpen && (
            <div className="absolute left-0 bottom-full mb-1 z-50 w-48 rounded-card border border-border bg-bg-secondary shadow-dropdown py-1">
              <div className="px-3 pt-1 pb-1 text-[11px] text-text-muted flex items-center justify-between">
                <span>搜索引擎</span>
                {searchConfig?.enabled ? (
                  <span className="text-green-500">已启用</span>
                ) : (
                  <span className="text-text-muted">未启用</span>
                )}
              </div>
              {WEB_SEARCH_ENGINES.map((engine) => {
                const providerKey = engine === 'Firecrawl' ? 'firecrawl' : engine === 'Zhipu' ? 'zhipu' : engine === 'Tavily' ? 'tavily' : 'exa';
                const hasKey = searchConfig?.hasApiKeys?.[providerKey as keyof typeof searchConfig.hasApiKeys];
                return (
                  <button
                    key={engine}
                    type="button"
                    onClick={() => handleToggleEngine(engine)}
                    className={`flex items-center justify-between w-full text-left px-3 py-1.5 text-[13px] transition-colors ${
                      selectedEngine === engine
                        ? 'bg-[var(--accent)]/15 text-text-primary font-medium'
                        : 'text-text-sub hover:bg-bg-tertiary'
                    }`}
                  >
                    <span>{engine}</span>
                    {hasKey && <Icon icon="check" size={12} className="text-green-500" />}
                  </button>
                );
              })}
              <div className="border-t border-border mt-1 pt-1 px-3">
                <span className="text-[11px] text-text-muted">
                  {searchConfig?.enabled ? '点击切换提供商' : '请在设置中启用搜索'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* 模型下拉（移到右侧） */}
        <ModelDropdown />

        {/* R5: 上下文指示器（圆环形，缩小到 20px） */}
        <ContextRing
          usedTokens={contextEstimate.usedTokens}
          maxTokens={MAX_CONTEXT_TOKENS}
          ratio={contextEstimate.ratio}
          tooltip={contextTooltip}
          size={20}
        />

        {/* 发送/停止按钮 */}
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
            className="px-3.5 py-1 text-[15px] rounded-input bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity btn-shimmer"
          >
            {t('ai.send')}
          </button>
        )}
      </div>
    </div>
  );
};

export default AIPanelComposer;
