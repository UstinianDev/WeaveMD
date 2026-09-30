// ============================================
// WeaveMD — 设置·Agent 个性面板（1:1 复刻 Notus）
// ============================================
// 四个 tab：soul.md（Agent 性格）/ style.md（写作风格）/ memory.md（全局记忆）
//          + 「自动记忆」（agent-memory-optimize 第二批 C3：只读列表 + 单条删除；
//            第三批 D5 追加「相似合并建议」三态审核：采纳 / 驳回）。
// UI：SegmentedTabs 切换 + textarea 编辑 + 字符计数 + 保存/取消/恢复默认。
// 数据流：agentStore.loadGlobalFiles / updateGlobalFiles → IPC → ~/.weavemd/agent/*.md；
//        自动记忆：agentStore.loadMemories / deleteMemory → IPC → SQLite agent_memory；
//        合并建议：loadMergeSuggestions / acceptMergeSuggestion / rejectMergeSuggestion
//        → ai:memory:similar:* 三通道（主进程按 ids 重算相似组，不信任渲染层）。
// 无 dangerouslySetInnerHTML、无 any、新增区域无内联 style（走 Tailwind + CSS 变量）。

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@render/i18n';
import { useAgentStore } from '@render/stores/agentStore';
import type { AgentMemoryKindValue, IMemoryMergeGroup } from '@shared/ai';
import Icon from '../../Common/Icon';

// ---- 常量 ----

type FileType = 'soul' | 'style' | 'memory';

/** 第 4 个 tab：自动记忆（只读列表 + 单条删除）。 */
const AUTO_MEMORY_TAB = 'autoMemory';

type PanelTab = FileType | typeof AUTO_MEMORY_TAB;

interface AutoMemoryMeta {
  i18nKey: string;
  fallback: string;
  descI18nKey: string;
  descFallback: string;
}

const AUTO_MEMORY_META: AutoMemoryMeta = {
  i18nKey: 'ai.personality.tab.autoMemory',
  fallback: '自动记忆',
  descI18nKey: 'ai.personality.desc.autoMemory',
  descFallback: 'Agent 自动写入的记忆，可查看并单条删除',
};

/** kind → 标签文案（i18n key + 回退值）。 */
const KIND_LABELS: Record<AgentMemoryKindValue, { i18nKey: string; fallback: string }> = {
  profile: { i18nKey: 'ai.personality.memory.kind.profile', fallback: '画像' },
  fact: { i18nKey: 'ai.personality.memory.kind.fact', fallback: '事实' },
  entity: { i18nKey: 'ai.personality.memory.kind.entity', fallback: '实体' },
};

interface FileOption {
  value: FileType;
  label: string;
  i18nKey: string;
  fallback: string;
  /** 推荐字符上限。 */
  recommendedChars: number;
  /** 描述（i18n key）。 */
  descI18nKey: string;
  descFallback: string;
}

const FILE_OPTIONS: FileOption[] = [
  {
    value: 'soul',
    label: 'Agent 性格',
    i18nKey: 'ai.personality.tab.soul',
    fallback: 'Agent 性格',
    recommendedChars: 2000,
    descI18nKey: 'ai.personality.desc.soul',
    descFallback: '定义 Agent 的人格、角色和行为准则',
  },
  {
    value: 'style',
    label: '写作风格',
    i18nKey: 'ai.personality.tab.style',
    fallback: '写作风格',
    recommendedChars: 2000,
    descI18nKey: 'ai.personality.desc.style',
    descFallback: '定义 Agent 的输出语气、格式和用词偏好',
  },
  {
    value: 'memory',
    label: '全局记忆',
    i18nKey: 'ai.personality.tab.memory',
    fallback: '全局记忆',
    recommendedChars: 4000,
    descI18nKey: 'ai.personality.desc.memory',
    descFallback: 'Agent 跨会话保留的长期记忆和偏好',
  },
];

// ---- 样式常量（对齐 Notus SETTINGS_SURFACE_STYLE） ----

const SURFACE_STYLE: React.CSSProperties = {
  background: 'var(--bg-primary, #fff)',
  border: '1px solid var(--border-color)',
  borderRadius: 14,
  padding: 0,
  overflow: 'hidden',
};

const HEADER_STYLE: React.CSSProperties = {
  minHeight: 62,
  padding: '13px 18px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  borderBottom: '1px solid var(--border-color)',
  background: 'var(--bg-secondary, #FDFCFB)',
};

const FOOTER_STYLE: React.CSSProperties = {
  minHeight: 64,
  padding: '12px 18px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  borderTop: '1px solid var(--border-color)',
  background: 'var(--bg-secondary, #FDFCFB)',
};

// ---- SegmentedTabs（内联复刻 Notus 风格） ----

interface SegmentedTabsProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

const SegmentedTabs: React.FC<SegmentedTabsProps> = ({ value, onChange, options }) => (
  <div className="flex gap-1 rounded-lg p-1" style={{ background: 'var(--bg-tertiary, #F2F0EA)' }}>
    {options.map((opt) => {
      const isActive = opt.value === value;
      return (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className="px-3 py-1.5 text-[13px] font-medium rounded-md transition-all"
          style={{
            background: isActive ? 'var(--bg-primary, #fff)' : 'transparent',
            color: isActive ? 'var(--text-primary)' : 'var(--text-sub)',
            boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

// ---- 主组件 ----

const AgentPersonalityPanel: React.FC = () => {
  const { t } = useI18n();
  const globalFiles = useAgentStore((s) => s.globalFiles);
  const loadGlobalFiles = useAgentStore((s) => s.loadGlobalFiles);
  const updateGlobalFiles = useAgentStore((s) => s.updateGlobalFiles);
  // 自动记忆（C3）
  const memories = useAgentStore((s) => s.memories);
  const memoriesLoading = useAgentStore((s) => s.memoriesLoading);
  const memoriesError = useAgentStore((s) => s.memoriesError);
  const loadMemories = useAgentStore((s) => s.loadMemories);
  const deleteMemory = useAgentStore((s) => s.deleteMemory);
  // 相似合并建议（D5 六.3 防线二：三态审核）
  const mergeSuggestions = useAgentStore((s) => s.mergeSuggestions);
  const mergeSuggestionsLoading = useAgentStore((s) => s.mergeSuggestionsLoading);
  const mergeSuggestionsError = useAgentStore((s) => s.mergeSuggestionsError);
  const loadMergeSuggestions = useAgentStore((s) => s.loadMergeSuggestions);
  const acceptMergeSuggestion = useAgentStore((s) => s.acceptMergeSuggestion);
  const rejectMergeSuggestion = useAgentStore((s) => s.rejectMergeSuggestion);

  const [activeFile, setActiveFile] = useState<PanelTab>('soul');
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  /** 正在提交的合并建议组 key（采纳 / 驳回按钮的 disabled 与文案态）。 */
  const [actingKey, setActingKey] = useState<string | null>(null);

  const activeOption = FILE_OPTIONS.find((o) => o.value === activeFile);
  const activeLabel = activeOption?.label ?? '';

  // 初始加载
  useEffect(() => {
    setLoading(true);
    void loadGlobalFiles().finally(() => setLoading(false));
  }, [loadGlobalFiles]);

  // 切换 tab 或 globalFiles 变化时同步内容（自动记忆 tab 无编辑面，跳过）
  useEffect(() => {
    if (activeFile === AUTO_MEMORY_TAB) return;
    if (globalFiles) {
      const text = globalFiles[activeFile] ?? '';
      setContent(text);
      setSavedContent(text);
    }
  }, [globalFiles, activeFile]);

  // 进入「自动记忆」tab 时拉取列表 + 合并建议（D5 三态审核）
  useEffect(() => {
    if (activeFile !== AUTO_MEMORY_TAB) return;
    void loadMemories();
    void loadMergeSuggestions();
  }, [activeFile, loadMemories, loadMergeSuggestions]);

  // 保存
  const handleSave = useCallback(async () => {
    if (activeFile === AUTO_MEMORY_TAB) return;
    setSaving(true);
    try {
      await updateGlobalFiles({ [activeFile]: content });
      setSavedContent(content);
    } catch {
      /* 静默 */
    } finally {
      setSaving(false);
    }
  }, [activeFile, content, updateGlobalFiles]);

  // 取消（恢复到上次保存的内容）
  const handleCancel = useCallback(() => {
    setContent(savedContent);
  }, [savedContent]);

  // 恢复默认（从后端获取默认内容并写入）
  const handleRestoreDefault = useCallback(async () => {
    if (activeFile === AUTO_MEMORY_TAB) return;
    if (!window.confirm(t('ai.personality.restoreConfirm', `恢复${activeLabel}的默认内容？`))) return;
    setSaving(true);
    try {
      const res = await window.weaveMD?.ai.globalFiles.default(activeFile);
      const defaultContent = (res?.success && res.data?.content) ? res.data.content : '';
      await updateGlobalFiles({ [activeFile]: defaultContent });
      setContent(defaultContent);
      setSavedContent(defaultContent);
    } catch {
      /* 静默 */
    } finally {
      setSaving(false);
    }
  }, [activeFile, activeLabel, t, updateGlobalFiles]);

  // 单条删除（二次确认后才发 IPC，与项目内既有删除交互一致）
  const handleDeleteMemory = useCallback(
    async (id: number) => {
      const confirmed = window.confirm(
        t(
          'ai.personality.memory.deleteConfirm',
          '确认删除这条记忆？删除后新会话不再注入。'
        )
      );
      if (!confirmed) return;
      setDeletingId(id);
      try {
        await deleteMemory(id);
      } finally {
        setDeletingId(null);
      }
    },
    [deleteMemory, t]
  );

  // 采纳合并建议（window.confirm 二次确认后才发 IPC，与既有删除交互一致）
  const handleAcceptMerge = useCallback(
    async (group: IMemoryMergeGroup) => {
      const confirmed = window.confirm(
        t(
          'ai.personality.memory.mergeAcceptConfirm',
          '确认采纳合并？较旧的记忆会被标记为已失效（仍可在上方列表查看）。'
        )
      );
      if (!confirmed) return;
      setActingKey(group.key);
      try {
        await acceptMergeSuggestion(group.members.map((m) => m.id));
      } finally {
        setActingKey(null);
      }
    },
    [acceptMergeSuggestion, t]
  );

  // 驳回合并建议：此后这组记忆不再自动合并、不再出现在建议列表
  const handleRejectMerge = useCallback(
    async (group: IMemoryMergeGroup) => {
      const confirmed = window.confirm(
        t(
          'ai.personality.memory.mergeRejectConfirm',
          '确认驳回？这组记忆此后不再自动合并，也不再出现在建议列表。'
        )
      );
      if (!confirmed) return;
      setActingKey(group.key);
      try {
        await rejectMergeSuggestion(group.members.map((m) => m.id));
      } finally {
        setActingKey(null);
      }
    },
    [rejectMergeSuggestion, t]
  );

  const hasChanges = content !== savedContent;  const overRecommended = content.length > (activeOption?.recommendedChars ?? 0);

  return (
    <div className="space-y-4" style={{ fontFamily: "Consolas, 'Alibaba PuHuiTi 2.0', '阿里巴巴普惠体', sans-serif" }}>
      {/* SegmentedTabs 切换四个栏 */}
      <SegmentedTabs
        value={activeFile}
        onChange={(v) => setActiveFile(v as PanelTab)}
        options={[
          ...FILE_OPTIONS.map((o) => ({ value: o.value, label: t(o.i18nKey, o.fallback) })),
          { value: AUTO_MEMORY_TAB, label: t(AUTO_MEMORY_META.i18nKey, AUTO_MEMORY_META.fallback) },
        ]}
      />

      {/* 栏描述 */}
      <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
        {activeOption
          ? t(activeOption.descI18nKey, activeOption.descFallback)
          : t(AUTO_MEMORY_META.descI18nKey, AUTO_MEMORY_META.descFallback)}
      </p>

      {activeOption ? (
        <>
      {/* 编辑器卡片 */}
      <div style={SURFACE_STYLE}>
        {/* 头部：文件名 + 更新时间 + 字符计数 */}
        <div style={HEADER_STYLE}>
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="inline-flex items-center justify-center shrink-0"
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: 'var(--accent-subtle, #F6E8E1)',
                color: 'var(--accent, #BE6247)',
                border: '1px solid var(--border-color)',
              }}
            >
              <Icon icon="file-outline" size={16} />
            </span>
            <div className="min-w-0">
              <div className="text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>
                {activeFile}.md
              </div>
              <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                {t('ai.personality.storagePath', '~/.weavemd/agent/')}
                {activeFile}.md
              </div>
            </div>
          </div>
          <div
            className="text-[12px] tabular-nums"
            style={{ color: overRecommended ? 'var(--warning, #D97706)' : 'var(--text-tertiary)' }}
          >
            {content.length} / {activeOption.recommendedChars} {t('ai.personality.chars', '字符')}
          </div>
        </div>

        {/* textarea 编辑区 */}
        <div style={{ padding: 18 }}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={loading || saving}
            spellCheck={false}
            aria-label={t(activeOption.i18nKey, activeOption.fallback)}
            className="w-full resize-y box-sizing-border-box outline-none transition-all"
            style={{
              minHeight: 390,
              border: '1px solid var(--border-color)',
              borderRadius: 12,
              padding: '16px 18px',
              color: 'var(--text-primary)',
              background: 'var(--bg-secondary, #FCFBF9)',
              fontFamily: "Consolas, 'Alibaba PuHuiTi 2.0', '阿里巴巴普惠体', monospace",
              fontSize: '13.5px',
              lineHeight: 1.75,
            }}
          />
        </div>

        {/* 底部：恢复默认 + 保存/取消 */}
        <div style={FOOTER_STYLE}>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              disabled={saving || loading}
              onClick={() => void handleRestoreDefault()}
              className="px-3 py-1.5 text-[13px] rounded-lg transition-colors disabled:opacity-40"
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--danger, #A6533C)',
                cursor: 'pointer',
              }}
            >
              {t('ai.personality.restoreDefault', '恢复默认')}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving || loading || !hasChanges}
              onClick={handleCancel}
              className="px-3 py-1.5 text-[13px] rounded-lg border transition-colors disabled:opacity-40"
              style={{
                borderColor: 'var(--border-color)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                cursor: hasChanges ? 'pointer' : 'default',
              }}
            >
              {t('ai.personality.cancel', '取消')}
            </button>
            <button
              type="button"
              disabled={loading || !hasChanges}
              onClick={() => void handleSave()}
              className="px-4 py-1.5 text-[13px] font-medium rounded-lg transition-all disabled:opacity-40"
              style={{
                minWidth: 88,
                justifyContent: 'center',
                border: 'none',
                background: hasChanges ? 'var(--accent, #D97757)' : 'var(--bg-tertiary)',
                color: hasChanges ? '#fff' : 'var(--text-muted)',
                boxShadow: hasChanges ? '0 6px 14px rgba(217,119,87,0.2)' : 'none',
                cursor: hasChanges ? 'pointer' : 'default',
              }}
            >
              {saving ? t('ai.personality.saving', '保存中...') : t('ai.personality.save', '保存修改')}
            </button>
          </div>
        </div>
      </div>
        </>
      ) : (
        /* 自动记忆卡片（C3）：只读列表 + 单条删除，全 Tailwind + CSS 变量，无内联 style */
        <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-[14px] overflow-hidden">
          {/* 头部：条数 + 删除语义提示 + 刷新 */}
          <div className="min-h-[56px] px-[18px] py-3 flex items-center justify-between gap-3 flex-wrap border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
            <div className="text-[12px] text-[var(--text-sub)]">
              {t('ai.personality.memory.total', '共')} {memories.length}{' '}
              {t('ai.personality.memory.items', '条')}
              <span className="mx-1.5">·</span>
              {t('ai.personality.memory.deleteNote', '删除后新会话不再注入')}
            </div>
            <button
              type="button"
              disabled={memoriesLoading}
              onClick={() => void loadMemories()}
              className="shrink-0 text-[12px] px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
            >
              {t('ai.personality.memory.refresh', '刷新')}
            </button>
          </div>

          {/* 列表区：加载 / 失败 / 空态 / 只读行 */}
          <div className="max-h-[420px] overflow-y-auto">
            {memoriesLoading && (
              <p className="px-[18px] py-6 text-[13px] text-center text-[var(--text-sub)]">
                {t('ai.personality.memory.loading', '加载中...')}
              </p>
            )}

            {!memoriesLoading && memoriesError && (
              <div className="px-[18px] py-6 text-center">
                <p className="text-[13px] text-[var(--danger,#A6533C)]">
                  {t('ai.personality.memory.loadFailed', '加载失败')}
                </p>
                <button
                  type="button"
                  onClick={() => void loadMemories()}
                  className="mt-2 text-[12px] px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {t('ai.personality.memory.retry', '重试')}
                </button>
              </div>
            )}

            {!memoriesLoading && !memoriesError && memories.length === 0 && (
              <p className="px-[18px] py-6 text-[13px] text-center text-[var(--text-sub)]">
                {t('ai.personality.memory.empty', '暂无自动记忆')}
              </p>
            )}

            {memories.map((m) => (
              <div
                key={m.id}
                className="flex items-start gap-3 px-[18px] py-3 border-b border-[var(--border-color)] last:border-b-0"
              >
                <span className="shrink-0 text-[11px] leading-5 px-2 rounded-full border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-sub)]">
                  {t(KIND_LABELS[m.kind].i18nKey, KIND_LABELS[m.kind].fallback)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-[var(--text-primary)] break-words">
                    {m.subject}
                  </div>
                  <div className="text-[12px] mt-0.5 text-[var(--text-sub)] break-words">
                    {m.content}
                  </div>
                  <div className="text-[11px] mt-1 text-[var(--text-muted)]">
                    {m.writtenAt}
                    {m.validTo && (
                      <span className="ml-2 text-[var(--warning,#D97706)]">
                        {t('ai.personality.memory.invalid', '已失效')}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={deletingId === m.id}
                  onClick={() => void handleDeleteMemory(m.id)}
                  className="shrink-0 text-[12px] px-2 py-1 rounded-lg border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--danger,#A6533C)] hover:border-[var(--danger,#A6533C)] transition-colors disabled:opacity-40"
                >
                  {t('ai.personality.memory.delete', '删除')}
                </button>
              </div>
            ))}
          </div>

          {/* 相似合并建议（D5 六.3 防线二：三态审核 —— 采纳 / 驳回），全 Tailwind + CSS 变量 */}
          <div className="border-t border-[var(--border-color)]">
            <div className="min-h-[48px] px-[18px] py-3 flex items-center justify-between gap-3 flex-wrap bg-[var(--bg-secondary)]">
              <div className="text-[12px] text-[var(--text-sub)]">
                {t('ai.personality.memory.mergeTitle', '相似合并建议')}
                <span className="mx-1.5">·</span>
                {t('ai.personality.memory.mergeNote', '采纳后旧记忆标记失效，驳回后不再建议')}
              </div>
              <button
                type="button"
                disabled={mergeSuggestionsLoading}
                onClick={() => void loadMergeSuggestions()}
                className="shrink-0 text-[12px] px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
              >
                {t('ai.personality.memory.mergeRefresh', '刷新建议')}
              </button>
            </div>

            <div className="max-h-[320px] overflow-y-auto">
              {mergeSuggestionsLoading && (
                <p className="px-[18px] py-6 text-[13px] text-center text-[var(--text-sub)]">
                  {t('ai.personality.memory.mergeLoading', '正在读取合并建议...')}
                </p>
              )}

              {!mergeSuggestionsLoading && mergeSuggestionsError && (
                <div className="px-[18px] py-6 text-center">
                  <p className="text-[13px] text-[var(--danger,#A6533C)]">
                    {t('ai.personality.memory.mergeLoadFailed', '合并建议读取失败')}
                  </p>
                  <button
                    type="button"
                    onClick={() => void loadMergeSuggestions()}
                    className="mt-2 text-[12px] px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-[var(--text-sub)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    {t('ai.personality.memory.mergeRetry', '重试建议')}
                  </button>
                </div>
              )}

              {!mergeSuggestionsLoading && !mergeSuggestionsError && mergeSuggestions.length === 0 && (
                <p className="px-[18px] py-6 text-[13px] text-center text-[var(--text-sub)]">
                  {t('ai.personality.memory.mergeEmpty', '暂无相似合并建议')}
                </p>
              )}

              {mergeSuggestions.map((group) => {
                const busy = actingKey === group.key;
                return (
                  <div
                    key={group.key}
                    className="px-[18px] py-3 border-b border-[var(--border-color)] last:border-b-0"
                  >
                    <div className="text-[11px] text-[var(--text-muted)]">
                      {t(KIND_LABELS[group.kind].i18nKey, KIND_LABELS[group.kind].fallback)}
                      <span className="mx-1.5">·</span>
                      {t('ai.personality.memory.mergeSimilarity', '相似度')}{' '}
                      {Math.round(group.score * 100)}%
                      <span className="mx-1.5">·</span>
                      {group.members.length} {t('ai.personality.memory.items', '条')}
                    </div>
                    {group.members.map((m) => (
                      <div key={m.id} className="mt-1.5 text-[12px] leading-5">
                        <span className="font-medium text-[var(--text-primary)] break-words">
                          {m.subject}
                        </span>
                        <span className="mx-1.5 text-[var(--text-muted)]">—</span>
                        <span className="text-[var(--text-sub)] break-words">{m.content}</span>
                      </div>
                    ))}
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy || mergeSuggestionsLoading}
                        onClick={() => void handleAcceptMerge(group)}
                        className="text-[12px] px-3 py-1 rounded-lg border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
                      >
                        {busy
                          ? t('ai.personality.memory.mergeWorking', '处理中...')
                          : t('ai.personality.memory.mergeAccept', '采纳合并')}
                      </button>
                      <button
                        type="button"
                        disabled={busy || mergeSuggestionsLoading}
                        onClick={() => void handleRejectMerge(group)}
                        className="text-[12px] px-3 py-1 rounded-lg border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--danger,#A6533C)] hover:border-[var(--danger,#A6533C)] transition-colors disabled:opacity-40"
                      >
                        {t('ai.personality.memory.mergeReject', '驳回')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentPersonalityPanel;
