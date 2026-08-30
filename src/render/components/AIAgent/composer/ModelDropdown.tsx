// ============================================
// WeaveMD — Composer 底部模型选择下拉（Phase 5 重写）
// ============================================
// 数据源：modelConfigs + activeModelConfigId（agentStore）。
// 列表项：provider - model 格式。选中 → modelConfigs.activate IPC。
// 降级：modelConfigs 为空时显示手动输入。无 dangerouslySetInnerHTML、无 any。

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';

type LoadState = 'loading' | 'ok' | 'manual';

const ModelDropdown: React.FC = () => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const config = useAgentStore((s) => s.config);
  const modelConfigs = useAgentStore((s) => s.modelConfigs);
  const activeModelConfigId = useAgentStore((s) => s.activeModelConfigId);

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [open, setOpen] = useState(false);
  const [manualValue, setManualValue] = useState(config?.model ?? '');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 搜索防抖 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // 过滤后的模型列表
  const filteredModelConfigs = useMemo(() => {
    if (!debouncedQuery) return modelConfigs;
    const query = debouncedQuery.toLowerCase();
    return modelConfigs.filter(
      (mc) =>
        mc.name.toLowerCase().includes(query) ||
        mc.provider.toLowerCase().includes(query) ||
        mc.model.toLowerCase().includes(query),
    );
  }, [modelConfigs, debouncedQuery]);

  // 挂载时拉取模型配置列表
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        await useAgentStore.getState().refreshModelConfigs();
        if (cancelled) return;
        const configs = useAgentStore.getState().modelConfigs;
        setLoadState(configs.length > 0 ? 'ok' : 'manual');
      } catch {
        if (!cancelled) setLoadState('manual');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // 同步 manualValue
  useEffect(() => {
    if (config?.model) setManualValue(config.model);
  }, [config?.model]);

  const currentModel = config?.model || '';
  const activeConfig = modelConfigs.find((c) => c.id === activeModelConfigId);
  const isConfigured = Boolean(config?.hasApiKey && modelConfigs.length > 0);

  // 选中配置 → 激活
  const selectConfig = (configId: string): void => {
    setOpen(false);
    const userId = user?.id ?? '';
    void window.weaveMD.ai.modelConfigs.activate(userId, configId).then((res) => {
      if (res.success && res.data) {
        useAgentStore.setState({
          config: res.data,
          activeModelConfigId: configId,
        });
      }
    });
  };

  // 手动输入：失焦或 Enter 时落盘
  const commitManual = (): void => {
    const value = manualValue.trim();
    if (value && value !== config?.model) {
      const userId = user?.id ?? '';
      void window.weaveMD.ai.setConfig(userId, { model: value }).then((res) => {
        if (res.success && res.data) {
          useAgentStore.setState({ config: res.data });
        }
      });
    }
  };

  // 下拉关闭时清空搜索
  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setDebouncedQuery('');
    }
  }, [open]);

  // 下拉打开时聚焦搜索框
  useEffect(() => {
    if (open && loadState === 'ok' && modelConfigs.length > 0) {
      // 延迟一帧确保 DOM 已渲染
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [open, loadState, modelConfigs.length]);

  // 按钮标签：有激活配置显示 provider - model；未配置时显示 "未配置模型"
  const buttonLabel = activeConfig
    ? `${activeConfig.provider} - ${activeConfig.model}`
    : !isConfigured
      ? t('ai.modelDropdown.unconfigured', '未配置模型')
      : manualValue || currentModel || t('ai.modelDropdown.label');

  return (
    <div className="relative inline-block text-[13px]">
      <button
        type="button"
        data-testid="model-dropdown"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded-input border border-[var(--border-color)] bg-[var(--input-bg)] px-2 py-1 transition-colors ${
          isConfigured
            ? 'text-[var(--text-sub)] hover:border-[var(--accent)] hover:text-[var(--text-primary)]'
            : 'text-[var(--text-muted)] opacity-68 cursor-not-allowed'
        }`}
        style={!isConfigured ? { opacity: 0.68, cursor: 'not-allowed' } : undefined}
      >
        <span className="max-w-[10rem] truncate">{buttonLabel}</span>
        <span className="text-[11px] text-[var(--text-muted)]">▾</span>
      </button>

      {loadState === 'loading' && <span className="ml-1 text-[11px] text-[var(--text-muted)]">...</span>}

      {open && (
        <div
          data-testid="model-dropdown-panel"
          className="absolute right-0 bottom-full mb-1 z-50 w-64 rounded-input border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-lg py-1 max-h-64 overflow-y-auto"
        >
          {/* 搜索框 */}
          {loadState === 'ok' && modelConfigs.length > 0 && (
            <div className="px-2 py-1.5 border-b border-[var(--border-color)]">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    if (searchQuery) {
                      setSearchQuery('');
                    } else {
                      setOpen(false);
                    }
                  }
                }}
                placeholder="搜索模型..."
                className="w-full px-2 py-1 text-[12px] bg-[var(--bg-primary)] text-[var(--text-primary)] rounded border border-[var(--border-color)] focus:border-[var(--accent)] outline-none placeholder:text-[var(--text-muted)]"
              />
            </div>
          )}

          {/* 配置列表 */}
          {loadState === 'ok' && filteredModelConfigs.length > 0 && (
            <>
              <div className="px-3 pt-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                {t('ai.modelDropdown.label')}
              </div>
              {filteredModelConfigs.map((mc) => {
                const isActive = mc.id === activeModelConfigId;
                return (
                  <button
                    key={mc.id}
                    type="button"
                    data-testid={`model-config-option-${mc.id}`}
                    onClick={() => selectConfig(mc.id)}
                    className={`block w-full text-left px-3 py-1.5 text-[13px] transition-colors ${
                      isActive
                        ? 'bg-[var(--accent)]/15 text-[var(--text-primary)]'
                        : 'text-[var(--text-sub)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    <span className="font-medium">{mc.provider}</span>
                    <span className="text-[var(--text-muted)]"> — {mc.model}</span>
                  </button>
                );
              })}
              <div className="mx-2 my-1 border-t border-[var(--border-color)]" />
            </>
          )}

          {/* 搜索无结果 */}
          {loadState === 'ok' && modelConfigs.length > 0 && debouncedQuery && filteredModelConfigs.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-[var(--text-muted)]">
              未找到匹配的模型
            </div>
          )}

          {/* 无配置提示 */}
          {loadState === 'manual' && modelConfigs.length === 0 && (
            <div className="px-3 pt-1 pb-0.5 text-[11px] text-amber-600">
              未配置模型
            </div>
          )}

          {/* 手动输入降级 */}
          <button
            type="button"
            onClick={() => {
              setManualValue(currentModel);
              setLoadState('manual');
              setOpen(true);
            }}
            data-testid="model-manual-toggle"
            className="block w-full text-left px-3 py-1.5 text-[13px] text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]"
          >
            {t('ai.modelDropdown.manual')}
          </button>
          {loadState === 'manual' && (
            <div className="px-2 py-1.5">
              <input
                type="text"
                data-testid="model-manual-input"
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                onBlur={commitManual}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitManual();
                    setOpen(false);
                  }
                }}
                placeholder={t('ai.modelDropdown.manualPlaceholder')}
                className="w-full border border-[var(--border-color)] rounded-input px-2 py-1 text-[13px] text-[var(--text-primary)] bg-[var(--bg-primary)] outline-none focus:border-[var(--accent)]"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ModelDropdown;
