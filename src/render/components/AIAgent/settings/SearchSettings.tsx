// ============================================
// WeaveMD — 设置·搜索配置面板（Phase 5 重写）
// ============================================
// 总开关 + 服务商 SegmentedTabs + API Key + 调用模式 + 结果数滑动条 + 测试连接。
// 数据流：searchConfig.get / .set IPC + search.test IPC。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useEffect, useState } from 'react';
import type { SearchProvider } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';

const PROVIDERS: { key: SearchProvider; label: string }[] = [
  { key: 'firecrawl', label: 'Firecrawl' },
  { key: 'zhipu', label: '智谱' },
  { key: 'tavily', label: 'Tavily' },
  { key: 'exa', label: 'Exa' },
];

const SearchSettings: React.FC = () => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);

  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<SearchProvider>('firecrawl');
  const [callMode, setCallMode] = useState('scrape_and_search');
  const [maxResults, setMaxResults] = useState(10);
  const [apiKeys, setApiKeys] = useState<Record<SearchProvider, string>>({
    firecrawl: '',
    zhipu: '',
    tavily: '',
    exa: '',
  });
  const [hasApiKeys, setHasApiKeys] = useState<Record<SearchProvider, boolean>>({
    firecrawl: false,
    zhipu: false,
    tavily: false,
    exa: false,
  });
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
        const res = await window.weaveMD.ai.searchConfig.get(user.id);
        if (cancelled) return;
        if (res.success && res.data) {
          setEnabled(res.data.enabled);
          setProvider(res.data.provider);
          setCallMode(res.data.callMode);
          setMaxResults(res.data.maxResults);
          setHasApiKeys(res.data.hasApiKeys);
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

  const handleApiKeyChange = (prov: SearchProvider, value: string): void => {
    setApiKeys((prev) => ({ ...prev, [prov]: value }));
  };

  const handleTest = async (): Promise<void> => {
    if (!user) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.weaveMD.ai.search.test({
        provider,
        apiKey: apiKeys[provider].trim(),
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
      // 收集所有非空 API Key
      const keys: Partial<Record<SearchProvider, string>> = {};
      for (const p of PROVIDERS) {
        if (apiKeys[p.key].trim()) {
          keys[p.key] = apiKeys[p.key].trim();
        }
      }
      const res = await window.weaveMD.ai.searchConfig.set(user.id, {
        enabled,
        provider,
        callMode,
        maxResults,
        apiKeys: keys,
      });
      if (res.success && res.data) {
        setHasApiKeys(res.data.hasApiKeys);
      }
      // 刷新 store
      await useAgentStore.getState().refreshSearchConfig();
      setSaved(true);
    } catch {
      /* 静默 */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* 总开关 */}
      <div>
        <label className="flex items-center gap-3 px-3 py-2 rounded-input hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="accent-[#7C3AED]"
          />
          <span className="text-[14px] text-[var(--text-primary)] font-medium">
            {t('ai.settings.search.enabled', '启用联网搜索')}
          </span>
        </label>
      </div>

      {/* 搜索服务商 SegmentedTabs */}
      <div>
        <label className="text-[14px] text-[var(--text-primary)] font-medium mb-1.5 block">
          {t('ai.settings.search.provider', '搜索服务商')}
        </label>
        <div className="flex gap-1 p-1 rounded-input bg-[var(--bg-tertiary)]">
          {PROVIDERS.map((p) => (
            <button
              key={p.key}
              type="button"
              data-testid={`search-provider-${p.key}`}
              onClick={() => setProvider(p.key)}
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

      {/* 当前服务商 API Key */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[14px] text-[var(--text-primary)] font-medium">
            {t('ai.settings.search.apiKey', 'API Key')} — {PROVIDERS.find((p) => p.key === provider)?.label}
          </label>
          {hasApiKeys[provider] && (
            <span className="text-[12px] text-[var(--text-muted)]">{t('ai.settings.apiKeySet')}</span>
          )}
        </div>
        <input
          type="password"
          value={apiKeys[provider]}
          onChange={(e) => handleApiKeyChange(provider, e.target.value)}
          placeholder="sk-..."
          autoComplete="off"
          className="w-full border rounded-input px-3 py-2 text-[14px] outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        />
      </div>

      {/* 调用模式 */}
      <div>
        <label className="text-[14px] text-[var(--text-primary)] font-medium mb-1.5 block">
          调用模式
        </label>
        <div className="px-3 py-2 rounded-input border border-[var(--border-color)] bg-[var(--input-bg)]">
          <span className="text-[14px] text-[var(--text-primary)]">{callMode}</span>
          <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
            scrape & search — 使用 Firecrawl 默认抓取和搜索组合
          </p>
        </div>
      </div>

      {/* 每次返回结果数 */}
      <div>
        <label className="text-[14px] text-[var(--text-primary)] font-medium mb-1.5 block">
          每次返回结果数
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={50}
            value={maxResults}
            onChange={(e) => setMaxResults(Number(e.target.value))}
            className="flex-1 accent-[#7C3AED]"
          />
          <span className="text-[14px] text-[var(--text-primary)] w-8 text-right">{maxResults}</span>
        </div>
      </div>

      {/* 测试结果 */}
      {testResult && (
        <p className={`text-[13px] ${testResult === 'ok' ? 'text-green-500' : 'text-red-400'}`}>
          {testResult === 'ok'
            ? t('ai.settings.search.testOk', '连接成功')
            : t('ai.settings.search.testFail', '连接失败')}
        </p>
      )}

      {/* 保存状态 */}
      {saving && <p className="text-[13px] text-[var(--text-muted)]">Saving...</p>}
      {saved && <p className="text-[13px] text-green-500">{t('settings.save')}</p>}

      {/* 操作按钮 */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          data-testid="search-test"
          onClick={() => void handleTest()}
          disabled={testing}
          className="px-3.5 py-1 text-[14px] rounded-input border border-[var(--border-color)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40 transition-colors"
        >
          {testing
            ? t('ai.settings.search.testing', '测试中...')
            : t('ai.settings.search.test', '测试连接')}
        </button>
        <button
          type="button"
          data-testid="search-save"
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

export default SearchSettings;
