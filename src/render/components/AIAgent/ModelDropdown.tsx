// ============================================
// WeaveMD — Composer 底部模型选择下拉（R18/R19）
// ============================================
// 挂载时拉取 `ai.listModels(userId)`（remote /models，key 在主进程不落渲染）；
// 选中项 → `setConfig({ model })` 持久化到 ai_config.model（复用 ai.setConfig）。
// 拉取失败/为空 → 降级：显示当前配置 model + 允许手动输入回退（R19）。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useEffect, useState } from 'react';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';

type LoadState = 'loading' | 'ok' | 'manual';

const ModelDropdown: React.FC = () => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const config = useAgentStore((s) => s.config);

  const [models, setModels] = useState<string[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [open, setOpen] = useState(false);
  const [manualValue, setManualValue] = useState(config?.model ?? '');

  // 挂载时拉取模型列表；终了设置 loadState 回落（loading → ok/manual）
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await window.weaveMD?.ai.listModels(user?.id ?? '');
        if (cancelled) return;
        if (res?.success && res.data && res.data.length > 0) {
          setModels(res.data);
          setLoadState('ok');
          return;
        }
        setModels([]);
        setLoadState('manual');
      } catch {
        if (!cancelled) {
          setModels([]);
          setLoadState('manual');
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const currentModel = config?.model || '';

  const selectModel = (model: string) => {
    setOpen(false);
    setManualValue(model);
    // 持久化选中模型：走 ai.setConfig（safeStorage 加密，key 不落渲染），并同步 store.config 供下拉即时回显
    const userId = user?.id ?? '';
    void window.weaveMD?.ai.setConfig(userId, { model }).then((res) => {
      if (res.success && res.data) {
        useAgentStore.setState({ config: res.data });
      }
    });
  };

  // 手动输入：失焦或 Enter 时落盘当前文本（回退模式）
  const commitManual = () => {
    const value = manualValue.trim();
    if (value && value !== config?.model) {
      const userId = user?.id ?? '';
      void window.weaveMD?.ai.setConfig(userId, { model: value }).then((res) => {
        if (res.success && res.data) {
          useAgentStore.setState({ config: res.data });
        }
      });
    }
  };

  // 下拉触发按钮标签：ok 模式展示当前选中（若不在列表内仍回退到手动显示）；manual 模式展示手动值/当前配置
  const buttonLabel = manualValue || currentModel || t('ai.modelDropdown.label');

  return (
    <div className="relative inline-block text-[13px]">
      <button
        type="button"
        data-testid="model-dropdown"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-input border border-border bg-bg-secondary px-2 py-1 text-text-sub hover:border-[var(--accent)] hover:text-text-primary transition-colors"
      >
        <span className="max-w-[8rem] truncate">{buttonLabel}</span>
        <span className="text-[11px] text-text-muted">▾</span>
      </button>

      {loadState === 'loading' && <span className="ml-1 text-[11px] text-text-muted">…</span>}

      {open && (
        <div
          data-testid="model-dropdown-panel"
          className="absolute right-0 bottom-full mb-1 z-50 w-56 rounded-card border border-border bg-bg-secondary shadow-dropdown py-1 max-h-56 overflow-y-auto"
        >
          {loadState === 'ok' && models.length > 0 && (
            <>
              <div className="px-3 pt-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
                {t('ai.modelDropdown.label')}
              </div>
              {models.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => selectModel(m)}
                  className={`block w-full text-left px-3 py-1.5 text-[13px] transition-colors ${
                    m === currentModel
                      ? 'bg-[var(--accent)]/15 text-text-primary'
                      : 'text-text-sub hover:bg-bg-tertiary'
                  }`}
                >
                  {m}
                </button>
              ))}
            </>
          )}

          {/* 拉取失败/为空提示（R19 降级说明；loadState 为 manual 时不重复展示） */}
          {loadState === 'manual' && models.length === 0 && (
            <div className="px-3 pt-1 pb-0.5 text-[11px] text-amber-600">
              {t('ai.modelDropdown.loadFailed')}
            </div>
          )}

          {/* 降级/手动输入区（R19）：拉取失败或为空 → 手动指定模型 */}
          <button
            type="button"
            onClick={() => {
              setManualValue(currentModel);
              setLoadState('manual');
              setOpen(true);
            }}
            data-testid="model-manual-toggle"
            className="block w-full text-left px-3 py-1.5 text-[13px] text-text-muted hover:bg-bg-tertiary"
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
                className="w-full border border-border rounded-input px-2 py-1 text-[13px] text-text-primary bg-bg-primary outline-none focus:border-[var(--accent)]"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ModelDropdown;
