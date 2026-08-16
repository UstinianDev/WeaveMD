// ============================================
// WeaveMD — Signup Page Component
// Right-side form with mascot interaction support
// ============================================

import React, { useState, useEffect, useCallback } from 'react';
import Input from '@render/components/Common/Input';
import Button from '@render/components/Common/Button';
import { useI18n } from '@render/i18n';
import {
  validateUsername,
  validatePassword,
  getPasswordStrength,
  generateCaptcha,
  validateCaptcha,
} from '@render/utils/validators';
import type { PasswordStrength } from '@render/utils/validators';
import type { MascotState } from './InteractiveMascot';

interface SignupPageProps {
  onSwitchToLogin: (prefillUsername?: string) => void;
  onMascotStateChange: (state: MascotState) => void;
  onPasswordVisibleChange: (visible: boolean) => void;
}

const SignupPage: React.FC<SignupPageProps> = ({ onSwitchToLogin, onMascotStateChange, onPasswordVisibleChange }) => {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);

  const [usernameError, setUsernameError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [captchaError, setCaptchaError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [loading, setLoading] = useState(false);

  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrength>('weak');

  const [captcha, setCaptcha] = useState(generateCaptcha);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const regenerateCaptcha = useCallback(() => {
    setCaptcha(generateCaptcha());
    setCaptchaAnswer('');
    setCaptchaError('');
  }, []);

  // Update mascot state
  useEffect(() => {
    if (registrationSuccess) {
      onMascotStateChange('success');
    } else if (generalError) {
      onMascotStateChange('error');
    } else if (focusedField === 'username') {
      onMascotStateChange('focus-username');
    } else if (focusedField === 'password') {
      onMascotStateChange('focus-password');
    } else {
      onMascotStateChange('idle');
    }
  }, [focusedField, generalError, registrationSuccess, onMascotStateChange]);

  // Check username availability with debounce
  useEffect(() => {
    if (!username || username.length < 5) {
      setUsernameAvailable(null);
      setUsernameError('');
      return;
    }

    const validation = validateUsername(username);
    if (!validation.valid) {
      setUsernameError(validation.message);
      setUsernameAvailable(null);
      return;
    }

    setUsernameError('');
    const timer = setTimeout(async () => {
      setUsernameChecking(true);
      try {
        const result = (await window.weaveMD.auth.checkUsername(username.trim())) as {
          available: boolean;
          message: string;
        };
        if (!result.available) {
          setUsernameAvailable(false);
          setUsernameError(result.message);
        } else {
          setUsernameAvailable(true);
        }
      } catch {
        setUsernameAvailable(null);
      } finally {
        setUsernameChecking(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [username]);

  // Update password strength indicator
  useEffect(() => {
    if (password) {
      setPasswordStrength(getPasswordStrength(password));
      const validation = validatePassword(password);
      setPasswordError(validation.valid ? '' : validation.message);
    } else {
      setPasswordStrength('weak');
      setPasswordError('');
    }
  }, [password]);

  const handleSubmit = async () => {
    setGeneralError('');

    const usernameValidation = validateUsername(username);
    if (!usernameValidation.valid) {
      setUsernameError(usernameValidation.message);
      return;
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      setPasswordError(passwordValidation.message);
      return;
    }

    if (!validateCaptcha(captchaAnswer, captcha.answer)) {
      setCaptchaError(t('auth.captchaError'));
      regenerateCaptcha();
      return;
    }

    setLoading(true);
    onMascotStateChange('hover-submit');
    try {
      const result = (await window.weaveMD.auth.register(username.trim(), password)) as {
        success: boolean;
        message?: string;
      };

      if (result.success) {
        setRegistrationSuccess(true);
        onMascotStateChange('success');
        setTimeout(() => {
          onSwitchToLogin(username.trim());
        }, 2000);
      } else {
        setGeneralError(t('auth.regError', result.message || 'Registration failed'));
        onMascotStateChange('error');
      }
    } catch {
      setGeneralError(t('auth.regConnError'));
      onMascotStateChange('error');
    } finally {
      setLoading(false);
    }
  };

  const strengthConfig: Record<PasswordStrength, { color: string; label: string; width: string }> =
    {
      weak: { color: 'bg-red-500', label: t('auth.weak'), width: 'w-1/3' },
      medium: { color: 'bg-yellow-500', label: t('auth.medium'), width: 'w-2/3' },
      strong: { color: 'bg-green-500', label: t('auth.strong'), width: 'w-full' },
    };

  if (registrationSuccess) {
    return (
      <div className="w-full max-w-[380px] text-center">
        <span className="text-5xl">✅</span>
        <h2 className="text-xl font-bold text-gray-900 mt-4">{t('auth.regSuccess')}</h2>
        <p className="text-sm text-gray-500 mt-2">{t('auth.redirecting')}</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[380px]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('auth.createAccount')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('auth.startJourney')}</p>
      </div>

      {/* General error */}
      {generalError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {generalError}
        </div>
      )}

      {/* Username */}
      <div className="mb-4">
        <Input
          label={t('auth.username')}
          value={username}
          onChange={(v) => {
            setUsername(v);
            setUsernameAvailable(null);
          }}
          placeholder={t('auth.usernameHint')}
          error={usernameError}
          disabled={loading}
          onFocus={() => setFocusedField('username')}
          onBlur={() => setFocusedField(null)}
        />
        {usernameAvailable === true && (
          <p className="text-xs text-green-500 mt-1">{`✓ ${t('auth.available')}`}</p>
        )}
        {usernameAvailable === false && (
          <p className="text-xs text-red-500 mt-1">{`✗ ${t('auth.taken')}`}</p>
        )}
        {usernameChecking && <p className="text-xs text-gray-400 mt-1">{t('auth.checking')}</p>}
      </div>

      {/* Password */}
      <div className="mb-2">
        <Input
          label={t('auth.password')}
          type="password"
          value={password}
          onChange={setPassword}
          placeholder={t('auth.passwordHint')}
          showPasswordToggle
          error={passwordError}
          disabled={loading}
          onFocus={() => setFocusedField('password')}
          onBlur={() => setFocusedField(null)}
          onVisibilityToggle={onPasswordVisibleChange}
        />
      </div>

      {/* Password strength indicator */}
      {password && (
        <div className="mb-4">
          <div className="flex gap-1 h-1 mb-1">
            <div
              className={`flex-1 rounded-full bg-gray-200 ${strengthConfig[passwordStrength].width} ${strengthConfig[passwordStrength].color}`}
            />
          </div>
          <p className="text-xs text-gray-400">
            {`${t('auth.strength')}: `}
            <span
              className={
                passwordStrength === 'weak'
                  ? 'text-red-500'
                  : passwordStrength === 'medium'
                    ? 'text-yellow-500'
                    : 'text-green-500'
              }
            >
              {strengthConfig[passwordStrength].label}
            </span>
          </p>
        </div>
      )}

      {/* Captcha */}
      <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-600 font-medium">{t('auth.securityCheck')}</p>
          <button
            onClick={regenerateCaptcha}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            title="Regenerate"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
        <p className="text-lg font-bold text-gray-900 mb-2 font-mono">{captcha.question}</p>
        <Input
          value={captchaAnswer}
          onChange={(v) => {
            setCaptchaAnswer(v);
            setCaptchaError('');
          }}
          placeholder={t('auth.captchaPlaceholder')}
          error={captchaError}
          disabled={loading}
        />
      </div>

      {/* Terms checkbox */}
      <label className="flex items-center gap-2 mb-6 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={agreeTerms}
          onChange={(e) => setAgreeTerms(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 bg-transparent accent-purple-600 cursor-pointer"
        />
        <span className="text-xs text-gray-500">{t('auth.terms')}</span>
      </label>

      {/* Register button */}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        loading={loading}
        disabled={!agreeTerms}
        onClick={handleSubmit}
        onMouseEnter={() => !loading && onMascotStateChange('hover-submit')}
        onMouseLeave={() => !loading && onMascotStateChange('idle')}
      >
        {t('auth.register')}
      </Button>

      {/* Sign in link */}
      <div className="mt-6 text-center">
        <button
          onClick={() => onSwitchToLogin()}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          {t('auth.alreadyHave')}
        </button>
      </div>
    </div>
  );
};

export default SignupPage;
