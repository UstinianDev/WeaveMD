// ============================================
// WeaveMD — @ 引用预览弹窗
// ============================================
// 在 composer 中选中 @ 引用项后，弹出预览浮层展示文件/目录/Skill 的详细信息。
// 纯展示组件：数据通过 IPC 异步加载，支持点击外部 / ESC 关闭。
// 位置自动调整避免超出视口边界。

import React, { useState, useEffect, useCallback, useRef } from 'react';

// ---------- 类型定义 ----------

/** 预览数据结构（三种类型共享统一形状）。 */
interface PreviewData {
  type: 'file' | 'directory' | 'skill';
  name: string;
  content?: string;
  metadata?: Record<string, unknown>;
  children?: Array<{ name: string; isDirectory: boolean }>;
}

export interface MentionPreviewProps {
  type: 'file' | 'directory' | 'skill';
  /** 文件/目录为磁盘路径，Skill 为技能名称。 */
  id: string;
  /** 展示名。 */
  name: string;
  /** 触发位置（视口坐标）。 */
  position: { x: number; y: number };
  /** 关闭回调。 */
  onClose: () => void;
}

// ---------- 工具函数 ----------

/** 截断文本到 maxLen 字符，超出加省略号。 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

/** 格式化文件大小。 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ---------- 类型图标（内联 SVG，无外部依赖） ----------

const FileIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const FolderIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const SkillIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

function TypeIcon({ type }: { type: 'file' | 'directory' | 'skill' }) {
  if (type === 'file') return <FileIcon />;
  if (type === 'directory') return <FolderIcon />;
  return <SkillIcon />;
}

// ---------- 子组件 ----------

/** 加载骨架。 */
const LoadingSkeleton: React.FC = () => (
  <div className="flex items-center justify-center py-8">
    <div className="animate-spin rounded-full h-5 w-5 border-2 border-[var(--border-color)] border-t-[var(--accent)]" />
  </div>
);

/** 错误提示。 */
const ErrorDisplay: React.FC<{ message: string }> = ({ message }) => (
  <div className="text-[13px] text-[var(--text-muted)] py-4 text-center">{message}</div>
);

/** 文件内容预览。 */
const FilePreview: React.FC<{ data: PreviewData }> = ({ data }) => (
  <div className="space-y-2">
    <pre className="text-[13px] text-[var(--text-sub)] font-mono whitespace-pre-wrap break-words leading-relaxed max-h-[280px] overflow-auto">
      {data.content}
      {(data.metadata?.size as number) > 500 && (
        <span className="text-[var(--text-muted)]">...</span>
      )}
    </pre>
    {data.metadata?.size !== undefined && (
      <div className="flex items-center gap-3 text-[12px] text-[var(--text-muted)] pt-2 border-t border-[var(--border-color)]">
        <span>{formatSize(data.metadata.size as number)}</span>
      </div>
    )}
  </div>
);

/** 目录内容预览。 */
const DirectoryPreview: React.FC<{ data: PreviewData }> = ({ data }) => (
  <div className="space-y-1">
    {(data.children ?? []).map((child, i) => (
      <div key={i} className="flex items-center gap-2 text-[13px]">
        <span className="shrink-0 text-[var(--text-muted)]">
          {child.isDirectory ? <FolderIcon /> : <FileIcon />}
        </span>
        <span className="text-[var(--text-sub)] truncate">{child.name}</span>
      </div>
    ))}
    {(data.metadata?.totalItems as number) > 20 && (
      <div className="text-[12px] text-[var(--text-muted)] pt-1">
        +{(data.metadata?.totalItems as number) - 20} more items
      </div>
    )}
    <div className="flex items-center gap-3 text-[12px] text-[var(--text-muted)] pt-2 border-t border-[var(--border-color)]">
      <span>{String(data.metadata?.totalItems ?? 0)} items</span>
    </div>
  </div>
);

/** Skill 预览。 */
const SkillPreview: React.FC<{ data: PreviewData }> = ({ data }) => (
  <div className="space-y-2">
    {data.content && (
      <p className="text-[13px] text-[var(--text-sub)] leading-relaxed">{data.content}</p>
    )}
  </div>
);

// ---------- 主组件 ----------

const MentionPreview: React.FC<MentionPreviewProps> = ({
  type,
  id,
  name,
  position,
  onClose,
}) => {
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 加载预览数据
  useEffect(() => {
    let cancelled = false;

    const loadPreview = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        let previewData: PreviewData;

        switch (type) {
          case 'file': {
            const res = (await window.weaveMD.file.readDisk(id)) as unknown as {
              success: boolean;
              data?: { path: string; name: string; content: string };
              message?: string;
            };
            if (cancelled) return;
            if (!res.success || !res.data) {
              throw new Error(res.message ?? 'Failed to read file');
            }
            const content = res.data.content ?? '';
            previewData = {
              type: 'file',
              name: res.data.name ?? name,
              content: truncate(content, 500),
              metadata: { size: content.length },
            };
            break;
          }

          case 'directory': {
            const res = (await window.weaveMD.folder.readFolder(id)) as unknown as {
              success: boolean;
              data?: Array<{ name: string; path: string; isDirectory: boolean }>;
              message?: string;
            };
            if (cancelled) return;
            if (!res.success || !res.data) {
              throw new Error(res.message ?? 'Failed to read directory');
            }
            const items = res.data;
            previewData = {
              type: 'directory',
              name,
              children: items.slice(0, 20).map((f) => ({
                name: f.name,
                isDirectory: f.isDirectory,
              })),
              metadata: { totalItems: items.length },
            };
            break;
          }

          case 'skill': {
            const res = await window.weaveMD.ai.listSkills('');
            if (cancelled) return;
            if (!res.success || !res.data) {
              throw new Error('Failed to load skill info');
            }
            const skill = res.data.find((s) => s.name === id);
            if (!skill) {
              throw new Error(`Skill not found: ${id}`);
            }
            previewData = {
              type: 'skill',
              name: skill.name,
              content: skill.description,
            };
            break;
          }

          default:
            throw new Error(`Unknown type: ${type as string}`);
        }

        if (!cancelled) setData(previewData);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load preview');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadPreview();
    return () => { cancelled = true; };
  }, [type, id, name]);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // 计算位置（避免超出视口）
  const adjustedPosition = useCallback(() => {
    const padding = 16;
    const width = 320;
    const height = 400;

    let x = position.x;
    let y = position.y;

    if (x + width > window.innerWidth - padding) {
      x = window.innerWidth - width - padding;
    }
    if (x < padding) x = padding;

    if (y + height > window.innerHeight - padding) {
      y = position.y - height - 8;
    }
    if (y < padding) y = padding;

    return { x, y };
  }, [position]);

  const pos = adjustedPosition();

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label={`Preview: ${name}`}
      data-testid="mention-preview"
      className="fixed z-50 w-80 max-h-[400px] rounded-card border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-dropdown overflow-hidden"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* 标题栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]">
        <span className="shrink-0 text-[var(--accent)]">
          <TypeIcon type={type} />
        </span>
        <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
          {name}
        </span>
        <span className="ml-auto text-[11px] text-[var(--text-muted)] uppercase tracking-wide">
          {type}
        </span>
      </div>

      {/* 内容区 */}
      <div className="p-3 overflow-auto max-h-[340px]">
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <ErrorDisplay message={error} />
        ) : data ? (
          <>
            {data.type === 'file' && <FilePreview data={data} />}
            {data.type === 'directory' && <DirectoryPreview data={data} />}
            {data.type === 'skill' && <SkillPreview data={data} />}
          </>
        ) : null}
      </div>
    </div>
  );
};

export default MentionPreview;
