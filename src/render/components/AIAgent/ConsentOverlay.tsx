// ============================================
// WeaveMD — 知情同意弹层（铁律二：联网/外发必须知情同意）
// ============================================
// 惰性出现：visible=false 时不渲染。勾选「允许联网」「允许笔记外发」+ 同意并记住。
// 拒绝 -> 回调中止本次请求。

import React, { useState } from 'react';
import { useI18n } from '@render/i18n';

export interface ConsentChoice {
  allowNetwork: boolean;
  allowSend: boolean;
}

interface ConsentOverlayProps {
  visible: boolean;
  onRemember: (choice: ConsentChoice) => void;
  onDeny: () => void;
}

const ConsentOverlay: React.FC<ConsentOverlayProps> = ({ visible, onRemember, onDeny }) => {
  const { t } = useI18n();
  const [allowNetwork, setAllowNetwork] = useState(false);
  const [allowSend, setAllowSend] = useState(false);

  // 惰性出现
  if (!visible) return null;

  return (
    // 父容器 pointer-events-none（AIAgentPanel 的全屏夹层），此处必须重新开启
    // pointer-events-auto，否则遮罩与按钮全部不可点击（同意/拒绝都会"穿透"）。
    <div className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-bg-secondary border border-border shadow-modal p-5 space-y-4">
        <h3 className="text-base font-semibold text-text-primary">{t('ai.consent.title')}</h3>

        <div className="space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={allowNetwork}
              onChange={(e) => setAllowNetwork(e.target.checked)}
              className="mt-0.5 accent-[var(--accent)]"
              aria-label={t('ai.consent.allowNetwork')}
            />
            <span className="text-sm text-text-sub">{t('ai.consent.allowNetwork')}</span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={allowSend}
              onChange={(e) => setAllowSend(e.target.checked)}
              className="mt-0.5 accent-[var(--accent)]"
              aria-label={t('ai.consent.allowSend')}
            />
            <span className="text-sm text-text-sub">{t('ai.consent.allowSend')}</span>
          </label>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => onRemember({ allowNetwork, allowSend })}
            className="flex-1 rounded-input px-3 py-2 text-sm font-medium text-white bg-[var(--accent)] hover:opacity-90 transition-opacity"
          >
            {t('ai.consent.remember')}
          </button>
          <button
            type="button"
            onClick={onDeny}
            className="flex-1 rounded-input px-3 py-2 text-sm font-medium text-text-sub bg-bg-tertiary hover:bg-bg-quaternary transition-colors"
          >
            {t('ai.consent.deny')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConsentOverlay;
