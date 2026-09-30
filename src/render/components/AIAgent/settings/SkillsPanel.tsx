// ============================================
// WeaveMD — 设置·技能面板（Phase 5 增强）
// ============================================
// 扫描路径说明 + 重新扫描按钮 + 技能卡片（name + description + 来源图标）
// + 「提炼技能」栏（agent-memory-optimize-3 D3 六.1：只读草稿列表 + 人工确认 / 驳回）。
// 数据流：ai.listSkills(userId) / ai.skillDraft.* IPC，只读 + 二次确认。
// 无 dangerouslySetInnerHTML、无 any、无内联 style（全部 Tailwind + CSS 变量）。

import React, { useEffect, useState } from 'react';
import type { AgentSkillInfo } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';
import Icon from '../../Common/Icon';

/** 内置技能名称集合（用于来源图标判断）。 */
const CORE_SKILL_NAMES = new Set(['polish_rewrite', 'tech_organize', 'kb_qa_guide']);

const SkillsPanel: React.FC = () => {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const [skills, setSkills] = useState<AgentSkillInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [scanning, setScanning] = useState(false);

  // 提炼技能草稿（D3 六.1）
  const skillDrafts = useAgentStore((s) => s.skillDrafts);
  const skillDraftsLoading = useAgentStore((s) => s.skillDraftsLoading);
  const skillDraftsError = useAgentStore((s) => s.skillDraftsError);
  const loadSkillDrafts = useAgentStore((s) => s.loadSkillDrafts);
  const approveSkillDraft = useAgentStore((s) => s.approveSkillDraft);
  const rejectSkillDraft = useAgentStore((s) => s.rejectSkillDraft);
  const [busyName, setBusyName] = useState<string | null>(null);

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

  // 进入设置页即拉取待确认草稿
  useEffect(() => {
    void loadSkillDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRescan = async (): Promise<void> => {
    setScanning(true);
    await loadSkills();
    setScanning(false);
  };

  /** 确认草稿 → 生效（二次确认，与设置页既有删除交互一致）。 */
  const handleApprove = async (name: string): Promise<void> => {
    if (!window.confirm(`确认启用技能「${name}」？启用后 agent 可通过 runSkill 调用它。`)) return;
    setBusyName(name);
    try {
      const ok = await approveSkillDraft(name);
      if (ok) await loadSkills();
    } finally {
      setBusyName(null);
    }
  };

  /** 驳回草稿（删除文件，二次确认）。 */
  const handleReject = async (name: string): Promise<void> => {
    if (!window.confirm(`确认驳回技能草稿「${name}」？驳回后将删除该草稿，不可恢复。`)) return;
    setBusyName(name);
    try {
      await rejectSkillDraft(name);
    } finally {
      setBusyName(null);
    }
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

      {/* 提炼技能（D3 六.1）：只读草稿列表 + 人工确认 / 驳回 */}
      <div className="rounded-input border border-[var(--border-color)] bg-[var(--input-bg)] px-3 py-2.5">
        <div className="mb-1.5">
          <p className="text-[13px] font-medium text-[var(--text-primary)]">
            {t('ai.settings.skillsDraftTitle', '提炼技能（待确认）')}
          </p>
          <p className="text-[12px] text-[var(--text-muted)]">
            {t(
              'ai.settings.skillsDraftDesc',
              '从执行轨迹自动提炼的技能草稿。确认后才会写入技能库，未确认的草稿不会进入任何提示词、也不会被 agent 调用。'
            )}
          </p>
        </div>

        {skillDraftsLoading ? (
          <p className="py-3 text-center text-[13px] text-[var(--text-muted)]">
            {t('ai.settings.skillsDraftLoading', '加载中...')}
          </p>
        ) : skillDraftsError ? (
          <p className="py-3 text-center text-[13px] text-[var(--text-sub)]" data-testid="skill-drafts-error">
            {skillDraftsError}
          </p>
        ) : skillDrafts.length === 0 ? (
          <p className="py-3 text-center text-[13px] text-[var(--text-muted)]" data-testid="skill-drafts-empty">
            {t('ai.settings.skillsDraftEmpty', '暂无待确认草稿')}
          </p>
        ) : (
          <div className="space-y-2">
            {skillDrafts.map((draft) => (
              <div
                key={draft.name}
                data-testid="skill-draft-item"
                className="rounded-input border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-[var(--text-primary)]">
                        {draft.name}
                      </span>
                      <span className="rounded-md border border-[var(--border-color)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]">
                        草稿
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-[var(--text-sub)]">{draft.description}</p>
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words font-mono text-[11px] text-[var(--text-muted)]">
                      {draft.instructions}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      data-testid="skill-draft-approve"
                      disabled={busyName === draft.name}
                      onClick={() => void handleApprove(draft.name)}
                      className="rounded-lg border border-[#16a34a] px-2.5 py-1 text-[12px] text-[#16a34a] transition-colors hover:bg-[#16a34a] hover:text-white disabled:opacity-40"
                    >
                      确认启用
                    </button>
                    <button
                      type="button"
                      data-testid="skill-draft-reject"
                      disabled={busyName === draft.name}
                      onClick={() => void handleReject(draft.name)}
                      className="rounded-lg border border-[var(--border-color)] px-2.5 py-1 text-[12px] text-[var(--text-sub)] transition-colors hover:border-[#dc2626] hover:text-[#dc2626] disabled:opacity-40"
                    >
                      驳回
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SkillsPanel;
