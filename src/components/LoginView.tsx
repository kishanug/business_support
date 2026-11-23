import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, Eye, EyeOff, KeyRound } from 'lucide-react';
import { api, ApiError, AuthStatusResponse, LoginQuickFillAccount, setAuthToken } from '../lib/api';
import type { SessionUser } from '../core/types';

interface LoginViewProps {
  onAuthenticated: (user: SessionUser) => void;
}

type DemoRoleKey = 'SA' | 'EC' | 'SUB';
type AuthPanelMode = 'SIGN_IN' | 'FORGOT' | 'INVITE';

const DEMO_ROLES: Array<{ key: DemoRoleKey; label: string; full: string }> = [
  { key: 'SA', label: 'Super Admin', full: 'Super Admin' },
  { key: 'EC', label: 'EC', full: 'External Coordinator' },
  { key: 'SUB', label: 'VT', full: 'Veloctive Team' },
];

export const LoginView: React.FC<LoginViewProps> = ({ onAuthenticated }) => {
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [mode, setMode] = useState<AuthPanelMode>('SIGN_IN');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [inviteToken, setInviteToken] = useState('');

  const [selectedDemo, setSelectedDemo] = useState<DemoRoleKey>('SA');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [quickFillAccounts, setQuickFillAccounts] = useState<LoginQuickFillAccount[]>([]);
  const [quickFillOpen, setQuickFillOpen] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  useEffect(() => {
    api.getAuthStatus().then(setAuthStatus).catch(() => {});
    api
      .getLoginQuickFillAccounts()
      .then((res) => setQuickFillAccounts(res.accounts ?? []))
      .catch(() => {});
    try {
      const params = new URLSearchParams(window.location.search);
      const qEmail = params.get('resetEmail');
      const qCode = params.get('resetCode');
      if (qEmail && qCode) {
        setEmail(qEmail);
        setResetToken(qCode);
        setMode('FORGOT');
        setInfo('Reset link verified. Choose a new password below.');
        params.delete('resetEmail');
        params.delete('resetCode');
        const nextQs = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${nextQs ? `?${nextQs}` : ''}`);
      }
    } catch {
      // ignore restricted history environments
    }
  }, []);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!email.trim() || !password) {
      setError('Enter both email and password.');
      return;
    }
    setBusy(true);
    try {
      const { token, user } = await api.login(email.trim(), password);
      setAuthToken(token);
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickDemoLogin() {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const { token, user } = await api.demoLogin(selectedDemo);
      setAuthToken(token);
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Demo sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!email.trim()) {
      setError('Enter the authorized Super Admin email.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.forgotPassword(email.trim());
      setInfo(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCompleteReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await api.resetPassword(email.trim(), resetToken.trim(), newPassword);
      setInfo('Password updated. Sign in with your new password.');
      setMode('SIGN_IN');
      setPassword('');
      setResetToken('');
      setNewPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset password.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAcceptInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { token, user } = await api.acceptInvite(email.trim(), inviteToken.trim(), newPassword);
      setAuthToken(token);
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invitation could not be activated.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#ffffff] text-[#15161a] flex flex-col items-center justify-center px-4 py-10 sm:py-14">
      <div className="w-full max-w-[448px] flex flex-col items-center">
        {/* Centered Editorial Brand Lockup matching Reference */}
        <header className="text-center mb-8 sm:mb-9">
          <div className="inline-flex items-center justify-center gap-3.5 mb-6">
            <img
              src="/assets/aistudio/image__1__81460661.png"
              alt="Veloctive cycling emblem"
              referrerPolicy="no-referrer"
              className="h-12 sm:h-[52px] w-auto object-contain shrink-0 select-none"
            />
            <div className="flex flex-col items-start leading-none">
              <span className="font-editorial text-[32px] sm:text-[36px] font-bold tracking-[-0.03em] text-[#15161a]">
                Agency<span className="text-[#D4A130]">OS</span>
              </span>
              <span className="font-editorial italic text-[13px] font-medium text-[#C89422] mt-0.5 select-none">
                by Kishan
              </span>
            </div>
          </div>

          <h1 className="font-editorial text-[24px] sm:text-[28px] font-bold leading-[1.24] tracking-[-0.025em] text-[#15161a]">
            One Platform. Every Assignment.
            <span className="block text-[#C81E2B] mt-0.5">Complete Control.</span>
          </h1>

          <p className="mt-3 text-xs sm:text-[13px] text-[#6b7280] font-medium">
            From the founder of Veloctive · Built on real-world service experience
          </p>
        </header>

        {/* Centered Dark Carbon Auth Card */}
        <section className="login-dark-card w-full rounded-2xl p-6 sm:p-8 shadow-[0_24px_64px_-20px_rgba(17,17,19,0.45)] border border-[#26262b]">
          <div className="mb-6">
            <p className="text-sm font-semibold text-[#E2B340]">
              {mode === 'SIGN_IN'
                ? 'Welcome back.'
                : mode === 'FORGOT'
                ? 'Reset password'
                : 'Activate invite'}
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 px-3.5 py-2.5 rounded-xl bg-red-950/60 border border-red-500/45 text-xs font-medium text-red-200 leading-relaxed"
            >
              {error}
            </div>
          )}
          {info && (
            <div
              role="status"
              className="mb-4 px-3.5 py-2.5 rounded-xl bg-[#E2B340]/15 border border-[#E2B340]/45 text-xs font-medium text-[#F5DFA0] leading-relaxed"
            >
              {info}
            </div>
          )}

          {/* SIGN IN MODE */}
          {mode === 'SIGN_IN' && (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label htmlFor="login-email" className="block text-xs font-medium text-[#d4d4d8] mb-1.5">
                  Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="login-dark-input w-full h-11 px-3.5 rounded-xl border border-[#2b2b31] text-sm focus:outline-none focus:border-[#C81E2B] transition-colors"
                />
              </div>

              <div>
                <label htmlFor="login-password" className="block text-xs font-medium text-[#d4d4d8] mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="login-dark-input w-full h-11 pl-3.5 pr-11 rounded-xl border border-[#2b2b31] text-sm focus:outline-none focus:border-[#C81E2B] transition-colors"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-[#a1a1aa] hover:text-white cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="flex justify-end mt-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setInfo(null);
                      setMode('FORGOT');
                    }}
                    className="text-xs font-medium text-[#E12D39] hover:text-[#F06A74] transition-colors cursor-pointer"
                  >
                    Forgot?
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full h-11 rounded-xl bg-[#C81E2B] hover:bg-[#A31621] disabled:opacity-60 text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                {busy ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          )}

          {/* FORGOT / RESET PASSWORD MODE */}
          {mode === 'FORGOT' && (
            <div className="space-y-4">
              {authStatus && !authStatus.smtpConfigured && (
                <p className="text-xs text-amber-300 bg-amber-500/12 border border-amber-500/30 rounded-xl px-3 py-2">
                  Configure <code className="font-mono">SMTP_USER</code> &amp; <code className="font-mono">SMTP_PASS</code> in Settings to send reset emails.
                </p>
              )}

              <form onSubmit={handleRequestReset} className="space-y-3">
                <div>
                  <label htmlFor="reset-email" className="block text-xs font-medium text-[#d4d4d8] mb-1.5">
                    Account Email
                  </label>
                  <input
                    id="reset-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="kishanus03@gmail.com"
                    className="login-dark-input w-full h-11 px-3.5 rounded-xl border border-[#2b2b31] text-sm focus:outline-none focus:border-[#C81E2B]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-10 rounded-xl border border-[#E2B340]/55 text-[#E2B340] hover:bg-[#E2B340]/12 disabled:opacity-60 text-xs font-semibold transition-colors cursor-pointer"
                >
                  {busy ? 'Sending...' : 'Email Reset Code'}
                </button>
              </form>

              <form onSubmit={handleCompleteReset} className="space-y-3 pt-4 border-t border-[#26262b]">
                <div>
                  <label htmlFor="reset-token" className="block text-xs font-medium text-[#d4d4d8] mb-1.5">
                    8-Character Reset Code
                  </label>
                  <input
                    id="reset-token"
                    type="text"
                    required
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    placeholder="ABCD1234"
                    className="login-dark-input w-full h-11 px-3.5 rounded-xl border border-[#2b2b31] text-sm font-mono uppercase focus:outline-none focus:border-[#C81E2B]"
                  />
                </div>
                <div>
                  <label htmlFor="reset-new-pw" className="block text-xs font-medium text-[#d4d4d8] mb-1.5">
                    New Password
                  </label>
                  <input
                    id="reset-new-pw"
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="login-dark-input w-full h-11 px-3.5 rounded-xl border border-[#2b2b31] text-sm focus:outline-none focus:border-[#C81E2B]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-11 rounded-xl bg-[#C81E2B] hover:bg-[#A31621] disabled:opacity-60 text-white text-sm font-semibold transition-colors cursor-pointer"
                >
                  {busy ? 'Updating...' : 'Update Password'}
                </button>
              </form>

              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setInfo(null);
                  setMode('SIGN_IN');
                }}
                className="text-xs text-[#a1a1aa] hover:text-white cursor-pointer"
              >
                ← Back to Sign In
              </button>
            </div>
          )}

          {/* ACTIVATE INVITE MODE */}
          {mode === 'INVITE' && (
            <form onSubmit={handleAcceptInvite} className="space-y-3.5">
              <div>
                <label htmlFor="inv-email" className="block text-xs font-medium text-[#d4d4d8] mb-1.5">
                  Invited Email
                </label>
                <input
                  id="inv-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="member@agency.in"
                  className="login-dark-input w-full h-11 px-3.5 rounded-xl border border-[#2b2b31] text-sm focus:outline-none focus:border-[#C81E2B]"
                />
              </div>
              <div>
                <label htmlFor="inv-token" className="block text-xs font-medium text-[#d4d4d8] mb-1.5">
                  Invite Token
                </label>
                <input
                  id="inv-token"
                  type="text"
                  value={inviteToken}
                  onChange={(e) => setInviteToken(e.target.value)}
                  placeholder="Paste invite token"
                  className="login-dark-input w-full h-11 px-3.5 rounded-xl border border-[#2b2b31] text-sm font-mono focus:outline-none focus:border-[#C81E2B]"
                />
              </div>
              <div>
                <label htmlFor="inv-pw" className="block text-xs font-medium text-[#d4d4d8] mb-1.5">
                  Set Password
                </label>
                <input
                  id="inv-pw"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="login-dark-input w-full h-11 px-3.5 rounded-xl border border-[#2b2b31] text-sm focus:outline-none focus:border-[#C81E2B]"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full h-11 rounded-xl bg-[#C81E2B] hover:bg-[#A31621] text-white text-sm font-semibold cursor-pointer"
              >
                Activate &amp; Sign In
              </button>
              <button
                type="button"
                onClick={() => setMode('SIGN_IN')}
                className="text-xs text-[#a1a1aa] hover:text-white cursor-pointer block"
              >
                ← Back to Sign In
              </button>
            </form>
          )}

          {/* Quick Demo Access Divider & Controls */}
          <div className="mt-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-[#2b2b31]" />
              <span className="text-[11px] font-medium text-[#8e8e98]">Quick Demo Access</span>
              <div className="flex-1 h-px bg-[#2b2b31]" />
            </div>

            <div
              role="radiogroup"
              aria-label="Demo role selector"
              data-testid="demo-role-selector"
              className="grid grid-cols-[1.5fr_1fr_1fr] gap-2.5"
            >
              {DEMO_ROLES.map((item) => {
                const isSelected = selectedDemo === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={item.full}
                    onClick={() => setSelectedDemo(item.key)}
                    className={`h-11 rounded-xl text-[13px] font-semibold border transition-colors cursor-pointer whitespace-nowrap px-2 ${
                      isSelected
                        ? 'border-[#C81E2B] bg-[#C81E2B]/14 text-[#E12D39]'
                        : 'border-[#2b2b31] bg-[#1a1a1e] text-[#e4e4e7] hover:border-[#3f3f46]'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={handleQuickDemoLogin}
              className="mt-3 w-full h-11 rounded-xl border border-[#E2B340]/60 bg-[#1a1a1e] hover:bg-[#E2B340]/12 text-[#f2efeb] text-sm font-semibold transition-colors cursor-pointer"
            >
              Quick Demo Login
            </button>

            <div className="mt-4 flex items-center justify-between gap-2 text-[11px] text-[#71717a]">
              <span>Demo uses isolated sample data. Production login ignores demo selection.</span>
              {mode === 'SIGN_IN' && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setInfo(null);
                    setMode('INVITE');
                  }}
                  className="inline-flex items-center gap-1 text-[#d4d4d8] hover:text-[#E2B340] font-medium cursor-pointer shrink-0"
                >
                  <KeyRound className="w-3 h-3 text-[#E2B340]" />
                  Activate invite
                </button>
              )}
            </div>

            {/* Super-Admin-Approved Quick-Fill Accounts (shown ONLY when Super Admin explicitly enables accounts) */}
            {quickFillAccounts.length > 0 && (
              <div
                data-testid="login-quickfill-panel"
                className="mt-4 rounded-xl border border-[#2b2b31] bg-[#18181c] overflow-hidden"
              >
                <button
                  type="button"
                  aria-expanded={quickFillOpen}
                  data-testid="login-quickfill-toggle"
                  onClick={() => setQuickFillOpen((o) => !o)}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-medium text-[#d4d4d8] hover:bg-white/[0.03] transition-colors cursor-pointer"
                >
                  <span>Quick-fill accounts (role-based)</span>
                  {quickFillOpen ? (
                    <ChevronUp className="w-4 h-4 text-[#8e8e98]" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[#8e8e98]" />
                  )}
                </button>

                {quickFillOpen && (
                  <div className="border-t border-[#26262b] px-3.5 py-2.5 space-y-2">
                    <div className="divide-y divide-[#26262b]/70">
                      {quickFillAccounts.map((acc) => {
                        const roleText =
                          acc.role === 'SUPER_ADMIN'
                            ? 'Super Admin'
                            : acc.role === 'EXTERNAL_COORDINATOR'
                            ? 'External Coordinator'
                            : 'Veloctive Team';
                        const isCopied = copiedEmail === acc.email;
                        return (
                          <div
                            key={acc.email}
                            className="py-2 first:pt-0.5 flex items-center justify-between gap-2"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setEmail(acc.email);
                                setMode('SIGN_IN');
                                setError(null);
                                setInfo(`Prefilled ${acc.email}. Enter your password to sign in.`);
                              }}
                              className="min-w-0 flex-1 text-left group cursor-pointer"
                            >
                              <p className="text-xs font-semibold text-[#f2efeb] group-hover:text-[#E2B340] truncate transition-colors">
                                {acc.email}
                              </p>
                              <p className="text-[11px] text-[#8e8e98]">
                                {roleText}
                                {acc.displayName ? ` · ${acc.displayName}` : ''}
                              </p>
                            </button>
                            <button
                              type="button"
                              aria-label={`Copy ${acc.email}`}
                              onClick={() => {
                                navigator.clipboard?.writeText(acc.email).catch(() => {});
                                setCopiedEmail(acc.email);
                                setTimeout(() => {
                                  setCopiedEmail((cur) => (cur === acc.email ? null : cur));
                                }, 1500);
                              }}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#8e8e98] hover:text-[#f2efeb] hover:bg-white/[0.06] cursor-pointer shrink-0"
                            >
                              {isCopied ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <p className="pt-1.5 border-t border-[#26262b]/70 text-[10.5px] leading-relaxed text-[#71717a]">
                      Tap an email to prefill, then enter your password. Credentials and role are strictly verified by the server on sign-in.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
