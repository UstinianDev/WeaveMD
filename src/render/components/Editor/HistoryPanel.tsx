// ============================================
// WeaveMD — History Panel (Slide-out)
// ============================================

import React, { useState, useEffect, useMemo } from 'react';
import { useHistoryStore } from '../../stores/historyStore';
import { useAuthStore } from '../../stores/authStore';
import { useEditorStore } from '../../stores/editorStore';
import type { IFile } from '../../../shared/types';

interface HistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const HistoryPanel: React.FC<HistoryPanelProps> = ({ isOpen, onClose }) => {
  const files = useHistoryStore((s) => s.files);
  const searchQuery = useHistoryStore((s) => s.searchQuery);
  const searchHistory = useHistoryStore((s) => s.searchHistory);
  const loadHistory = useHistoryStore((s) => s.loadHistory);
  const deleteHistoryFile = useHistoryStore((s) => s.deleteHistoryFile);
  const user = useAuthStore((s) => s.user);
  const openFile = useEditorStore((s) => s.openFile);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && user) {
      setLoading(true);
      loadHistory(user.id).finally(() => setLoading(false));
    }
  }, [isOpen, user, loadHistory]);

  const filteredFiles = useMemo(() =>
    files.filter((f) =>
      !searchQuery || f.name.toLowerCase().includes(searchQuery.toLowerCase())
    ), [files, searchQuery]);

  const handleOpenFile = (file: IFile) => {
    openFile(file);
    onClose();
  };

  const handleDeleteFile = async (fileId: string) => {
    if (!user) return;
    await deleteHistoryFile(fileId);
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-[280px] bg-bg-secondary border-r border-border shadow-modal slide-in-left flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-white">History</h3>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-white transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <div className="relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => searchHistory(e.target.value)}
              placeholder="Search files..."
              className="w-full bg-bg-primary border border-border rounded-input pl-8 pr-3 py-1.5 text-xs text-white placeholder-text-muted outline-none focus:border-accent transition-colors"
            />
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-text-muted">Loading...</p>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-text-muted">
                {searchQuery ? 'No matching files' : 'No files yet'}
              </p>
            </div>
          ) : (
            filteredFiles.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-tertiary cursor-pointer transition-colors group"
                onClick={() => handleOpenFile(file)}
              >
                <span className="text-sm">📄</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-sub truncate">{file.name}</p>
                  <p className="text-xs text-text-muted">{formatDate(file.modifiedAt)}</p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteFile(file.id);
                  }}
                  className="text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                  title="Delete"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default HistoryPanel;
