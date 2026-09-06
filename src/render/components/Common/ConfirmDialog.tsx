// ============================================
// WeaveMD — Confirm Dialog Component
// ============================================
// 三选一确认对话框：保存 / 不保存 / 取消
// 用于切换文档、退出应用等需要用户确认的场景。

import React from 'react';
import Modal from './Modal';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructiveLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onDestructive?: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = '保存',
  cancelLabel = '取消',
  destructiveLabel = '不保存',
  onConfirm,
  onCancel,
  onDestructive,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      width={380}
      footer={
        <>
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-sm rounded-md transition-colors"
            style={{
              color: 'var(--text-secondary)',
              backgroundColor: 'var(--bg-tertiary)',
            }}
          >
            {cancelLabel}
          </button>
          {onDestructive && (
            <button
              onClick={onDestructive}
              className="px-4 py-1.5 text-sm rounded-md transition-colors"
              style={{
                color: 'var(--color-danger, #ef4444)',
                backgroundColor: 'transparent',
                border: '1px solid var(--color-danger, #ef4444)',
              }}
            >
              {destructiveLabel}
            </button>
          )}
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 text-sm rounded-md transition-colors"
            style={{
              color: '#fff',
              backgroundColor: 'var(--accent, #6C3FF5)',
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {message}
      </p>
    </Modal>
  );
};

export default ConfirmDialog;
