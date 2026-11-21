import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, Mail, ShieldCheck, UserPlus } from 'lucide-react';
import { api, ApiError, AuthStatusResponse, setAuthToken } from '../lib/api';
import type { SessionUser } from '../core/types';

interface LoginViewProps {
  onAuthenticated: (user: SessionUser) => void;
}

type DemoRoleKey = 'SA' | 'EC' | 'SUB';
type AuthPanelMode = 'SIGN_IN' | 'FORGOT' | 'INVITE' | 'BOOTSTRAP';

const DEMO_ROLES: Array<{ key: DemoRoleKey; short: string; full: string }> = [
  { key: 'SA', short: 'SA', full: 'Super Admin' },
  { key: 'EC', short: 'EC', full: 'External Coordinator' },
  { key: 'SUB', short: 'SUB', full: 'Substitute' },
];

export const LoginView: React.FC<LoginViewProps> = ({ onAuthenticated }) => {
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [mode, setMode] = useState<AuthPanelMode>('SIGN_IN');

  // Sign-in form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Forgot / Reset / Invite / Bootstrap fields
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPhone, setAdminPhone] = useState('');

  // Compact Quick Demo selector
  const [selectedDemo, setSelectedDemo] = useState<DemoRoleKey>('SA');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    api.getAuthStatus().then(setAuthStatus).catch(() => {});
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
    setBusy(true);
    try {
      const res = await api.forgotPassword(email.trim());
      setInfo(res.resetToken ? `${res.message} Sandbox token: ${res.resetToken}` : res.message);
      if (res.resetToken) setResetToken(res.resetToken);
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
      setInfo('Password updated. You may now sign in with your new password.');
      setMode('SIGN_IN');
      setPassword('');
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

  async function handleBootstrapAdmin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { token, user } = await api.bootstrapAdmin({
        email: email.trim(),
        password,
        displayName: adminName.trim(),
        callingPhone: adminPhone.trim(),
      });
      setAuthToken(token);
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Admin setup failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#FFFFFF] flex flex-col lg:flex-row">
      {/* Left Brand Editorial Panel (Desktop) + Compact Header (Mobile) */}
      <div className="lg:w-[46%] xl:w-[48%] bg-[#F8F7FC] border-b lg:border-b-0 lg:border-r border-[#E6E8EF] px-6 py-8 sm:px-10 lg:px-14 lg:py-16 flex flex-col justify-between">
        <div className="max-w-md mx-auto lg:mx-0 w-full">
          {/* Original Supplied Golden Veloctive Cycling Monogram + AgencyOS Wordmark */}
          <div className="flex items-center gap-3.5">
            <img
              src="/assets/aistudio/image__1__81460661.png"
              alt="Veloctive golden cycling emblem"
              referrerPolicy="no-referrer"
              className="h-12 w-auto object-contain shrink-0 select-none"
            />
            <div className="relative inline-flex items-baseline">
              <span className="font-display text-[30px] sm:text-[34px] font-extrabold tracking-tight leading-none text-[#142342]">
                Agency<span className="text-[#C59D45]">OS</span>
              </span>
              <span
                className="ml-1 -mt-1.5 self-start text-[12px] font-medium italic text-[#B58F3D] -rotate-6 origin-bottom-left select-none whitespace-nowrap"
                style={{ textDecoration: 'none' }}
              >
                by Kishan
              </span>
            </div>
          </div>

          {/* Tagline */}
          <div className="mt-7 lg:mt-12">
            <h1 className="font-display text-2xl sm:text-3xl lg:text-[34px] font-bold tracking-tight text-[#142342] leading-[1.18] text-balance">
              One Platform. Every Assignment.
              <span className="block text-[#6D28D9] mt-1">Complete Control.</span>
            </h1>
            <p className="mt-4 text-sm sm:text-[15px] text-[#475569] leading-relaxed max-w-sm">
              Coordinate client requests, registered substitutes, partner delegation, morning check-ins, and reconciled receivables and payables from one workspace.
            </p>
          </div>

          {/* Subtle Gold Credibility Strip */}
          <div className="mt-6 lg:mt-10 pt-5 border-t border-[#E6E8EF]">
            <p className="text-xs font-semibold text-[#B58F3D] tracking-wide">
              From the founder of Veloctive
            </p>
            <p className="text-xs text-[#64748B] mt-0.5">
              Built on real-world service experience
            </p>
          </div>
        </div>

        {/* Desktop-only Operational Highlights */}
        <div className="hidden lg:grid grid-cols-2 gap-6 pt-10 max-w-md border-t border-[#E6E8EF]/80 mt-12">
          <div>
            <p className="text-xs font-semibold text-[#142342]">Privacy-First Pool</p>
            <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
              Member identity and 30-second briefing stay locked until final assignment confirmation.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-[#142342]">Idempotent Ledger</p>
            <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
              Valid Finish posts one member receivable and one registered partner payable atomically.
            </p>
          </div>
        </div>
      </div>

      {/* Right Sign-In & Compact Demo Shell */}
      <div className="flex-1 flex items-center justify-center px-5 py-8 sm:px-8 lg:px-14 bg-white">
        <div className="w-full max-w-[420px]">
          {/* Gold-accented Welcome back */}
          <div className="mb-6">
            <p className="text-xs font-semibold text-[#B58F3D] mb-1">Invite-Only Access</p>
            <h2 className="font-display text-2xl sm:text-[26px] font-bold text-[#142342] tracking-tight">
              Welcome back<span className="text-[#D8B66C]">.</span>
            </h2>
            <p className="text-sm text-[#64748B] mt-1">
              Sign in with your invited credentials. Role permissions are verified by the server.
            </p>
          </div>

          {/* Alerts */}
          {error && (
            <div role="alert" className="mb-4 px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
              {error}
            </div>
          )}
          {info && (
            <div role="status" className="mb-4 px-3.5 py-2.5 rounded-lg bg-[#F3E8FF] border border-[#DDD6FE] text-xs font-medium text-[#5B21B6]">
              {info}
            </div>
          )}

          {/* SIGN IN FORM */}
          {mode === 'SIGN_IN' && (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label htmlFor="login-email" className="block text-xs font-semibold text-[#142342] mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@agency.in"
                    className="w-full h-11 pl-10 pr-3.5 rounded-xl border border-[#E6E8EF] bg-white text-sm text-[#142342] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#6D28D9] focus:ring-2 focus:ring-[#F3E8FF] transition-colors"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="login-password" className="block text-xs font-semibold text-[#142342]">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setInfo(null);
                      setMode('FORGOT');
                    }}
                    className="text-xs font-medium text-[#6D28D9] hover:text-[#5B21B6] transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full h-11 pl-10 pr-11 rounded-xl border border-[#E6E8EF] bg-white text-sm text-[#142342] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#6D28D9] focus:ring-2 focus:ring-[#F3E8FF] transition-colors"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-[#64748B] hover:text-[#142342] hover:bg-[#F8F7FC]"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full h-11 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center cursor-pointer"
              >
                {busy ? 'Signing in...' : 'Sign In'}
              </button>

              <div className="flex items-center justify-between pt-1 text-xs text-[#64748B]">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setInfo(null);
                    setMode('INVITE');
                  }}
                  className="inline-flex items-center gap-1.5 text-[#142342] hover:text-[#6D28D9] font-medium"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  Activate invite
                </button>
                {authStatus && !authStatus.workspaceInitialized && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setInfo(null);
                      setMode('BOOTSTRAP');
                    }}
                    className="inline-flex items-center gap-1.5 text-[#B58F3D] hover:text-[#142342] font-semibold"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    First-run Admin setup
                  </button>
                )}
              </div>
            </form>
          )}

          {/* FORGOT / RESET PASSWORD */}
          {mode === 'FORGOT' && (
            <div className="space-y-4">
              <form onSubmit={handleRequestReset} className="space-y-3">
                <div>
                  <label htmlFor="reset-email" className="block text-xs font-semibold text-[#142342] mb-1.5">
                    Account Email
                  </label>
                  <input
                    id="reset-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@agency.in"
                    className="w-full h-11 px-3.5 rounded-xl border border-[#E6E8EF] text-sm text-[#142342] focus:outline-none focus:border-[#6D28D9]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-11 rounded-xl border border-[#6D28D9] text-[#6D28D9] hover:bg-[#F3E8FF] text-sm font-semibold transition-colors"
                >
                  Request Reset Token
                </button>
              </form>

              <form onSubmit={handleCompleteReset} className="space-y-3 pt-3 border-t border-[#E6E8EF]">
                <div>
                  <label htmlFor="reset-token" className="block text-xs font-semibold text-[#142342] mb-1.5">
                    Reset Token
                  </label>
                  <input
                    id="reset-token"
                    type="text"
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    placeholder="Paste token"
                    className="w-full h-11 px-3.5 rounded-xl border border-[#E6E8EF] text-sm font-mono text-[#142342] focus:outline-none focus:border-[#6D28D9]"
                  />
                </div>
                <div>
                  <label htmlFor="reset-new-pw" className="block text-xs font-semibold text-[#142342] mb-1.5">
                    New Password (min 8 chars)
                  </label>
                  <input
                    id="reset-new-pw"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New strong password"
                    className="w-full h-11 px-3.5 rounded-xl border border-[#E6E8EF] text-sm text-[#142342] focus:outline-none focus:border-[#6D28D9]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-11 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-sm font-semibold transition-colors"
                >
                  Update Password
                </button>
              </form>

              <button
                type="button"
                onClick={() => setMode('SIGN_IN')}
                className="text-xs font-medium text-[#64748B] hover:text-[#142342]"
              >
                Back to Sign In
              </button>
            </div>
          )}

          {/* ACCEPT INVITE */}
          {mode === 'INVITE' && (
            <form onSubmit={handleAcceptInvite} className="space-y-3.5">
              <div>
                <label htmlFor="inv-email" className="block text-xs font-semibold text-[#142342] mb-1.5">
                  Invited Email
                </label>
                <input
                  id="inv-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="coordinator@agency.in"
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E6E8EF] text-sm focus:outline-none focus:border-[#6D28D9]"
                />
              </div>
              <div>
                <label htmlFor="inv-token" className="block text-xs font-semibold text-[#142342] mb-1.5">
                  Invite Token
                </label>
                <input
                  id="inv-token"
                  type="text"
                  value={inviteToken}
                  onChange={(e) => setInviteToken(e.target.value)}
                  placeholder="Token from Super Admin invite"
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E6E8EF] text-sm font-mono focus:outline-none focus:border-[#6D28D9]"
                />
              </div>
              <div>
                <label htmlFor="inv-pw" className="block text-xs font-semibold text-[#142342] mb-1.5">
                  Set Password (min 8 chars)
                </label>
                <input
                  id="inv-pw"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Choose a private password"
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E6E8EF] text-sm focus:outline-none focus:border-[#6D28D9]"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full h-11 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-sm font-semibold"
              >
                Activate & Sign In
              </button>
              <button
                type="button"
                onClick={() => setMode('SIGN_IN')}
                className="text-xs font-medium text-[#64748B] hover:text-[#142342]"
              >
                Back to Sign In
              </button>
            </form>
          )}

          {/* FIRST-RUN WORKSPACE ADMIN SETUP */}
          {mode === 'BOOTSTRAP' && (
            <form onSubmit={handleBootstrapAdmin} className="space-y-3.5">
              <p className="text-xs text-[#475569] leading-relaxed">
                Initialize the isolated local workspace with your Super Admin account. This workspace has zero demo records.
              </p>
              <div>
                <label htmlFor="boot-name" className="block text-xs font-semibold text-[#142342] mb-1.5">
                  Full Name
                </label>
                <input
                  id="boot-name"
                  type="text"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder="Kishan Mehta"
                  required
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E6E8EF] text-sm focus:outline-none focus:border-[#6D28D9]"
                />
              </div>
              <div>
                <label htmlFor="boot-phone" className="block text-xs font-semibold text-[#142342] mb-1.5">
                  Coordinator Calling Number
                </label>
                <input
                  id="boot-phone"
                  type="tel"
                  value={adminPhone}
                  onChange={(e) => setAdminPhone(e.target.value)}
                  placeholder="9820000001"
                  required
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E6E8EF] text-sm focus:outline-none focus:border-[#6D28D9]"
                />
              </div>
              <div>
                <label htmlFor="boot-email" className="block text-xs font-semibold text-[#142342] mb-1.5">
                  Admin Email
                </label>
                <input
                  id="boot-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@agency.in"
                  required
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E6E8EF] text-sm focus:outline-none focus:border-[#6D28D9]"
                />
              </div>
              <div>
                <label htmlFor="boot-pw" className="block text-xs font-semibold text-[#142342] mb-1.5">
                  Password (min 8 chars)
                </label>
                <input
                  id="boot-pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create strong password"
                  required
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E6E8EF] text-sm focus:outline-none focus:border-[#6D28D9]"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full h-11 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-sm font-semibold"
              >
                Create Super Admin Account
              </button>
              <button
                type="button"
                onClick={() => setMode('SIGN_IN')}
                className="text-xs font-medium text-[#64748B] hover:text-[#142342]"
              >
                Back to Sign In
              </button>
            </form>
          )}

          {/* LOCKED SPEC: Compact Quick Demo Access — Single Horizontal Row SA / EC / SUB + ONE Quick Demo Login */}
          <div className="mt-7 pt-6 border-t border-[#E6E8EF]">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-semibold text-[#142342]">Quick Demo Access</span>
              <span className="text-[11px] text-[#64748B]">Isolated fictional data</span>
            </div>

            {/* Single horizontal row, fixed height (h-11), vertically centered labels, zero height jump or font wrap */}
            <div
              role="radiogroup"
              aria-label="Demo role selector"
              data-testid="demo-role-selector"
              className="flex items-center gap-1.5 p-1 rounded-xl bg-[#F8F7FC] border border-[#E6E8EF] h-[52px]"
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
                    className={`h-10 rounded-lg text-[13px] font-semibold leading-none whitespace-nowrap flex items-center justify-center transition-all duration-150 cursor-pointer ${
                      isSelected
                        ? 'flex-1 bg-[#6D28D9] text-white px-3 shadow-xs'
                        : 'w-[54px] shrink-0 bg-transparent text-[#475569] hover:text-[#142342] hover:bg-white/80'
                    }`}
                  >
                    <span className="truncate">{isSelected ? item.full : item.short}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={handleQuickDemoLogin}
              className="mt-3 w-full h-11 rounded-xl border border-[#6D28D9] bg-[#F3E8FF]/60 hover:bg-[#F3E8FF] text-[#6D28D9] text-sm font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Quick Demo Login</span>
            </button>

            <p className="mt-3 text-[11px] text-[#64748B] leading-relaxed text-center">
              Running in Local Full-Stack Sandbox (no external Supabase project connected). Demo sessions never access workspace records.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
