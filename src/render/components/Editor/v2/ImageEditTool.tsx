// ============================================
// WeaveMD Editor v2 — ImageEditTool
// ============================================
// 弹层（对标 marktext packages/muya/src/ui/imageEditTool/index.ts，本地化适配）：
// - 双 Tab 头部：「嵌入链接（link，默认）/ 本地选择（select）」
// - link Tab：src（打开 focus 并全选，初值 initialSrc）+ alt（初值 initialAlt）
//   + title（初值 initialTitle），「嵌入」提交
// - select Tab：pickImage → 非空路径直接应用（跳过二次确认）；取消返回 null 保持打开
// - Escape / × / 取消 → onCancel
// 样式全部内联 + 现有 CSS 变量，不新增全局 CSS 类。

import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface ImageEditToolProps {
  /** false 时渲染 null */
  open: boolean;
  /** 弹层锚定位置（fixed top/left） */
  position: { top: number; left: number };
  /** K5：图片 src 预填（「修改图片」模式；插入场景为 ''） */
  initialSrc?: string;
  /** 图片 alt 预填（插入场景为选区文本），link Tab alt 输入初值 */
  initialAlt?: string;
  /** K5：图片 title 预填（「修改图片」模式） */
  initialTitle?: string;
  /** 复用 window.weaveMD.dialog.pickImage，取消返回 null */
  pickImage?: () => Promise<string | null>;
  /** 确认（link 提交 / select 直接应用） */
  onConfirm: (img: { src: string; alt: string; title: string }) => void;
  /** 取消（Escape / × / 取消按钮） */
  onCancel: () => void;
}

type TabKey = 'link' | 'select';

const EMPTY_URL_MESSAGE = 'URL 不能为空';

const ImageEditTool: React.FC<ImageEditToolProps> = ({
  open,
  position,
  initialSrc,
  initialAlt,
  initialTitle,
  pickImage,
  onConfirm,
  onCancel,
}) => {
  const [tab, setTab] = useState<TabKey>('link');
  const [src, setSrc] = useState('');
  const [alt, setAlt] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const srcRef = useRef<HTMLInputElement>(null);

  // 每次从关闭到打开：重置输入/错误，src/alt/title 回到预填值（修改场景原样保留），
  // 回到默认 link Tab
  useEffect(() => {
    if (!open) return;
    setTab('link');
    setSrc(initialSrc ?? '');
    setAlt(initialAlt ?? '');
    setTitle(initialTitle ?? '');
    setError(null);
  }, [open, initialSrc, initialAlt, initialTitle]);

  // link Tab：打开时 src 自动聚焦并全选（setSelectionRange(0, len)）
  useEffect(() => {
    if (!open) return;
    const input = srcRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(0, input.value.length);
  }, [open]);

  // Escape 关闭弹层
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  const handleLinkConfirm = useCallback(() => {
    const trimmed = src.trim();
    if (!trimmed) {
      setError(EMPTY_URL_MESSAGE);
      srcRef.current?.focus();
      return;
    }
    onConfirm({ src: trimmed, alt, title });
  }, [src, alt, title, onConfirm]);

  const handlePickImage = useCallback(async () => {
    if (!pickImage) {
      console.warn('[ImageEditTool] pickImage 未提供，选择本地图片为 no-op');
      return;
    }
    const path = await pickImage();
    if (!path) return;
    // marktext 语义：本地选择直接应用，跳过二次确认（预填的 alt/title 原样保留）
    onConfirm({ src: path, alt: initialAlt ?? '', title: initialTitle ?? '' });
  }, [pickImage, initialAlt, initialTitle, onConfirm]);

  if (!open) return null;

  return (
    <div
      data-testid="image-edit-tool"
      role="dialog"
      aria-modal="true"
      aria-label="修改图片"
      className="image-edit-tool"
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 200,
        minWidth: 280,
        padding: '12px',
        borderRadius: '8px',
        boxShadow: '0 2px 12px rgba(0, 0, 0, 0.2)',
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        color: 'var(--text-primary)',
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '8px',
        }}
      >
        <span style={{ fontWeight: 600 }}>修改图片</span>
        <button
          type="button"
          aria-label="关闭"
          onClick={onCancel}
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--text-sub)',
            fontSize: '16px',
          }}
        >
          ×
        </button>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <button
          type="button"
          onClick={() => setTab('link')}
          style={{
            flex: 1,
            padding: '4px 0',
            cursor: 'pointer',
            border: 'none',
            borderBottom: `2px solid ${tab === 'link' ? 'var(--accent)' : 'transparent'}`,
            background: 'transparent',
            color: tab === 'link' ? 'var(--accent)' : 'var(--text-sub)',
          }}
        >
          嵌入链接
        </button>
        <button
          type="button"
          onClick={() => setTab('select')}
          style={{
            flex: 1,
            padding: '4px 0',
            cursor: 'pointer',
            border: 'none',
            borderBottom: `2px solid ${tab === 'select' ? 'var(--accent)' : 'transparent'}`,
            background: 'transparent',
            color: tab === 'select' ? 'var(--accent)' : 'var(--text-sub)',
          }}
        >
          本地选择
        </button>
      </div>

      {tab === 'link' ? (
        <>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
              图片 URL
            </label>
            <input
              ref={srcRef}
              type="text"
              value={src}
              placeholder="输入图片 URL"
              onChange={(e) => {
                setSrc(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLinkConfirm();
              }}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '4px 6px',
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                color: 'var(--text-primary)',
              }}
            />
            {error && (
              <span style={{ display: 'block', color: 'var(--danger, #e5484d)', fontSize: '12px' }}>
                {error}
              </span>
            )}
          </div>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>alt</label>
            <input
              type="text"
              value={alt}
              placeholder="可选描述 (alt)"
              onChange={(e) => setAlt(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '4px 6px',
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                color: 'var(--text-primary)',
              }}
            />
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
              title
            </label>
            <input
              type="text"
              value={title}
              placeholder="可选标题 (title)"
              onChange={(e) => setTitle(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '4px 6px',
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        </>
      ) : (
        <div style={{ marginBottom: '12px' }}>
          <button
            type="button"
            onClick={handlePickImage}
            style={{
              width: '100%',
              padding: '6px 0',
              cursor: 'pointer',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
            }}
          >
            选择图片
          </button>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '4px 12px',
            cursor: 'pointer',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            backgroundColor: 'transparent',
            color: 'var(--text-sub)',
          }}
        >
          取消
        </button>
        {tab === 'link' && (
          <button
            type="button"
            onClick={handleLinkConfirm}
            style={{
              padding: '4px 12px',
              cursor: 'pointer',
              border: 'none',
              borderRadius: '4px',
              backgroundColor: 'var(--accent)',
              color: '#fff',
            }}
          >
            嵌入
          </button>
        )}
      </div>
    </div>
  );
};

export default ImageEditTool;
