// ============================================
// WeaveMD — Create Dialog (File / Folder)
// ============================================

import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import Modal from './Modal';

interface CreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (result: { type: 'file' | 'folder'; path: string; name: string }) => void;
  initialType?: 'file' | 'folder';
}

const CreateDialog: React.FC<CreateDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  initialType = 'file',
}) => {
  const { t } = useI18n();
  const [type, setType] = useState<'file' | 'folder'>(initialType);
  const [selectedPath, setSelectedPath] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleSelectPath = async () => {
    try {
      if (type === 'file') {
        const defaultName = name || 'untitled';
        const result = (await window.weaveMD.dialog.saveFile({
          defaultName,
        })) as unknown as { success: boolean; data?: { path: string }; error?: string };

        if (result.success && result.data) {
          const fullPath = result.data.path;
          const separator = fullPath.includes('\\') ? '\\' : '/';
          const dir = fullPath.substring(0, fullPath.lastIndexOf(separator));
          setSelectedPath(dir);

          if (!name) {
            const extractedName = fullPath.split(/[\\/]/).pop() || '';
            setName(extractedName.replace(/\.md$/i, ''));
          }
        }
      } else {
        const result = (await window.weaveMD.dialog.openFolder()) as unknown as {
          success: boolean;
          data?: { path: string };
          error?: string;
        };

        if (result.success && result.data) {
          setSelectedPath(result.data.path);
        }
      }
    } catch {
      setError(t('dialog.pathSelectFailed', '选择路径失败'));
    }
  };

  const handleConfirm = () => {
    if (!selectedPath) {
      setError(t('folder.selectPath', '请先选择存储位置'));
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t('folder.enterName', '请输入名称'));
      return;
    }

    const finalName =
      type === 'file' && !trimmedName.endsWith('.md')
        ? `${trimmedName}.md`
        : trimmedName;

    onConfirm({ type, path: selectedPath, name: finalName });
    resetState();
  };

  const resetState = () => {
    setError('');
    setName('');
    setSelectedPath('');
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const footer = (
    <>
      <button
        onClick={handleClose}
        className="px-4 py-2 rounded text-sm text-text-sub hover:text-text-primary transition-colors"
      >
        {t('settings.cancel')}
      </button>
      <button
        onClick={handleConfirm}
        className="px-4 py-2 rounded text-sm bg-accent text-white hover:bg-accent-hover transition-colors"
      >
        {t('toolbar.confirm')}
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={type === 'file' ? t('file.new') : t('file.newFolder')}
      footer={footer}
    >
      {/* Type tabs */}
      <div className="flex gap-1 mb-4 p-1 rounded bg-bg-tertiary">
        <button
          onClick={() => {
            setType('file');
            setError('');
          }}
          className={`flex-1 py-1.5 rounded text-sm transition-colors ${
            type === 'file'
              ? 'bg-accent text-white'
              : 'text-text-muted hover:text-text-primary'
          }`}
        >
          📄 {t('file.new')}
        </button>
        <button
          onClick={() => {
            setType('folder');
            setError('');
          }}
          className={`flex-1 py-1.5 rounded text-sm transition-colors ${
            type === 'folder'
              ? 'bg-accent text-white'
              : 'text-text-muted hover:text-text-primary'
          }`}
        >
          📁 {t('file.newFolder')}
        </button>
      </div>

      {/* Path selection */}
      <div className="mb-4">
        <label className="block text-sm text-text-sub mb-1">
          {t('folder.location', '存储位置')}
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={selectedPath}
            readOnly
            placeholder={t('folder.selectPath', '请选择存储位置')}
            className="flex-1 px-3 py-2 rounded bg-bg-tertiary border border-border text-sm text-text-primary"
          />
          <button
            onClick={handleSelectPath}
            className="px-3 py-2 rounded bg-accent/20 text-accent text-sm hover:bg-accent/30 transition-colors"
            title={t('folder.selectPath', '请选择存储位置')}
          >
            📁
          </button>
        </div>
      </div>

      {/* Name input */}
      <div className="mb-4">
        <label className="block text-sm text-text-sub mb-1">
          {type === 'file'
            ? t('folder.fileName', '文件名')
            : t('folder.folderName', '文件夹名')}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError('');
          }}
          placeholder={type === 'file' ? 'untitled' : 'New Folder'}
          className="w-full px-3 py-2 rounded bg-bg-tertiary border border-border text-sm text-text-primary focus:border-accent focus:outline-none"
          autoFocus
        />
      </div>

      {/* Error message */}
      {error && <div className="mb-3 text-sm text-red-400">{error}</div>}
    </Modal>
  );
};

export default CreateDialog;