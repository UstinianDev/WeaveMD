// ============================================
// WeaveMD — 设置·Agent 个性面板（1:1 复刻 Notus）
// ============================================
// 三个全局 Agent 文件：soul.md（Agent 性格）/ style.md（写作风格）/ memory.md（全局记忆）。
// UI：SegmentedTabs 切换 + textarea 编辑 + 字符计数 + 保存/取消/恢复默认。
// 数据流：agentStore.loadGlobalFiles / updateGlobalFiles → IPC → ~/.weavemd/agent/*.md。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@render/i18n';
import { useAgentStore } from '@render/stores/agentStore';
import Icon from '../../Common/Icon';

// ---- 常量 ----

type FileType = 'soul' | 'style' | 'memory';

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

  const [activeFile, setActiveFile] = useState<FileType>('soul');
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const activeOption = FILE_OPTIONS.find((o) => o.value === activeFile)!;

  // 初始加载
  useEffect(() => {
    setLoading(true);
    void loadGlobalFiles().finally(() => setLoading(false));
  }, [loadGlobalFiles]);

  // 切换 tab 或 globalFiles 变化时同步内容
  useEffect(() => {
    if (globalFiles) {
      const text = globalFiles[activeFile] ?? '';
      setContent(text);
      setSavedContent(text);
    }
  }, [globalFiles, activeFile]);

  // 保存
  const handleSave = useCallback(async () => {
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
    if (!window.confirm(t('ai.personality.restoreConfirm', `恢复${activeOption.label}的默认内容？`))) return;
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
  }, [activeFile, activeOption.label, t, updateGlobalFiles]);

  const hasChanges = content !== savedContent;
  const overRecommended = content.length > activeOption.recommendedChars;

  return (
    <div className="space-y-4" style={{ fontFamily: "Consolas, 'Alibaba PuHuiTi 2.0', '阿里巴巴普惠体', sans-serif" }}>
      {/* SegmentedTabs 切换三个文件 */}
      <SegmentedTabs
        value={activeFile}
        onChange={(v) => setActiveFile(v as FileType)}
        options={FILE_OPTIONS.map((o) => ({ value: o.value, label: t(o.i18nKey, o.fallback) }))}
      />

      {/* 文件描述 */}
      <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
        {t(activeOption.descI18nKey, activeOption.descFallback)}
      </p>

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
    </div>
  );
};

export default AgentPersonalityPanel;
