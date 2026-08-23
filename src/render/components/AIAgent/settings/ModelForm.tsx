// ============================================
// WeaveMD — 设置·模型表单（从 SettingsModal ai Tab 整体迁入，M3）
// ============================================
// remote 地址 / 模型 ID / API 密钥(hasApiKey) / ④当前提供商状态与断开连接 /
// 同意开关(allowNetwork+allowSend)。
// 唯一后端为 remote。保存行为与现状一致：setConfig（key 内部 safeStorage 加密，不落渲染）+
// setConsent。打开/保持时经 ai.getConfig/getConsent 拉取当前配置。
// 断开连接（④）：清 key 即断开，setConfig({apiKey:''}) → hasApiKey=false → 状态行显示「未配置」。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useEffect, useState } from 'react';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';

const ModelForm: React.FC = () => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const storeConfig = useAgentStore((s) => s.config);

  // —— AI 配置表单（内存态草稿，Save 时写回落盘） ——
  const [aiRemoteBaseUrl, setAiRemoteBaseUrl] = useState('https://api.deepseek.com');
  const [aiModel, setAiModel] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiHasApiKey, setAiHasApiKey] = useState(false);
  const [aiAllowNetwork, setAiAllowNetwork] = useState(false);
  const [aiAllowSend, setAiAllowSend] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  // 进入时加载配置与同意记录（不落明文 key）
  useEffect(() => {
    if (!user) return;
    const ai = window.weaveMD?.ai;
    if (!ai) return;
    let cancelled = false;
    Promise.all([ai.getConfig(user.id), ai.getConsent(user.id)])
      .then(([cfgRes, consentRes]) => {
        if (cancelled) return;
        if (cfgRes.success && cfgRes.data) {
          setAiRemoteBaseUrl(cfgRes.data.remoteBaseUrl);
          setAiModel(cfgRes.data.model);
          setAiHasApiKey(cfgRes.data.hasApiKey);
        }
        if (consentRes.success && consentRes.data) {
          setAiAllowNetwork(consentRes.data.allowNetwork);
          setAiAllowSend(consentRes.data.allowSend);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleSave = async () => {
    setSaved(false);

    // AI 配置：仅当有值才传 apiKey（setConfig 内部 safeStorage 加密，key 不落渲染）
    if (user) {
      setAiLoading(true);
      try {
        const ai = window.weaveMD?.ai;
        if (ai) {
          const cfg: {
            backend: 'remote';
            remoteBaseUrl: string;
            model: string;
            apiKey?: string;
          } = {
            backend: 'remote',
            remoteBaseUrl: aiRemoteBaseUrl,
            model: aiModel,
          };
          if (aiApiKey.trim()) cfg.apiKey = aiApiKey.trim();
          const res = await ai.setConfig(user.id, cfg);
          // ④ 同步最新 provider 状态（含重填 key 后的连接恢复），避免 store/local 状态陈旧
          if (res.success && res.data) {
            setAiHasApiKey(res.data.hasApiKey);
            useAgentStore.setState({ config: res.data });
          }
          await ai.setConsent(user.id, {
            allowNetwork: aiAllowNetwork,
            allowSend: aiAllowSend,
            consentUpdatedAt: new Date().toISOString(),
          });
        }
      } catch {
        // 保存失败静默（主进程侧错误），不阻断关闭
      } finally {
        setAiLoading(false);
        setSaved(true);
      }
    }
  };

  // ④ 断开连接：清 key 即断开（setConfig({apiKey:''}) → hasApiKey=false），并同步 store 状态
  const handleDisconnect = async () => {
    if (!user) return;
    const ai = window.weaveMD?.ai;
    if (!ai) return;
    try {
      const res = await ai.setConfig(user.id, { apiKey: '' });
      if (res.success && res.data) {
        setAiHasApiKey(false);
        setAiApiKey('');
        useAgentStore.setState({ config: res.data });
      }
    } catch {
      // 断开失败静默（主进程侧错误），不阻断 UI
    }
  };

  // ④ 提供商状态数据源：优先读 agentStore.config（store init 拉取），本地 aiHasApiKey 兜底（表单独立加载）
  // —— 避免脏读：断开后本地同步置 false，store.config 由 handleDisconnect 回写，两者一致
  const effectiveHasApiKey = storeConfig?.hasApiKey ?? aiHasApiKey;
  const effectiveRemoteBaseUrl = storeConfig?.remoteBaseUrl || aiRemoteBaseUrl;
  const providerConnected = effectiveHasApiKey;
  const remoteHost = (() => {
    try {
      return new URL(effectiveRemoteBaseUrl).host || '';
    } catch {
      return '';
    }
  })();

  return (
    <div className="space-y-5">
      {/* Remote base URL */}
      <div>
        <label className="text-[15px] text-[var(--text-primary)] font-medium mb-1.5 block">
          {t('ai.settings.remoteBaseUrl')}
        </label>
        <input
          type="text"
          value={aiRemoteBaseUrl}
          onChange={(e) => setAiRemoteBaseUrl(e.target.value)}
          className="w-full border rounded-input px-3 py-2 text-[15px] outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        />
      </div>

      {/* Model id */}
      <div>
        <label className="text-[15px] text-[var(--text-primary)] font-medium mb-1.5 block">
          {t('ai.settings.model')}
        </label>
        <input
          type="text"
          value={aiModel}
          onChange={(e) => setAiModel(e.target.value)}
          placeholder="e.g. qwen3.5 / deepseek-chat"
          className="w-full border rounded-input px-3 py-2 text-[15px] outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        />
      </div>

      {/* API key */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[15px] text-[var(--text-primary)] font-medium">
            {t('ai.settings.apiKey')}
          </label>
          {aiHasApiKey && (
            <span className="text-[13px] text-[var(--text-muted)]">{t('ai.settings.apiKeySet')}</span>
          )}
        </div>
        <input
          type="password"
          value={aiApiKey}
          onChange={(e) => setAiApiKey(e.target.value)}
          placeholder="sk-..."
          autoComplete="off"
          className="w-full border rounded-input px-3 py-2 text-[15px] outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        />
        <p className="text-[13px] text-[var(--text-muted)] mt-1">{t('ai.security.weakKeyring')}</p>
      </div>

      {/* ④ 当前提供商状态与断开连接：清 key 即断开 → hasApiKey=false → 显示「未配置」 */}
      <div>
        <label className="text-[15px] text-[var(--text-primary)] font-medium mb-1.5 block">
          {t('ai.settings.backend')}
        </label>
        {providerConnected ? (
          <div className="flex items-center justify-between gap-2 rounded-input border border-[var(--border-color)] bg-[var(--input-bg)] px-3 py-2">
            <span className="text-[15px] text-green-500">
              {remoteHost
                ? `${t('ai.settings.provider.connected')} · ${remoteHost}`
                : t('ai.settings.provider.connected')}
            </span>
            <button
              type="button"
              data-testid="provider-disconnect"
              onClick={() => void handleDisconnect()}
              className="text-[13px] px-2 py-1 rounded-input border border-[var(--border-color)] text-[var(--text-primary)] hover:border-red-400 hover:text-red-400 transition-colors"
            >
              {t('ai.settings.disconnect')}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-[15px] text-[var(--text-muted)]">
              {t('ai.settings.provider.disconnected')}
            </span>
            <span className="text-[13px] text-[var(--text-muted)]">{t('ai.settings.reconnect')}</span>
          </div>
        )}
      </div>

      {/* 同意开关 */}
      <div>
        <label className="text-[15px] text-[var(--text-primary)] font-medium mb-2 block">
          {t('ai.settings.allowNetwork')}
        </label>
        <div className="space-y-2">
          <label className="flex items-center gap-3 px-3 py-2 rounded-input hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={aiAllowNetwork}
              onChange={(e) => setAiAllowNetwork(e.target.checked)}
              className="accent-[#7C3AED]"
            />
            <span className="text-[15px] text-[var(--text-sub)]">{t('ai.settings.allowNetwork')}</span>
          </label>
          <label className="flex items-center gap-3 px-3 py-2 rounded-input hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={aiAllowSend}
              onChange={(e) => setAiAllowSend(e.target.checked)}
              className="accent-[#7C3AED]"
            />
            <span className="text-[15px] text-[var(--text-sub)]">{t('ai.settings.allowSend')}</span>
          </label>
        </div>
      </div>

      {/* 保存状态提示 */}
      <div className="flex items-center gap-3">
        {aiLoading && <p className="text-[13px] text-[var(--text-muted)]">Saving...</p>}
        {saved && <p className="text-[13px] text-green-500">{t('settings.save')}</p>}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          data-testid="model-form-save"
          onClick={() => void handleSave()}
          disabled={aiLoading}
          className="px-3.5 py-1 text-[15px] rounded-input bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {t('settings.save')}
        </button>
      </div>
    </div>
  );
};

export default ModelForm;
