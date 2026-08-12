// ============================================
// WeaveMD Editor v2 — Insert URL Modal
// ============================================
// Self-drawn modal used to insert a link or image URL.
// macOS terminal style window dots (red / yellow / green) on the top-left,
// an URL input, and optional "pick image" button backed by the IPC pickImage channel.
// Replaces the disabled window.prompt flow in FloatingToolbar (object buttons).

import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface InsertUrlModalProps {
  /** Modal title, e.g. "插入链接" or "插入图片". */
  title: string;
  /** When false, the modal renders nothing. */
  open: boolean;
  /** Show the "pick image from disk" button. */
  showPickImage?: boolean;
  /** Called with the trimmed URL when the user confirms a non-empty value. */
  onConfirm: (url: string) => void;
  /** Called when the user cancels / closes the modal (cancel button, X, Escape). */
  onCancel: () => void;
  /** Backed by window.weaveMD.dialog.pickImage(); returns null when cancelled. */
  pickImage?: () => Promise<string | null>;
}

const EMPTY_URL_MESSAGE = 'URL 不能为空';

const InsertUrlModal: React.FC<InsertUrlModalProps> = ({
  title,
  open,
  showPickImage = false,
  onConfirm,
  onCancel,
  pickImage,
}) => {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state and focus the input each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setUrl('');
    setError(null);
    inputRef.current?.focus();
  }, [open]);

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  const handleConfirm = useCallback(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError(EMPTY_URL_MESSAGE);
      inputRef.current?.focus();
      return;
    }
    onConfirm(trimmed);
  }, [url, onConfirm]);

  const handlePickImage = useCallback(async () => {
    if (!pickImage) return;
    const path = await pickImage();
    if (path !== null) {
      setUrl(path);
      setError(null);
      inputRef.current?.focus();
    }
  }, [pickImage]);

  if (!open) return null;

  return (
    <div className="insert-url-modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="insert-url-modal">
        <div className="insert-url-modal-header">
          <div className="insert-url-modal-dots" aria-hidden="true">
            <span className="insert-url-modal-dot insert-url-modal-dot--close" />
            <span className="insert-url-modal-dot insert-url-modal-dot--minimize" />
            <span className="insert-url-modal-dot insert-url-modal-dot--zoom" />
          </div>
          <span className="insert-url-modal-title">{title}</span>
          <button
            type="button"
            className="insert-url-modal-close"
            aria-label="关闭"
            onClick={onCancel}
          >
            ×
          </button>
        </div>

        <div className="insert-url-modal-body">
          <label className="insert-url-modal-label" htmlFor="insert-url-modal-input">
            {showPickImage ? '图片 URL' : '链接 URL'}
          </label>
          <input
            id="insert-url-modal-input"
            ref={inputRef}
            className="insert-url-modal-input"
            type="text"
            value={url}
            placeholder={showPickImage ? '输入图片 URL' : '输入链接 URL'}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // R5: 阻止编辑层 selectionchange 竞态——否则回车会在恢复选区前把陈旧选区写入状态（丢内容）。
                e.preventDefault();
                e.stopPropagation();
                handleConfirm();
              }
            }}
          />
          {error && <span className="insert-url-modal-error">{error}</span>}
        </div>

        <div className="insert-url-modal-actions">
          {showPickImage && (
            <button type="button" className="insert-url-modal-btn" onClick={handlePickImage}>
              选择文件
            </button>
          )}
          <button type="button" className="insert-url-modal-btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="insert-url-modal-btn insert-url-modal-btn--primary" onClick={handleConfirm}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
};

export default InsertUrlModal;
