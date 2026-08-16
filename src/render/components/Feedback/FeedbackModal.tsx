// ============================================
// WeaveMD — 问题反馈 Modal
// ============================================
// 帮助菜单「问题反馈」→ 弹层：描述 + 多图（pick-images + media:// 缩略图）+ SMTP 授权码区。
// - 授权码区仿 ModelForm：type=password、hasAuthCode 布尔、已设置隐藏、清空即断开。
// - 明文授权码绝不落渲染：mail.get 仅回 hasAuthCode 布尔；输入值仅在 mail.set 时一次性传主进程。
// - 发送走 mail.send（主进程 stat 权威校验图片 + nodemailer）；hasAuthCode=false 点发送首拦提示。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { toImgSrc } from '@render/editor/kernel/inlineRenderer';

export interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

type SendState = 'idle' | 'sending' | 'success' | 'error';

const FeedbackModal: React.FC<FeedbackModalProps> = ({ open, onClose }) => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);

  const [description, setDescription] = useState('');
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [hasAuthCode, setHasAuthCode] = useState(false);
  const [authInput, setAuthInput] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [sendState, setSendState] = useState<SendState>('idle');
  const descRef = useRef<HTMLTextAreaElement>(null);

  const mail = window.weaveMD?.mail;

  // 打开时重置 + 拉取授权码状态（仅布尔，无明文）
  useEffect(() => {
    if (!open) return;
    setDescription('');
    setImagePaths([]);
    setAuthInput('');
    setMessage(null);
    setSendState('idle');
    if (user && mail) {
      let cancelled = false;
      mail
        .get(user.id)
        .then((res) => {
          if (cancelled) return;
          setHasAuthCode(!!res.success && !!res.data?.hasAuthCode);
        })
        .catch(() => {
          if (!cancelled) setHasAuthCode(false);
        });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id, mail]);

  // Escape 关闭
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const handleAddImages = useCallback(async () => {
    if (!mail) return;
    const res = await mail.pickImages();
    const paths = res?.success ? res.data : null;
    if (paths && paths.length) {
      setMessage(null);
      setImagePaths((prev) => [...prev, ...paths]);
    }
  }, [mail]);

  const handleRemoveImage = useCallback((index: number) => {
    setImagePaths((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSaveAuthCode = useCallback(async () => {
    if (!user || !mail) return;
    const code = authInput.trim();
    const res = await mail.set({ userId: user.id, authCode: code });
    if (res.success && res.data) {
      setHasAuthCode(res.data.hasAuthCode);
      setAuthInput('');
    }
  }, [user, mail, authInput]);

  const handleDisconnect = useCallback(async () => {
    if (!user || !mail) return;
    const res = await mail.set({ userId: user.id, authCode: '' });
    if (res.success && res.data) {
      setHasAuthCode(res.data.hasAuthCode);
    }
  }, [user, mail]);

  const handleSend = useCallback(async () => {
    if (!user || !mail) return;
    setMessage(null);
    const body = description.trim();
    if (!body) {
      setMessage(t('feedback.descriptionRequired'));
      setSendState('error');
      descRef.current?.focus();
      return;
    }
    // 首拦：未配置授权码 → 提示先配置，不静默（不调用 send）
    if (!hasAuthCode && !authInput.trim()) {
      setMessage(t('feedback.authCodeRequired'));
      setSendState('idle');
      return;
    }
    // 若本次输入了授权码先保存
    if (authInput.trim()) {
      const setRes = await mail.set({ userId: user.id, authCode: authInput.trim() });
      if (!setRes.success) {
        setMessage(t('feedback.sendFailed'));
        setSendState('error');
        return;
      }
    }
    setSendState('sending');
    try {
      const res = await mail.send({ userId: user.id, body, imagePaths });
      const inner = res.data;
      if (res.success && inner?.success) {
        setMessage(t('feedback.sendSuccess'));
        setSendState('success');
      } else {
        // 按主进程错误分类映射专属文案（需求⑤：授权码/网络/超时明确提示，不静默、不外透原始 error）
        const code = inner?.error?.code;
        const key =
          code === 'auth_failed'
            ? 'feedback.error.authFailed'
            : code === 'network'
              ? 'feedback.error.network'
              : code === 'timeout'
                ? 'feedback.error.timeout'
                : code === 'invalid_image'
                  ? 'feedback.error.invalidImage'
                  : 'feedback.error.generic';
        setMessage(t(key));
        setSendState('error');
      }
    } catch {
      setMessage(t('feedback.error.generic'));
      setSendState('error');
    }
  }, [user, mail, description, hasAuthCode, authInput, imagePaths, t]);

  if (!open) return null;

  const sending = sendState === 'sending';

  return (
    <div className="insert-url-modal-overlay" role="dialog" aria-modal="true" aria-label={t('feedback.title')}>
      <div className="insert-url-modal feedback-modal">
        <div className="insert-url-modal-header">
          <div className="insert-url-modal-dots" aria-hidden="true">
            <span className="insert-url-modal-dot insert-url-modal-dot--close" />
            <span className="insert-url-modal-dot insert-url-modal-dot--minimize" />
            <span className="insert-url-modal-dot insert-url-modal-dot--zoom" />
          </div>
          <span className="insert-url-modal-title">{t('feedback.title')}</span>
          <button type="button" className="insert-url-modal-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="insert-url-modal-body space-y-4">
          {/* 描述 */}
          <div>
            <label htmlFor="feedback-desc" className="text-[15px] text-[var(--text-primary)] font-medium mb-1.5 block">
              {t('feedback.description')}
            </label>
            <textarea
              id="feedback-desc"
              ref={descRef}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                if (sendState !== 'idle') setSendState('idle');
              }}
              className="w-full border rounded-input px-3 py-2 text-[15px] outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)] min-h-[96px] resize-y"
              placeholder={t('feedback.descriptionPlaceholder')}
            />
          </div>

          {/* 图片 */}
          <div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleAddImages}
                className="px-3 py-1 text-[15px] rounded-input border border-[var(--border-color)] text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors"
              >
                {t('feedback.addImages')}
              </button>
              {imagePaths.length > 0 && (
                <span className="text-[13px] text-[var(--text-muted)]">
                  {imagePaths.length} <span role="img" aria-label="images" />
                </span>
              )}
            </div>
            {imagePaths.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-3">
                {imagePaths.map((p, i) => (
                  <div key={`${p}-${i}`} data-testid="feedback-img-thumb" className="relative">
                    <img
                      src={toImgSrc(p)}
                      alt=""
                      className="w-20 h-20 object-cover rounded-input border border-[var(--border-color)]"
                    />
                    <button
                      type="button"
                      aria-label={t('feedback.removeImage')}
                      onClick={() => handleRemoveImage(i)}
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white text-[12px] leading-none flex items-center justify-center"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 授权码区（仿 ModelForm：hasAuthCode 布尔、明文不落渲染） */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[15px] text-[var(--text-primary)] font-medium">
                {t('feedback.authCode')}
              </label>
            </div>
            {hasAuthCode ? (
              <div className="flex items-center justify-between gap-2 rounded-input border border-[var(--border-color)] bg-[var(--input-bg)] px-3 py-2">
                <span className="text-[15px] text-green-500">{t('feedback.authCodeSet')}</span>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="text-[13px] px-2 py-1 rounded-input border border-[var(--border-color)] text-[var(--text-primary)] hover:border-red-400 hover:text-red-400 transition-colors"
                >
                  {t('feedback.disconnect')}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  data-testid="feedback-auth-input"
                  value={authInput}
                  onChange={(e) => setAuthInput(e.target.value)}
                  placeholder={t('feedback.authCodePlaceholder')}
                  autoComplete="off"
                  className="flex-1 border rounded-input px-3 py-2 text-[15px] outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  onClick={handleSaveAuthCode}
                  className="px-3 py-2 text-[15px] rounded-input bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
                >
                  {t('feedback.reconnect')}
                </button>
              </div>
            )}
            <p className="text-[13px] text-[var(--text-muted)] mt-1">{t('feedback.authHint')}</p>
          </div>

          {/* 状态提示 */}
          {message && (
            <p
              data-testid="feedback-status"
              className={`text-[14px] ${
                sendState === 'success' ? 'text-green-500' : 'text-red-400'
              }`}
            >
              {message}
            </p>
          )}
        </div>

        <div className="insert-url-modal-actions">
          <button type="button" className="insert-url-modal-btn" onClick={onClose}>
            {t('feedback.cancel')}
          </button>
          <button
            type="button"
            disabled={sending}
            onClick={() => void handleSend()}
            className="px-3.5 py-1 text-[15px] rounded-input bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {sending ? t('feedback.sending') : t('feedback.send')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FeedbackModal;
