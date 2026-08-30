// ============================================
// WeaveMD — AI 面板共享 Composer（三视图复用）
// ============================================
// 1:1 复刻 Notus InputBar 的 @mention 方案：
// - 纯 textarea，无 overlay，无透明文字
// - cursorIndex 状态追踪（onChange/onClick/onKeyUp/onSelect/onCompositionEnd）
// - activeMention regex 检测：支持 @{filename with spaces} 语法
// - dismissedMentionKey 关闭补全菜单
// - applyMention 插入纯文本 token

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentSkillInfo } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';
import { useEditorStore } from '@render/stores/editorStore';
import { useRewriteStore } from '@render/stores/rewriteStore';
import { useFileTreeStore, type IFolderNode } from '@render/stores/fileTreeStore';
import { onStreamDelta } from '@render/stores/agentStore';
import CompletionMenu, { type CompletionMenuItem } from '../composer/CompletionMenu';
import ContextRing from '../composer/ContextRing';
import ModelDropdown from '../composer/ModelDropdown';
import {
  SEND_ROUTES,
  type SendContext,
} from '../composer/sendRoutes';
import Icon from '../../Common/Icon';

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

/** @mention 活跃状态（参考 Notus activeMention）。 */
interface ActiveMention {
  start: number;
  end: number;
  key: string;
  query: string;
}

/** mention 选项（文件/目录/技能）。 */
interface MentionOption {
  type: 'file' | 'folder';
  id: string;
  name: string;
  path?: string;
  description?: string;
}

/** 递归扁平化文件夹树为 MentionOption[]。 */
function flattenFolders(nodes: IFolderNode[]): MentionOption[] {
  const result: MentionOption[] = [];
  for (const n of nodes) {
    if (n.isDirectory) {
      result.push({
        type: 'folder',
        id: n.id,
        name: n.name,
        path: n.path,
        description: `目录: ${n.name}`,
      });
    }
    if (n.children.length > 0) {
      result.push(...flattenFolders(n.children));
    }
  }
  return result;
}

interface AIPanelComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend?: () => void;
  onCompose?: () => void;
}

const AIPanelComposer: React.FC<AIPanelComposerProps> = ({ value, onChange, onSend, onCompose }) => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);

  const isStreaming = useAgentStore((s) => s.isStreaming);
  const sendAgentMessage = useAgentStore((s) => s.sendAgentMessage);
  const stopStream = useAgentStore((s) => s.stopStream);
  const messages = useAgentStore((s) => s.messages);
  const writeMode = useAgentStore((s) => s.writeMode);
  const setWriteMode = useAgentStore((s) => s.setWriteMode);

  // 改写状态
  const selectionContext = useRewriteStore((s) => s.selectionContext);

  // 搜索配置
  const searchConfig = useAgentStore((s) => s.searchConfig);

  // —— 控制条状态 ——
  const [searchMenuOpen, setSearchMenuOpen] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState<WebSearchEngine | null>(() => {
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
  const searchMenuRef = useRef<HTMLDivElement>(null);

  // 流式文本长度追踪
  const streamLenRef = useRef(0);
  useEffect(() => {
    const unsubscribe = onStreamDelta((delta) => {
      streamLenRef.current += delta.length;
    });
    if (!isStreaming) streamLenRef.current = 0;
    return unsubscribe;
  }, [isStreaming]);

  // 光标位置 state（参考 Notus 的方式）
  const [cursorIndex, setCursorIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // @mention 补全状态（参考 Notus）
  const [dismissedMentionKey, setDismissedMentionKey] = useState('');
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const mentionOptionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // R5: 上下文 token 估算
  const contextEstimate = useMemo(() => {
    const totalChars = messages.reduce((acc, m) => acc + m.content.length, 0) + streamLenRef.current;
    const usedTokens = Math.round(totalChars / 4);
    const ratio = usedTokens / MAX_CONTEXT_TOKENS;
    return { usedTokens, ratio };
  }, [messages]);

  // —— 第 7 期 B1：/ 自动补全 ——
  const [skills, setSkills] = useState<AgentSkillInfo[]>([]);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionTrigger, setCompletionTrigger] = useState<'/' | '@'>('/');
  const [completionItems, setCompletionItems] = useState<CompletionMenuItem[]>([]);
  const [completionActive, setCompletionActive] = useState(0);
  const [completionInsertAt, setCompletionInsertAt] = useState(0);

  // —— 附件状态 ——
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // 文件树数据（用于 @mention 下拉）
  const looseFiles = useFileTreeStore((s) => s.looseFiles);
  const folders = useFileTreeStore((s) => s.folders);

  // 挂载时加载技能清单
  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const res = await window.weaveMD?.ai.listSkills(user?.id ?? '');
        if (res?.success && res.data) setSkills(res.data);
      } catch {
        /* 静默 */
      }
    };
    void load();
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

  // 预计算技能列表
  const skillItems = useMemo<CompletionMenuItem[]>(
    () =>
      skills.map((s) => ({
        value: s.name,
        label: s.name,
        description: s.description,
        insertText: `/${s.name} `,
      })),
    [skills],
  );

  /** 构建补全菜单项（仅 / 触发） */
  const buildCompletionItems = (query: string): CompletionMenuItem[] => {
    if (!query) return skillItems;
    const q = query.toLowerCase();
    return skillItems.filter((it) =>
      it.insertText.slice(1).toLowerCase().includes(q)
    );
  };

  // —— @mention 选项列表（参考 Notus mentionOptions） ——
  const mentionOptions = useMemo<MentionOption[]>(() => {
    const fileItems: MentionOption[] = looseFiles
      .filter((f) => !f.id.startsWith('welcome://'))
      .map((f) => ({
        type: 'file' as const,
        id: f.id,
        name: f.name,
        path: f.path,
        description: `文件: ${f.name}`,
      }));
    const folderItems = flattenFolders(folders);
    return [...fileItems, ...folderItems];
  }, [looseFiles, folders]);

  // —— @mention 活跃检测（参考 Notus activeMention） ——
  // regex: 支持 @{filename with spaces} 和 @filename 两种语法
  const activeMention = useMemo<ActiveMention | null>(() => {
    if (!mentionOptions.length) return null;
    const beforeCursor = value.slice(0, cursorIndex);
    const match = beforeCursor.match(/(?:^|\s)@(?:\{([^}]*)|([^\s@]*))$/);
    if (!match) return null;

    const mentionStart = beforeCursor.lastIndexOf('@');
    const mentionKey = `${mentionStart}:${beforeCursor.slice(mentionStart, cursorIndex)}`;
    if (dismissedMentionKey === mentionKey) return null;

    const query = String(match[1] ?? match[2] ?? '').trim();
    return {
      start: mentionStart,
      end: cursorIndex,
      key: mentionKey,
      query,
    };
  }, [cursorIndex, dismissedMentionKey, mentionOptions.length, value]);

  // 按 query 过滤 mention 选项
  const filteredMentionOptions = useMemo(() => {
    if (!activeMention) return [];
    const q = activeMention.query.toLowerCase();
    if (!q) return mentionOptions.slice(0, 8);
    return mentionOptions
      .filter((opt) =>
        opt.name.toLowerCase().includes(q) ||
        (opt.description ?? '').toLowerCase().includes(q) ||
        (opt.path ?? '').toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [activeMention, mentionOptions]);

  // 重置 activeMentionIndex
  useEffect(() => {
    if (!activeMention) {
      setActiveMentionIndex(0);
      return;
    }
    setActiveMentionIndex((prev) => Math.min(Math.max(prev, 0), Math.max(0, filteredMentionOptions.length - 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMention?.key, filteredMentionOptions.length]);

  // 滚动到可见区域
  useEffect(() => {
    if (!filteredMentionOptions.length) return;
    const list = mentionListRef.current;
    const option = mentionOptionRefs.current[activeMentionIndex];
    if (!list || !option) return;

    const optionTop = option.offsetTop;
    const optionBottom = optionTop + option.offsetHeight;
    const visibleTop = list.scrollTop;
    const visibleBottom = visibleTop + list.clientHeight;

    if (optionTop < visibleTop) {
      list.scrollTo({ top: optionTop - 4, behavior: 'smooth' });
    } else if (optionBottom > visibleBottom) {
      list.scrollTo({ top: optionBottom - list.clientHeight + 4, behavior: 'smooth' });
    }
  }, [activeMentionIndex, filteredMentionOptions.length]);

  const contextTooltip = t(
    'ai.context.tooltip',
    `Token 使用：${contextEstimate.usedTokens} / ${MAX_CONTEXT_TOKENS}`
  )
    .replace('{used}', String(contextEstimate.usedTokens))
    .replace('{total}', String(MAX_CONTEXT_TOKENS));

  // 变更 input 时检测光标处 token 是否以 / 开头，从而开/关补全菜单。
  // @mention 由 activeMention useMemo 自动检测，无需手动刷新。
  const refreshCompletion = (val: string, cursor: number) => {
    const textBeforeCursor = val.slice(0, cursor);

    // 仅处理 / 触发（技能补全）
    const match = /(^|\s)\/([a-zA-Z0-9_-]*)$/.exec(textBeforeCursor);
    if (!match) {
      setCompletionOpen(false);
      return;
    }
    const query = match[2] ?? '';
    const items = buildCompletionItems(query);
    if (items.length === 0) {
      setCompletionOpen(false);
      return;
    }
    setCompletionTrigger('/');
    setCompletionItems(items);
    setCompletionActive(0);
    setCompletionInsertAt(cursor - query.length - 1);
    setCompletionOpen(true);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    onChange(v);
    setCursorIndex(e.target.selectionStart || 0);
    setDismissedMentionKey(''); // 输入时重置 dismissed，参考 Notus
    refreshCompletion(v, e.target.selectionStart || 0);
  };

  // 光标位置变化时更新 cursorIndex（参考 Notus）
  const handleSelect = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    setCursorIndex(textarea.selectionStart || 0);
  }, []);

  // @mention 选中处理（参考 Notus applyMention）
  const applyMention = useCallback((option: MentionOption) => {
    if (!activeMention) return;
    // 支持 @{filename with spaces} 语法
    const token = option.name.includes(' ') ? `@{${option.name}}` : `@${option.name}`;
    const nextValue = `${value.slice(0, activeMention.start)}${token} ${value.slice(activeMention.end)}`;
    const nextCursor = activeMention.start + token.length + 1;
    onChange(nextValue);
    setCursorIndex(nextCursor);
    setDismissedMentionKey('');
    setActiveMentionIndex(0);
    setCompletionOpen(false);

    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }, [activeMention, onChange, value]);

  const handleCompletionSelect = (item: CompletionMenuItem) => {
    onChange(value.slice(0, completionInsertAt) + item.insertText);
    setCompletionOpen(false);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const newPos = completionInsertAt + item.insertText.length;
      textarea.focus();
      textarea.setSelectionRange(newPos, newPos);
      setCursorIndex(newPos);
    });
  };

  const handleCompletionMove = (dir: 1 | -1) => {
    setCompletionActive((prev) => {
      if (completionItems.length === 0) return prev;
      return (prev + dir + completionItems.length) % completionItems.length;
    });
  };

  // 技能就绪后重估当前 `/` 补全
  useEffect(() => {
    if (skills.length > 0) refreshCompletion(value, cursorIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills]);

  /** agent 模式发送分流 */
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
      /* 静默 */
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
      /* 静默 */
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // —— 联网搜索引擎选择 ——
  const handleToggleEngine = useCallback((engine: WebSearchEngine) => {
    setSelectedEngine((prev) => (prev === engine ? null : engine));
    setSearchMenuOpen(false);
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

  // 类型图标
  const getTypeIconify = (type: MentionOption['type']): string => {
    return type === 'folder' ? 'folder-outline' : 'file-outline';
  };

  const getTypeBg = (type: MentionOption['type']): string => {
    return type === 'folder' ? 'bg-amber-500/10 text-amber-500' : 'bg-[#2563eb]/10 text-[#2563eb]';
  };

  const getTypeColor = (type: MentionOption['type']): string => {
    return type === 'folder' ? 'text-amber-500' : 'text-[#2563eb]';
  };

  // —— 键盘事件处理（参考 Notus handleKeyDown） ——
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // @mention 导航（参考 Notus）
    if (activeMention && filteredMentionOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveMentionIndex((prev) => (prev + 1) % filteredMentionOptions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveMentionIndex((prev) => (prev - 1 + filteredMentionOptions.length) % filteredMentionOptions.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        applyMention(filteredMentionOptions[activeMentionIndex] || filteredMentionOptions[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissedMentionKey(activeMention.key);
        setActiveMentionIndex(0);
        return;
      }
    }

    // /skill 补全菜单导航
    if (completionOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleCompletionMove(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleCompletionMove(-1);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const active = completionItems[completionActive];
        if (active) handleCompletionSelect(active);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setCompletionOpen(false);
        return;
      }
    }

    // Enter 发送
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border px-2.5 pt-2 pb-2.5 space-y-1.5">
      <div className="relative">
        {/* B1 `/` 技能补全菜单 */}
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
        <div className="relative">
          {/* @mention 下拉列表（参考 Notus activeMention dropdown） */}
          {activeMention && filteredMentionOptions.length > 0 && (
            <div
              ref={mentionListRef}
              className="absolute left-0 right-0 bottom-full mb-1 z-50 max-h-60 overflow-y-auto rounded-card border border-border bg-bg-secondary shadow-dropdown"
              role="listbox"
              aria-label={t('ai.mention.title', '@ 引用')}
              style={{ overscrollBehavior: 'contain' }}
            >
              <div className="px-3 pt-2 pb-1 text-[11px] text-text-muted font-medium">
                {t('ai.mention.title', '@ 引用')}
              </div>
              {filteredMentionOptions.map((option, index) => (
                <button
                  key={`${option.type}-${option.id}`}
                  ref={(node) => { mentionOptionRefs.current[index] = node; }}
                  type="button"
                  role="option"
                  aria-selected={index === activeMentionIndex}
                  onClick={() => applyMention(option)}
                  onMouseEnter={() => setActiveMentionIndex(index)}
                  className={`flex items-center gap-2.5 w-full text-left px-3 py-2 text-[13px] transition-colors ${
                    index === activeMentionIndex
                      ? 'bg-[var(--accent)]/10 text-text-primary'
                      : 'text-text-sub hover:bg-bg-tertiary'
                  }`}
                >
                  <span className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center ${getTypeBg(option.type)}`}>
                    <Icon icon={getTypeIconify(option.type)} size={14} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{option.name}</div>
                    {option.description && (
                      <div className="truncate text-[11px] text-text-muted">
                        {option.description}
                      </div>
                    )}
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${getTypeColor(option.type)} bg-bg-tertiary`}>
                    {option.type === 'folder' ? '目录' : '文件'}
                  </span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInputChange}
            onSelect={handleSelect}
            onClick={(e) => {
              setCursorIndex(e.currentTarget.selectionStart || 0);
            }}
            onKeyUp={(e) => {
              setCursorIndex(e.currentTarget.selectionStart || 0);
            }}
            onCompositionEnd={(e) => {
              setCursorIndex(e.currentTarget.selectionStart || 0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              selectionContext
                ? t('ai.rewrite.selectionHint')
                : t('ai.placeholder')
            }
            rows={3}
            className="composer-textarea w-full resize-none bg-bg-primary border border-border rounded-input px-2.5 py-1.5 text-[15px] placeholder-text-muted outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors"
            style={{
              fontFamily: "'Consolas', 'Alibaba PuHuiTi 2.0', '阿里巴巴普惠体', sans-serif",
              lineHeight: '24px',
            }}
          />
        </div>
      </div>
      {/* 底部控制条 */}
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

        {/* 写模式切换 */}
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

        {/* 模型下拉 */}
        <ModelDropdown />

        {/* R5: 上下文指示器 */}
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
