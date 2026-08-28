// ============================================
// WeaveMD — 设置·技能面板（Phase 5 增强）
// ============================================
// 扫描路径说明 + 重新扫描按钮 + 技能卡片（name + description + 来源图标）。
// 数据流：ai.listSkills(userId) IPC，只读。无 dangerouslySetInnerHTML、无 any。

import React, { useEffect, useState } from 'react';
import type { AgentSkillInfo } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import Icon from '../../Common/Icon';

/** 内置技能名称集合（用于来源图标判断）。 */
const CORE_SKILL_NAMES = new Set(['polish_rewrite', 'tech_organize', 'kb_qa_guide']);

const SkillsPanel: React.FC = () => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const [skills, setSkills] = useState<AgentSkillInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [scanning, setScanning] = useState(false);

  const loadSkills = async (): Promise<void> => {
    try {
      const res = await window.weaveMD?.ai.listSkills(user?.id ?? '');
      if (res?.success && res.data) setSkills(res.data);
    } catch {
      /* 静默 */
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void loadSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleRescan = async (): Promise<void> => {
    setScanning(true);
    await loadSkills();
    setScanning(false);
  };

  if (!loaded) {
    return <p className="text-[14px] text-[var(--text-muted)]">{t('ai.settings.skillsLoading', '加载中...')}</p>;
  }

  return (
    <div className="space-y-4" style={{ fontFamily: "Consolas, 'Alibaba PuHuiTi 2.0', '阿里巴巴普惠体', sans-serif" }}>
      {/* 扫描路径说明 */}
      <div className="rounded-input border border-[var(--border-color)] bg-[var(--input-bg)] px-3 py-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[13px] text-[var(--text-muted)]">
            自动扫描以下目录中的 SKILL.md 文件
          </p>
          <button
            type="button"
            data-testid="skills-rescan"
            onClick={() => void handleRescan()}
            disabled={scanning}
            className="text-[12px] px-2 py-0.5 rounded-lg border border-[var(--border-color)] text-[var(--text-primary)] hover:border-[#2563eb] hover:text-[#2563eb] disabled:opacity-40 transition-colors"
          >
            {scanning ? '...' : '重新扫描'}
          </button>
        </div>
        <div className="space-y-0.5">
          <p className="text-[12px] text-[var(--text-muted)] font-mono">内置技能（随代码注册）</p>
          <p className="text-[12px] text-[var(--text-muted)] font-mono">userData/skills/&lt;name&gt;/SKILL.md</p>
        </div>
      </div>

      {/* 技能列表 */}
      {skills.length === 0 ? (
        <p className="text-[14px] text-[var(--text-muted)] py-4 text-center">
          {t('ai.settings.skillsEmpty', '暂无技能')}
        </p>
      ) : (
        <div className="space-y-2">
          {skills.map((s) => {
            const isCore = CORE_SKILL_NAMES.has(s.name);
            return (
              <div
                key={s.name}
                data-testid="skill-item"
                className="flex items-start gap-2.5 rounded-input border border-[var(--border-color)] bg-[var(--input-bg)] px-3 py-2.5"
              >
                {/* 来源图标 */}
                <span className="shrink-0 mt-0.5 text-[14px]" title={isCore ? '内置技能' : '用户技能'}>
                  {isCore ? (
                    <Icon icon="build" size={16} />
                  ) : (
                    <Icon icon="file-outline" size={16} />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium text-[var(--text-primary)]">{s.name}</p>
                  <p className="text-[12px] text-[var(--text-sub)] mt-0.5">{s.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SkillsPanel;
