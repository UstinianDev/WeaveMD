// ============================================
// WeaveMD — 设置·模型配置（Phase 5 重写：双视图）
// ============================================
// 视图 A：配置列表（激活/删除）+ 视图 B：新建配置表单。
// 数据流：modelConfigs.list / .create / .delete / .activate IPC。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useEffect, useState } from 'react';
import type { ModelProtocol } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';

// —— 协议/提供商选项 ——
const PROTOCOL_OPTIONS: { value: ModelProtocol; label: string }[] = [
  { value: 'openai', label: 'OpenAI API' },
  { value: 'anthropic', label: 'Anthropic' },
];

const PROVIDER_OPTIONS: { value: string; protocol: ModelProtocol; label: string }[] = [
  { value: 'OpenAI', protocol: 'openai', label: 'OpenAI' },
  { value: 'Anthropic', protocol: 'anthropic', label: 'Anthropic' },
  { value: 'Custom', protocol: 'openai', label: 'Custom' },
];

const PROTOCOL_BASE_URL_PLACEHOLDER: Record<ModelProtocol, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
};

type ViewMode = 'list' | 'create';

const ModelForm: React.FC = () => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const modelConfigs = useAgentStore((s) => s.modelConfigs);
  const activeModelConfigId = useAgentStore((s) => s.activeModelConfigId);

  const [view, setView] = useState<ViewMode>('list');

  // —— 新建表单草稿 ——
  const [formProtocol, setFormProtocol] = useState<ModelProtocol>('openai');
  const [formProvider, setFormProvider] = useState('OpenAI');
  const [formBaseUrl, setFormBaseUrl] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formHint, setFormHint] = useState('');
  const [saving, setSaving] = useState(false);

  // 加载模型配置列表
  useEffect(() => {
    if (!user) return;
    void useAgentStore.getState().refreshModelConfigs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // —— 激活配置 ——
  const handleActivate = async (configId: string): Promise<void> => {
    if (!user) return;
    try {
      const res = await window.weaveMD.ai.modelConfigs.activate(user.id, configId);
      if (res.success && res.data) {
        useAgentStore.setState({
          config: res.data,
          activeModelConfigId: configId,
        });
      }
    } catch {
      /* 静默 */
    }
  };

  // —— 删除配置 ——
  const handleDelete = async (configId: string): Promise<void> => {
    if (!user) return;
    try {
      const res = await window.weaveMD.ai.modelConfigs.delete(user.id, configId);
      if (res.success) {
        // 刷新 modelConfigs 列表
        await useAgentStore.getState().refreshModelConfigs();
        // 刷新 config（主进程已处理级联：无剩余→清空，有剩余→自动激活下一个）
        const cfgRes = await window.weaveMD.ai.getConfig(user.id);
        if (cfgRes.success && cfgRes.data) {
          useAgentStore.setState({
            config: cfgRes.data,
            activeModelConfigId: cfgRes.data.activeModelConfigId ?? null,
          });
        }
      }
    } catch {
      /* 静默 */
    }
  };

  // —— 提供商选择 → 自动推断协议 ——
  const handleProviderChange = (value: string): void => {
    setFormProvider(value);
    const match = PROVIDER_OPTIONS.find((p) => p.value === value);
    if (match) {
      setFormProtocol(match.protocol);
    }
  };

  // —— 新建配置 ——
  const [formError, setFormError] = useState<string | null>(null);

  const handleCreate = async (): Promise<void> => {
    if (!user) return;
    if (!formModel.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await window.weaveMD.ai.modelConfigs.create(user.id, {
        protocol: formProtocol,
        provider: formProvider,
        baseUrl: formBaseUrl.trim() || PROTOCOL_BASE_URL_PLACEHOLDER[formProtocol],
        model: formModel.trim(),
        apiKey: formApiKey.trim() || undefined,
        hint: formHint.trim() || undefined,
      });
      if (res.success && res.data) {
        // 自动激活新配置
        await window.weaveMD.ai.modelConfigs.activate(user.id, res.data.id);
        // 刷新列表
        await useAgentStore.getState().refreshModelConfigs();
        // 同步 config store
        const cfgRes = await window.weaveMD.ai.getConfig(user.id);
        if (cfgRes.success && cfgRes.data) {
          useAgentStore.setState({
            config: cfgRes.data,
            activeModelConfigId: res.data.id,
          });
        }
        // 重置表单并返回列表
        resetForm();
        setView('list');
      } else {
        console.error('[ModelForm] create failed:', res.message);
        setFormError(res.message || '添加失败，请重试');
      }
    } catch (err) {
      console.error('[ModelForm] create error:', err);
      setFormError('网络或内部错误，请重试');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = (): void => {
    setFormProtocol('openai');
    setFormProvider('OpenAI');
    setFormBaseUrl('');
    setFormModel('');
    setFormApiKey('');
    setFormHint('');
  };

  const handleCancel = (): void => {
    resetForm();
    setView('list');
  };

  // —— 视图 A：配置列表 ——
  if (view === 'list') {
    return (
      <div className="space-y-4" style={{ fontFamily: "Consolas, 'Alibaba PuHuiTi 2.0', '阿里巴巴普惠体', sans-serif" }}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
            {t('ai.settings.modelConfigs.title', 'AI 模型配置')}
          </h3>
          <button
            type="button"
            data-testid="model-config-new"
            onClick={() => setView('create')}
            className="px-3 py-1 text-[13px] rounded-lg bg-[#2563eb] text-white hover:bg-[#1d4ed8] transition-colors"
          >
            {t('ai.settings.modelConfigs.new', '+ 新建配置')}
          </button>
        </div>

        {/* 配置列表 */}
        {modelConfigs.length === 0 ? (
          <p className="text-[14px] text-[var(--text-muted)] py-6 text-center">
            {t('ai.settings.modelConfigs.empty', '暂无配置，点击上方按钮新建')}
          </p>
        ) : (
          <div className="space-y-2">
            {modelConfigs.map((cfg) => {
              const isActive = cfg.id === activeModelConfigId;
              return (
                <div
                  key={cfg.id}
                  data-testid={`model-config-item-${cfg.id}`}
                  className={`flex items-center gap-3 rounded-input border border-[var(--border-color)] bg-[var(--input-bg)] px-3 py-2.5 transition-colors ${
                    isActive ? 'border-l-2 border-l-[var(--accent)]' : ''
                  }`}
                >
                  {/* 协议标签 */}
                  <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                    {cfg.protocol === 'openai' ? 'OpenAI' : 'Anthropic'}
                  </span>

                  {/* 模型名 + baseUrl */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-[var(--text-primary)] truncate">
                      {cfg.name || (cfg.provider ? `${cfg.provider} - ${cfg.model}` : cfg.model)}
                    </p>
                    <p className="text-[12px] text-[var(--text-muted)] truncate">{cfg.baseUrl}</p>
                  </div>

                  {/* 状态/操作按钮 */}
                  {isActive ? (
                    <span className="shrink-0 text-[12px] font-medium text-[#2563eb]">
                      {t('ai.settings.modelConfigs.active', '当前')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      data-testid={`model-config-activate-${cfg.id}`}
                      onClick={() => void handleActivate(cfg.id)}
                      className="shrink-0 text-[12px] px-2 py-1 rounded-input border border-[var(--border-color)] text-[var(--text-primary)] hover:border-[#2563eb] hover:text-[#2563eb] transition-colors"
                    >
                      {t('ai.settings.modelConfigs.activate', '激活')}
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid={`model-config-delete-${cfg.id}`}
                    onClick={() => void handleDelete(cfg.id)}
                    className="shrink-0 text-[12px] px-2 py-1 rounded-input border border-[var(--border-color)] text-[var(--text-muted)] hover:border-red-400 hover:text-red-400 transition-colors"
                  >
                    {t('ai.settings.modelConfigs.delete', '删除')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // —— 视图 B：新建配置表单 ——
  return (
    <div className="space-y-4" style={{ fontFamily: "Consolas, 'Alibaba PuHuiTi 2.0', '阿里巴巴普惠体', sans-serif" }}>
      {/* 标题 */}
      <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
        {t('ai.settings.modelConfigs.title', 'AI 模型配置')}
      </h3>

      {/* 兼容协议 */}
      <div>
        <label className="text-[14px] text-[var(--text-primary)] font-medium mb-1 block">
          {t('ai.settings.modelConfigs.protocol', '兼容协议')}
        </label>
        <select
          value={formProtocol}
          onChange={(e) => setFormProtocol(e.target.value as ModelProtocol)}
          className="w-full border rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#2563eb] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        >
          {PROTOCOL_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* 提供商 */}
      <div>
        <label className="text-[14px] text-[var(--text-primary)] font-medium mb-1 block">
          {t('ai.settings.modelConfigs.provider', '提供商')}
        </label>
        <select
          value={formProvider}
          onChange={(e) => handleProviderChange(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#2563eb] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        >
          {PROVIDER_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* Base URL */}
      <div>
        <label className="text-[14px] text-[var(--text-primary)] font-medium mb-1 block">
          {t('ai.settings.modelConfigs.baseUrl', 'Base URL')}
        </label>
        <input
          type="text"
          value={formBaseUrl}
          onChange={(e) => setFormBaseUrl(e.target.value)}
          placeholder={PROTOCOL_BASE_URL_PLACEHOLDER[formProtocol]}
          className="w-full border rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#2563eb] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        />
      </div>

      {/* 模型名称 */}
      <div>
        <label className="text-[14px] text-[var(--text-primary)] font-medium mb-1 block">
          {t('ai.settings.modelConfigs.model', '模型名称')}
        </label>
        <input
          type="text"
          value={formModel}
          onChange={(e) => setFormModel(e.target.value)}
          placeholder="e.g. gpt-4o / claude-sonnet-4-20250514"
          className="w-full border rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#2563eb] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        />
      </div>

      {/* API Key */}
      <div>
        <label className="text-[14px] text-[var(--text-primary)] font-medium mb-1 block">
          {t('ai.settings.modelConfigs.apiKey', 'API Key')}
        </label>
        <input
          type="password"
          value={formApiKey}
          onChange={(e) => setFormApiKey(e.target.value)}
          placeholder="sk-..."
          autoComplete="off"
          className="w-full border rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#2563eb] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
        />
      </div>

      {/* 提示 */}
      <p className="text-[12px] text-[var(--text-muted)]">
        {t('ai.settings.modelConfigs.hint', '提供商会根据 Base URL 和模型名自动识别，保存后即可在 AI Agent 中选用')}
      </p>

      {/* 错误信息 */}
      {formError && (
        <p className="text-[13px] text-red-400">{formError}</p>
      )}

      {/* 按钮 */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          data-testid="model-config-cancel"
          onClick={handleCancel}
          className="px-3.5 py-1.5 text-[14px] rounded-input border border-[var(--border-color)] text-[var(--text-primary)] hover:border-[#2563eb] hover:text-[#2563eb] transition-colors"
        >
          {t('ai.settings.modelConfigs.cancel', '取消')}
        </button>
        <button
          type="button"
          data-testid="model-config-add"
          onClick={() => void handleCreate()}
          disabled={saving || !formModel.trim()}
          className="px-3.5 py-1.5 text-[14px] rounded-input bg-[#2563eb] text-white hover:bg-[#1d4ed8] disabled:opacity-40 transition-colors"
        >
          {saving ? '...' : t('ai.settings.modelConfigs.add', '添加配置')}
        </button>
      </div>
    </div>
  );
};

export default ModelForm;
