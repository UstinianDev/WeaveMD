// ============================================
// WeaveMD — Help Menu Dropdown
// ============================================

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@render/i18n';
import type { DropdownItem as DropdownItemType } from '@render/components/Common/Dropdown';
import NavMenu from './NavMenu';
import { saveCurrentDraftIfNeeded } from '@render/services/saveCurrentDraft';

/** Update event payload from main process (matches UpdateEvent in main/update.ts). */
interface UpdateEvent {
  state: string;
  version?: string;
  releaseNotes?: string;
  progress?: { percent: number; transferred: number; total: number };
  error?: string;
}

interface HelpMenuProps {
  onOpenFeedback: () => void;
}

const HelpMenu: React.FC<HelpMenuProps> = ({ onOpenFeedback }) => {
  const { t } = useI18n();
  const [version, setVersion] = useState('...');
  const [updateState, setUpdateState] = useState<string>('idle');
  const [updateVersion, setUpdateVersion] = useState<string | undefined>(undefined);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [updateError, setUpdateError] = useState<string | undefined>(undefined);
  const [hasUnreadUpdate, setHasUnreadUpdate] = useState(false); // 红点提示

  // Fetch current app version
  useEffect(() => {
    window.weaveMD.version
      .get()
      .then((v: string) => setVersion(v))
      .catch(() => {});
  }, []);

  // Subscribe to update events from main process
  useEffect(() => {
    const unsub = window.weaveMD.update.onEvent((evt: unknown) => {
      const event = evt as UpdateEvent;
      setUpdateState(event.state);
      if (event.version) setUpdateVersion(event.version);
      if (event.error) setUpdateError(event.error); else setUpdateError(undefined);
      if (event.progress?.percent !== undefined) {
        setDownloadPercent(Math.round(event.progress.percent));
      }
      // 有可用更新时显示红点
      if (event.state === 'available') {
        setHasUnreadUpdate(true);
      }
    });
    return unsub;
  }, []);

  const handleCheckUpdate = useCallback(() => {
    setUpdateState('checking');
    setHasUnreadUpdate(false); // 清除红点
    void window.weaveMD.update.check().catch(() => {});
  }, []);

  const handleDownload = useCallback(async () => {
    // 先保存当前文档
    const saved = await saveCurrentDraftIfNeeded();
    if (!saved) {
      console.warn('[HelpMenu] Failed to save draft before update');
    }
    // 然后下载安装包
    void window.weaveMD.update.download().catch(() => {});
  }, []);

  const handleInstall = useCallback(async () => {
    // 先保存当前文档
    const saved = await saveCurrentDraftIfNeeded();
    if (!saved) {
      console.warn('[HelpMenu] Failed to save draft before install');
    }
    // 然后重启安装
    void window.weaveMD.update.quitAndInstall();
  }, []);

  const handleSkipVersion = useCallback(() => {
    if (updateVersion) {
      void window.weaveMD.update.skipVersion(updateVersion).catch(() => {});
    }
    setUpdateState('idle');
  }, [updateVersion]);

  // Build update status label
  const updateStatusLabel = (): string => {
    switch (updateState) {
      case 'checking':
        return t('update.checking');
      case 'available':
        return `${t('update.available')} (v${updateVersion ?? '?'})`;
      case 'not-available':
        return t('update.notAvailable');
      case 'downloading':
        return `${t('update.downloading')} ${downloadPercent}%`;
      case 'downloaded':
        return t('update.downloaded');
      case 'error':
        return updateError ? `${t('update.error')}: ${updateError}` : t('update.error');
      default:
        return '';
    }
  };

  const items: DropdownItemType[] = [
    {
      label: t('feedback.title'),
      onClick: onOpenFeedback,
    },
    { type: 'divider' },
    // Update status line (when not idle)
    ...(updateState !== 'idle'
      ? [
          {
            label: updateStatusLabel(),
            disabled: true,
          },
        ]
      : []),
    // Available: 显示新版本提示 + 跳过 + 立即下载
    ...(updateState === 'available'
      ? [
          {
            label: `🎉 ${t('update.newVersion', '新版本可用')}`,
            disabled: true,
          },
          {
            label: t('update.skip', '跳过此版本'),
            onClick: handleSkipVersion,
          },
          {
            label: t('update.downloadNow', '立即下载'),
            onClick: () => void handleDownload(),
          },
        ]
      : []),
    // Downloaded: 重启安装
    ...(updateState === 'downloaded'
      ? [
          {
            label: t('update.install', '重启并安装'),
            onClick: () => void handleInstall(),
          },
        ]
      : []),
    // Idle / not-available / error: 检查更新
    ...(updateState === 'idle' || updateState === 'not-available' || updateState === 'error'
      ? [
          {
            label: t('update.checkNow', '检查更新'),
            onClick: handleCheckUpdate,
          },
        ]
      : []),
    { type: 'divider' },
    {
      label: t('navbar.version', 'Version {version}').replace('{version}', version),
      disabled: true,
    },
  ];

  return (
    <NavMenu
      icon={
        <span className="relative">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          {/* 红点提示 */}
          {hasUnreadUpdate && (
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          )}
        </span>
      }
      tooltip="navbar.help"
      items={items}
      width={200}
    />
  );
};

export default HelpMenu;
