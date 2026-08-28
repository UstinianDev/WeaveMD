// ============================================
// WeaveMD — Token 用量预算设置面板
// ============================================
// Token 用量预算设置面板（L3 UI）。

import React, { useEffect, useState } from 'react';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';

interface BudgetConfig {
  dailyLimit: number;
  monthlyLimit: number;
  enabled: boolean;
}

interface BudgetUsage {
  dailyUsed: number;
  monthlyUsed: number;
  dailyRemaining: number;
  monthlyRemaining: number;
}

const LlmBudgetPanel: React.FC = () => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);

  const [config, setConfig] = useState<BudgetConfig>({
    dailyLimit: 1000000,
    monthlyLimit: 30000000,
    enabled: false,
  });
  const [usage, setUsage] = useState<BudgetUsage>({
    dailyUsed: 0,
    monthlyUsed: 0,
    dailyRemaining: 1000000,
    monthlyRemaining: 30000000,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // 加载配置（简化实现：使用默认值）
  useEffect(() => {
    // 实际项目中应从 IPC 加载配置
    setConfig({
      dailyLimit: 1000000,
      monthlyLimit: 30000000,
      enabled: false,
    });
  }, []);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setSaved(false);
    try {
      // 实际项目中应通过 IPC 保存配置
      await new Promise((resolve) => setTimeout(resolve, 500));
      setSaved(true);
    } catch {
      /* 静默 */
    } finally {
      setSaving(false);
    }
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  return (
    <div className="space-y-5" style={{ fontFamily: "Consolas, 'Alibaba PuHuiTi 2.0', '阿里巴巴普惠体', sans-serif" }}>
      {/* 总开关 */}
      <div>
        <label className="flex items-center gap-3 px-3 py-2 rounded-input hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => setConfig((prev) => ({ ...prev, enabled: e.target.checked }))}
            className="accent-[#2563eb]"
          />
          <span className="text-[14px] text-[var(--text-primary)] font-medium">
            启用 Token 预算控制
          </span>
        </label>
      </div>

      {/* 当前用量 */}
      {config.enabled && (
        <div className="space-y-3">
          <div className="text-[13px] text-[var(--text-primary)] font-medium">当前用量</div>

          {/* 日用量 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-[var(--text-muted)]">今日已用</span>
              <span className="text-[var(--text-primary)]">
                {formatNumber(usage.dailyUsed)} / {formatNumber(config.dailyLimit)}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all"
                style={{
                  width: `${Math.min(100, (usage.dailyUsed / config.dailyLimit) * 100)}%`,
                }}
              />
            </div>
          </div>

          {/* 月用量 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-[var(--text-muted)]">本月已用</span>
              <span className="text-[var(--text-primary)]">
                {formatNumber(usage.monthlyUsed)} / {formatNumber(config.monthlyLimit)}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all"
                style={{
                  width: `${Math.min(100, (usage.monthlyUsed / config.monthlyLimit) * 100)}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 预算设置 */}
      {config.enabled && (
        <div className="space-y-3">
          <div className="text-[13px] text-[var(--text-primary)] font-medium">预算设置</div>

          {/* 每日预算 */}
          <div>
            <label className="text-[12px] text-[var(--text-muted)] mb-1 block">
              每日 Token 上限
            </label>
            <input
              type="number"
              value={config.dailyLimit}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, dailyLimit: Number(e.target.value) }))
              }
              className="w-full px-3 py-1.5 text-[13px] rounded-input border border-[var(--border-color)] bg-[var(--input-bg)] text-[var(--text-primary)] outline-none focus:border-[#2563eb]"
            />
          </div>

          {/* 每月预算 */}
          <div>
            <label className="text-[12px] text-[var(--text-muted)] mb-1 block">
              每月 Token 上限
            </label>
            <input
              type="number"
              value={config.monthlyLimit}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, monthlyLimit: Number(e.target.value) }))
              }
              className="w-full px-3 py-1.5 text-[13px] rounded-input border border-[var(--border-color)] bg-[var(--input-bg)] text-[var(--text-primary)] outline-none focus:border-[#2563eb]"
            />
          </div>
        </div>
      )}

      {/* 保存状态 */}
      {saving && <p className="text-[13px] text-[var(--text-muted)]">Saving...</p>}
      {saved && <p className="text-[13px] text-green-500">{t('settings.save')}</p>}

      {/* 操作按钮 */}
      <div className="flex items-center justify-end">
        <button
          type="button"
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

export default LlmBudgetPanel;
