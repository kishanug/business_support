import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit3,
  FileText,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Plus,
  Power,
  Search,
  Send,
  Shield,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { api, ApiError, type ConfirmedBriefingItem, type SubstituteBootstrapData } from '../lib/api';
import {
  buildCoordinatorUpdateWhatsAppText,
  buildOpenRequestHelpWhatsAppText,
  buildReachedPhotoWhatsAppText,
  buildTelHref,
  buildWhatsAppHref,
  formatDisplayDate,
  formatINR,
  formatShortDate,
  getMemberNoteTypeLabel,
} from '../core/rules';
import type { PartnerGuestContact, PublicOpenRequestCard } from '../core/types';
import type { SubTab } from './AppShell';

interface SubstitutePortalProps {
  data: SubstituteBootstrapData;
  activeTab: SubTab;
  onSelectTab: (tab: SubTab) => void;
  onRefresh: () => Promise<void>;
  focusedOpenRequestId?: string | null;
  focusedAssignmentId?: string | null;
  onClearFocus?: () => void;
}

export const SubstitutePortal: React.FC<SubstitutePortalProps> = ({
  data,
  activeTab,
  onSelectTab,
  onRefresh,
  focusedOpenRequestId,
  focusedAssignmentId,
  onClearFocus,
}) => {
  const [expandedOpenId, setExpandedOpenId] = useState<string | null>(null);
  const [highlightedAssignmentId, setHighlightedAssignmentId] = useState<string | null>(null);

  React.useEffect(() => {
    if (focusedOpenRequestId && activeTab === 'open') {
      setExpandedOpenId(focusedOpenRequestId);
      setTimeout(() => {
        document
          .getElementById(`sub-open-${focusedOpenRequestId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);
      onClearFocus?.();
    }
  }, [focusedOpenRequestId, activeTab, onClearFocus]);

  React.useEffect(() => {
    if (focusedAssignmentId && activeTab === 'meetings') {
      setHighlightedAssignmentId(focusedAssignmentId);
      setTimeout(() => {
        document
          .getElementById(`sub-asgn-${focusedAssignmentId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);
      onClearFocus?.();
    }
  }, [focusedAssignmentId, activeTab, onClearFocus]);
  const [bidTarget, setBidTarget] = useState<PublicOpenRequestCard | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [bidNote, setBidNote] = useState('');

  const [delegateTarget, setDelegateTarget] = useState<PublicOpenRequestCard | null>(null);
  const [selectedGuestId, setSelectedGuestId] = useState('');
  const [delegateGuestSearch, setDelegateGuestSearch] = useState('');
  const [delegateNote, setDelegateNote] = useState('');
  const [showInlineNewGuest, setShowInlineNewGuest] = useState(false);
  const [inlineGuestForm, setInlineGuestForm] = useState({
    name: '',
    phone: '',
    whatsappPhone: '',
    homeArea: '',
    notes: '',
    consentConfirmed: true,
  });

  // Earnings filter by Assigned Via Coordinator
  const [earningsViaFilter, setEarningsViaFilter] = useState('ALL');

  // Finish assignment modal
  const [finishTarget, setFinishTarget] = useState<ConfirmedBriefingItem | null>(null);
  const [finishNotes, setFinishNotes] = useState({
    referralsGiven: '',
    peopleMet: '',
    highlights: '',
    issues: '',
    earlyFinishReason: '',
  });
  const [isEarlyFinish, setIsEarlyFinish] = useState(false);

  // One-Row Active Meeting Check-In & Completion Flow state (Home)
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [issueDraftText, setIssueDraftText] = useState('');
  const [activeCompleteId, setActiveCompleteId] = useState<string | null>(null);
  const [memberNoteDraft, setMemberNoteDraft] = useState('');
  const [expandedBriefingId, setExpandedBriefingId] = useState<string | null>(null);

  // Add / Edit Guest Contact modal (Partner Network)
  const [networkSearch, setNetworkSearch] = useState('');
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [editingGuestId, setEditingGuestId] = useState<string | null>(null);
  const [guestForm, setGuestForm] = useState({
    name: '',
    phone: '',
    whatsappPhone: '',
    homeArea: '',
    preferredAreas: '',
    notes: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    consentConfirmed: true,
    active: true,
  });

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reachedWhatsAppPrompt, setReachedWhatsAppPrompt] = useState<{
    url: string;
    chapterName: string;
    meetingDate: string;
    coordinatorName: string;
  } | null>(null);

  function buildReachedWhatsAppUrl(item: ConfirmedBriefingItem): string {
    const message = buildReachedPhotoWhatsAppText(item.chapterName, item.assignment.meetingDate);
    return buildWhatsAppHref(item.coordinatorWhatsappPhone || item.coordinatorCallingPhone, message);
  }

  function triggerWhatsAppLink(url: string) {
    try {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      // fallback link remains visible in status banner
    }
  }

  async function handleRespond(
    reqId: string,
    responseType: 'INTERESTED' | 'NOT_AVAILABLE' | 'FIRST_CONFIRM',
    requestCrossMeeting = false
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.submitResponse(reqId, {
        responseType,
        ...(requestCrossMeeting ? { requestCrossMeeting: true } : {}),
      });
      await onRefresh();
      if (res.crossMeetingPending) {
        setNotice('Cross-meeting request pinned to Super Admin for approval.');
      } else if (res.autoConfirmed) {
        setNotice('Confirmed! Meeting instructions unlocked in Home & My Meetings.');
      } else if (responseType === 'INTERESTED') {
        setNotice('Interest submitted for coordinator review.');
      } else {
        setNotice('Marked Not Available.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to submit response.');
    } finally {
      setBusy(false);
    }
  }

  async function submitBid(e: React.FormEvent) {
    e.preventDefault();
    if (!bidTarget) return;
    setBusy(true);
    setError(null);
    try {
      await api.submitResponse(bidTarget.id, {
        responseType: 'BID',
        proposedPayout: Number(bidAmount),
        note: bidNote,
      });
      await onRefresh();
      setBidTarget(null);
      setBidAmount('');
      setBidNote('');
      setNotice('Custom price offer submitted for coordinator approval.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to submit offer.');
    } finally {
      setBusy(false);
    }
  }

  async function submitDelegation(e: React.FormEvent) {
    e.preventDefault();
    if (!delegateTarget || !selectedGuestId) return;
    setBusy(true);
    setError(null);
    try {
      await api.submitResponse(delegateTarget.id, {
        responseType: 'DELEGATE_PROPOSAL',
        delegatedGuestId: selectedGuestId,
        note: delegateNote,
      });
      await onRefresh();
      setDelegateTarget(null);
      setSelectedGuestId('');
      setDelegateNote('');
      setNotice('Guest attendee nominated. Mandatory coordinator approval is pending.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to nominate guest.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckin(item: ConfirmedBriefingItem, eventType: 'AWAKE' | 'LEFT_HOME' | 'REACHED') {
    setBusy(true);
    setError(null);
    try {
      await api.recordCheckin(item.assignment.id, eventType);
      await onRefresh();
      if (eventType === 'REACHED') {
        const waUrl = buildReachedWhatsAppUrl(item);
        setReachedWhatsAppPrompt({
          url: waUrl,
          chapterName: item.chapterName,
          meetingDate: item.assignment.meetingDate,
          coordinatorName: item.coordinatorName,
        });
        triggerWhatsAppLink(waUrl);
        setNotice(
          `Marked Reached for ${item.chapterName} — Super Admin & ${item.assignedViaCoordinatorName} notified. Opening WhatsApp to share your venue photo.`
        );
      } else {
        const label = eventType === 'AWAKE' ? "Marked I'm Awake" : 'Marked Departed';
        setNotice(`${label} for ${item.chapterName} — Super Admin & ${item.assignedViaCoordinatorName} notified.`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Check-in failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReportIssueSubmit(assignmentId: string) {
    if (!issueDraftText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.reportAssignmentIssue(assignmentId, issueDraftText.trim());
      await onRefresh();
      setActiveIssueId(null);
      setIssueDraftText('');
      setNotice('Issue alert sent to your coordinator.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to send issue alert.');
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickComplete(item: ConfirmedBriefingItem) {
    setBusy(true);
    setError(null);
    try {
      const cleanNote = memberNoteDraft.trim();
      const res = await api.finishAssignment(item.assignment.id, {
        idempotencyKey: `ui-finish-${item.assignment.id}`,
        isEarlyFinish: false,
        notes: {
          referralsGiven: cleanNote,
          highlights: cleanNote,
          issues: item.assignment.issueNote ?? '',
        },
      });
      await onRefresh();
      setActiveCompleteId(null);
      setMemberNoteDraft('');
      setNotice(
        res.idempotentReplay
          ? 'Meeting already completed.'
          : `Meeting completed · ${formatINR(res.substituteEarning.amount)} payout posted.`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not mark meeting completed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleFinishSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!finishTarget) return;
    setBusy(true);
    setError(null);
    try {
      const idempotencyKey = `ui-finish-${finishTarget.assignment.id}`;
      const res = await api.finishAssignment(finishTarget.assignment.id, {
        idempotencyKey,
        isEarlyFinish,
        notes: finishNotes,
      });
      await onRefresh();
      setFinishTarget(null);
      setFinishNotes({
        referralsGiven: '',
        peopleMet: '',
        highlights: '',
        issues: '',
        earlyFinishReason: '',
      });
      setIsEarlyFinish(false);
      setNotice(
        res.idempotentReplay
          ? 'Already finished — no duplicate financial entries created.'
          : `Meeting finished (Self-Reported)! ₹${res.substituteEarning.amount} added to your Earnings ledger.`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not complete Finish.');
    } finally {
      setBusy(false);
    }
  }

  async function handleInlineAddGuest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = await api.upsertPartnerGuest({
        ...inlineGuestForm,
        active: true,
      });
      await onRefresh();
      setSelectedGuestId(saved.id);
      setShowInlineNewGuest(false);
      setInlineGuestForm({
        name: '',
        phone: '',
        whatsappPhone: '',
        homeArea: '',
        notes: '',
        consentConfirmed: true,
      });
      setNotice(`Saved "${saved.name}" to My Network and selected for nomination.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save guest contact.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveGuest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.upsertPartnerGuest({
        id: editingGuestId ?? undefined,
        ...guestForm,
      });
      await onRefresh();
      setGuestModalOpen(false);
      setEditingGuestId(null);
      setGuestForm({
        name: '',
        phone: '',
        whatsappPhone: '',
        homeArea: '',
        preferredAreas: '',
        notes: '',
        emergencyContactName: '',
        emergencyContactPhone: '',
        consentConfirmed: true,
        active: true,
      });
      setNotice(
        editingGuestId
          ? 'Saved guest contact updated.'
          : 'Saved guest contact to My Network (no login account created).'
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save guest contact.');
    } finally {
      setBusy(false);
    }
  }

  function openEditGuest(guest: PartnerGuestContact) {
    setError(null);
    setEditingGuestId(guest.id);
    setGuestForm({
      name: guest.name,
      phone: guest.phone,
      whatsappPhone: guest.whatsappPhone ?? '',
      homeArea: guest.homeArea,
      preferredAreas: guest.preferredAreas ?? '',
      notes: guest.notes ?? '',
      emergencyContactName: guest.emergencyContactName ?? '',
      emergencyContactPhone: guest.emergencyContactPhone ?? '',
      consentConfirmed: guest.consentConfirmed,
      active: guest.active,
    });
    setGuestModalOpen(true);
  }

  const activeGuests = useMemo(
    () => data.myGuestContacts.filter((g) => g.active),
    [data.myGuestContacts]
  );

  const filteredDelegateGuests = useMemo(() => {
    const q = delegateGuestSearch.trim().toLowerCase();
    if (!q) return activeGuests;
    return activeGuests.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.phone.toLowerCase().includes(q) ||
        g.homeArea.toLowerCase().includes(q)
    );
  }, [activeGuests, delegateGuestSearch]);

  const filteredNetworkGuests = useMemo(() => {
    const q = networkSearch.trim().toLowerCase();
    if (!q) return data.myGuestContacts;
    return data.myGuestContacts.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.phone.toLowerCase().includes(q) ||
        g.homeArea.toLowerCase().includes(q)
    );
  }, [data.myGuestContacts, networkSearch]);

  const filteredEarnings = useMemo(() => {
    if (earningsViaFilter === 'ALL') return data.myEarnings;
    return data.myEarnings.filter((e) => e.assignedViaCoordinatorId === earningsViaFilter);
  }, [data.myEarnings, earningsViaFilter]);

  const totalEarned = filteredEarnings.reduce((s, e) => s + e.amount, 0);
  const totalPaid = filteredEarnings.reduce((s, e) => s + e.paidAmount, 0);
  const totalBonuses = data.myBonuses.reduce((s, b) => s + b.amount, 0);
  const totalOutstanding = Math.max(0, totalEarned - totalPaid);
  const completedMeetingsCount = data.confirmedBriefings.filter(
    (b) => b.assignment.status === 'COMPLETED_SELF_REPORTED' || b.assignment.status === 'VERIFIED'
  ).length;
  const pendingMeetingsCount = data.confirmedBriefings.filter(
    (b) => !['COMPLETED_SELF_REPORTED', 'VERIFIED', 'CANCELLED', 'REPLACED'].includes(b.assignment.status)
  ).length;

  const activeCheckinMeetings = useMemo(
    () =>
      data.confirmedBriefings
        .filter(
          (b) =>
            !['COMPLETED_SELF_REPORTED', 'VERIFIED', 'CANCELLED', 'REPLACED', 'NO_SHOW'].includes(
              b.assignment.status
            )
        )
        .sort((a, b) => a.assignment.meetingDate.localeCompare(b.assignment.meetingDate)),
    [data.confirmedBriefings]
  );

  const completedHistoryMeetings = useMemo(
    () =>
      data.confirmedBriefings
        .filter((b) =>
          ['COMPLETED_SELF_REPORTED', 'VERIFIED', 'DISPUTED', 'CANCELLED'].includes(
            b.assignment.status
          )
        )
        .sort((a, b) => b.assignment.meetingDate.localeCompare(a.assignment.meetingDate)),
    [data.confirmedBriefings]
  );

  const totalNonCancelled = data.confirmedBriefings.filter(
    (b) => !['CANCELLED', 'REPLACED'].includes(b.assignment.status)
  ).length;
  const attendanceRate =
    totalNonCancelled > 0 ? Math.round((completedMeetingsCount / totalNonCancelled) * 100) : 100;

  return (
    <div className="space-y-5">
      {reachedWhatsAppPrompt && (
        <div
          role="status"
          data-testid="reached-whatsapp-banner"
          className="px-4 py-3 rounded-[6px] bg-emerald-500/14 border border-emerald-500/40 text-xs text-emerald-200 flex flex-wrap items-center justify-between gap-2.5"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Camera className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              <strong>{reachedWhatsAppPrompt.chapterName}</strong> ({formatShortDate(reachedWhatsAppPrompt.meetingDate)}) — Click below to take &amp; send your venue photo via WhatsApp to{' '}
              <strong>{reachedWhatsAppPrompt.coordinatorName}</strong>.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={reachedWhatsAppPrompt.url}
              target="_blank"
              rel="noreferrer"
              data-testid="reached-whatsapp-link"
              className="h-8 px-3 rounded-[5px] bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Open WhatsApp &amp; Share Photo
            </a>
            <button
              type="button"
              onClick={() => setReachedWhatsAppPrompt(null)}
              className="text-xs font-semibold text-emerald-300 hover:underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {notice && (
        <div role="status" className="px-4 py-2.5 rounded-[6px] bg-[#C81E2B]/20 border border-[#E12D39]/40 text-xs font-medium text-[#F5DFA0] flex items-center justify-between gap-2">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-semibold cursor-pointer">
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="px-4 py-2.5 rounded-[6px] bg-red-500/12 border border-red-500/35 text-xs font-medium text-red-400 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="font-semibold cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* ==================== VELOCTIVE TEAM HOME: PERSONAL DASHBOARD + ONE-ROW ACTIVE MEETING FLOW ==================== */}
      {activeTab === 'home' && (
        <div className="space-y-6">
          {/* Personal Veloctive Team Dashboard Header & Milestone Card */}
          <div className="p-5 sm:p-6 rounded-lg bg-[#18181a] border border-[#f2efeb]/10 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#E2B340]">
                  {data.actor.canManageNetwork ? 'Veloctive Team Partner' : 'Veloctive Team Member'} · Personal Dashboard
                </p>
                <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-[#f2efeb] mt-1 tabular-nums">
                  {data.milestone.validCompletions}{' '}
                  <span className="text-base font-semibold text-[#f2efeb]/60">Meetings Completed</span>
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onSelectTab('open')}
                className="h-10 px-4 rounded-[6px] bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors"
              >
                Browse Open Requests ({data.openRequests.length})
              </button>
            </div>

            {/* 4-Card Personal Quick Summary Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10 border-l-[3px] border-l-emerald-500">
                <p className="text-[11px] text-[#f2efeb]/60">Attendance &amp; Done</p>
                <p className="font-display text-xl font-bold text-[#f2efeb] mt-1 tabular-nums">
                  {completedMeetingsCount}{' '}
                  <span className="text-xs font-semibold text-emerald-400">({attendanceRate}%)</span>
                </p>
                <p className="text-[11px] text-[#f2efeb]/50 mt-0.5 tabular-nums">
                  {data.confirmedBriefings.filter((b) => b.assignment.status === 'VERIFIED').length} verified
                </p>
              </div>

              <div className="p-3.5 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10 border-l-[3px] border-l-[#E12D39]">
                <p className="text-[11px] text-[#f2efeb]/60">Active / Upcoming</p>
                <p className="font-display text-xl font-bold text-[#f2efeb] mt-1 tabular-nums">
                  {activeCheckinMeetings.length}
                </p>
                <p className="text-[11px] text-[#f2efeb]/50 mt-0.5">
                  {activeCheckinMeetings.length > 0 ? 'Ready for check-in below' : 'All caught up'}
                </p>
              </div>

              <div className="p-3.5 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10 border-l-[3px] border-l-[#E2B340]">
                <p className="text-[11px] text-[#f2efeb]/60">Pending Payout</p>
                <p className="font-display text-xl font-bold text-[#E2B340] mt-1 tabular-nums">
                  {formatINR(totalOutstanding)}
                </p>
                <p className="text-[11px] text-[#f2efeb]/50 mt-0.5 tabular-nums">
                  Paid {formatINR(totalPaid)}
                </p>
              </div>

              <div className="p-3.5 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10 border-l-[3px] border-l-[#f2efeb]/40">
                <p className="text-[11px] text-[#f2efeb]/60">Total Earned</p>
                <p className="font-display text-xl font-bold text-[#f2efeb] mt-1 tabular-nums">
                  {formatINR(totalEarned)}
                </p>
                <p className="text-[11px] text-[#E2B340] mt-0.5 tabular-nums">
                  +{formatINR(totalBonuses)} bonus
                </p>
              </div>
            </div>

            {/* Milestone Progress Bar */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#f2efeb] inline-flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-[#E2B340]" />
                  Next Milestone: {data.milestone.nextMilestone.label}
                </span>
                <span className="font-semibold text-[#E2B340] tabular-nums">
                  {data.milestone.remaining} to go
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-[#111113] border border-[#f2efeb]/10 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#C81E2B] to-[#E2B340] rounded-full transition-all"
                  style={{ width: `${data.milestone.progressPercent}%` }}
                />
              </div>
            </div>
          </div>

          {/* ONE-ROW ACTIVE MEETING CHECK-IN & COMPLETION FLOW */}
          {activeCheckinMeetings.length > 0 && (
            <section
              aria-labelledby="active-meeting-flow-heading"
              data-testid="veloctive-active-flow"
              className="rounded-lg border border-[#E2B340]/30 bg-[#18181a] overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-[#f2efeb]/10 bg-[#1f1f23] flex flex-wrap items-center justify-between gap-2">
                <h3 id="active-meeting-flow-heading" className="font-display text-sm font-bold text-[#f2efeb]">
                  Active Meetings ({activeCheckinMeetings.length})
                </h3>
                <span className="text-[11px] text-[#f2efeb]/55">
                  Check-ins notify Coordinator &amp; Admin
                </span>
              </div>

              <div className="divide-y divide-[#f2efeb]/10">
                {activeCheckinMeetings.map((item) => {
                  const a = item.assignment;
                  const isAwakeDone =
                    a.checkinState === 'AWAKE' ||
                    a.checkinState === 'LEFT_HOME' ||
                    a.checkinState === 'REACHED';
                  const isDepartedDone =
                    a.checkinState === 'LEFT_HOME' || a.checkinState === 'REACHED';
                  const isReachedDone = a.checkinState === 'REACHED';
                  const isIssueOpen = activeIssueId === a.id;
                  const isCompleteOpen = activeCompleteId === a.id;
                  const isBriefingOpen = expandedBriefingId === a.id;

                  return (
                    <div
                      key={a.id}
                      data-testid={`active-flow-row-${item.requestNumber}`}
                      className="p-3.5 sm:p-4 space-y-3"
                    >
                      {/* Single-Row Core Layout */}
                      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                        {/* Meeting Identity */}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                            <span className="font-mono text-[11px] text-[#E2B340] font-semibold">
                              #{item.requestNumber}
                            </span>
                            <span className="font-display font-bold text-sm text-[#f2efeb]">
                              {item.chapterName}
                            </span>
                            <span className="text-[#f2efeb]/55">·</span>
                            <span className="text-[#f2efeb]/80 font-medium">
                              {formatShortDate(a.meetingDate)} · {item.reportingTime}
                            </span>
                            <span className="text-[#f2efeb]/55">·</span>
                            <span className="font-semibold text-[#E2B340] tabular-nums">
                              {formatINR(a.agreedPayout)}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1 text-xs text-[#f2efeb]/65">
                            <span className="inline-flex items-center gap-1">
                              <a
                                href={
                                  item.mapsUrl ||
                                  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                                    `${item.venueName} ${item.area}`
                                  )}`
                                }
                                target="_blank"
                                rel="noreferrer"
                                title={`Open ${item.venueName} on Maps`}
                                aria-label={`Open ${item.venueName} on Google Maps`}
                                data-testid={`sub-confirmed-map-link-${item.requestNumber}`}
                                className="inline-flex items-center gap-1 text-[#f2efeb]/75 hover:text-[#E2B340] transition-colors"
                              >
                                <MapPin className="w-3.5 h-3.5 text-[#E2B340] shrink-0" />
                                <span>
                                  {item.venueName} · {item.area}
                                </span>
                              </a>
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedBriefingId(isBriefingOpen ? null : a.id)
                              }
                              className="text-[11px] font-semibold text-[#E2B340] hover:underline inline-flex items-center gap-1 cursor-pointer"
                            >
                              <FileText className="w-3 h-3" />
                              {isBriefingOpen ? 'Hide Instructions' : 'Instructions & Maps'}
                            </button>
                            <span className="inline-flex items-center gap-1.5 text-[11px]">
                              <span className="text-[#f2efeb]/50">Coord: {item.coordinatorName}</span>
                              {item.coordinatorCallingPhone && (
                                <a
                                  href={buildTelHref(item.coordinatorCallingPhone)}
                                  aria-label={`Call coordinator ${item.coordinatorName}`}
                                  className="text-[#f2efeb]/80 hover:text-[#E2B340]"
                                >
                                  <Phone className="w-3 h-3" />
                                </a>
                              )}
                              {(item.coordinatorWhatsappPhone || item.coordinatorCallingPhone) && (
                                <a
                                  href={buildWhatsAppHref(
                                    item.coordinatorWhatsappPhone || item.coordinatorCallingPhone,
                                    buildCoordinatorUpdateWhatsAppText(item.coordinatorName, item.chapterName, a.meetingDate)
                                  )}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={`WhatsApp coordinator ${item.coordinatorName}`}
                                  className="text-emerald-400 hover:text-emerald-300"
                                >
                                  <MessageCircle className="w-3 h-3" />
                                </a>
                              )}
                            </span>
                            {a.issueNote && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-300">
                                <AlertTriangle className="w-3 h-3 text-red-400" />
                                {a.issueNote}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* One-Row Action Stepper: Awake -> Departed -> Reached -> Any Issue -> Completed */}
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleCheckin(item, 'AWAKE')}
                            className={`h-9 px-2.5 rounded-[5px] text-xs font-semibold border inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                              isAwakeDone
                                ? 'border-emerald-500/40 bg-emerald-500/14 text-emerald-300'
                                : 'border-[#f2efeb]/15 bg-[#111113] hover:border-[#E2B340]/50 text-[#f2efeb]'
                            }`}
                          >
                            <Clock className="w-3.5 h-3.5" />
                            I&apos;m Awake
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleCheckin(item, 'LEFT_HOME')}
                            className={`h-9 px-2.5 rounded-[5px] text-xs font-semibold border inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                              isDepartedDone
                                ? 'border-emerald-500/40 bg-emerald-500/14 text-emerald-300'
                                : 'border-[#f2efeb]/15 bg-[#111113] hover:border-[#E2B340]/50 text-[#f2efeb]'
                            }`}
                          >
                            <Navigation className="w-3.5 h-3.5" />
                            Departed
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleCheckin(item, 'REACHED')}
                            className={`h-9 px-2.5 rounded-[5px] text-xs font-semibold border inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                              isReachedDone
                                ? 'border-emerald-500/40 bg-emerald-500/14 text-emerald-300'
                                : 'border-[#f2efeb]/15 bg-[#111113] hover:border-[#E2B340]/50 text-[#f2efeb]'
                            }`}
                          >
                            <MapPin className="w-3.5 h-3.5" />
                            Reached
                          </button>

                          {isReachedDone && (
                            <a
                              href={buildReachedWhatsAppUrl(item)}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Share venue photo on WhatsApp for ${item.chapterName}`}
                              className="h-9 px-2.5 rounded-[5px] border border-emerald-500/40 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1 transition-colors whitespace-nowrap"
                            >
                              <Camera className="w-3.5 h-3.5" />
                              WA Photo
                            </a>
                          )}

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setActiveCompleteId(null);
                              if (isIssueOpen) {
                                setActiveIssueId(null);
                                setIssueDraftText('');
                              } else {
                                setActiveIssueId(a.id);
                                setIssueDraftText(a.issueNote ?? '');
                              }
                            }}
                            className={`h-9 px-2.5 rounded-[5px] text-xs font-semibold border inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                              isIssueOpen || a.issueNote
                                ? 'border-red-500/45 bg-red-950/45 text-red-300'
                                : 'border-[#f2efeb]/15 bg-[#111113] hover:border-red-500/40 text-[#f2efeb]/80 hover:text-red-300'
                            }`}
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Any Issue
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setActiveIssueId(null);
                              if (isCompleteOpen) {
                                setActiveCompleteId(null);
                                setMemberNoteDraft('');
                              } else {
                                setActiveCompleteId(a.id);
                                setMemberNoteDraft('');
                              }
                            }}
                            className="h-9 px-3 rounded-[5px] bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Completed
                          </button>
                        </div>
                      </div>

                      {/* Expandable Meeting Instructions & Venue */}
                      {isBriefingOpen && (
                        <div className="p-3 rounded-[6px] bg-[#111113] border border-[#f2efeb]/10 text-xs space-y-2">
                          <p className="font-semibold text-[#E2B340]">Meeting Instructions (30s Intro)</p>
                          <p className="text-[#f2efeb]/85 leading-relaxed">{item.intro30Sec}</p>
                          {item.referralAsk && (
                            <div className="p-2.5 rounded-[5px] bg-[#E2B340]/10 border border-[#E2B340]/35 space-y-1">
                              <p className="text-[11px] font-bold uppercase tracking-wider text-[#E2B340]">
                                {getMemberNoteTypeLabel(item.memberNoteType)}
                              </p>
                              <p className="text-[#f2efeb] leading-relaxed">{item.referralAsk}</p>
                            </div>
                          )}
                          {item.specialInstructions && (
                            <p className="text-[#f2efeb]/75">
                              <strong className="text-[#f2efeb]">Note:</strong> {item.specialInstructions}
                            </p>
                          )}
                          <div className="pt-1.5 border-t border-[#f2efeb]/10 flex flex-wrap items-center justify-between gap-2 text-[#f2efeb]/65">
                            <span>
                              <strong className="text-[#f2efeb]">{item.venueName}</strong> · {item.address}
                            </span>
                            {item.mapsUrl && (
                              <a
                                href={item.mapsUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[#E2B340] font-semibold hover:underline inline-flex items-center gap-1"
                              >
                                <MapPin className="w-3.5 h-3.5" />
                                Open Maps
                              </a>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Inline Issue Alert Row */}
                      {isIssueOpen && (
                        <div className="p-3 rounded-[6px] bg-red-950/25 border border-red-500/35 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                          <input
                            type="text"
                            value={issueDraftText}
                            onChange={(e) => setIssueDraftText(e.target.value)}
                            placeholder="Share any issue (traffic delay, venue change, member update)..."
                            className="flex-1 h-9 px-3 rounded-[5px] border border-red-500/30 bg-[#111113] text-xs text-[#f2efeb] placeholder:text-[#f2efeb]/40 focus:outline-none focus:border-red-400"
                          />
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={busy || !issueDraftText.trim()}
                              onClick={() => void handleReportIssueSubmit(a.id)}
                              className="h-9 px-3 rounded-[5px] bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
                            >
                              Send Alert
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveIssueId(null);
                                setIssueDraftText('');
                              }}
                              className="h-9 px-2.5 rounded-[5px] border border-[#f2efeb]/12 text-xs text-[#f2efeb]/70 hover:text-[#f2efeb] cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Inline Meeting Done Note + Confirm Completed Row */}
                      {isCompleteOpen && (
                        <div className="p-3 rounded-[6px] bg-[#1f1f23] border border-[#E2B340]/40 space-y-2">
                          <label className="block text-[11px] font-semibold text-[#E2B340]">
                            Optional Note for Coordinator (referrals passed, contacts met, or updates)
                          </label>
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                            <input
                              type="text"
                              data-testid={`complete-note-input-${item.requestNumber}`}
                              value={memberNoteDraft}
                              onChange={(e) => setMemberNoteDraft(e.target.value)}
                              placeholder="e.g. Passed 2 referrals; met architect contact for follow-up..."
                              className="flex-1 h-9 px-3 rounded-[5px] border border-[#f2efeb]/15 bg-[#111113] text-xs text-[#f2efeb] placeholder:text-[#f2efeb]/40 focus:outline-none focus:border-[#E2B340]"
                            />
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                disabled={busy}
                                data-testid={`confirm-complete-btn-${item.requestNumber}`}
                                onClick={() => void handleQuickComplete(item)}
                                className="h-9 px-3.5 rounded-[5px] bg-[#C81E2B] hover:bg-[#A31621] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Mark Completed
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveCompleteId(null);
                                  setMemberNoteDraft('');
                                }}
                                className="h-9 px-2.5 rounded-[5px] border border-[#f2efeb]/12 text-xs text-[#f2efeb]/70 hover:text-[#f2efeb] cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Completed & Recent Meeting History */}
          <div className="rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#f2efeb]/10 bg-[#1f1f23] flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-[#f2efeb]">
                Completed &amp; Past Meetings ({completedHistoryMeetings.length})
              </h3>
              <button
                type="button"
                onClick={() => onSelectTab('meetings')}
                className="text-xs font-semibold text-[#E2B340] hover:underline cursor-pointer"
              >
                Open My Meetings
              </button>
            </div>
            <div className="divide-y divide-[#f2efeb]/10">
              {completedHistoryMeetings.length === 0 ? (
                <p className="p-6 text-xs text-[#f2efeb]/60">
                  No completed meetings yet.
                </p>
              ) : (
                completedHistoryMeetings.map((item) => (
                  <div key={item.assignment.id} className="px-4 py-3 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#f2efeb] truncate">
                        {item.chapterName} · {formatShortDate(item.assignment.meetingDate)}
                      </p>
                      <p className="text-[#f2efeb]/60 truncate">
                        {item.assignment.actualAttendeeName}
                        {item.assignment.isDelegated ? ' (Guest)' : ''}
                        {item.venueName ? ` · ${item.venueName}` : ''}
                        {item.assignment.meetingNotes?.referralsGiven
                          ? ` · ${item.assignment.meetingNotes.referralsGiven}`
                          : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0 tabular-nums">
                      <p className="font-bold text-[#f2efeb]">{formatINR(item.assignment.agreedPayout)}</p>
                      <p className="text-[11px] text-emerald-400 font-medium">
                        {item.assignment.status.replace(/_/g, ' ')}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== OPEN REQUESTS (Screenshot 2 Adaptation: Privacy-Safe + Need Help Bottom-Right) ==================== */}
      {activeTab === 'open' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#f2efeb]/60">
              Meeting instructions &amp; venue details unlock after confirmation. Contact Coordinator for any help.
            </p>
          </div>

          {data.openRequests.length === 0 ? (
            <div className="p-8 rounded-[6px] border border-dashed border-[#f2efeb]/10 text-center text-sm text-[#f2efeb]/60">
              No open requests available right now.
            </div>
          ) : (
            data.openRequests.map((card) => {
              const isExpanded = expandedOpenId === card.id;
              const alreadyResponded = Boolean(card.myResponse);
              const helpText = buildOpenRequestHelpWhatsAppText(
                card.coordinatorName,
                card.chapterName,
                card.meetingDate
              );

              return (
                <div
                  key={card.id}
                  id={`sub-open-${card.id}`}
                  data-testid={`open-request-card-${card.requestNumber}`}
                  className={`rounded-lg border bg-[#18181a] overflow-hidden transition-colors hover:border-[#C81E2B]/40 ${
                    isExpanded ? 'border-[#E2B340]/60' : 'border-[#f2efeb]/10'
                  }`}
                >
                  {/* Tap-to-expand public card summary */}
                  <div className="p-4 sm:p-5">
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() => setExpandedOpenId(isExpanded ? null : card.id)}
                      className="w-full text-left cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-xs text-[#f2efeb]/60">#{card.requestNumber}</span>
                            <h3 className="font-display text-base font-bold text-[#f2efeb] truncate">
                              {card.chapterName}
                            </h3>
                          </div>
                          <p className="text-xs sm:text-sm text-[#f2efeb]/70 mt-1">
                            <strong className="text-[#f2efeb]">{card.area}</strong> · {formatDisplayDate(card.meetingDate)} ·{' '}
                            <strong className="text-[#f2efeb]">{card.reportingTime}</strong>
                          </p>
                          <p className="text-xs text-[#f2efeb]/60 mt-1">
                            {card.assignmentMode === 'FIRST_CONFIRM'
                              ? 'First Eligible Confirm'
                              : 'Multiple Interests (Coordinator selects)'}
                            {' · '}
                            {card.filledPositions}/{card.positionsRequired} filled
                            {card.urgency === 'URGENT' ? ' · Urgent' : ''}
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <p className="font-display text-lg font-extrabold text-[#E2B340] tabular-nums">
                            {formatINR(card.offeredPayout)}
                          </p>
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#f2efeb]/60 mt-0.5">
                            {isExpanded ? 'Less' : 'Details'}
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </span>
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-[#f2efeb]/10 text-xs text-[#f2efeb]/70 space-y-1.5">
                        <p>
                          <strong>Venue Area:</strong> {card.venueName}, {card.area}
                        </p>
                        <p>
                          <strong>Schedule:</strong> Report {card.reportingTime} · Meeting {card.startTime} – {card.endTime}
                        </p>
                        {card.specialInstructions && (
                          <p>
                            <strong>Instructions:</strong> {card.specialInstructions}
                          </p>
                        )}
                      </div>
                    )}

                    {card.sameDateSelfConflict && !card.myAssignmentId && (
                      <div className="mt-3 px-3 py-2 rounded-[5px] bg-[#E2B340]/12 border border-[#E2B340]/35 text-xs text-[#F5DFA0] flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-[#E2B340] shrink-0 mt-0.5" />
                        <span>
                          You already have a meeting on this date (
                          <strong>
                            {card.sameDateSelfConflict.chapterName} · {card.sameDateSelfConflict.reportingTime}
                          </strong>
                          ). Self-acceptance is locked — you can pin a <strong>Cross-Meeting Request</strong> for Super Admin approval.
                        </span>
                      </div>
                    )}

                    {/* Action Bar + LOCKED Bottom-Right Coordinator-Only Need Help? Call & WhatsApp */}
                    <div className="mt-4 pt-3 border-t border-[#f2efeb]/10 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {card.myAssignmentId ? (
                          <span className="text-xs font-bold text-emerald-400 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-4 h-4" />
                            Confirmed (See Home &amp; My Meetings)
                          </span>
                        ) : alreadyResponded ? (
                          <span className="text-xs font-semibold text-[#E2B340]">
                            {card.myResponse!.isCrossMeetingRequest
                              ? `Cross-Meeting Pinned to Super Admin (${card.myResponse!.status.replace(/_/g, ' ')})`
                              : `Response: ${card.myResponse!.responseType.replace(/_/g, ' ')} (${card.myResponse!.status.replace(/_/g, ' ')})`}
                          </span>
                        ) : (
                          <>
                            {card.sameDateSelfConflict ? (
                              <button
                                type="button"
                                disabled={busy}
                                data-testid={`cross-meeting-btn-${card.requestNumber}`}
                                onClick={() => handleRespond(card.id, 'INTERESTED', true)}
                                className="h-10 px-4 rounded-[6px] border border-[#E2B340] bg-[#E2B340]/18 hover:bg-[#E2B340]/28 text-[#f2efeb] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <Shield className="w-4 h-4 text-[#E2B340]" />
                                Request Cross-Meeting (Super Admin)
                              </button>
                            ) : card.assignmentMode === 'FIRST_CONFIRM' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleRespond(card.id, 'FIRST_CONFIRM')}
                                className="h-10 px-4 rounded-[6px] bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <Check className="w-4 h-4" />
                                I Confirm (I Will Go)
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleRespond(card.id, 'INTERESTED')}
                                className="h-10 px-4 rounded-[6px] bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <Check className="w-4 h-4" />
                                Interested (I Will Go)
                              </button>
                            )}

                            {card.allowBids && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setBidTarget(card);
                                  setBidAmount(String(card.offeredPayout + 50));
                                }}
                                className="h-10 px-3.5 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] hover:bg-[#18181a]/[0.05] text-xs font-semibold text-[#f2efeb] cursor-pointer"
                              >
                                Make an Offer
                              </button>
                            )}

                            {data.actor.canManageNetwork ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setError(null);
                                  setDelegateTarget(card);
                                  setDelegateGuestSearch('');
                                  setShowInlineNewGuest(activeGuests.length === 0);
                                  setSelectedGuestId(activeGuests[0]?.id ?? '');
                                }}
                                className="h-10 px-3.5 rounded-[6px] border border-[#E2B340] bg-[#1f1f23] hover:bg-[#C81E2B]/20 text-xs font-semibold text-[#f2efeb] inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <Users className="w-3.5 h-3.5 text-[#E2B340]" />
                                Send Someone Else
                              </button>
                            ) : (
                              <span className="text-[11px] text-[#f2efeb]/45">
                                Partner delegation disabled
                              </span>
                            )}

                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleRespond(card.id, 'NOT_AVAILABLE')}
                              className="h-10 px-3 rounded-[6px] text-xs font-medium text-[#f2efeb]/60 hover:text-red-400 cursor-pointer"
                            >
                              Not Available
                            </button>
                          </>
                        )}
                      </div>

                      {/* LOCKED: Need Help? with Coordinator-only Call + WhatsApp at bottom-right */}
                      <div className="flex items-center gap-2 ml-auto shrink-0">
                        <span className="text-[11px] font-medium text-[#f2efeb]/60 whitespace-nowrap">
                          Need Help?
                        </span>
                        <a
                          href={buildTelHref(card.coordinatorCallingPhone)}
                          aria-label={`Call coordinator ${card.coordinatorName}`}
                          className="w-9 h-9 rounded-lg border border-[#f2efeb]/10 bg-[#1f1f23] hover:bg-[#C81E2B]/22 flex items-center justify-center text-[#f2efeb]"
                        >
                          <Phone className="w-4 h-4" />
                        </a>
                        <a
                          href={buildWhatsAppHref(card.coordinatorWhatsappPhone, helpText)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`WhatsApp coordinator ${card.coordinatorName}`}
                          className="w-9 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center"
                        >
                          <MessageCircle className="w-4 h-4" />
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ==================== MY MEETINGS (Private Member Briefing + Morning Check-ins + Finish) ==================== */}
      {activeTab === 'meetings' && (
        <div className="space-y-4">
          {data.confirmedBriefings.length === 0 ? (
            <div className="p-8 rounded-[6px] border border-dashed border-[#f2efeb]/10 text-center text-sm text-[#f2efeb]/60">
              No confirmed meetings yet. Respond to an open request to get started.
            </div>
          ) : (
            data.confirmedBriefings.map((item) => {
              const a = item.assignment;
              const isFinished =
                a.status === 'COMPLETED_SELF_REPORTED' || a.status === 'VERIFIED' || a.status === 'DISPUTED';

              return (
                <div
                  key={a.id}
                  id={`sub-asgn-${a.id}`}
                  className={`rounded-lg border bg-[#18181a] p-4 sm:p-5 space-y-4 transition-colors ${
                    highlightedAssignmentId === a.id
                      ? 'border-[#E2B340]/70 ring-1 ring-[#E2B340]/40'
                      : 'border-[#f2efeb]/10'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-mono text-[#f2efeb]/60">
                        #{item.requestNumber} · {formatShortDate(a.meetingDate)} · Report {item.reportingTime} · Via{' '}
                        <strong className="font-sans text-[#E2B340]">{item.assignedViaCoordinatorName}</strong>
                      </p>
                      <h3 className="font-display text-base sm:text-lg font-bold text-[#f2efeb] mt-0.5">
                        {item.chapterName} · {a.actualAttendeeName}
                        {a.isDelegated && (
                          <span className="ml-1.5 text-xs font-semibold text-[#E2B340]">(Guest)</span>
                        )}
                      </h3>
                      <p className="text-xs text-[#f2efeb]/65 mt-0.5 flex items-center gap-1.5">
                        <a
                          href={
                            item.mapsUrl ||
                            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                              `${item.venueName} ${item.area}`
                            )}`
                          }
                          target="_blank"
                          rel="noreferrer"
                          title={`Open ${item.venueName} on Maps`}
                          aria-label={`Open ${item.venueName} on Google Maps`}
                          className="inline-flex items-center gap-1 text-[#f2efeb]/75 hover:text-[#E2B340] transition-colors"
                        >
                          <MapPin className="w-3.5 h-3.5 text-[#E2B340] shrink-0" />
                          <span>
                            {item.venueName} · {item.area}
                          </span>
                        </a>
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-display text-base font-bold text-[#E2B340] tabular-nums">
                        {formatINR(a.agreedPayout)}
                      </p>
                      <p className="text-xs font-semibold text-[#f2efeb]">{a.status.replace(/_/g, ' ')}</p>
                    </div>
                  </div>

                  {/* Meeting Instructions & Coordinator Contact (Zero Member Details) */}
                  <div className="p-3.5 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10 space-y-2 text-xs">
                    <p className="font-semibold text-[#E2B340]">Meeting Instructions (30s Intro)</p>
                    <p className="text-[#f2efeb]/85 leading-relaxed">{item.intro30Sec}</p>
                    {item.referralAsk && (
                      <div className="p-2.5 rounded-[5px] bg-[#E2B340]/10 border border-[#E2B340]/35 space-y-1">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-[#E2B340]">
                          {getMemberNoteTypeLabel(item.memberNoteType)}
                        </p>
                        <p className="text-[#f2efeb] leading-relaxed">{item.referralAsk}</p>
                      </div>
                    )}
                    {item.specialInstructions && (
                      <p className="text-[#f2efeb]/75">
                        <strong className="text-[#f2efeb]">Note:</strong> {item.specialInstructions}
                      </p>
                    )}
                    <div className="pt-2 border-t border-[#f2efeb]/10 flex flex-wrap items-center justify-between gap-2 text-[#f2efeb]/70">
                      <span>
                        <strong className="text-[#f2efeb]">{item.venueName}</strong> · {item.address}
                      </span>
                      <div className="flex items-center gap-3 shrink-0">
                        {item.mapsUrl && (
                          <a
                            href={item.mapsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#E2B340] font-semibold inline-flex items-center gap-1 hover:underline"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                            Maps
                          </a>
                        )}
                        {item.coordinatorCallingPhone && (
                          <a
                            href={buildTelHref(item.coordinatorCallingPhone)}
                            aria-label={`Call coordinator ${item.coordinatorName}`}
                            className="inline-flex items-center gap-1 font-semibold text-[#f2efeb] hover:text-[#E2B340]"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            Call {item.coordinatorName}
                          </a>
                        )}
                        {(item.coordinatorWhatsappPhone || item.coordinatorCallingPhone) && (
                          <a
                            href={buildWhatsAppHref(
                              item.coordinatorWhatsappPhone || item.coordinatorCallingPhone,
                              buildCoordinatorUpdateWhatsAppText(item.coordinatorName, item.chapterName, a.meetingDate)
                            )}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`WhatsApp coordinator ${item.coordinatorName}`}
                            className="inline-flex items-center gap-1 font-semibold text-emerald-400 hover:underline"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            WA Coordinator
                          </a>
                        )}
                      </div>
                    </div>
                    {item.directions && <p className="text-[11px] text-[#f2efeb]/60">{item.directions}</p>}
                  </div>

                  {/* Morning Self Check-In Sequence & Finish Button */}
                  {!isFinished && a.status !== 'CANCELLED' ? (
                    <div className="space-y-2.5">
                      <p className="text-xs font-semibold text-[#f2efeb]">
                        Check-In &amp; Completion
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleCheckin(item, 'AWAKE')}
                          className={`h-10 px-3 rounded-[6px] text-xs font-semibold border transition-colors cursor-pointer ${
                            a.checkinState === 'AWAKE' ||
                            a.checkinState === 'LEFT_HOME' ||
                            a.checkinState === 'REACHED'
                              ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-300'
                              : 'border-[#f2efeb]/10 bg-[#18181a] hover:bg-[#18181a]/[0.05] text-[#f2efeb]'
                          }`}
                        >
                          <Clock className="w-3.5 h-3.5 inline mr-1" />
                          I&apos;m Awake
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleCheckin(item, 'LEFT_HOME')}
                          className={`h-10 px-3 rounded-[6px] text-xs font-semibold border transition-colors cursor-pointer ${
                            a.checkinState === 'LEFT_HOME' || a.checkinState === 'REACHED'
                              ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-300'
                              : 'border-[#f2efeb]/10 bg-[#18181a] hover:bg-[#18181a]/[0.05] text-[#f2efeb]'
                          }`}
                        >
                          <Navigation className="w-3.5 h-3.5 inline mr-1" />
                          I&apos;ve Left Home
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleCheckin(item, 'REACHED')}
                          className={`h-10 px-3 rounded-[6px] text-xs font-semibold border transition-colors cursor-pointer ${
                            a.checkinState === 'REACHED'
                              ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-300'
                              : 'border-[#f2efeb]/10 bg-[#18181a] hover:bg-[#18181a]/[0.05] text-[#f2efeb]'
                          }`}
                        >
                          <MapPin className="w-3.5 h-3.5 inline mr-1" />
                          I&apos;ve Reached
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setError(null);
                            setFinishTarget(item);
                          }}
                          className="h-10 px-3 rounded-[6px] bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold inline-flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Finish
                        </button>
                      </div>
                      {a.checkinState === 'REACHED' && (
                        <div className="pt-1">
                          <a
                            href={buildReachedWhatsAppUrl(item)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:underline"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            Share Live Venue Photo on WhatsApp ({item.coordinatorName})
                          </a>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="pt-2 border-t border-[#f2efeb]/10 flex flex-wrap items-center justify-between gap-2 text-xs text-[#f2efeb]/70">
                      <span>
                        Status: <strong className="text-[#f2efeb]">{a.status.replace(/_/g, ' ')}</strong>
                        {a.finishedReportedByPartner ? ' · Partner Reported' : ''}
                      </span>
                      <span className="text-[#f2efeb]/60">Payout posted</span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ==================== EARNINGS, VIA COORDINATOR BREAKDOWN & BONUSES ==================== */}
      {activeTab === 'earnings' && (
        <div className="space-y-5">
          {/* Comprehensive KPI Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-[6px] border border-[#f2efeb]/10 bg-[#1f1f23]">
              <p className="text-[11px] text-[#f2efeb]/60">Meetings (Done / Pend.)</p>
              <p className="font-display text-xl font-bold text-[#f2efeb] mt-1 tabular-nums">
                {completedMeetingsCount}{' '}
                <span className="text-sm font-medium text-[#f2efeb]/60">/ {pendingMeetingsCount}</span>
              </p>
            </div>
            <div className="p-3.5 rounded-[6px] border border-[#f2efeb]/10 bg-[#1f1f23]">
              <p className="text-[11px] text-[#f2efeb]/60">Total Earned</p>
              <p className="font-display text-xl font-bold text-[#f2efeb] mt-1 tabular-nums">
                {formatINR(totalEarned)}
              </p>
              <p className="text-[11px] text-emerald-400 font-medium tabular-nums">
                Paid {formatINR(totalPaid)}
              </p>
            </div>
            <div className="p-3.5 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a]">
              <p className="text-[11px] text-[#f2efeb]/60">Remaining Payout</p>
              <p className="font-display text-xl font-bold text-[#E2B340] mt-1 tabular-nums">
                {formatINR(totalOutstanding)}
              </p>
            </div>
            <div className="p-3.5 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a]">
              <p className="text-[11px] text-[#f2efeb]/60">Appreciation Bonus</p>
              <p className="font-display text-xl font-bold text-[#E2B340] mt-1 tabular-nums">
                {formatINR(totalBonuses)}
              </p>
            </div>
          </div>

          {/* Assigned Via Coordinator Breakdown */}
          {data.viaCoordinatorSummary && data.viaCoordinatorSummary.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-sm font-bold text-[#f2efeb]">
                  By Coordinator (Assigned Via)
                </h3>
                {earningsViaFilter !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => setEarningsViaFilter('ALL')}
                    className="text-xs font-semibold text-[#E2B340] hover:underline cursor-pointer"
                  >
                    Show all coordinators
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {data.viaCoordinatorSummary.map((item) => {
                  const selected = earningsViaFilter === item.coordinatorId;
                  return (
                    <button
                      key={item.coordinatorId}
                      type="button"
                      onClick={() =>
                        setEarningsViaFilter(selected ? 'ALL' : item.coordinatorId)
                      }
                      className={`p-3.5 rounded-[6px] border text-left transition-colors cursor-pointer ${
                        selected
                          ? 'border-[#C81E2B] bg-[#C81E2B]/18'
                          : 'border-[#f2efeb]/10 bg-[#18181a] hover:border-[#C81E2B]/40'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-display text-sm font-bold text-[#f2efeb] truncate">
                          Via {item.coordinatorName}
                        </p>
                        <span className="text-xs font-semibold text-[#E2B340] tabular-nums shrink-0">
                          {item.completedMeetings} done
                        </span>
                      </div>
                      <p className="text-xs text-[#f2efeb]/70 mt-1 tabular-nums">
                        Earned <strong className="text-[#f2efeb]">{formatINR(item.totalEarned)}</strong> · Paid{' '}
                        {formatINR(item.paidAmount)} · Rem.{' '}
                        <strong className={item.remainingAmount > 0 ? 'text-[#E2B340]' : 'text-emerald-400'}>
                          {formatINR(item.remainingAmount)}
                        </strong>
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Itemized Statement with Via Coordinator Filter */}
          <div className="rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#f2efeb]/10 bg-[#1f1f23] flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-sm font-bold text-[#f2efeb]">
                Itemized Statement ({filteredEarnings.length})
              </h3>
              {data.viaCoordinatorSummary && data.viaCoordinatorSummary.length > 0 && (
                <select
                  aria-label="Filter earnings by coordinator"
                  value={earningsViaFilter}
                  onChange={(e) => setEarningsViaFilter(e.target.value)}
                  className="h-8 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs text-[#f2efeb]"
                >
                  <option value="ALL">All Coordinators</option>
                  {data.viaCoordinatorSummary.map((c) => (
                    <option key={c.coordinatorId} value={c.coordinatorId}>
                      Via {c.coordinatorName}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="divide-y divide-[#f2efeb]/10">
              {filteredEarnings.length === 0 ? (
                <p className="p-6 text-center text-xs text-[#f2efeb]/60">No earnings match this coordinator filter.</p>
              ) : (
                filteredEarnings.map((earn) => (
                  <div key={earn.id} className="px-4 py-3 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#f2efeb]">
                        {formatShortDate(earn.meetingDate)} · {earn.chapterName} ·{' '}
                        <span className="text-[#E2B340]">Via {earn.assignedViaCoordinatorName}</span>
                      </p>
                      <p className="text-[#f2efeb]/60 mt-0.5">
                        Actual attendee: <strong className="text-[#f2efeb]">{earn.actualAttendeeName}</strong>
                        {earn.isDelegated
                          ? ` (Delegated — arranged & paid to ${data.actor.displayName})`
                          : ''}
                      </p>
                    </div>
                    <div className="text-right tabular-nums shrink-0">
                      <p className="font-bold text-[#f2efeb]">{formatINR(earn.amount)}</p>
                      <p className={earn.status === 'ON_HOLD' ? 'text-red-400 font-semibold' : 'text-[#f2efeb]/60'}>
                        {earn.status === 'ON_HOLD' ? 'On Hold' : `Paid ${formatINR(earn.paidAmount)}`}
                      </p>
                    </div>
                  </div>
                ))
              )}
              {data.myBonuses.map((bon) => (
                <div key={bon.id} className="px-4 py-3 flex items-center justify-between gap-2 text-xs bg-white/[0.03]">
                  <div>
                    <p className="font-semibold text-[#E2B340] inline-flex items-center gap-1">
                      <Award className="w-3.5 h-3.5" />
                      Appreciation Bonus
                    </p>
                    <p className="text-[#f2efeb]/70 mt-0.5">{bon.message}</p>
                  </div>
                  <span className="font-display text-sm font-bold text-[#E2B340] tabular-nums">
                    +{formatINR(bon.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ==================== MY NETWORK (Partner Substitute Only) ==================== */}
      {activeTab === 'network' && data.actor.canManageNetwork && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-[#f2efeb]">My Saved Guest Network</h2>
              <p className="text-xs text-[#f2efeb]/60">
                Guests have no login account. You remain accountable for check-ins, Finish, and agency payout.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setEditingGuestId(null);
                setGuestForm({
                  name: '',
                  phone: '',
                  whatsappPhone: '',
                  homeArea: '',
                  preferredAreas: '',
                  notes: '',
                  emergencyContactName: '',
                  emergencyContactPhone: '',
                  consentConfirmed: true,
                  active: true,
                });
                setGuestModalOpen(true);
              }}
              className="h-10 px-4 rounded-[6px] bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Add Guest Contact
            </button>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-[#f2efeb]/45 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={networkSearch}
              onChange={(e) => setNetworkSearch(e.target.value)}
              placeholder="Search saved guests by name, mobile, or area..."
              className="w-full h-10 pl-10 pr-3.5 rounded-[6px] border border-[#f2efeb]/10 text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
            />
          </div>

          <div className="divide-y divide-[#f2efeb]/10 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] overflow-hidden">
            {filteredNetworkGuests.length === 0 ? (
              <p className="p-8 text-center text-sm text-[#f2efeb]/60">No saved guest contacts match.</p>
            ) : (
              filteredNetworkGuests.map((guest) => (
                <div key={guest.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`font-display text-sm font-bold ${guest.active ? 'text-[#f2efeb]' : 'text-[#f2efeb]/45 line-through'}`}>
                      {guest.name}
                    </p>
                    <p className="text-xs text-[#f2efeb]/70 mt-0.5">
                      {guest.homeArea} · {guest.phone}
                      {guest.preferredAreas ? ` · Prefers ${guest.preferredAreas}` : ''}
                      {' · No App Login'}
                    </p>
                    {guest.notes && <p className="text-[11px] text-[#f2efeb]/60 mt-0.5">{guest.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href={buildTelHref(guest.phone)}
                      aria-label={`Call guest ${guest.name}`}
                      className="w-9 h-9 rounded-lg border border-[#f2efeb]/10 flex items-center justify-center text-[#f2efeb]"
                    >
                      <Phone className="w-4 h-4" />
                    </a>
                    <button
                      type="button"
                      aria-label={`Edit guest ${guest.name}`}
                      onClick={() => openEditGuest(guest)}
                      className="w-9 h-9 rounded-lg border border-[#f2efeb]/10 hover:bg-[#C81E2B]/20 flex items-center justify-center text-[#f2efeb]/70 cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`${guest.active ? 'Deactivate' : 'Reactivate'} guest ${guest.name}`}
                      onClick={async () => {
                        await api.upsertPartnerGuest({ ...guest, active: !guest.active });
                        await onRefresh();
                      }}
                      className="w-9 h-9 rounded-lg border border-[#f2efeb]/10 hover:bg-amber-500/12 flex items-center justify-center text-[#f2efeb]/60 hover:text-amber-400 cursor-pointer"
                    >
                      <Power className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* MAKE AN OFFER MODAL */}
      {bidTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Make an Offer">
          <div className="w-full sm:max-w-md bg-[#18181a] rounded-t-lg sm:rounded-lg border border-[#f2efeb]/10 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f2efeb]/10 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-[#f2efeb]">Make a Price Offer</h2>
              <button type="button" onClick={() => setBidTarget(null)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#f2efeb]/60">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={submitBid} className="p-5 space-y-3.5">
              <p className="text-xs text-[#f2efeb]/70">
                {bidTarget.chapterName} · Offered {formatINR(bidTarget.offeredPayout)}. Custom offers always require coordinator approval.
              </p>
              <div>
                <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Proposed Payout (₹) *</label>
                <input
                  type="number"
                  required
                  min={50}
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Note</label>
                <input
                  type="text"
                  value={bidNote}
                  onChange={(e) => setBidNote(e.target.value)}
                  placeholder="Optional commute / timing note"
                  className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setBidTarget(null)} className="h-10 px-4 rounded-[6px] border border-[#f2efeb]/10 text-xs font-semibold">Cancel</button>
                <button type="submit" disabled={busy} className="h-10 px-5 rounded-[6px] bg-[#C81E2B] text-white text-xs font-semibold">Submit Offer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SEND SOMEONE ELSE (PARTNER DELEGATION) MODAL WITH INLINE ADD NEW GUEST */}
      {delegateTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Send Someone Else">
          <div className="w-full sm:max-w-lg bg-[#18181a] rounded-t-lg sm:rounded-lg border border-[#f2efeb]/10 max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f2efeb]/10 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-[#f2efeb]">Send Someone Else</h2>
                <p className="text-xs text-[#f2efeb]/60">
                  {delegateTarget.chapterName} · {formatShortDate(delegateTarget.meetingDate)}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close delegation modal"
                onClick={() => setDelegateTarget(null)}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-[#f2efeb]/60"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {error && (
                <div role="alert" className="p-2.5 rounded-lg bg-red-500/12 border border-red-500/35 text-xs text-red-400">
                  {error}
                </div>
              )}

              <p className="text-xs text-[#f2efeb]/70 leading-relaxed">
                Nominate a saved guest from <strong>My Network</strong>. Coordinator approval is mandatory even on First-Confirm requests. Agency payout and check-in accountability remain strictly with you ({data.actor.displayName}).
              </p>

              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#f2efeb]">
                  {showInlineNewGuest ? 'New Guest Contact' : `Saved Guests (${activeGuests.length})`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setShowInlineNewGuest((v) => !v);
                  }}
                  className="text-xs font-semibold text-[#E2B340] hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  {showInlineNewGuest ? 'Choose Existing Saved Guest' : '+ Add New Guest'}
                </button>
              </div>

              {showInlineNewGuest ? (
                <form onSubmit={handleInlineAddGuest} className="p-3.5 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10 space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Guest Full Name *</label>
                    <input
                      type="text"
                      required
                      value={inlineGuestForm.name}
                      onChange={(e) => setInlineGuestForm({ ...inlineGuestForm, name: e.target.value })}
                      placeholder="e.g. Rohan Joshi"
                      className="w-full h-9 px-3 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Mobile *</label>
                      <input
                        type="tel"
                        required
                        value={inlineGuestForm.phone}
                        onChange={(e) => setInlineGuestForm({ ...inlineGuestForm, phone: e.target.value })}
                        placeholder="98XXXXXXXX"
                        className="w-full h-9 px-3 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Home Area *</label>
                      <input
                        type="text"
                        required
                        value={inlineGuestForm.homeArea}
                        onChange={(e) => setInlineGuestForm({ ...inlineGuestForm, homeArea: e.target.value })}
                        placeholder="e.g. Andheri West"
                        className="w-full h-9 px-3 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs"
                      />
                    </div>
                  </div>
                  <label className="flex items-start gap-2 text-[11px] text-[#f2efeb]/80 cursor-pointer">
                    <input
                      type="checkbox"
                      required
                      checked={inlineGuestForm.consentConfirmed}
                      onChange={(e) => setInlineGuestForm({ ...inlineGuestForm, consentConfirmed: e.target.checked })}
                      className="mt-0.5 accent-[#C81E2B]"
                    />
                    <span>Guest consented to be nominated (no login account or direct agency payment created).</span>
                  </label>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowInlineNewGuest(false)}
                      className="h-9 px-3 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs font-medium"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={busy}
                      className="h-9 px-4 rounded-lg bg-[#27272d] text-white text-xs font-semibold cursor-pointer"
                    >
                      {busy ? 'Saving...' : 'Save & Select Guest'}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={submitDelegation} className="space-y-3.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[#f2efeb]/45 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="search"
                      value={delegateGuestSearch}
                      onChange={(e) => setDelegateGuestSearch(e.target.value)}
                      placeholder="Filter saved guests..."
                      className="w-full h-9 pl-8 pr-3 rounded-lg border border-[#f2efeb]/10 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Select Saved Guest *</label>
                    <select
                      required
                      value={selectedGuestId}
                      onChange={(e) => setSelectedGuestId(e.target.value)}
                      className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] text-sm"
                    >
                      <option value="">Choose guest...</option>
                      {filteredDelegateGuests.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.homeArea} · {g.phone})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Note for Coordinator</label>
                    <input
                      type="text"
                      value={delegateNote}
                      onChange={(e) => setDelegateNote(e.target.value)}
                      placeholder="Confirm guest availability & experience"
                      className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button type="button" onClick={() => setDelegateTarget(null)} className="h-10 px-4 rounded-[6px] border border-[#f2efeb]/10 text-xs font-semibold">Cancel</button>
                    <button type="submit" disabled={busy || !selectedGuestId} className="h-10 px-5 rounded-[6px] bg-[#C81E2B] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                      <Send className="w-3.5 h-3.5" />
                      Submit for Approval
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* FINISH MEETING + OPTIONAL NOTES MODAL */}
      {finishTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Finish Meeting">
          <div className="w-full sm:max-w-lg bg-[#18181a] rounded-t-lg sm:rounded-lg border border-[#f2efeb]/10 max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f2efeb]/10 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-[#f2efeb]">Finish Meeting</h2>
                <p className="text-xs text-[#f2efeb]/60">
                  {finishTarget.chapterName} · Attendee: {finishTarget.assignment.actualAttendeeName}
                </p>
              </div>
              <button type="button" onClick={() => setFinishTarget(null)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#f2efeb]/60">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleFinishSubmit} className="p-5 overflow-y-auto space-y-3.5">
              <div className="p-3 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10 text-xs text-[#f2efeb]/70 space-y-1">
                <p>
                  Pressing Finish atomically marks this assignment <strong>Completed (Self-Reported)</strong> and posts your{' '}
                  <strong>{formatINR(finishTarget.assignment.agreedPayout)}</strong> payable once.
                </p>
                {finishTarget.assignment.isDelegated && (
                  <p className="text-[#E2B340] font-semibold">
                    Delegated Attribution: Reported by Partner {data.actor.displayName} for Guest {finishTarget.assignment.actualAttendeeName}.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Referrals / Leads Given (Optional)</label>
                <input
                  type="text"
                  value={finishNotes.referralsGiven}
                  onChange={(e) => setFinishNotes({ ...finishNotes, referralsGiven: e.target.value })}
                  className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#f2efeb] mb-1">People Met / Highlights (Optional)</label>
                <textarea
                  rows={2}
                  value={finishNotes.highlights}
                  onChange={(e) => setFinishNotes({ ...finishNotes, highlights: e.target.value })}
                  className="w-full p-3 rounded-[6px] border border-[#f2efeb]/10 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-[#f2efeb] cursor-pointer">
                <input
                  type="checkbox"
                  checked={isEarlyFinish}
                  onChange={(e) => setIsEarlyFinish(e.target.checked)}
                  className="accent-[#C81E2B]"
                />
                Finishing before scheduled end time ({finishTarget.endTime})
              </label>
              {isEarlyFinish && (
                <div>
                  <label className="block text-xs font-semibold text-amber-300 mb-1">Early Finish Reason *</label>
                  <input
                    type="text"
                    required
                    value={finishNotes.earlyFinishReason}
                    onChange={(e) => setFinishNotes({ ...finishNotes, earlyFinishReason: e.target.value })}
                    placeholder="Required when finishing early (triggers coordinator review)"
                    className="w-full h-10 px-3 rounded-[6px] border border-amber-500/35 text-sm"
                  />
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setFinishTarget(null)} className="h-10 px-4 rounded-[6px] border border-[#f2efeb]/10 text-xs font-semibold">Cancel</button>
                <button type="submit" disabled={busy} className="h-10 px-5 rounded-[6px] bg-[#C81E2B] text-white text-xs font-semibold cursor-pointer">
                  Confirm Finish
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD / EDIT PARTNER GUEST CONTACT MODAL */}
      {guestModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Guest Contact Form">
          <div className="w-full sm:max-w-md bg-[#18181a] rounded-t-lg sm:rounded-lg border border-[#f2efeb]/10 max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f2efeb]/10 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-[#f2efeb]">
                {editingGuestId ? 'Edit Saved Guest Contact' : 'Add Saved Guest Contact'}
              </h2>
              <button type="button" onClick={() => setGuestModalOpen(false)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#f2efeb]/60">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveGuest} className="p-5 overflow-y-auto space-y-3.5">
              {error && <p className="p-2.5 rounded-lg bg-red-500/12 text-xs text-red-400">{error}</p>}
              <div>
                <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Guest Full Name *</label>
                <input type="text" required value={guestForm.name} onChange={(e) => setGuestForm({ ...guestForm, name: e.target.value })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Mobile *</label>
                  <input type="tel" required value={guestForm.phone} onChange={(e) => setGuestForm({ ...guestForm, phone: e.target.value })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">WhatsApp</label>
                  <input type="tel" value={guestForm.whatsappPhone} onChange={(e) => setGuestForm({ ...guestForm, whatsappPhone: e.target.value })} placeholder="Same if blank" className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Home Area *</label>
                  <input type="text" required value={guestForm.homeArea} onChange={(e) => setGuestForm({ ...guestForm, homeArea: e.target.value })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Preferred Areas</label>
                  <input type="text" value={guestForm.preferredAreas} onChange={(e) => setGuestForm({ ...guestForm, preferredAreas: e.target.value })} placeholder="e.g. Andheri, Goregaon" className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Notes</label>
                <input type="text" value={guestForm.notes} onChange={(e) => setGuestForm({ ...guestForm, notes: e.target.value })} placeholder="Punctuality, speaking comfort, etc." className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm" />
              </div>
              <label className="flex items-start gap-2 text-xs text-[#f2efeb]/80 cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={guestForm.consentConfirmed}
                  onChange={(e) => setGuestForm({ ...guestForm, consentConfirmed: e.target.checked })}
                  className="mt-0.5 accent-[#C81E2B]"
                />
                <span>I confirm this contact consented to be nominated as an attendee (no AgencyOS login is created for them).</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setGuestModalOpen(false)} className="h-10 px-4 rounded-[6px] border border-[#f2efeb]/10 text-xs font-semibold">Cancel</button>
                <button type="submit" disabled={busy} className="h-10 px-5 rounded-[6px] bg-[#C81E2B] text-white text-xs font-semibold cursor-pointer">
                  {editingGuestId ? 'Update Contact' : 'Save Contact'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
