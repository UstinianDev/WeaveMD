// ============================================
// WeaveMD — AI 面板共享 Composer（三视图复用）
// ============================================
// TipTap contentEditable 实现，支持 /skill 和 @file 标签的可视化 chip。
// - useEditor 初始化 TipTap 编辑器（StarterKit + SkillTag + MentionTag + suggestions）
// - 标签节点（skillTag / mentionTag）以 atom 节点形式渲染为 chip
// - handleSend 从 editor state 遍历提取标签信息，构建纯文本 + 标签元数据
// - Enter 发送，Shift+Enter 换行（通过 keymap 配置）

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';
import { useEditorStore } from '@render/stores/editorStore';
import { useRewriteStore } from '@render/stores/rewriteStore';
import { useFileTreeStore, type IFolderNode } from '@render/stores/fileTreeStore';
import { onStreamDelta } from '@render/stores/agentStore';
import ContextRing from '../composer/ContextRing';
import ModelDropdown from '../composer/ModelDropdown';
import {
  SEND_ROUTES,
  type SendContext,
} from '../composer/sendRoutes';
import Icon from '../../Common/Icon';
import { SkillTag } from '../composer/extensions/SkillTag';
import { MentionTag } from '../composer/extensions/MentionTag';
import { setCachedSkills, createSkillSuggestionExtension } from '../composer/extensions/skillSuggestion';
import { setMentionItemsGetter, createMentionSuggestionExtension } from '../composer/extensions/mentionSuggestion';
import type { MentionOption } from '../composer/extensions/mentionSuggestion';

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

/** 搜索配置 provider key → 显示名映射。 */
const PROVIDER_DISPLAY_MAP: Record<string, WebSearchEngine> = {
  firecrawl: 'Firecrawl',
  zhipu: 'Zhipu',
  tavily: 'Tavily',
  exa: 'Exa',
};

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

/** 从 TipTap editor state 中提取纯文本和标签信息。 */
function extractEditorContent(editor: import('@tiptap/core').Editor): {
  text: string;
  skillTagName: string;
  mentionTags: Array<{ type: string; id: string; name: string; path: string }>;
} {
  let text = '';
  let skillTagName = '';
  const mentionTags: Array<{ type: string; id: string; name: string; path: string }> = [];

  editor.state.doc.descendants((node) => {
    if (node.type.name === 'skillTag') {
      const name = (node.attrs.name as string) ?? '';
      text += `/${name}`;
      if (!skillTagName) skillTagName = name;
    } else if (node.type.name === 'mentionTag') {
      const name = (node.attrs.name as string) ?? '';
      const type = (node.attrs.type as string) ?? 'file';
      const id = (node.attrs.id as string) ?? '';
      const path = (node.attrs.path as string) ?? '';
      text += name.includes(' ') ? `@{${name}}` : `@${name}`;
      mentionTags.push({ type, id, name, path });
    } else if (node.isText) {
      text += node.text ?? '';
    }
  });

  return { text, skillTagName, mentionTags };
}

const AIPanelComposerInner: React.FC<AIPanelComposerProps> = ({ value, onChange, onSend, onCompose }) => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);

  const isStreaming = useAgentStore((s) => s.isStreaming);
  const sendAgentMessage = useAgentStore((s) => s.sendAgentMessage);
  const stopStream = useAgentStore((s) => s.stopStream);
  const messages = useAgentStore((s) => s.messages);
  const writeMode = useAgentStore((s) => s.writeMode);
  const setWriteMode = useAgentStore((s) => s.setWriteMode);

  // 配置状态（用于未配置锁）：LLM + Embedding + Search 三重检查
  const config = useAgentStore((s) => s.config);
  const modelConfigs = useAgentStore((s) => s.modelConfigs);
  const embeddingConnectionOk = useAgentStore((s) => s.embeddingConnectionOk);
  const searchConnectionOk = useAgentStore((s) => s.searchConnectionOk);
  const searchConfig = useAgentStore((s) => s.searchConfig);
  const llmReady = Boolean(config?.hasApiKey && modelConfigs.length > 0);
  const isConfigured = llmReady && embeddingConnectionOk && searchConnectionOk;

  // 改写状态
  const selectionContext = useRewriteStore((s) => s.selectionContext);

  // —— 控制条状态 ——
  const [searchMenuOpen, setSearchMenuOpen] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState<WebSearchEngine | null>(null);
  const searchMenuRef = useRef<HTMLDivElement>(null);

  // 同步 searchConfig 到 selectedEngine（init 完成后或配置变更后）
  useEffect(() => {
    if (searchConfig?.enabled && searchConfig.provider) {
      setSelectedEngine(PROVIDER_DISPLAY_MAP[searchConfig.provider] ?? null);
    } else {
      setSelectedEngine(null);
    }
  }, [searchConfig?.enabled, searchConfig?.provider]);

  // 流式文本长度追踪
  const streamLenRef = useRef(0);
  useEffect(() => {
    const unsubscribe = onStreamDelta((delta) => {
      streamLenRef.current += delta.length;
    });
    if (!isStreaming) streamLenRef.current = 0;
    return unsubscribe;
  }, [isStreaming]);

  // R5: 上下文 token 估算
  const contextEstimate = useMemo(() => {
    const totalChars = messages.reduce((acc, m) => acc + m.content.length, 0) + streamLenRef.current;
    const usedTokens = Math.round(totalChars / 4);
    const ratio = usedTokens / MAX_CONTEXT_TOKENS;
    return { usedTokens, ratio };
  }, [messages]);

  // —— 附件状态 ——
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // 文件树数据（用于 @mention）
  const looseFiles = useFileTreeStore((s) => s.looseFiles);
  const folders = useFileTreeStore((s) => s.folders);

  // 构建 mention 选项列表（用于 suggestion 插件的 items getter）
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

  // 注册 mention items getter（让 suggestion 插件可以查询文件树）
  useEffect(() => {
    setMentionItemsGetter((query: string) => {
      const q = query.toLowerCase();
      if (!q) return mentionOptions.slice(0, 8);
      return mentionOptions
        .filter((opt) =>
          opt.name.toLowerCase().includes(q) ||
          (opt.description ?? '').toLowerCase().includes(q) ||
          (opt.path ?? '').toLowerCase().includes(q),
        )
        .slice(0, 8);
    });
  }, [mentionOptions]);

  // 挂载时加载技能清单
  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const res = await window.weaveMD?.ai.listSkills(user?.id ?? '');
        if (res?.success && res.data) {
          setCachedSkills(res.data);
        }
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

  const contextTooltip = t(
    'ai.context.tooltip',
    `Token 使用：${contextEstimate.usedTokens} / ${MAX_CONTEXT_TOKENS}`,
  )
    .replace('{used}', String(contextEstimate.usedTokens))
    .replace('{total}', String(MAX_CONTEXT_TOKENS));

  // —— TipTap 编辑器初始化 ——
  // 使用 ref 追踪 onChange 回调，避免 editor 重建
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // 禁用不需要的块级扩展，保持 composer 轻量
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        // 配置 Link 扩展：启用自动链接和粘贴链接
        link: {
          autolink: true,
          openOnClick: true,
          linkOnPaste: true,
          defaultProtocol: 'https',
        },
      }),
      SkillTag,
      MentionTag,
      createSkillSuggestionExtension(),
      createMentionSuggestionExtension(),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'composer-tiptap-editor w-full bg-bg-primary border border-border rounded-[var(--radius-input)] px-2.5 py-1.5 text-[15px] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors min-h-[72px] max-h-[160px] overflow-y-auto',
        style: "font-family: 'Consolas', 'Alibaba PuHuiTi 2.0', '阿里巴巴普惠体', sans-serif; line-height: 24px;",
        'data-placeholder': selectionContext
          ? t('ai.rewrite.selectionHint')
          : t('ai.placeholder'),
      },
      handlePaste: (view, event) => {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        // 优先检测 Edge 的 text/link-preview 格式，提取原始 URL
        const linkPreview = clipboardData.getData('text/link-preview');
        if (linkPreview) {
          try {
            const preview = JSON.parse(linkPreview);
            if (preview.url) {
              // 插入原始 URL 文本，而非 HTML 标题
              const { state } = view;
              const { tr } = state;
              tr.insertText(preview.url);
              view.dispatch(tr);
              return true;
            }
          } catch {
            // JSON 解析失败，继续其他处理
          }
        }

        // 检测纯文本是否为 URL
        const plainText = clipboardData.getData('text/plain');
        if (plainText && /^https?:\/\/\S+$/i.test(plainText.trim())) {
          const { state } = view;
          const { tr } = state;
          tr.insertText(plainText.trim());
          view.dispatch(tr);
          return true;
        }

        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const { text } = extractEditorContent(ed);
      onChangeRef.current(text);
    },
  });

  // Suggestion 插件已通过 extensions 数组注册（createSkillSuggestionExtension / createMentionSuggestionExtension）

  // 同步外部 value → editor content（仅在值真正变化时）
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (!editor) return;
    // 仅当外部 value 变化且与 editor 文本不同时同步（避免循环）
    const editorText = extractEditorContent(editor).text;
    if (value !== prevValueRef.current && value !== editorText) {
      prevValueRef.current = value;
      // 将纯文本设置为编辑器内容
      editor.commands.setContent(value || '');
    }
  }, [value, editor]);

  // placeholder 显示/隐藏（通过 CSS 控制）
  useEffect(() => {
    if (!editor) return;
    const el = editor.view.dom;
    const updatePlaceholder = (): void => {
      const isEmpty = editor.isEmpty;
      el.setAttribute('data-empty', String(isEmpty));
    };
    editor.on('update', updatePlaceholder);
    updatePlaceholder();
    return () => { editor.off('update', updatePlaceholder); };
  }, [editor]);

  /** agent 模式发送分流 */
  const handleSendAgent = (text: string, skillTagName: string): void => {
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
      runFullDocumentRewrite: (txt) => { void useRewriteStore.getState().runFullDocumentRewrite(txt); },
      runSelectionRewrite: (instruction) => { void useRewriteStore.getState().runSelectionRewrite(instruction); },
      editorContent: useEditorStore.getState().content,
      createConversation: async (userId) => {
        const ai = window.weaveMD?.ai;
        const res = await ai?.createConversation(userId, 'agent');
        return (res?.success && res.data) ? res.data.id : null;
      },
      setAgentState: (patch) => { useAgentStore.setState(patch); },
      skillTagName,
    };
    for (const route of SEND_ROUTES) {
      const handled = route(text, ctx);
      if (handled) return;
    }
  };

  const handleSend = () => {
    if (!editor) return;
    const { text, skillTagName } = extractEditorContent(editor);
    const trimmed = text.trim();
    if (!trimmed || isStreaming || !isConfigured) return;

    let fullText = trimmed;
    if (attachments.length > 0) {
      const parts: string[] = [trimmed];
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

    void handleSendAgent(fullText, skillTagName);
    // 清空编辑器
    editor.commands.clearContent();
    onChange('');
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
    const providerMapLocal: Record<WebSearchEngine, string> = {
      Firecrawl: 'firecrawl',
      Zhipu: 'zhipu',
      Tavily: 'tavily',
      Exa: 'exa',
    };
    const provider = providerMapLocal[engine];
    if (provider && user?.id) {
      void window.weaveMD?.ai.searchConfig.set(user.id, { provider: provider as 'firecrawl' | 'zhipu' | 'tavily' | 'exa' });
      void useAgentStore.getState().refreshSearchConfig();
    }
  }, [user?.id]);

  // —— 键盘事件处理（Enter 发送） ——
  // TipTap 的 keymap 在 StarterKit 中已配置，此处仅处理 Enter 发送
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;
  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      // Enter 发送（非 Shift+Enter）
      if (event.key === 'Enter' && !event.shiftKey) {
        // 不在 suggestion 弹出时拦截（suggestion 的 onKeyDown 优先）
        event.preventDefault();
        handleSendRef.current();
      }
    };

    editor.view.dom.addEventListener('keydown', handleKeyDown);
    return () => { editor.view.dom.removeEventListener('keydown', handleKeyDown); };
  }, [editor]);

  const editorEmpty = editor?.isEmpty ?? true;

  return (
    <div className="border-t border-border px-2.5 pt-2 pb-2.5 space-y-1.5">
      <div className="relative">
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
          <EditorContent editor={editor} />
          {/* Placeholder：当编辑器为空时显示 */}
          {editorEmpty && (
            <div
              className="absolute top-0 left-0 right-0 px-2.5 py-1.5 text-[15px] text-text-muted pointer-events-none"
              style={{ lineHeight: '24px' }}
            >
              {selectionContext
                ? t('ai.rewrite.selectionHint')
                : t('ai.placeholder')}
            </div>
          )}
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
            disabled={editorEmpty || !isConfigured}
            title={!isConfigured ? t('ai.configRequired', '请先在设置中配置 API Key') : undefined}
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

const AIPanelComposer = React.memo(AIPanelComposerInner);

export default AIPanelComposer;
