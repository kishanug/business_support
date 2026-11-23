import React, { useEffect, useState } from 'react';
import {
  CalendarCheck2,
  Check,
  ChevronDown,
  Copy,
  History,
  KeyRound,
  LogOut,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import type { AuditEvent, SessionUser } from '../core/types';
import { api, ApiError, type MyProfileData } from '../lib/api';

export interface TomorrowBriefingSummary {
  dateLabel: string;
  total: number;
  confirmed: number;
  unfilled: number;
  briefingText: string;
}

export interface NextMeetingSummary {
  label: string;
  sublabel: string;
  copyText: string;
}

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  user: SessionUser;
  myProfile: MyProfileData;
  auditEvents?: AuditEvent[];
  tomorrowBriefing?: TomorrowBriefingSummary;
  nextMeeting?: NextMeetingSummary | null;
  onProfileUpdated: () => Promise<void> | void;
  onQuickCreateRequest?: () => void;
  onLogout: () => void;
  onResetDemo?: () => Promise<void> | void;
  onClearTransactions?: () => Promise<void> | void;
}

function formatRoleLabel(user: SessionUser): string {
  if (user.role === 'SUPER_ADMIN') return 'Super Admin';
  if (user.role === 'EXTERNAL_COORDINATOR') return 'External Coordinator';
  if (user.canManageNetwork) return 'Veloctive Team Partner';
  return 'Veloctive Team';
}

function formatAuditAction(action: string): string {
  const map: Record<string, string> = {
    PROFILE_UPDATED: 'Profile Updated',
    PASSWORD_CHANGED: 'Password Changed',
    USER_PASSWORD_RESET_WITH_TOKEN: 'Password Reset',
    USER_PASSWORD_RESET_BY_ADMIN: 'Password Reset by Admin',
    USER_INVITED: 'Account Created',
    REQUEST_CREATED: 'Request Created',
    REQUEST_CANCELLED: 'Request Cancelled',
    ASSIGNMENT_CONFIRMED: 'Assignment Confirmed',
    ASSIGNMENT_FINISHED: 'Meeting Completed',
    ASSIGNMENT_VERIFIED: 'Meeting Verified',
    RECEIPT_RECORDED: 'Member Payment Recorded',
    PAYOUT_RECORDED: 'Veloctive Team Payout Recorded',
    COMMISSION_PAID: 'Commission Paid',
  };
  if (map[action]) return map[action];
  return action
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

function getInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'AO';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

async function copyTextSafe(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to textarea fallback
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    return true;
  } catch {
    return false;
  }
}

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  open,
  onClose,
  user,
  myProfile,
  auditEvents = [],
  tomorrowBriefing,
  nextMeeting,
  onProfileUpdated,
  onQuickCreateRequest,
  onLogout,
  onResetDemo,
  onClearTransactions,
}) => {
  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const isSubstitute = user.role === 'SUBSTITUTE';
  const isDemo = user.namespace === 'demo';

  // Profile form state synced from server myProfile
  const [displayName, setDisplayName] = useState(myProfile.displayName);
  const [callingPhone, setCallingPhone] = useState(myProfile.callingPhone);
  const [whatsappPhone, setWhatsappPhone] = useState(myProfile.whatsappPhone);
  const [region, setRegion] = useState(myProfile.region);
  const [defaultMemberFee, setDefaultMemberFee] = useState(
    myProfile.defaultMemberFee !== undefined ? String(myProfile.defaultMemberFee) : ''
  );
  const [defaultSubstitutePayout, setDefaultSubstitutePayout] = useState(
    myProfile.defaultSubstitutePayout !== undefined ? String(myProfile.defaultSubstitutePayout) : ''
  );
  const [homeArea, setHomeArea] = useState(myProfile.homeArea);
  const [upiReference, setUpiReference] = useState(myProfile.upiReference);
  const [emergencyContactName, setEmergencyContactName] = useState(myProfile.emergencyContactName);
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(myProfile.emergencyContactPhone);
  const [availability, setAvailability] = useState<'AVAILABLE' | 'LIMITED' | 'UNAVAILABLE'>(
    myProfile.availability ?? 'AVAILABLE'
  );
  const [emergencyConsent, setEmergencyConsent] = useState(Boolean(myProfile.emergencyConsent));

  const [profileSaving, setProfileSaving] = useState(false);
  const [profileStatus, setProfileStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [quickSaving, setQuickSaving] = useState(false);

  // Copy feedback
  const [copiedBriefing, setCopiedBriefing] = useState(false);
  const [copiedMeeting, setCopiedMeeting] = useState(false);

  // Collapsible sections
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Admin maintenance confirmation
  const [confirmMode, setConfirmMode] = useState<'NONE' | 'RESET_DEMO' | 'CLEAR_TX'>('NONE');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProfileStatus(null);
    setPasswordStatus(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setDisplayName(myProfile.displayName);
    setCallingPhone(myProfile.callingPhone);
    setWhatsappPhone(myProfile.whatsappPhone);
    setRegion(myProfile.region);
    setDefaultMemberFee(myProfile.defaultMemberFee !== undefined ? String(myProfile.defaultMemberFee) : '');
    setDefaultSubstitutePayout(
      myProfile.defaultSubstitutePayout !== undefined ? String(myProfile.defaultSubstitutePayout) : ''
    );
    setHomeArea(myProfile.homeArea);
    setUpiReference(myProfile.upiReference);
    setEmergencyContactName(myProfile.emergencyContactName);
    setEmergencyContactPhone(myProfile.emergencyContactPhone);
    setAvailability(myProfile.availability ?? 'AVAILABLE');
    setEmergencyConsent(Boolean(myProfile.emergencyConsent));
  }, [open, myProfile]);

  if (!open) return null;

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileStatus(null);
    const trimmedName = displayName.trim();
    if (trimmedName.length < 2) {
      setProfileStatus({ kind: 'err', text: 'Display name must be at least 2 characters.' });
      return;
    }

    const payload: Partial<MyProfileData> = {
      displayName: trimmedName,
      callingPhone: callingPhone.trim(),
      whatsappPhone: whatsappPhone.trim(),
    };

    if (isSubstitute) {
      payload.homeArea = homeArea.trim();
      payload.upiReference = upiReference.trim();
      payload.emergencyContactName = emergencyContactName.trim();
      payload.emergencyContactPhone = emergencyContactPhone.trim();
      payload.availability = availability;
      payload.emergencyConsent = emergencyConsent;
    } else {
      payload.region = region.trim();
      if (defaultMemberFee.trim() !== '') {
        const feeNum = Number(defaultMemberFee);
        if (!Number.isFinite(feeNum) || feeNum < 0) {
          setProfileStatus({ kind: 'err', text: 'Default member fee must be zero or positive.' });
          return;
        }
        payload.defaultMemberFee = feeNum;
      }
      if (defaultSubstitutePayout.trim() !== '') {
        const payNum = Number(defaultSubstitutePayout);
        if (!Number.isFinite(payNum) || payNum < 0) {
          setProfileStatus({ kind: 'err', text: 'Default Veloctive Team payout must be zero or positive.' });
          return;
        }
        payload.defaultSubstitutePayout = payNum;
      }
    }

    setProfileSaving(true);
    try {
      await api.updateMyProfile(payload);
      await onProfileUpdated();
      setProfileStatus({ kind: 'ok', text: 'Preferences saved.' });
    } catch (err) {
      setProfileStatus({
        kind: 'err',
        text: err instanceof ApiError ? err.message : 'Could not save preferences.',
      });
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleQuickAvailability(next: 'AVAILABLE' | 'LIMITED' | 'UNAVAILABLE') {
    setAvailability(next);
    setQuickSaving(true);
    setProfileStatus(null);
    try {
      await api.updateMyProfile({ availability: next });
      await onProfileUpdated();
    } catch (err) {
      setProfileStatus({
        kind: 'err',
        text: err instanceof ApiError ? err.message : 'Could not update availability.',
      });
    } finally {
      setQuickSaving(false);
    }
  }

  async function handleQuickEmergencyConsent(next: boolean) {
    setEmergencyConsent(next);
    setQuickSaving(true);
    setProfileStatus(null);
    try {
      await api.updateMyProfile({ emergencyConsent: next });
      await onProfileUpdated();
    } catch (err) {
      setProfileStatus({
        kind: 'err',
        text: err instanceof ApiError ? err.message : 'Could not update consent.',
      });
    } finally {
      setQuickSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordStatus(null);
    if (!currentPassword) {
      setPasswordStatus({ kind: 'err', text: 'Enter your current password.' });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordStatus({ kind: 'err', text: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordStatus({ kind: 'err', text: 'New passwords do not match.' });
      return;
    }
    setPasswordSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordStatus({ kind: 'ok', text: 'Password updated successfully.' });
    } catch (err) {
      setPasswordStatus({
        kind: 'err',
        text: err instanceof ApiError ? err.message : 'Could not update password.',
      });
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleCopyBriefing() {
    if (!tomorrowBriefing) return;
    const ok = await copyTextSafe(tomorrowBriefing.briefingText);
    if (ok) {
      setCopiedBriefing(true);
      setTimeout(() => setCopiedBriefing(false), 2200);
    }
  }

  async function handleCopyNextMeeting() {
    if (!nextMeeting) return;
    const ok = await copyTextSafe(nextMeeting.copyText);
    if (ok) {
      setCopiedMeeting(true);
      setTimeout(() => setCopiedMeeting(false), 2200);
    }
  }

  async function runConfirmedAction(action: 'RESET_DEMO' | 'CLEAR_TX') {
    setBusy(true);
    try {
      if (action === 'RESET_DEMO' && onResetDemo) {
        await onResetDemo();
      } else if (action === 'CLEAR_TX' && onClearTransactions) {
        await onClearTransactions();
      }
      setConfirmMode('NONE');
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'w-full h-9 px-3 rounded-[4px] bg-[#111113] border border-[#f2efeb]/12 text-xs text-[#f2efeb] placeholder:text-[#f2efeb]/35 focus:outline-none focus:border-[#E12D39] transition-colors';
  const labelClass = 'block font-mono text-[10px] uppercase tracking-[0.12em] text-[#f2efeb]/55 mb-1';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Account and preferences"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md bg-[#18181a] h-full border-l border-[#f2efeb]/10 flex flex-col">
        {/* Header */}
        <div className="px-5 h-16 border-b border-[#f2efeb]/10 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-display text-base font-bold text-[#f2efeb]">Account &amp; Preferences</h2>
            <p className="text-xs text-[#f2efeb]/60 truncate max-w-[300px]">{user.email}</p>
          </div>
          <button
            type="button"
            aria-label="Close account preferences"
            onClick={onClose}
            className="w-9 h-9 rounded-[4px] flex items-center justify-center text-[#f2efeb]/60 hover:text-[#f2efeb] hover:bg-white/5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Identity Summary Strip */}
          <div className="p-3.5 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10 flex items-center gap-3">
            <div className="w-11 h-11 rounded-[6px] bg-[#E2B340]/15 border border-[#E2B340]/45 text-[#E2B340] font-display font-bold text-sm flex items-center justify-center shrink-0">
              {getInitials(user.displayName)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-bold text-[#f2efeb] truncate">{user.displayName}</p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#E2B340]">
                  {formatRoleLabel(user)}
                </span>
                {isDemo && (
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#F06A74]">
                    · Demo Mode
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Role-Specific Daily Quick Utility */}
          {!isSubstitute && tomorrowBriefing && (
            <div className="p-4 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CalendarCheck2 className="w-4 h-4 text-[#E2B340]" />
                  <p className="font-display text-sm font-bold text-[#f2efeb]">Tomorrow&apos;s Briefing</p>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#f2efeb]/55">
                  {tomorrowBriefing.dateLabel}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="p-2.5 rounded-[4px] bg-[#111113] border border-[#f2efeb]/8">
                  <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#f2efeb]/50">Total</p>
                  <p className="text-base font-bold text-[#f2efeb] tabular-nums mt-0.5">{tomorrowBriefing.total}</p>
                </div>
                <div className="p-2.5 rounded-[4px] bg-[#111113] border border-[#f2efeb]/8">
                  <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#f2efeb]/50">Confirmed</p>
                  <p className="text-base font-bold text-emerald-400 tabular-nums mt-0.5">
                    {tomorrowBriefing.confirmed}
                  </p>
                </div>
                <div className="p-2.5 rounded-[4px] bg-[#111113] border border-[#f2efeb]/8">
                  <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#f2efeb]/50">Unfilled</p>
                  <p
                    className={`text-base font-bold tabular-nums mt-0.5 ${
                      tomorrowBriefing.unfilled > 0 ? 'text-[#E2B340]' : 'text-[#f2efeb]/70'
                    }`}
                  >
                    {tomorrowBriefing.unfilled}
                  </p>
                </div>
              </div>

              {tomorrowBriefing.total > 0 ? (
                <button
                  type="button"
                  onClick={handleCopyBriefing}
                  className="w-full h-9 px-3 rounded-[4px] border border-[#E2B340]/45 bg-[#E2B340]/12 hover:bg-[#E2B340]/22 text-xs font-semibold text-[#f2efeb] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copiedBriefing ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      Copied WhatsApp Briefing
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-[#E2B340]" />
                      Copy Tomorrow&apos;s Briefing
                    </>
                  )}
                </button>
              ) : (
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <p className="text-xs text-[#f2efeb]/60">No meetings scheduled for tomorrow yet.</p>
                  {onQuickCreateRequest && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onQuickCreateRequest();
                      }}
                      className="h-8 px-3 rounded-[4px] bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold inline-flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      New Request
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {isSubstitute && (
            <div className="p-4 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-[#E2B340]" />
                  <p className="font-display text-sm font-bold text-[#f2efeb]">My Availability</p>
                </div>
                {quickSaving && (
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#E2B340]">Saving...</span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Availability status">
                {(
                  [
                    { key: 'AVAILABLE', label: 'Available' },
                    { key: 'LIMITED', label: 'Limited' },
                    { key: 'UNAVAILABLE', label: 'Unavailable' },
                  ] as const
                ).map((opt) => {
                  const active = availability === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      disabled={quickSaving}
                      onClick={() => handleQuickAvailability(opt.key)}
                      aria-pressed={active}
                      className={`h-9 rounded-[4px] text-xs font-semibold border transition-colors cursor-pointer ${
                        active
                          ? opt.key === 'AVAILABLE'
                            ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                            : opt.key === 'LIMITED'
                              ? 'bg-[#E2B340]/20 border-[#E2B340]/50 text-[#E2B340]'
                              : 'bg-red-500/20 border-red-400/50 text-red-300'
                          : 'bg-[#111113] border-[#f2efeb]/10 text-[#f2efeb]/65 hover:text-[#f2efeb]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <label className="flex items-center justify-between gap-3 pt-1 cursor-pointer">
                <span className="text-xs text-[#f2efeb]/80">Share emergency contact with coordinators</span>
                <input
                  type="checkbox"
                  checked={emergencyConsent}
                  disabled={quickSaving}
                  onChange={(e) => handleQuickEmergencyConsent(e.target.checked)}
                  className="w-4 h-4 accent-[#C81E2B] cursor-pointer"
                />
              </label>

              {nextMeeting && (
                <div className="pt-2 border-t border-[#f2efeb]/10 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#f2efeb]/50">Next Confirmed</p>
                    <p className="text-xs font-semibold text-[#f2efeb] truncate">{nextMeeting.label}</p>
                    <p className="text-[11px] text-[#f2efeb]/55 truncate">{nextMeeting.sublabel}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyNextMeeting}
                    className="h-8 px-2.5 rounded-[4px] border border-[#E2B340]/45 bg-[#E2B340]/12 hover:bg-[#E2B340]/22 text-xs font-semibold text-[#f2efeb] inline-flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    {copiedMeeting ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-[#E2B340]" />}
                    {copiedMeeting ? 'Copied' : 'Copy'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Editable Profile & Contact Preferences */}
          <form
            onSubmit={handleSaveProfile}
            className="p-4 rounded-[6px] bg-[#18181a] border border-[#f2efeb]/10 space-y-3"
          >
            <p className="font-display text-sm font-bold text-[#f2efeb]">Profile &amp; Contact Details</p>

            <div>
              <label htmlFor="pref-display-name" className={labelClass}>
                Display Name
              </label>
              <input
                id="pref-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                minLength={2}
                className={inputClass}
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="pref-calling-phone" className={labelClass}>
                  Calling Phone
                </label>
                <input
                  id="pref-calling-phone"
                  type="tel"
                  value={callingPhone}
                  onChange={(e) => setCallingPhone(e.target.value)}
                  placeholder="98XXXXXXXX"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="pref-whatsapp-phone" className={labelClass}>
                  WhatsApp Phone
                </label>
                <input
                  id="pref-whatsapp-phone"
                  type="tel"
                  value={whatsappPhone}
                  onChange={(e) => setWhatsappPhone(e.target.value)}
                  placeholder="98XXXXXXXX"
                  className={inputClass}
                />
              </div>
            </div>

            {!isSubstitute ? (
              <>
                <div>
                  <label htmlFor="pref-region" className={labelClass}>
                    Primary Region / Hub
                  </label>
                  <input
                    id="pref-region"
                    type="text"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    placeholder="e.g. Western Suburbs, Mumbai"
                    className={inputClass}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="pref-member-fee" className={labelClass}>
                      Default Member Fee (₹)
                    </label>
                    <input
                      id="pref-member-fee"
                      type="number"
                      min={0}
                      step={50}
                      value={defaultMemberFee}
                      onChange={(e) => setDefaultMemberFee(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="pref-sub-payout" className={labelClass}>
                      Default Sub Payout (₹)
                    </label>
                    <input
                      id="pref-sub-payout"
                      type="number"
                      min={0}
                      step={50}
                      value={defaultSubstitutePayout}
                      onChange={(e) => setDefaultSubstitutePayout(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="pref-home-area" className={labelClass}>
                      Home Area
                    </label>
                    <input
                      id="pref-home-area"
                      type="text"
                      value={homeArea}
                      onChange={(e) => setHomeArea(e.target.value)}
                      placeholder="e.g. Andheri West"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="pref-upi" className={labelClass}>
                      Private UPI ID
                    </label>
                    <input
                      id="pref-upi"
                      type="text"
                      value={upiReference}
                      onChange={(e) => setUpiReference(e.target.value)}
                      placeholder="name@upi"
                      className={inputClass}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="pref-emg-name" className={labelClass}>
                      Emergency Contact
                    </label>
                    <input
                      id="pref-emg-name"
                      type="text"
                      value={emergencyContactName}
                      onChange={(e) => setEmergencyContactName(e.target.value)}
                      placeholder="Contact name"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="pref-emg-phone" className={labelClass}>
                      Emergency Phone
                    </label>
                    <input
                      id="pref-emg-phone"
                      type="tel"
                      value={emergencyContactPhone}
                      onChange={(e) => setEmergencyContactPhone(e.target.value)}
                      placeholder="98XXXXXXXX"
                      className={inputClass}
                    />
                  </div>
                </div>
              </>
            )}

            {profileStatus && (
              <p
                role="status"
                className={`text-xs px-3 py-2 rounded-[4px] border ${
                  profileStatus.kind === 'ok'
                    ? 'bg-emerald-500/12 border-emerald-500/35 text-emerald-300'
                    : 'bg-red-500/12 border-red-500/35 text-red-300'
                }`}
              >
                {profileStatus.text}
              </p>
            )}

            <button
              type="submit"
              disabled={profileSaving}
              className="w-full h-9 px-3 rounded-[4px] bg-[#C81E2B] hover:bg-[#A31621] disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              {profileSaving ? 'Saving...' : 'Save Preferences'}
            </button>
          </form>

          {/* Collapsible Security: Change Password */}
          <div className="rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] overflow-hidden">
            <button
              type="button"
              aria-expanded={passwordOpen}
              onClick={() => setPasswordOpen((v) => !v)}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/[0.02] cursor-pointer"
            >
              <span className="font-display text-sm font-bold text-[#f2efeb] inline-flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#E2B340]" />
                Change Password
              </span>
              <ChevronDown
                className={`w-4 h-4 text-[#f2efeb]/50 transition-transform ${passwordOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {passwordOpen && (
              <div className="px-4 pb-4 pt-1 border-t border-[#f2efeb]/8">
                {isDemo ? (
                  <p className="text-xs text-[#f2efeb]/65 leading-relaxed pt-2">
                    Demo accounts use one-click Demo Login. Sign in to your Workspace account to update your password.
                  </p>
                ) : (
                  <form onSubmit={handleChangePassword} className="space-y-2.5 pt-2">
                    <div>
                      <label htmlFor="pref-cur-pwd" className={labelClass}>
                        Current Password
                      </label>
                      <input
                        id="pref-cur-pwd"
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        required
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label htmlFor="pref-new-pwd" className={labelClass}>
                        New Password (min 8 characters)
                      </label>
                      <input
                        id="pref-new-pwd"
                        type="password"
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        minLength={8}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label htmlFor="pref-confirm-pwd" className={labelClass}>
                        Confirm New Password
                      </label>
                      <input
                        id="pref-confirm-pwd"
                        type="password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        minLength={8}
                        className={inputClass}
                      />
                    </div>

                    {passwordStatus && (
                      <p
                        role="status"
                        className={`text-xs px-3 py-2 rounded-[4px] border ${
                          passwordStatus.kind === 'ok'
                            ? 'bg-emerald-500/12 border-emerald-500/35 text-emerald-300'
                            : 'bg-red-500/12 border-red-500/35 text-red-300'
                        }`}
                      >
                        {passwordStatus.text}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={passwordSaving}
                      className="w-full h-9 px-3 rounded-[4px] bg-[#27272d] hover:bg-[#32323a] border border-[#f2efeb]/12 text-[#f2efeb] text-xs font-semibold transition-colors cursor-pointer"
                    >
                      {passwordSaving ? 'Updating...' : 'Update Password'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>

          {/* Collapsible Super Admin Data Maintenance */}
          {isSuperAdmin && (onResetDemo || onClearTransactions) && (
            <div className="rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] overflow-hidden">
              <button
                type="button"
                aria-expanded={maintenanceOpen}
                onClick={() => setMaintenanceOpen((v) => !v)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/[0.02] cursor-pointer"
              >
                <span className="font-display text-sm font-bold text-[#f2efeb] inline-flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-[#E2B340]" />
                  Workspace Maintenance
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-[#f2efeb]/50 transition-transform ${maintenanceOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {maintenanceOpen && (
                <div className="px-4 pb-4 pt-2 border-t border-[#f2efeb]/8 space-y-3 text-xs">
                  <p className="text-[#f2efeb]/60 leading-relaxed">
                    Clean up test entries without affecting user accounts or directory masters.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {isDemo && onResetDemo && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmMode('RESET_DEMO')}
                        className="h-9 px-3 rounded-[4px] border border-[#f2efeb]/12 bg-[#1f1f23] hover:bg-[#C81E2B]/20 text-xs font-semibold text-[#f2efeb] inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-[#E2B340]" />
                        Reset Demo Data
                      </button>
                    )}
                    {onClearTransactions && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmMode('CLEAR_TX')}
                        className="h-9 px-3 rounded-[4px] border border-red-500/35 bg-red-500/12 hover:bg-red-500/20 text-xs font-semibold text-red-400 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Clear Transactions
                      </button>
                    )}
                  </div>

                  {confirmMode === 'RESET_DEMO' && (
                    <div className="p-3 rounded-[4px] bg-[#C81E2B]/18 border border-[#E12D39]/40 space-y-2">
                      <p className="font-semibold text-[#f2efeb]">Restore clean demo dataset?</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => runConfirmedAction('RESET_DEMO')}
                          className="h-8 px-3 rounded-[4px] bg-[#C81E2B] text-white text-xs font-semibold cursor-pointer"
                        >
                          {busy ? 'Resetting...' : 'Confirm Reset'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirmMode('NONE')}
                          className="h-8 px-3 rounded-[4px] border border-[#f2efeb]/12 bg-[#18181a] text-xs text-[#f2efeb]/70 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {confirmMode === 'CLEAR_TX' && (
                    <div className="p-3 rounded-[4px] bg-red-500/12 border border-red-500/35 space-y-2">
                      <p className="font-semibold text-red-300">
                        Clear all requests, assignments &amp; finance ledgers?
                      </p>
                      <p className="text-[11px] text-red-300/80">
                        Accounts, chapters, venues, members, and Veloctive Team remain intact.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => runConfirmedAction('CLEAR_TX')}
                          className="h-8 px-3 rounded-[4px] bg-red-600 text-white text-xs font-semibold cursor-pointer"
                        >
                          {busy ? 'Clearing...' : 'Confirm Clear All'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirmMode('NONE')}
                          className="h-8 px-3 rounded-[4px] border border-red-500/35 bg-[#18181a] text-xs text-red-300 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Collapsible Recent Activity (Admin & Coordinator, collapsed by default) */}
          {!isSubstitute && (
            <div className="rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] overflow-hidden">
              <button
                type="button"
                aria-expanded={activityOpen}
                onClick={() => setActivityOpen((v) => !v)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/[0.02] cursor-pointer"
              >
                <span className="font-display text-sm font-bold text-[#f2efeb] inline-flex items-center gap-2">
                  <History className="w-4 h-4 text-[#E2B340]" />
                  Recent Activity
                  <span className="font-mono text-[11px] font-normal text-[#f2efeb]/50">
                    ({auditEvents.length})
                  </span>
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-[#f2efeb]/50 transition-transform ${activityOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {activityOpen && (
                <div className="divide-y divide-[#f2efeb]/8 border-t border-[#f2efeb]/8 max-h-60 overflow-y-auto">
                  {auditEvents.length === 0 ? (
                    <p className="p-4 text-xs text-[#f2efeb]/55">No recent activity yet.</p>
                  ) : (
                    auditEvents.slice(0, 20).map((ev) => (
                      <div key={ev.id} className="px-4 py-2.5 text-xs">
                        <p className="font-semibold text-[#f2efeb]">{formatAuditAction(ev.action)}</p>
                        <p className="text-[#f2efeb]/65 mt-0.5 leading-snug">{ev.summary}</p>
                        <p className="text-[11px] text-[#f2efeb]/45 mt-1">
                          {ev.actorName} · {new Date(ev.createdAt).toLocaleString('en-IN')}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#f2efeb]/10 bg-[#1f1f23] flex items-center justify-between gap-2 shrink-0">
          {isSuperAdmin && isDemo && onResetDemo ? (
            <button
              type="button"
              onClick={() => {
                setMaintenanceOpen(true);
                setConfirmMode('RESET_DEMO');
              }}
              className="h-10 px-3.5 rounded-[4px] border border-[#f2efeb]/12 bg-[#18181a] hover:bg-[#C81E2B]/20 text-xs font-semibold text-[#f2efeb] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Demo
            </button>
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#f2efeb]/40">
              AgencyOS
            </span>
          )}

          <button
            type="button"
            onClick={onLogout}
            className="h-10 px-4 rounded-[4px] bg-[#27272d] hover:bg-[#323238] text-[#f2efeb] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
};
