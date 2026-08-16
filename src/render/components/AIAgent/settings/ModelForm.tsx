// ============================================
// WeaveMD — 设置·模型表单（从 SettingsModal ai Tab 整体迁入，M3）
// ============================================
// 后端选择 / ollama 地址 / remote 地址 / 模型 ID / API 密钥(hasApiKey) /
// 同意开关(allowNetwork+allowSend) / KB 检索参数(topK/fuse/threshold/pinnedWeight/embedding host+model)。
// 保存行为与现状一致：setConfig（key 内部 safeStorage 加密，不落渲染）+ setConsent + setKbSettings。
// 打开/保持时经 ai.getConfig/getConsent 拉取当前配置。无 dangerouslySetInnerHTML、无 any。

import React, { useEffect, useState } from 'react';
import type { ChatBackend, IKbSettings } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';

/** 数值收敛：NaN/越界回退到 fallback，否则夹在 [min, max]。 */
function clampNum(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

const ModelForm: React.FC = () => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const kbSettings = useAgentStore((s) => s.kbSettings);
  const kbSettingsSaveState = useAgentStore((s) => s.kbSettingsSaveState);

  // —— AI 配置表单（内存态草稿，Save 时写回落盘） ——
  const [aiBackend, setAiBackend] = useState<ChatBackend>('ollama');
  const [aiOllamaBaseUrl, setAiOllamaBaseUrl] = useState('http://localhost:11434');
  const [aiRemoteBaseUrl, setAiRemoteBaseUrl] = useState('https://api.deepseek.com');
  const [aiModel, setAiModel] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiHasApiKey, setAiHasApiKey] = useState(false);
  const [aiAllowNetwork, setAiAllowNetwork] = useState(false);
  const [aiAllowSend, setAiAllowSend] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  // —— KB（Agent 知识库）参数表单（内存态草稿，Save 时写回 agentStore.kbSettings） ——
  const [kbTopK, setKbTopK] = useState<number>(kbSettings.topK);
  const [kbFuse, setKbFuse] = useState<number>(kbSettings.fuse);
  const [kbThreshold, setKbThreshold] = useState<number>(kbSettings.threshold);
  const [kbPinnedWeight, setKbPinnedWeight] = useState<number>(kbSettings.pinnedWeight);
  const [kbEmbeddingHost, setKbEmbeddingHost] = useState<string>(kbSettings.embeddingHost);
  const [kbEmbeddingModel, setKbEmbeddingModel] = useState<string>(kbSettings.embeddingModel);

  // 进入时加载配置与同意记录（不落明文 key）；KB 草稿从 agentStore.kbSettings 内存态拉取
  useEffect(() => {
    if (!user) return;
    const ai = window.weaveMD?.ai;
    if (!ai) return;
    let cancelled = false;
    Promise.all([ai.getConfig(user.id), ai.getConsent(user.id)])
      .then(([cfgRes, consentRes]) => {
        if (cancelled) return;
        if (cfgRes.success && cfgRes.data) {
          setAiBackend(cfgRes.data.backend);
          setAiOllamaBaseUrl(cfgRes.data.ollamaBaseUrl);
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

  // KB 草稿同步自内存态源 agentStore.kbSettings（进入/切换时）
  useEffect(() => {
    setKbTopK(kbSettings.topK);
    setKbFuse(kbSettings.fuse);
    setKbThreshold(kbSettings.threshold);
    setKbPinnedWeight(kbSettings.pinnedWeight);
    setKbEmbeddingHost(kbSettings.embeddingHost);
    setKbEmbeddingModel(kbSettings.embeddingModel);
  }, [kbSettings]);

  const handleSave = async () => {
    setSaved(false);
    // KB（Agent 知识库）参数：写回 agentStore.kbSettings（内存态，仅 Agent KB 问答生效）
    const next: IKbSettings = {
      topK: clampNum(kbTopK, 1, 100, 5),
      fuse: clampNum(kbFuse, 0, 1, 0.5),
      threshold: clampNum(kbThreshold, 0, 1, 0.6),
      pinnedWeight: clampNum(kbPinnedWeight, 0.1, 10, 1.5),
      embeddingHost: kbEmbeddingHost.trim() || 'http://localhost:11434',
      embeddingModel: kbEmbeddingModel.trim() || 'nomic-embed-text',
    };
    await useAgentStore.getState().setKbSettings(next);

    // AI 配置：仅当有值才传 apiKey（setConfig 内部 safeStorage 加密，key 不落渲染）
    if (user) {
      setAiLoading(true);
      try {
        const ai = window.weaveMD?.ai;
        if (ai) {
          const cfg: {
            backend: ChatBackend;
            ollamaBaseUrl: string;
            remoteBaseUrl: string;
            model: string;
            apiKey?: string;
          } = {
            backend: aiBackend,
            ollamaBaseUrl: aiOllamaBaseUrl,
            remoteBaseUrl: aiRemoteBaseUrl,
            model: aiModel,
          };
          if (aiApiKey.trim()) cfg.apiKey = aiApiKey.trim();
          await ai.setConfig(user.id, cfg);
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

  return (
    <div className="space-y-5">
      {/* 后端选择 */}
      <div>
        <label className="text-sm text-[var(--text-primary)] font-medium mb-2 block">
          {t('ai.settings.backend')}
        </label>
        <div className="space-y-1">
          <label className="flex items-center gap-3 px-3 py-2 rounded-input hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
            <input
              type="radio"
              name="ai-backend"
              value="ollama"
              checked={aiBackend === 'ollama'}
              onChange={() => setAiBackend('ollama')}
              className="accent-[#7C3AED]"
            />
            <span className="text-sm text-[var(--text-sub)]">{t('ai.settings.backend.ollama')}</span>
          </label>
          <label className="flex items-center gap-3 px-3 py-2 rounded-input hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
            <input
              type="radio"
              name="ai-backend"
              value="remote"
              checked={aiBackend === 'remote'}
              onChange={() => setAiBackend('remote')}
              className="accent-[#7C3AED]"
            />
            <span className="text-sm text-[var(--text-sub)]">{t('ai.settings.backend.remote')}</span>
          </label>
        </div>
      </div>

      {/* Ollama base URL */}
      <div>
        <label className="text-sm text-[var(--text-primary)] font-medium mb-1.5 block">
          {t('ai.settings.ollamaBaseUrl')}
        </label>
        <input
          type="text"
          value={aiOllamaBaseUrl}
          onChange={(e) => setAiOllamaBaseUrl(e.target.value)}
          className="w-full border rounded-input px-3 py-2 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        />
      </div>

      {/* Remote base URL */}
      <div>
        <label className="text-sm text-[var(--text-primary)] font-medium mb-1.5 block">
          {t('ai.settings.remoteBaseUrl')}
        </label>
        <input
          type="text"
          value={aiRemoteBaseUrl}
          onChange={(e) => setAiRemoteBaseUrl(e.target.value)}
          className="w-full border rounded-input px-3 py-2 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        />
      </div>

      {/* Model id */}
      <div>
        <label className="text-sm text-[var(--text-primary)] font-medium mb-1.5 block">
          {t('ai.settings.model')}
        </label>
        <input
          type="text"
          value={aiModel}
          onChange={(e) => setAiModel(e.target.value)}
          placeholder="e.g. qwen3.5 / deepseek-chat"
          className="w-full border rounded-input px-3 py-2 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        />
      </div>

      {/* API key */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm text-[var(--text-primary)] font-medium">
            {t('ai.settings.apiKey')}
          </label>
          {aiHasApiKey && (
            <span className="text-xs text-[var(--text-muted)]">{t('ai.settings.apiKeySet')}</span>
          )}
        </div>
        <input
          type="password"
          value={aiApiKey}
          onChange={(e) => setAiApiKey(e.target.value)}
          placeholder="sk-..."
          autoComplete="off"
          className="w-full border rounded-input px-3 py-2 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        />
        <p className="text-xs text-[var(--text-muted)] mt-1">{t('ai.security.weakKeyring')}</p>
      </div>

      {/* 同意开关 */}
      <div>
        <label className="text-sm text-[var(--text-primary)] font-medium mb-2 block">
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
            <span className="text-sm text-[var(--text-sub)]">{t('ai.settings.allowNetwork')}</span>
          </label>
          <label className="flex items-center gap-3 px-3 py-2 rounded-input hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={aiAllowSend}
              onChange={(e) => setAiAllowSend(e.target.checked)}
              className="accent-[#7C3AED]"
            />
            <span className="text-sm text-[var(--text-sub)]">{t('ai.settings.allowSend')}</span>
          </label>
        </div>
      </div>

      {/* KB（Agent 知识库）参数区 —— 仅 Agent 知识库问答生效 */}
      <div className="border-t border-[var(--border-color)] pt-4">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm text-[var(--text-primary)] font-medium">
            {t('ai.settings.kb.title')}
          </label>
        </div>
        <p className="text-xs text-[var(--text-muted)] mb-3">{t('ai.settings.kb.hint')}</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[var(--text-primary)] font-medium mb-1 block">
              {t('ai.settings.kb.topK')}
            </label>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={Number.isFinite(kbTopK) ? kbTopK : 5}
              onChange={(e) => setKbTopK(e.currentTarget.valueAsNumber)}
              className="w-full border rounded-input px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-primary)] font-medium mb-1 block">
              {t('ai.settings.kb.fuse')}
            </label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={Number.isFinite(kbFuse) ? kbFuse : 0.5}
              onChange={(e) => setKbFuse(e.currentTarget.valueAsNumber)}
              className="w-full border rounded-input px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-primary)] font-medium mb-1 block">
              {t('ai.settings.kb.threshold')}
            </label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={Number.isFinite(kbThreshold) ? kbThreshold : 0.6}
              onChange={(e) => setKbThreshold(e.currentTarget.valueAsNumber)}
              className="w-full border rounded-input px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-primary)] font-medium mb-1 block">
              {t('ai.settings.kb.pinnedWeight')}
            </label>
            <input
              type="number"
              min={0.1}
              max={10}
              step={0.1}
              value={Number.isFinite(kbPinnedWeight) ? kbPinnedWeight : 1.5}
              onChange={(e) => setKbPinnedWeight(e.currentTarget.valueAsNumber)}
              className="w-full border rounded-input px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
            />
          </div>
        </div>

        <div className="mt-3">
          <label className="text-xs text-[var(--text-primary)] font-medium mb-1 block">
            {t('ai.settings.kb.embeddingHost')}
          </label>
          <input
            type="text"
            value={kbEmbeddingHost}
            onChange={(e) => setKbEmbeddingHost(e.target.value)}
            placeholder="http://localhost:11434"
            className="w-full border rounded-input px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
          />
        </div>
        <div className="mt-3">
          <label className="text-xs text-[var(--text-primary)] font-medium mb-1 block">
            {t('ai.settings.kb.embeddingModel')}
          </label>
          <input
            type="text"
            value={kbEmbeddingModel}
            onChange={(e) => setKbEmbeddingModel(e.target.value)}
            placeholder="nomic-embed-text"
            className="w-full border rounded-input px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
          />
        </div>
      </div>

      {/* 保存状态提示 */}
      <div className="flex items-center gap-3">
        {aiLoading && <p className="text-xs text-[var(--text-muted)]">Saving...</p>}
        {saved && <p className="text-xs text-green-500">{t('settings.save')}</p>}
        {kbSettingsSaveState === 'saving' && (
          <p className="text-xs text-[var(--text-muted)]">{t('ai.settings.kb.saving')}</p>
        )}
        {kbSettingsSaveState === 'saved' && (
          <p className="text-xs text-[var(--text-muted)]">{t('ai.settings.kb.saved')}</p>
        )}
        {kbSettingsSaveState === 'error' && (
          <p className="text-xs text-red-400">{t('ai.settings.kb.saveFailed')}</p>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          data-testid="model-form-save"
          onClick={() => void handleSave()}
          disabled={aiLoading}
          className="px-3.5 py-1 text-sm rounded-input bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {t('settings.save')}
        </button>
      </div>
    </div>
  );
};

export default ModelForm;
