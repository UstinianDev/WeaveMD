// ============================================
// WeaveMD — 设置·Embedding 配置面板（Phase 5 重写）
// ============================================
// Base URL / 模型名称 / API Key / 多模态开关 / 测试连接 / 保存。
// 数据流：embeddingConfig.get / .set IPC。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useEffect, useState } from 'react';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';

const EmbeddingSettings: React.FC = () => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);

  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [multimodal, setMultimodal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // 加载已保存配置
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await window.weaveMD.ai.embeddingConfig.get(user.id);
        if (cancelled) return;
        if (res.success && res.data) {
          setBaseUrl(res.data.baseUrl);
          setModel(res.data.model);
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
      setTestResult(res.success ? 'ok' : 'fail');
    } catch {
      setTestResult('fail');
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
        baseUrl?: string;
        model?: string;
        apiKey?: string;
        multimodal?: boolean;
      } = {
        baseUrl,
        model,
        multimodal,
      };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      const res = await window.weaveMD.ai.embeddingConfig.set(user.id, payload);
      if (res.success && res.data) {
        setHasApiKey(res.data.hasApiKey);
      }
      // 刷新 store
      await useAgentStore.getState().refreshEmbeddingConfig();
      setSaved(true);
    } catch {
      /* 静默 */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Base URL */}
      <div>
        <label className="text-[14px] text-[var(--text-primary)] font-medium mb-1.5 block">
          {t('ai.settings.embedding.baseUrl', 'Base URL')}
        </label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
          className="w-full border rounded-input px-3 py-2 text-[14px] outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
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
          placeholder="text-embedding-v3"
          className="w-full border rounded-input px-3 py-2 text-[14px] outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        />
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
          className="w-full border rounded-input px-3 py-2 text-[14px] outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        />
      </div>

      {/* 多模态开关 */}
      <div>
        <label className="flex items-center gap-3 px-3 py-2 rounded-input hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
          <input
            type="checkbox"
            checked={multimodal}
            onChange={(e) => setMultimodal(e.target.checked)}
            className="accent-[#7C3AED]"
          />
          <span className="text-[14px] text-[var(--text-sub)]">
            {t('ai.settings.embedding.multimodal', '启用多模态向量')}
          </span>
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
          className="px-3.5 py-1 text-[14px] rounded-input border border-[var(--border-color)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40 transition-colors"
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
          className="px-3.5 py-1 text-[14px] rounded-input bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {t('settings.save')}
        </button>
      </div>
    </div>
  );
};

export default EmbeddingSettings;
