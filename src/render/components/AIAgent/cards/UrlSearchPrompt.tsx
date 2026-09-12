// ============================================
// WeaveMD — URL 搜索提示组件
// ============================================
// 检测消息中的 URL，显示搜索提示，用户可选择搜索或忽略。
// 搜索结果作为可折叠卡片呈现。

import React, { useState, useCallback } from 'react';
import { useI18n } from '@render/i18n';
import Icon from '../../Common/Icon';

interface UrlSearchPromptProps {
  /** 检测到的 URL 列表 */
  urls: string[];
  /** 搜索回调 */
  onSearch: (url: string) => void;
  /** 忽略回调 */
  onIgnore: () => void;
}

const UrlSearchPrompt: React.FC<UrlSearchPromptProps> = ({
  urls,
  onSearch,
  onIgnore,
}) => {
  const { t } = useI18n();
  const [ignored, setIgnored] = useState(false);
  const [searchingUrl, setSearchingUrl] = useState<string | null>(null);

  const handleSearch = useCallback((url: string) => {
    setSearchingUrl(url);
    onSearch(url);
  }, [onSearch]);

  const handleIgnore = useCallback(() => {
    setIgnored(true);
    onIgnore();
  }, [onIgnore]);

  if (ignored || urls.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg border border-border bg-bg-secondary p-3">
      <div className="flex items-center gap-2 mb-2">
        <Icon icon="mdi:link-variant" size={16} className="text-[var(--accent)]" />
        <span className="text-sm text-text-primary font-medium">
          {t('ai.urlDetected', '检测到链接')}
        </span>
      </div>

      <div className="space-y-2">
        {urls.map((url) => (
          <div
            key={url}
            className="flex items-center gap-2 p-2 rounded-md bg-bg-tertiary"
          >
            <div className="flex-1 min-w-0">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--accent)] hover:underline truncate block"
                title={url}
              >
                {url}
              </a>
            </div>

            <button
              type="button"
              onClick={() => handleSearch(url)}
              disabled={searchingUrl === url}
              className="px-3 py-1 text-xs rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {searchingUrl === url ? (
                <span className="flex items-center gap-1">
                  <Icon icon="mdi:loading" size={12} className="animate-spin" />
                  {t('ai.searching', '搜索中...')}
                </span>
              ) : (
                t('ai.searchLink', '搜索此链接')
              )}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={handleIgnore}
          className="px-3 py-1 text-xs rounded-md text-text-sub hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        >
          {t('ai.ignoreLinks', '忽略')}
        </button>
      </div>
    </div>
  );
};

export default UrlSearchPrompt;
