// ============================================
// WeaveMD — 设置·Embedding 配置面板（R1 多提供商 + R12 多模态）
// ============================================
// 提供商选择 / Base URL / 模型名称 / Dimension / API Key / 多模态开关 / 测试连接 / 保存。
// 数据流：embeddingConfig.get / .set IPC。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useEffect, useState, useCallback } from 'react';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';

type EmbeddingProvider = 'openai' | 'qwen' | 'doubao' | 'zhipu' | 'custom';

const PROVIDERS: { key: EmbeddingProvider; label: string; defaultModel: string; defaultBase: string; defaultDim: number }[] = [
  { key: 'openai', label: 'OpenAI', defaultModel: 'text-embedding-3-small', defaultBase: 'https://api.openai.com', defaultDim: 1536 },
  { key: 'qwen', label: '通义千问', defaultModel: 'text-embedding-v3', defaultBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultDim: 1024 },
  { key: 'doubao', label: '豆包', defaultModel: 'doubao-embedding', defaultBase: 'https://ark.cn-beijing.volces.com', defaultDim: 2048 },
  { key: 'zhipu', label: '智谱', defaultModel: 'embedding-3', defaultBase: 'https://open.bigmodel.cn', defaultDim: 2048 },
  { key: 'custom', label: '自定义', defaultModel: '', defaultBase: '', defaultDim: 1536 },
];

/** 旧版默认 URL → 新版映射，加载时自动修正已保存的过期地址。 */
const DEPRECATED_BASE_URLS: Record<string, string> = {
  'https://dashscope.aliyuncs.com': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
};

const EmbeddingSettings: React.FC = () => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);

  const [provider, setProvider] = useState<EmbeddingProvider>('qwen');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [dimension, setDimension] = useState(1024);
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [multimodal, setMultimodal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  /** 切换提供商时自动填充默认值。 */
  const handleProviderChange = useCallback((newProvider: EmbeddingProvider) => {
    setProvider(newProvider);
    const preset = PROVIDERS.find((p) => p.key === newProvider);
    if (preset) {
      setBaseUrl(preset.defaultBase);
      setModel(preset.defaultModel);
      setDimension(preset.defaultDim);
    }
  }, []);

  // 加载已保存配置
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await window.weaveMD.ai.embeddingConfig.get(user.id);
        if (cancelled) return;
        if (res.success && res.data) {
          if (res.data.provider) setProvider(res.data.provider as EmbeddingProvider);
          // 自动修正已保存的过期 Base URL
          const migratedUrl = DEPRECATED_BASE_URLS[res.data.baseUrl] ?? res.data.baseUrl;
          setBaseUrl(migratedUrl);
          setModel(res.data.model);
          if (res.data.dimension) setDimension(res.data.dimension);
          setHasApiKey(res.data.hasApiKey);
          setMultimodal(res.data.multimodal);
        }
      } catch {
        /* 静默 */
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleTest = async (): Promise<void> => {
    if (!user) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.weaveMD.ai.embedding.test({
        baseUrl,
        model,
        apiKey: apiKey.trim(),
        userId: user.id,
      });
      const ok = res.success;
      setTestResult(ok ? 'ok' : 'fail');
      useAgentStore.setState({ embeddingConnectionOk: ok });
    } catch {
      setTestResult('fail');
      useAgentStore.setState({ embeddingConnectionOk: false });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!user) return;
    setSaving(true);
    setSaved(false);
    try {
      const payload: {
        provider?: string;
        baseUrl?: string;
        model?: string;
        dimension?: number;
        apiKey?: string;
        multimodal?: boolean;
      } = {
        provider,
        baseUrl,
        model,
        dimension,
        multimodal,
      };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      const res = await window.weaveMD.ai.embeddingConfig.set(user.id, payload);
      if (res.success && res.data) {
        setHasApiKey(res.data.hasApiKey);
      }
      // 刷新 store + 根据保存结果标记连接状态
      await useAgentStore.getState().refreshEmbeddingConfig();
      useAgentStore.setState({ embeddingConnectionOk: Boolean(res.success && res.data?.hasApiKey) });
      setSaved(true);
    } catch {
      /* 静默 */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5" style={{ fontFamily: "Consolas, 'Alibaba PuHuiTi 2.0', '阿里巴巴普惠体', sans-serif" }}>
      {/* 提供商选择 */}
      <div>
        <label className="text-[14px] text-[var(--text-primary)] font-medium mb-1.5 block">
          {t('ai.settings.embedding.provider', 'Embedding 提供商')}
        </label>
        <div className="flex gap-1 p-1 rounded-input bg-[var(--bg-tertiary)]">
          {PROVIDERS.map((p) => (
            <button
              key={p.key}
              type="button"
              data-testid={`embedding-provider-${p.key}`}
              onClick={() => handleProviderChange(p.key)}
              className={`flex-1 px-2 py-1.5 text-[13px] rounded-input transition-colors ${
                provider === p.key
                  ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm border border-[var(--border-color)]'
                  : 'text-[var(--text-sub)] hover:text-[var(--text-primary)]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Base URL */}
      <div>
        <label className="text-[14px] text-[var(--text-primary)] font-medium mb-1.5 block">
          {t('ai.settings.embedding.baseUrl', 'Base URL')}
        </label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={PROVIDERS.find((p) => p.key === provider)?.defaultBase || 'https://api.openai.com'}
          className="w-full border rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#2563eb] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        />
      </div>

      {/* 模型名称 */}
      <div>
        <label className="text-[14px] text-[var(--text-primary)] font-medium mb-1.5 block">
          {t('ai.settings.embedding.model', '模型名称')}
        </label>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={PROVIDERS.find((p) => p.key === provider)?.defaultModel || 'text-embedding-v3'}
          className="w-full border rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#2563eb] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        />
      </div>

      {/* Dimension */}
      <div>
        <label className="text-[14px] text-[var(--text-primary)] font-medium mb-1.5 block">
          {t('ai.settings.embedding.dimension', '向量维度')}
        </label>
        <input
          type="number"
          value={dimension}
          onChange={(e) => setDimension(Number(e.target.value) || 1536)}
          min={64}
          max={4096}
          className="w-full border rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#2563eb] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        />
        <p className="text-[12px] text-[var(--text-muted)] mt-1">
          {t('ai.settings.embedding.dimensionHint', '修改后需重新索引知识库才能生效')}
        </p>
      </div>

      {/* API Key */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[14px] text-[var(--text-primary)] font-medium">
            {t('ai.settings.apiKey')}
          </label>
          {hasApiKey && (
            <span className="text-[12px] text-[var(--text-muted)]">{t('ai.settings.apiKeySet')}</span>
          )}
        </div>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          autoComplete="off"
          className="w-full border rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#2563eb] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        />
      </div>

      {/* 多模态开关（R12） */}
      <div>
        <label className="flex items-center gap-3 px-3 py-2 rounded-input hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
          <input
            type="checkbox"
            checked={multimodal}
            onChange={(e) => setMultimodal(e.target.checked)}
            className="accent-[#2563eb]"
          />
          <div>
            <span className="text-[14px] text-[var(--text-sub)]">
              {t('ai.settings.embedding.multimodal', '启用多模态向量')}
            </span>
            <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
              需要视觉 Embedding 模型（如 qwen-vl-embed-v1）
            </p>
          </div>
        </label>
      </div>

      {/* 测试结果 */}
      {testResult && (
        <p className={`text-[13px] ${testResult === 'ok' ? 'text-green-500' : 'text-red-400'}`}>
          {testResult === 'ok'
            ? t('ai.settings.embedding.testOk', '连接成功')
            : t('ai.settings.embedding.testFail', '连接失败')}
        </p>
      )}

      {/* 保存状态 */}
      {saving && <p className="text-[13px] text-[var(--text-muted)]">Saving...</p>}
      {saved && <p className="text-[13px] text-green-500">{t('settings.save')}</p>}

      {/* 操作按钮 */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          data-testid="embedding-test"
          onClick={() => void handleTest()}
          disabled={testing}
          className="px-3.5 py-1 text-[14px] rounded-input border border-[var(--border-color)] text-[var(--text-primary)] hover:border-[#2563eb] hover:text-[#2563eb] disabled:opacity-40 transition-colors"
        >
          {testing
            ? t('ai.settings.embedding.testing', '测试中...')
            : t('ai.settings.embedding.test', '测试连接')}
        </button>
        <button
          type="button"
          data-testid="embedding-save"
          onClick={() => void handleSave()}
          disabled={saving}
          className="px-3.5 py-1 text-[14px] rounded-input bg-[#2563eb] text-white hover:bg-[#1d4ed8] disabled:opacity-40 transition-colors"
        >
          {t('settings.save')}
        </button>
      </div>
    </div>
  );
};

export default EmbeddingSettings;
