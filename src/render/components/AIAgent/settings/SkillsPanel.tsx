// ============================================
// WeaveMD — 设置·技能面板（R10，只读列出）
// ============================================
// 挂载拉取 `ai.listSkills(userId)`（内置 core + 用户扩展 SKILL.md），只读列出名称+描述。
// 失败/为空显示空态。无 dangerouslySetInnerHTML、无 any。

import React, { useEffect, useState } from 'react';
import type { AgentSkillInfo } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';

const SkillsPanel: React.FC = () => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const [skills, setSkills] = useState<AgentSkillInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await window.weaveMD?.ai.listSkills(user?.id ?? '');
        if (cancelled) return;
        if (res?.success && res.data) setSkills(res.data);
      } catch {
        /* 静默：listSkills 不可用仅影响技能展示，不阻断 */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!loaded) {
    return <p className="text-sm text-text-muted">{t('ai.settings.skillsLoading', '加载中...')}</p>;
  }

  return (
    <div className="space-y-2">
      {skills.length === 0 ? (
        <p className="text-sm text-text-muted">{t('ai.settings.skillsEmpty', '暂无技能')}</p>
      ) : (
        skills.map((s) => (
          <div
            key={s.name}
            data-testid="skill-item"
            className="rounded-card border border-border bg-bg-secondary/40 px-3 py-2"
          >
            <p className="text-sm font-medium text-text-primary">{s.name}</p>
            <p className="text-xs text-text-sub mt-0.5">{s.description}</p>
          </div>
        ))
      )}
    </div>
  );
};

export default SkillsPanel;
