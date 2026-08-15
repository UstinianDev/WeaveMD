// ============================================
// WeaveMD — Settings Modal
// ============================================

import React, { useEffect, useState } from 'react';
import type { LanguageType, ThemeType } from '@shared/types';
import type { ChatBackend, IKbSettings } from '@shared/ai';
import { useI18n } from '@render/i18n';
import { useAuthStore } from '@render/stores/authStore';
import { useAgentStore } from '@render/stores/agentStore';
import { useUIStore } from '@render/stores/uiStore';
import Button from '@render/components/Common/Button';
import Modal from '@render/components/Common/Modal';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const LANGUAGES: { value: LanguageType; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
];

const THEMES: { value: ThemeType; label: string; preview: string }[] = [
  { value: 'light-header', label: 'Light with Light Header', preview: 'bg-white border' },
  { value: 'light', label: 'Light', preview: 'bg-white border' },
  { value: 'dark', label: 'Dark', preview: 'bg-[#0F0F0F]' },
  { value: 'high-contrast', label: 'High Contrast', preview: 'bg-black' },
  { value: 'custom', label: 'Custom', preview: 'bg-gradient-to-r from-[#7C3AED] to-[#6366F1]' },
];

type SettingsTab = 'system' | 'account' | 'ai';

/** 数值收敛：NaN/越界回退到 fallback，否则夹在 [min, max]。 */
function clampNum(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { t } = useI18n();
  const theme = useUIStore((s) => s.theme);
  const language = useUIStore((s) => s.language);
  const setTheme = useUIStore((s) => s.setTheme);
  const setLanguage = useUIStore((s) => s.setLanguage);
  const closeModal = useUIStore((s) => s.closeModal);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const recentAccounts = useAuthStore((s) => s.recentAccounts);
  const loadRecentAccounts = useAuthStore((s) => s.loadRecentAccounts);
  const kbSettings = useAgentStore((s) => s.kbSettings);
  const setKbSettings = useAgentStore((s) => s.setKbSettings);

  const [activeTab, setActiveTab] = useState<SettingsTab>('system');
  const [selectedTheme, setSelectedTheme] = useState<ThemeType>(theme);
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageType>(language);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSwitchAccount, setShowSwitchAccount] = useState(false);
  const [switchPassword, setSwitchPassword] = useState('');
  const [switchUsername, setSwitchUsername] = useState('');
  const [switchError, setSwitchError] = useState('');
  const [isSwitching, setIsSwitching] = useState(false);

  // --- AI 配置表单 ---
  const [aiBackend, setAiBackend] = useState<ChatBackend>('ollama');
  const [aiOllamaBaseUrl, setAiOllamaBaseUrl] = useState('http://localhost:11434');
  const [aiRemoteBaseUrl, setAiRemoteBaseUrl] = useState('https://api.deepseek.com');
  const [aiModel, setAiModel] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiHasApiKey, setAiHasApiKey] = useState(false);
  const [aiAllowNetwork, setAiAllowNetwork] = useState(false);
  const [aiAllowSend, setAiAllowSend] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  // --- KB（Agent 知识库）参数表单（内存态草稿，Save 时写回 agentStore.kbSettings） ---
  const [kbTopK, setKbTopK] = useState<number>(kbSettings.topK);
  const [kbFuse, setKbFuse] = useState<number>(kbSettings.fuse);
  const [kbThreshold, setKbThreshold] = useState<number>(kbSettings.threshold);
  const [kbPinnedWeight, setKbPinnedWeight] = useState<number>(kbSettings.pinnedWeight);
  const [kbEmbeddingHost, setKbEmbeddingHost] = useState<string>(kbSettings.embeddingHost);
  const [kbEmbeddingModel, setKbEmbeddingModel] = useState<string>(kbSettings.embeddingModel);

  const TABS: { key: SettingsTab; label: string }[] = [
    { key: 'system', label: t('settings.system') },
    { key: 'account', label: t('settings.account') },
    { key: 'ai', label: t('ai.settings.title') },
  ];

  useEffect(() => {
    if (isOpen) {
      setSelectedTheme(theme);
      setSelectedLanguage(language);
      setShowDeleteConfirm(false);
      setShowSwitchAccount(false);
      setSwitchPassword('');
      setSwitchUsername('');
      setSwitchError('');
      // 每次打开同步 KB 设置草稿（内存态源 = agentStore.kbSettings）
      setKbTopK(kbSettings.topK);
      setKbFuse(kbSettings.fuse);
      setKbThreshold(kbSettings.threshold);
      setKbPinnedWeight(kbSettings.pinnedWeight);
      setKbEmbeddingHost(kbSettings.embeddingHost);
      setKbEmbeddingModel(kbSettings.embeddingModel);
      loadRecentAccounts();
    }
  }, [isOpen, theme, language, loadRecentAccounts, kbSettings]);

  // AI Tab 打开/进入时加载配置与同意记录（不落明文 key）
  useEffect(() => {
    if (!isOpen || !user) return;
    const ai = window.weaveMD?.ai;
    if (!ai) return;
    let cancelled = false;
    Promise.all([ai.getConfig(user.id), ai.getConsent(user.id)])
      .then(([cfgRes, consentRes]) => {
        if (cancelled) return;
        if (cfgRes.success && cfgRes.data) {
          setAiBackend(cfgRes.data.backend);
          setAiOllamaBaseUrl(cfgRes.data.ollamaBaseUrl);
          setAiRemoteBaseUrl(cfgRes.data.remoteBaseUrl);
          setAiModel(cfgRes.data.model);
          setAiHasApiKey(cfgRes.data.hasApiKey);
        }
        if (consentRes.success && consentRes.data) {
          setAiAllowNetwork(consentRes.data.allowNetwork);
          setAiAllowSend(consentRes.data.allowSend);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen, user, activeTab]);

  const handleSave = async () => {
    setTheme(selectedTheme);
    setLanguage(selectedLanguage);
    // Persist to backend
    if (user) {
      window.weaveMD.settings
        .update(user.id, {
          theme: selectedTheme,
          language: selectedLanguage,
        })
        .catch(() => {});
    }

    // KB（Agent 知识库）参数：写回 agentStore.kbSettings（内存态，仅 Agent KB 问答生效）
    if (activeTab === 'ai') {
      const next: IKbSettings = {
        topK: clampNum(kbTopK, 1, 100, 5),
        fuse: clampNum(kbFuse, 0, 1, 0.5),
        threshold: clampNum(kbThreshold, 0, 1, 0.6),
        pinnedWeight: clampNum(kbPinnedWeight, 0.1, 10, 1.5),
        embeddingHost: kbEmbeddingHost.trim() || 'http://localhost:11434',
        embeddingModel: kbEmbeddingModel.trim() || 'nomic-embed-text',
      };
      setKbSettings(next);
    }

    // AI 配置：仅当有值才传 apiKey（setConfig 内部 safeStorage 加密，key 不落渲染）
    if (user && activeTab === 'ai') {
      setAiLoading(true);
      try {
        const ai = window.weaveMD?.ai;
        if (ai) {
          const cfg: {
            backend: ChatBackend;
            ollamaBaseUrl: string;
            remoteBaseUrl: string;
            model: string;
            apiKey?: string;
          } = {
            backend: aiBackend,
            ollamaBaseUrl: aiOllamaBaseUrl,
            remoteBaseUrl: aiRemoteBaseUrl,
            model: aiModel,
          };
          if (aiApiKey.trim()) cfg.apiKey = aiApiKey.trim();
          await ai.setConfig(user.id, cfg);
          await ai.setConsent(user.id, {
            allowNetwork: aiAllowNetwork,
            allowSend: aiAllowSend,
            consentUpdatedAt: new Date().toISOString(),
          });
        }
      } catch {
        // 保存失败静默（主进程侧错误），不阻断关闭
      } finally {
        setAiLoading(false);
      }
    }
    closeModal();
  };

  const handleCancel = () => {
    closeModal();
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      // Clear local state
      logout();
      closeModal();
    } catch {
      // Still logout even if IPC fails
      logout();
      closeModal();
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    setIsDeleting(true);
    try {
      const result = (await window.weaveMD.account.delete(user.id)) as {
        success: boolean;
        message: string;
      };
      if (result.success) {
        logout();
        closeModal();
      }
    } catch {
      // Still logout even on IPC error to clear local state
      logout();
      closeModal();
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleSwitchToAccount = async (username: string) => {
    // If switching to the same account, just close the switch panel
    if (username === user?.username) {
      setShowSwitchAccount(false);
      return;
    }

    // Show password input for the selected account
    setSwitchUsername(username);
    setSwitchPassword('');
    setSwitchError('');
  };

  const handleConfirmSwitch = async () => {
    if (!switchPassword) {
      setSwitchError('请输入密码');
      return;
    }

    setIsSwitching(true);
    setSwitchError('');

    try {
      const result = (await window.weaveMD.auth.login(switchUsername, switchPassword, false)) as {
        success: boolean;
        data?: {
          token: string;
          user: { id: string; username: string; createdAt: string; lastLogin: string | null };
        };
        message?: string;
      };

      if (result.success && result.data) {
        // Logout current user first
        logout();
        // Login with new account
        useAuthStore.getState().login(result.data.user, result.data.token);
        closeModal();
      } else {
        setSwitchError(result.message || '登录失败');
      }
    } catch {
      setSwitchError('无法连接到认证服务');
    } finally {
      setIsSwitching(false);
    }
  };

  const handleCancelSwitch = () => {
    setShowSwitchAccount(false);
    setSwitchUsername('');
    setSwitchPassword('');
    setSwitchError('');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('settings.title')}
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={handleCancel}>
            {t('settings.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSave}>
            {t('settings.save')}
          </Button>
        </>
      }
    >
      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[var(--bg-primary)] rounded-input p-0.5">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-1.5 text-sm rounded-[6px] transition-colors ${
              activeTab === tab.key
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-sub)] hover:text-[var(--text-primary)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'system' && (
        <div className="space-y-6">
          {/* Language */}
          <div>
            <label className="text-sm text-[var(--text-primary)] font-medium mb-2 block">
              {t('settings.language')}
            </label>
            <div className="space-y-1">
              {LANGUAGES.map((lang) => (
                <label
                  key={lang.value}
                  className="flex items-center gap-3 px-3 py-2 rounded-input hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors"
                >
                  <input
                    type="radio"
                    name="language"
                    value={lang.value}
                    checked={selectedLanguage === lang.value}
                    onChange={() => setSelectedLanguage(lang.value)}
                    className="accent-[#7C3AED]"
                  />
                  <span className="text-sm text-[var(--text-sub)]">{lang.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Theme */}
          <div>
            <label className="text-sm text-[var(--text-primary)] font-medium mb-2 block">
              {t('settings.theme')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map((th) => (
                <button
                  key={th.value}
                  onClick={() => setSelectedTheme(th.value)}
                  className={`flex items-center gap-3 p-3 rounded-input border transition-colors text-left ${
                    selectedTheme === th.value
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--border-color)] hover:border-[var(--accent-secondary)]'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded border border-[var(--border-color)] ${th.preview}`}
                  />
                  <span className="text-sm text-[var(--text-sub)]">{th.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'account' && (
        <div className="space-y-4">
          <div className="p-4 bg-[var(--bg-primary)] rounded-input border border-[var(--border-color)]">
            <p className="text-sm text-[var(--text-sub)]">
              {`${t('settings.accountInfo')}: `}
              <span className="text-[var(--text-primary)] font-semibold">@{user?.username}</span>
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1">{t('settings.manageAccount')}</p>
          </div>

          {/* Switch Account Section */}
          {!showSwitchAccount ? (
            <div className="space-y-2">
              <Button variant="secondary" fullWidth onClick={() => setShowSwitchAccount(true)}>
                {t('settings.switchAccount')}
              </Button>
              {/* Logout Button */}
              <Button variant="danger" fullWidth onClick={handleLogout} loading={isLoggingOut}>
                {t('settings.logOut')}
              </Button>
              {/* Delete Account Button */}
              {showDeleteConfirm ? (
                <div className="p-3 bg-red-600/10 border border-red-600/30 rounded-input">
                  <p className="text-sm text-red-400 mb-3">{t('settings.confirmDelete')}</p>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={isDeleting}
                    >
                      {t('settings.cancel')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      fullWidth
                      onClick={handleDeleteAccount}
                      loading={isDeleting}
                    >
                      {t('settings.confirmDeleteBtn')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="danger" fullWidth onClick={() => setShowDeleteConfirm(true)}>
                  {t('settings.deleteAccount')}
                </Button>
              )}
            </div>
          ) : (
            /* Switch Account Panel */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-[var(--text-primary)]">
                  {t('auth.recentAccounts')}
                </h3>
                <button
                  onClick={handleCancelSwitch}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {t('settings.cancel')}
                </button>
              </div>

              {/* Recent accounts list */}
              {recentAccounts.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] text-center py-4">
                  {t('auth.noRecent')}
                </p>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {recentAccounts.map((account) => (
                    <button
                      key={account}
                      onClick={() => handleSwitchToAccount(account)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-input text-sm transition-colors text-left ${
                        account === user?.username
                          ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-[var(--text-primary)]'
                          : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-sub)] border border-transparent'
                      }`}
                    >
                      <span className="w-7 h-7 rounded-full bg-[var(--accent)]/20 flex items-center justify-center text-xs font-semibold text-[var(--accent)]">
                        {account.charAt(0).toUpperCase()}
                      </span>
                      <span className="flex-1">@{account}</span>
                      {account === user?.username && (
                        <span className="text-xs text-[var(--accent)]">当前</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Password input for selected account */}
              {switchUsername && (
                <div className="p-3 bg-[var(--bg-primary)] rounded-input border border-[var(--border-color)] space-y-2">
                  <p className="text-xs text-[var(--text-sub)]">
                    输入{' '}
                    <span className="text-[var(--text-primary)] font-semibold">
                      @{switchUsername}
                    </span>{' '}
                    的密码以切换
                  </p>
                  <input
                    type="password"
                    value={switchPassword}
                    onChange={(e) => setSwitchPassword(e.target.value)}
                    placeholder="输入密码"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleConfirmSwitch();
                      if (e.key === 'Escape') handleCancelSwitch();
                    }}
                    className="w-full border rounded-input px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
                    style={{
                      backgroundColor: 'var(--input-bg)',
                      borderColor: 'var(--border-color)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  {switchError && <p className="text-xs text-red-400">{switchError}</p>}
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth
                      onClick={handleCancelSwitch}
                      disabled={isSwitching}
                    >
                      取消
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      fullWidth
                      onClick={handleConfirmSwitch}
                      loading={isSwitching}
                    >
                      切换
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'ai' && (
        <div className="space-y-5">
          {/* 后端选择 */}
          <div>
            <label className="text-sm text-[var(--text-primary)] font-medium mb-2 block">
              {t('ai.settings.backend')}
            </label>
            <div className="space-y-1">
              <label className="flex items-center gap-3 px-3 py-2 rounded-input hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
                <input
                  type="radio"
                  name="ai-backend"
                  value="ollama"
                  checked={aiBackend === 'ollama'}
                  onChange={() => setAiBackend('ollama')}
                  className="accent-[#7C3AED]"
                />
                <span className="text-sm text-[var(--text-sub)]">{t('ai.settings.backend.ollama')}</span>
              </label>
              <label className="flex items-center gap-3 px-3 py-2 rounded-input hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
                <input
                  type="radio"
                  name="ai-backend"
                  value="remote"
                  checked={aiBackend === 'remote'}
                  onChange={() => setAiBackend('remote')}
                  className="accent-[#7C3AED]"
                />
                <span className="text-sm text-[var(--text-sub)]">{t('ai.settings.backend.remote')}</span>
              </label>
            </div>
          </div>

          {/* Ollama base URL */}
          <div>
            <label className="text-sm text-[var(--text-primary)] font-medium mb-1.5 block">
              {t('ai.settings.ollamaBaseUrl')}
            </label>
            <input
              type="text"
              value={aiOllamaBaseUrl}
              onChange={(e) => setAiOllamaBaseUrl(e.target.value)}
              className="w-full border rounded-input px-3 py-2 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
            />
          </div>

          {/* Remote base URL */}
          <div>
            <label className="text-sm text-[var(--text-primary)] font-medium mb-1.5 block">
              {t('ai.settings.remoteBaseUrl')}
            </label>
            <input
              type="text"
              value={aiRemoteBaseUrl}
              onChange={(e) => setAiRemoteBaseUrl(e.target.value)}
              className="w-full border rounded-input px-3 py-2 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
            />
          </div>

          {/* Model id */}
          <div>
            <label className="text-sm text-[var(--text-primary)] font-medium mb-1.5 block">
              {t('ai.settings.model')}
            </label>
            <input
              type="text"
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              placeholder="e.g. qwen3.5 / deepseek-chat"
              className="w-full border rounded-input px-3 py-2 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
            />
          </div>

          {/* API key */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm text-[var(--text-primary)] font-medium">
                {t('ai.settings.apiKey')}
              </label>
              {aiHasApiKey && (
                <span className="text-xs text-[var(--text-muted)]">{t('ai.settings.apiKeySet')}</span>
              )}
            </div>
            <input
              type="password"
              value={aiApiKey}
              onChange={(e) => setAiApiKey(e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
              className="w-full border rounded-input px-3 py-2 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">{t('ai.security.weakKeyring')}</p>
          </div>

          {/* 同意开关 */}
          <div>
            <label className="text-sm text-[var(--text-primary)] font-medium mb-2 block">
              {t('ai.settings.allowNetwork')}
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-3 px-3 py-2 rounded-input hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={aiAllowNetwork}
                  onChange={(e) => setAiAllowNetwork(e.target.checked)}
                  className="accent-[#7C3AED]"
                />
                <span className="text-sm text-[var(--text-sub)]">{t('ai.settings.allowNetwork')}</span>
              </label>
              <label className="flex items-center gap-3 px-3 py-2 rounded-input hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={aiAllowSend}
                  onChange={(e) => setAiAllowSend(e.target.checked)}
                  className="accent-[#7C3AED]"
                />
                <span className="text-sm text-[var(--text-sub)]">{t('ai.settings.allowSend')}</span>
              </label>
            </div>
          </div>

          {/* KB（Agent 知识库）参数区 —— 仅 Agent 知识库问答生效 */}
          <div className="border-t border-[var(--border-color)] pt-4">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm text-[var(--text-primary)] font-medium">
                {t('ai.settings.kb.title')}
              </label>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-3">{t('ai.settings.kb.hint')}</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[var(--text-primary)] font-medium mb-1 block">
                  {t('ai.settings.kb.topK')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={Number.isFinite(kbTopK) ? kbTopK : 5}
                  onChange={(e) => setKbTopK(e.currentTarget.valueAsNumber)}
                  className="w-full border rounded-input px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-primary)] font-medium mb-1 block">
                  {t('ai.settings.kb.fuse')}
                </label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={Number.isFinite(kbFuse) ? kbFuse : 0.5}
                  onChange={(e) => setKbFuse(e.currentTarget.valueAsNumber)}
                  className="w-full border rounded-input px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-primary)] font-medium mb-1 block">
                  {t('ai.settings.kb.threshold')}
                </label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={Number.isFinite(kbThreshold) ? kbThreshold : 0.6}
                  onChange={(e) => setKbThreshold(e.currentTarget.valueAsNumber)}
                  className="w-full border rounded-input px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-primary)] font-medium mb-1 block">
                  {t('ai.settings.kb.pinnedWeight')}
                </label>
                <input
                  type="number"
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={Number.isFinite(kbPinnedWeight) ? kbPinnedWeight : 1.5}
                  onChange={(e) => setKbPinnedWeight(e.currentTarget.valueAsNumber)}
                  className="w-full border rounded-input px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="text-xs text-[var(--text-primary)] font-medium mb-1 block">
                {t('ai.settings.kb.embeddingHost')}
              </label>
              <input
                type="text"
                value={kbEmbeddingHost}
                onChange={(e) => setKbEmbeddingHost(e.target.value)}
                placeholder="http://localhost:11434"
                className="w-full border rounded-input px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
              />
            </div>
            <div className="mt-3">
              <label className="text-xs text-[var(--text-primary)] font-medium mb-1 block">
                {t('ai.settings.kb.embeddingModel')}
              </label>
              <input
                type="text"
                value={kbEmbeddingModel}
                onChange={(e) => setKbEmbeddingModel(e.target.value)}
                placeholder="nomic-embed-text"
                className="w-full border rounded-input px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)] bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
              />
            </div>
          </div>

          {aiLoading && <p className="text-xs text-[var(--text-muted)]">Saving...</p>}
        </div>
      )}
    </Modal>
  );
};

export default SettingsModal;
