// ============================================
// WeaveMD — Signup Page Component
// ============================================

import React, { useState, useEffect, useCallback } from 'react';
import Input from '../Common/Input';
import Button from '../Common/Button';
import { validateUsername, validatePassword, getPasswordStrength, generateCaptcha, validateCaptcha } from '../../utils/validators';
import type { PasswordStrength } from '../../utils/validators';

interface SignupPageProps {
  onSwitchToLogin: (prefillUsername?: string) => void;
}

const SignupPage: React.FC<SignupPageProps> = ({ onSwitchToLogin }) => {
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

  // Regenerate captcha
  const regenerateCaptcha = useCallback(() => {
    setCaptcha(generateCaptcha());
    setCaptchaAnswer('');
    setCaptchaError('');
  }, []);

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
        // Can't reach server — allow to proceed
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

    // Validate all fields
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
      setCaptchaError('Incorrect answer, please try again');
      regenerateCaptcha();
      return;
    }

    setLoading(true);
    try {
      const result = (await window.weaveMD.auth.register(username.trim(), password)) as {
        success: boolean;
        message?: string;
      };

      if (result.success) {
        setRegistrationSuccess(true);
        setTimeout(() => {
          onSwitchToLogin(username.trim());
        }, 2000);
      } else {
        setGeneralError(result.message || 'Registration failed');
      }
    } catch {
      setGeneralError('Cannot connect to registration service');
    } finally {
      setLoading(false);
    }
  };

  const strengthConfig: Record<PasswordStrength, { color: string; label: string; width: string }> = {
    weak: { color: 'strength-weak', label: 'Weak', width: 'w-1/3' },
    medium: { color: 'strength-medium', label: 'Medium', width: 'w-2/3' },
    strong: { color: 'strength-strong', label: 'Strong', width: 'w-full' },
  };

  if (registrationSuccess) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg-primary p-4">
        <div className="w-full max-w-[420px] bg-bg-secondary rounded-card p-8 shadow-modal text-center">
          <span className="text-5xl">✅</span>
          <h2 className="text-xl font-bold text-white mt-4">Registration successful!</h2>
          <p className="text-sm text-text-sub mt-2">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-bg-primary p-4">
      <div className="w-full max-w-[420px] bg-bg-secondary rounded-card p-8 shadow-modal">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white">Create Account</h1>
          <p className="text-sm text-text-sub mt-1">Start your note-taking journey</p>
        </div>

        {/* General error */}
        {generalError && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-input text-sm text-red-400">
            {generalError}
          </div>
        )}

        {/* Username */}
        <div className="mb-4">
          <Input
            label="Username"
            value={username}
            onChange={(v) => {
              setUsername(v);
              setUsernameAvailable(null);
            }}
            placeholder="5-15 characters, a-z, 0-9, _"
            error={usernameError}
            disabled={loading}
            hint={
              usernameAvailable === true
                ? '✓ Username available'
                : undefined
            }
          />
          {usernameAvailable === true && (
            <p className="text-xs text-green-400 mt-1">✓ Username available</p>
          )}
          {usernameAvailable === false && (
            <p className="text-xs text-red-400 mt-1">✗ This username is taken</p>
          )}
          {usernameChecking && (
            <p className="text-xs text-text-muted mt-1">Checking availability...</p>
          )}
        </div>

        {/* Password */}
        <div className="mb-2">
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="At least 8 characters"
            showPasswordToggle
            error={passwordError}
            disabled={loading}
          />
        </div>

        {/* Password strength indicator */}
        {password && (
          <div className="mb-4">
            <div className="flex gap-1 h-1 mb-1">
              <div className={`flex-1 rounded-full bg-bg-tertiary ${strengthConfig[passwordStrength].width} ${strengthConfig[passwordStrength].color}`} />
            </div>
            <p className="text-xs text-text-muted">
              Strength: <span className={passwordStrength === 'weak' ? 'text-red-400' : passwordStrength === 'medium' ? 'text-yellow-400' : 'text-green-400'}>{strengthConfig[passwordStrength].label}</span>
            </p>
          </div>
        )}

        {/* Captcha */}
        <div className="mb-4 p-3 bg-bg-primary rounded-input border border-border">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-text-sub font-medium">Security check</p>
            <button
              onClick={regenerateCaptcha}
              className="text-text-muted hover:text-white transition-colors"
              title="Regenerate"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
              </svg>
            </button>
          </div>
          <p className="text-lg font-bold text-white mb-2 font-code">{captcha.question}</p>
          <Input
            value={captchaAnswer}
            onChange={(v) => {
              setCaptchaAnswer(v);
              setCaptchaError('');
            }}
            placeholder="Your answer"
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
            className="w-4 h-4 rounded border-border bg-transparent accent-[#7C3AED] cursor-pointer"
          />
          <span className="text-xs text-text-sub">I have read the Terms</span>
        </label>

        {/* Register button */}
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={loading}
          disabled={!agreeTerms}
          onClick={handleSubmit}
        >
          Register
        </Button>

        {/* Sign in link */}
        <div className="mt-6 text-center">
          <button
            onClick={() => onSwitchToLogin()}
            className="text-sm text-text-muted hover:text-text-sub transition-colors"
          >
            Already have an account? Sign In
          </button>
        </div>
      </div>
    </div>
  );
};

export default SignupPage;
