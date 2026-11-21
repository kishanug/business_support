import React, { useMemo, useState } from 'react';
import {
  Award,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit3,
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
  buildTelHref,
  buildWhatsAppHref,
  formatDisplayDate,
  formatINR,
  formatShortDate,
} from '../core/rules';
import type { PartnerGuestContact, PublicOpenRequestCard } from '../core/types';
import type { SubTab } from './AppShell';

interface SubstitutePortalProps {
  data: SubstituteBootstrapData;
  activeTab: SubTab;
  onSelectTab: (tab: SubTab) => void;
  onRefresh: () => Promise<void>;
}

export const SubstitutePortal: React.FC<SubstitutePortalProps> = ({
  data,
  activeTab,
  onSelectTab,
  onRefresh,
}) => {
  const [expandedOpenId, setExpandedOpenId] = useState<string | null>(null);
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

  async function handleRespond(
    reqId: string,
    responseType: 'INTERESTED' | 'NOT_AVAILABLE' | 'FIRST_CONFIRM'
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.submitResponse(reqId, { responseType });
      await onRefresh();
      if (res.autoConfirmed) {
        setNotice('Position atomically confirmed! Member briefing is now unlocked in My Meetings.');
      } else if (responseType === 'INTERESTED') {
        setNotice('Interest submitted. Coordinator will review and confirm.');
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

  async function handleCheckin(assignmentId: string, eventType: 'AWAKE' | 'LEFT_HOME' | 'REACHED') {
    setBusy(true);
    setError(null);
    try {
      await api.recordCheckin(assignmentId, eventType);
      await onRefresh();
      setNotice(`Check-in recorded (${eventType.replace(/_/g, ' ')}).`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Check-in failed.');
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

  return (
    <div className="space-y-5">
      {notice && (
        <div role="status" className="px-4 py-2.5 rounded-xl bg-[#F3E8FF] border border-[#DDD6FE] text-xs font-medium text-[#5B21B6] flex items-center justify-between gap-2">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-semibold">
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-700 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {/* ==================== HOME: MEETINGS COMPLETED -> NEXT MILESTONE -> HISTORY ==================== */}
      {activeTab === 'home' && (
        <div className="space-y-6">
          {/* Primary Milestone Card */}
          <div className="p-5 sm:p-6 rounded-2xl bg-[#F8F7FC] border border-[#E6E8EF] space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[#B58F3D]">
                  {data.actor.canManageNetwork ? 'Partner Substitute Account' : 'Registered Substitute'}
                </p>
                <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-[#142342] mt-1 tabular-nums">
                  {data.milestone.validCompletions}{' '}
                  <span className="text-base font-semibold text-[#64748B]">Meetings Completed</span>
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onSelectTab('open')}
                className="h-10 px-4 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                Browse Open Requests ({data.openRequests.length})
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#142342] inline-flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-[#B58F3D]" />
                  Next Milestone: {data.milestone.nextMilestone.label}
                </span>
                <span className="font-semibold text-[#6D28D9] tabular-nums">
                  {data.milestone.remaining} to go
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-white border border-[#E6E8EF] overflow-hidden">
                <div
                  className="h-full bg-[#6D28D9] rounded-full transition-all"
                  style={{ width: `${data.milestone.progressPercent}%` }}
                />
              </div>
              <p className="text-[11px] text-[#64748B]">
                Only valid completed/verified meetings count. Cancelled or disputed jobs are excluded; milestone rewards require admin approval and are issued once per tier.
              </p>
            </div>
          </div>

          {/* Quick Earnings Strip */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl border border-[#E6E8EF] bg-white">
              <p className="text-[11px] text-[#64748B]">Upcoming Meetings</p>
              <p className="font-display text-xl font-bold text-[#142342] mt-1 tabular-nums">
                {
                  data.confirmedBriefings.filter(
                    (b) => !['COMPLETED_SELF_REPORTED', 'VERIFIED', 'CANCELLED'].includes(b.assignment.status)
                  ).length
                }
              </p>
            </div>
            <div className="p-3.5 rounded-xl border border-[#E6E8EF] bg-white">
              <p className="text-[11px] text-[#64748B]">Pending Payout</p>
              <p className="font-display text-xl font-bold text-[#6D28D9] mt-1 tabular-nums">
                {formatINR(totalOutstanding)}
              </p>
            </div>
            <div className="p-3.5 rounded-xl border border-[#E6E8EF] bg-white">
              <p className="text-[11px] text-[#64748B]">Bonuses Received</p>
              <p className="font-display text-xl font-bold text-[#B58F3D] mt-1 tabular-nums">
                {formatINR(totalBonuses)}
              </p>
            </div>
          </div>

          {/* Recent Meeting History */}
          <div className="rounded-xl border border-[#E6E8EF] bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E6E8EF] bg-[#F8F7FC] flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-[#142342]">Meeting History</h3>
              <button
                type="button"
                onClick={() => onSelectTab('meetings')}
                className="text-xs font-semibold text-[#6D28D9] hover:underline"
              >
                Open My Meetings
              </button>
            </div>
            <div className="divide-y divide-[#E6E8EF]">
              {data.confirmedBriefings.length === 0 ? (
                <p className="p-6 text-xs text-[#64748B]">No assignments yet.</p>
              ) : (
                data.confirmedBriefings.map((item) => (
                  <div key={item.assignment.id} className="px-4 py-3 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#142342] truncate">
                        {item.chapterName} · {formatShortDate(item.assignment.meetingDate)}
                      </p>
                      <p className="text-[#64748B] truncate">
                        Attendee: {item.assignment.actualAttendeeName}
                        {item.assignment.isDelegated ? ' (Delegated Guest)' : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0 tabular-nums">
                      <p className="font-bold text-[#142342]">{formatINR(item.assignment.agreedPayout)}</p>
                      <p className="text-[11px] text-[#6D28D9] font-medium">
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
            <p className="text-xs text-[#64748B]">
              Member name, phone &amp; 30-second briefing stay hidden until your assignment is confirmed.
            </p>
          </div>

          {data.openRequests.length === 0 ? (
            <div className="p-8 rounded-xl border border-dashed border-[#E6E8EF] text-center text-sm text-[#64748B]">
              No open requests available right now.
            </div>
          ) : (
            data.openRequests.map((card) => {
              const isExpanded = expandedOpenId === card.id;
              const alreadyResponded = Boolean(card.myResponse);
              const helpText = `Hi ${card.coordinatorName}, I have a quick question about open request #${card.requestNumber} (${card.chapterName} on ${card.meetingDate}).`;

              return (
                <div
                  key={card.id}
                  data-testid={`open-request-card-${card.requestNumber}`}
                  className="rounded-2xl border border-[#E6E8EF] bg-white overflow-hidden transition-colors hover:border-[#6D28D9]/40"
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
                            <span className="font-mono text-xs text-[#64748B]">#{card.requestNumber}</span>
                            <h3 className="font-display text-base font-bold text-[#142342] truncate">
                              {card.chapterName}
                            </h3>
                          </div>
                          <p className="text-xs sm:text-sm text-[#475569] mt-1">
                            <strong className="text-[#142342]">{card.area}</strong> · {formatDisplayDate(card.meetingDate)} ·{' '}
                            <strong className="text-[#142342]">{card.reportingTime}</strong>
                          </p>
                          <p className="text-xs text-[#64748B] mt-1">
                            {card.assignmentMode === 'FIRST_CONFIRM'
                              ? 'First Eligible Confirm'
                              : 'Multiple Interests (Coordinator selects)'}
                            {' · '}
                            {card.filledPositions}/{card.positionsRequired} filled
                            {card.urgency === 'URGENT' ? ' · Urgent' : ''}
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <p className="font-display text-lg font-extrabold text-[#6D28D9] tabular-nums">
                            {formatINR(card.offeredPayout)}
                          </p>
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#64748B] mt-0.5">
                            {isExpanded ? 'Less' : 'Details'}
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </span>
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-[#E6E8EF] text-xs text-[#475569] space-y-1.5">
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
                        <p className="text-[11px] text-[#64748B] inline-flex items-center gap-1 pt-1">
                          <Shield className="w-3.5 h-3.5 text-[#B58F3D]" />
                          Member identity, contact &amp; 30-second intro unlock immediately after confirmation.
                        </p>
                      </div>
                    )}

                    {/* Action Bar + LOCKED Bottom-Right Coordinator-Only Need Help? Call & WhatsApp */}
                    <div className="mt-4 pt-3 border-t border-[#E6E8EF]/80 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {card.myAssignmentId ? (
                          <span className="text-xs font-bold text-emerald-700 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-4 h-4" />
                            Confirmed (See My Meetings)
                          </span>
                        ) : alreadyResponded ? (
                          <span className="text-xs font-semibold text-[#6D28D9]">
                            Response: {card.myResponse!.responseType.replace(/_/g, ' ')} (
                            {card.myResponse!.status.replace(/_/g, ' ')})
                          </span>
                        ) : (
                          <>
                            {card.assignmentMode === 'FIRST_CONFIRM' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleRespond(card.id, 'FIRST_CONFIRM')}
                                className="h-10 px-4 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <Check className="w-4 h-4" />
                                I Confirm (I Will Go)
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleRespond(card.id, 'INTERESTED')}
                                className="h-10 px-4 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
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
                                className="h-10 px-3.5 rounded-xl border border-[#E6E8EF] bg-white hover:bg-[#F8F7FC] text-xs font-semibold text-[#142342] cursor-pointer"
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
                                className="h-10 px-3.5 rounded-xl border border-[#D8B66C] bg-[#F8F7FC] hover:bg-[#F3E8FF]/50 text-xs font-semibold text-[#142342] inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <Users className="w-3.5 h-3.5 text-[#B58F3D]" />
                                Send Someone Else
                              </button>
                            ) : (
                              <span className="text-[11px] text-[#94A3B8]">
                                Partner delegation disabled
                              </span>
                            )}

                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleRespond(card.id, 'NOT_AVAILABLE')}
                              className="h-10 px-3 rounded-xl text-xs font-medium text-[#64748B] hover:text-red-600 cursor-pointer"
                            >
                              Not Available
                            </button>
                          </>
                        )}
                      </div>

                      {/* LOCKED: Need Help? with Coordinator-only Call + WhatsApp at bottom-right */}
                      <div className="flex items-center gap-2 ml-auto shrink-0">
                        <span className="text-[11px] font-medium text-[#64748B] whitespace-nowrap">
                          Need Help?
                        </span>
                        <a
                          href={buildTelHref(card.coordinatorCallingPhone)}
                          aria-label={`Call coordinator ${card.coordinatorName}`}
                          className="w-9 h-9 rounded-lg border border-[#E6E8EF] bg-[#F8F7FC] hover:bg-[#F3E8FF] flex items-center justify-center text-[#142342]"
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
            <div className="p-8 rounded-xl border border-dashed border-[#E6E8EF] text-center text-sm text-[#64748B]">
              No confirmed meetings yet. Respond to an open request to get started.
            </div>
          ) : (
            data.confirmedBriefings.map((item) => {
              const a = item.assignment;
              const isFinished =
                a.status === 'COMPLETED_SELF_REPORTED' || a.status === 'VERIFIED' || a.status === 'DISPUTED';

              return (
                <div key={a.id} className="rounded-2xl border border-[#E6E8EF] bg-white p-4 sm:p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-mono text-[#64748B]">
                        #{item.requestNumber} · {formatShortDate(a.meetingDate)} · Report {item.reportingTime} · Via{' '}
                        <strong className="font-sans text-[#6D28D9]">{item.assignedViaCoordinatorName}</strong>
                      </p>
                      <h3 className="font-display text-base sm:text-lg font-bold text-[#142342] mt-0.5">
                        {item.chapterName} · {item.memberName} → {a.actualAttendeeName}
                      </h3>
                      <p className="text-xs text-[#475569] mt-0.5">
                        {item.memberBusiness}
                        {a.isDelegated && (
                          <span className="ml-1.5 text-[#B58F3D] font-semibold">
                            · Guest via {data.actor.displayName} (Reported by Partner {data.actor.displayName} for Guest {a.actualAttendeeName})
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-display text-base font-bold text-[#6D28D9] tabular-nums">
                        {formatINR(a.agreedPayout)}
                      </p>
                      <p className="text-xs font-semibold text-[#142342]">{a.status.replace(/_/g, ' ')}</p>
                    </div>
                  </div>

                  {/* Private Briefing Unlocked Post-Confirmation */}
                  <div className="p-3.5 rounded-xl bg-[#F8F7FC] border border-[#E6E8EF] space-y-2 text-xs">
                    <p className="font-semibold text-[#142342]">30-Second Speaking Intro</p>
                    <p className="text-[#334155] leading-relaxed">{item.intro30Sec}</p>
                    <div className="pt-2 border-t border-[#E6E8EF] flex flex-wrap items-center justify-between gap-2 text-[#475569]">
                      <span>
                        <strong className="text-[#142342]">{item.venueName}</strong> · {item.address}
                      </span>
                      {item.mapsUrl && (
                        <a
                          href={item.mapsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#6D28D9] font-semibold inline-flex items-center gap-1 hover:underline"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                          Maps
                        </a>
                      )}
                    </div>
                    {item.directions && <p className="text-[11px] text-[#64748B]">{item.directions}</p>}
                  </div>

                  {/* Morning Self Check-In Sequence & Finish Button */}
                  {!isFinished && a.status !== 'CANCELLED' ? (
                    <div className="space-y-2.5">
                      <p className="text-xs font-semibold text-[#142342]">
                        Morning Check-in &amp; Completion
                        {a.isDelegated
                          ? ` · Reported by Partner ${data.actor.displayName} for Guest ${a.actualAttendeeName}`
                          : ''}
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleCheckin(a.id, 'AWAKE')}
                          className={`h-10 px-3 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                            a.checkinState === 'AWAKE' ||
                            a.checkinState === 'LEFT_HOME' ||
                            a.checkinState === 'REACHED'
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                              : 'border-[#E6E8EF] bg-white hover:bg-[#F8F7FC] text-[#142342]'
                          }`}
                        >
                          <Clock className="w-3.5 h-3.5 inline mr-1" />
                          I&apos;m Awake
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleCheckin(a.id, 'LEFT_HOME')}
                          className={`h-10 px-3 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                            a.checkinState === 'LEFT_HOME' || a.checkinState === 'REACHED'
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                              : 'border-[#E6E8EF] bg-white hover:bg-[#F8F7FC] text-[#142342]'
                          }`}
                        >
                          <Navigation className="w-3.5 h-3.5 inline mr-1" />
                          I&apos;ve Left Home
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleCheckin(a.id, 'REACHED')}
                          className={`h-10 px-3 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                            a.checkinState === 'REACHED'
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                              : 'border-[#E6E8EF] bg-white hover:bg-[#F8F7FC] text-[#142342]'
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
                          className="h-10 px-3 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold inline-flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Finish
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-2 border-t border-[#E6E8EF] flex flex-wrap items-center justify-between gap-2 text-xs text-[#475569]">
                      <span>
                        Completed status: <strong className="text-[#142342]">{a.status.replace(/_/g, ' ')}</strong>
                        {a.finishedReportedByPartner ? ' · Reported by Partner' : ''}
                      </span>
                      <span className="text-[#64748B]">Ledger entry posted automatically</span>
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
            <div className="p-3.5 rounded-xl border border-[#E6E8EF] bg-[#F8F7FC]">
              <p className="text-[11px] text-[#64748B]">Meetings (Done / Pend.)</p>
              <p className="font-display text-xl font-bold text-[#142342] mt-1 tabular-nums">
                {completedMeetingsCount}{' '}
                <span className="text-sm font-medium text-[#64748B]">/ {pendingMeetingsCount}</span>
              </p>
            </div>
            <div className="p-3.5 rounded-xl border border-[#E6E8EF] bg-[#F8F7FC]">
              <p className="text-[11px] text-[#64748B]">Total Earned</p>
              <p className="font-display text-xl font-bold text-[#142342] mt-1 tabular-nums">
                {formatINR(totalEarned)}
              </p>
              <p className="text-[11px] text-emerald-700 font-medium tabular-nums">
                Paid {formatINR(totalPaid)}
              </p>
            </div>
            <div className="p-3.5 rounded-xl border border-[#E6E8EF] bg-white">
              <p className="text-[11px] text-[#64748B]">Remaining Payout</p>
              <p className="font-display text-xl font-bold text-[#6D28D9] mt-1 tabular-nums">
                {formatINR(totalOutstanding)}
              </p>
            </div>
            <div className="p-3.5 rounded-xl border border-[#E6E8EF] bg-white">
              <p className="text-[11px] text-[#64748B]">Appreciation Bonus</p>
              <p className="font-display text-xl font-bold text-[#B58F3D] mt-1 tabular-nums">
                {formatINR(totalBonuses)}
              </p>
            </div>
          </div>

          {/* Assigned Via Coordinator Breakdown */}
          {data.viaCoordinatorSummary && data.viaCoordinatorSummary.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-sm font-bold text-[#142342]">
                  By Coordinator (Assigned Via)
                </h3>
                {earningsViaFilter !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => setEarningsViaFilter('ALL')}
                    className="text-xs font-semibold text-[#6D28D9] hover:underline cursor-pointer"
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
                      className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                        selected
                          ? 'border-[#6D28D9] bg-[#F3E8FF]/60'
                          : 'border-[#E6E8EF] bg-white hover:border-[#6D28D9]/40'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-display text-sm font-bold text-[#142342] truncate">
                          Via {item.coordinatorName}
                        </p>
                        <span className="text-xs font-semibold text-[#6D28D9] tabular-nums shrink-0">
                          {item.completedMeetings} done
                        </span>
                      </div>
                      <p className="text-xs text-[#475569] mt-1 tabular-nums">
                        Earned <strong className="text-[#142342]">{formatINR(item.totalEarned)}</strong> · Paid{' '}
                        {formatINR(item.paidAmount)} · Rem.{' '}
                        <strong className={item.remainingAmount > 0 ? 'text-[#6D28D9]' : 'text-emerald-700'}>
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
          <div className="rounded-xl border border-[#E6E8EF] bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E6E8EF] bg-[#F8F7FC] flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-sm font-bold text-[#142342]">
                Itemized Statement ({filteredEarnings.length})
              </h3>
              {data.viaCoordinatorSummary && data.viaCoordinatorSummary.length > 0 && (
                <select
                  aria-label="Filter earnings by coordinator"
                  value={earningsViaFilter}
                  onChange={(e) => setEarningsViaFilter(e.target.value)}
                  className="h-8 px-2.5 rounded-lg border border-[#E6E8EF] bg-white text-xs text-[#142342]"
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
            <div className="divide-y divide-[#E6E8EF]">
              {filteredEarnings.length === 0 ? (
                <p className="p-6 text-center text-xs text-[#64748B]">No earnings match this coordinator filter.</p>
              ) : (
                filteredEarnings.map((earn) => (
                  <div key={earn.id} className="px-4 py-3 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#142342]">
                        {formatShortDate(earn.meetingDate)} · {earn.chapterName} ·{' '}
                        <span className="text-[#6D28D9]">Via {earn.assignedViaCoordinatorName}</span>
                      </p>
                      <p className="text-[#64748B] mt-0.5">
                        Actual attendee: <strong className="text-[#142342]">{earn.actualAttendeeName}</strong>
                        {earn.isDelegated
                          ? ` (Delegated — arranged & paid to ${data.actor.displayName})`
                          : ''}
                      </p>
                    </div>
                    <div className="text-right tabular-nums shrink-0">
                      <p className="font-bold text-[#142342]">{formatINR(earn.amount)}</p>
                      <p className={earn.status === 'ON_HOLD' ? 'text-red-600 font-semibold' : 'text-[#64748B]'}>
                        {earn.status === 'ON_HOLD' ? 'On Hold' : `Paid ${formatINR(earn.paidAmount)}`}
                      </p>
                    </div>
                  </div>
                ))
              )}
              {data.myBonuses.map((bon) => (
                <div key={bon.id} className="px-4 py-3 flex items-center justify-between gap-2 text-xs bg-[#F8F7FC]/60">
                  <div>
                    <p className="font-semibold text-[#B58F3D] inline-flex items-center gap-1">
                      <Award className="w-3.5 h-3.5" />
                      Appreciation Bonus
                    </p>
                    <p className="text-[#475569] mt-0.5">{bon.message}</p>
                  </div>
                  <span className="font-display text-sm font-bold text-[#B58F3D] tabular-nums">
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
              <h2 className="font-display text-base font-bold text-[#142342]">My Saved Guest Network</h2>
              <p className="text-xs text-[#64748B]">
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
              className="h-10 px-4 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Add Guest Contact
            </button>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={networkSearch}
              onChange={(e) => setNetworkSearch(e.target.value)}
              placeholder="Search saved guests by name, mobile, or area..."
              className="w-full h-10 pl-10 pr-3.5 rounded-xl border border-[#E6E8EF] text-sm text-[#142342] focus:outline-none focus:border-[#6D28D9]"
            />
          </div>

          <div className="divide-y divide-[#E6E8EF] rounded-xl border border-[#E6E8EF] bg-white overflow-hidden">
            {filteredNetworkGuests.length === 0 ? (
              <p className="p-8 text-center text-sm text-[#64748B]">No saved guest contacts match.</p>
            ) : (
              filteredNetworkGuests.map((guest) => (
                <div key={guest.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`font-display text-sm font-bold ${guest.active ? 'text-[#142342]' : 'text-[#94A3B8] line-through'}`}>
                      {guest.name}
                    </p>
                    <p className="text-xs text-[#475569] mt-0.5">
                      {guest.homeArea} · {guest.phone}
                      {guest.preferredAreas ? ` · Prefers ${guest.preferredAreas}` : ''}
                      {' · No App Login'}
                    </p>
                    {guest.notes && <p className="text-[11px] text-[#64748B] mt-0.5">{guest.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href={buildTelHref(guest.phone)}
                      aria-label={`Call guest ${guest.name}`}
                      className="w-9 h-9 rounded-lg border border-[#E6E8EF] flex items-center justify-center text-[#142342]"
                    >
                      <Phone className="w-4 h-4" />
                    </a>
                    <button
                      type="button"
                      aria-label={`Edit guest ${guest.name}`}
                      onClick={() => openEditGuest(guest)}
                      className="w-9 h-9 rounded-lg border border-[#E6E8EF] hover:bg-[#F3E8FF]/50 flex items-center justify-center text-[#475569] cursor-pointer"
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
                      className="w-9 h-9 rounded-lg border border-[#E6E8EF] hover:bg-amber-50 flex items-center justify-center text-[#64748B] hover:text-amber-700 cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-[#142342]/45 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Make an Offer">
          <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl border border-[#E6E8EF] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E6E8EF] flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-[#142342]">Make a Price Offer</h2>
              <button type="button" onClick={() => setBidTarget(null)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#64748B]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={submitBid} className="p-5 space-y-3.5">
              <p className="text-xs text-[#475569]">
                {bidTarget.chapterName} · Offered {formatINR(bidTarget.offeredPayout)}. Custom offers always require coordinator approval.
              </p>
              <div>
                <label className="block text-xs font-semibold text-[#142342] mb-1">Proposed Payout (₹) *</label>
                <input
                  type="number"
                  required
                  min={50}
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#142342] mb-1">Note</label>
                <input
                  type="text"
                  value={bidNote}
                  onChange={(e) => setBidNote(e.target.value)}
                  placeholder="Optional commute / timing note"
                  className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setBidTarget(null)} className="h-10 px-4 rounded-xl border border-[#E6E8EF] text-xs font-semibold">Cancel</button>
                <button type="submit" disabled={busy} className="h-10 px-5 rounded-xl bg-[#6D28D9] text-white text-xs font-semibold">Submit Offer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SEND SOMEONE ELSE (PARTNER DELEGATION) MODAL WITH INLINE ADD NEW GUEST */}
      {delegateTarget && (
        <div className="fixed inset-0 z-50 bg-[#142342]/45 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Send Someone Else">
          <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl border border-[#E6E8EF] max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E6E8EF] flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-[#142342]">Send Someone Else</h2>
                <p className="text-xs text-[#64748B]">
                  {delegateTarget.chapterName} · {formatShortDate(delegateTarget.meetingDate)}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close delegation modal"
                onClick={() => setDelegateTarget(null)}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-[#64748B]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {error && (
                <div role="alert" className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {error}
                </div>
              )}

              <p className="text-xs text-[#475569] leading-relaxed">
                Nominate a saved guest from <strong>My Network</strong>. Coordinator approval is mandatory even on First-Confirm requests. Agency payout and check-in accountability remain strictly with you ({data.actor.displayName}).
              </p>

              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#142342]">
                  {showInlineNewGuest ? 'New Guest Contact' : `Saved Guests (${activeGuests.length})`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setShowInlineNewGuest((v) => !v);
                  }}
                  className="text-xs font-semibold text-[#6D28D9] hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  {showInlineNewGuest ? 'Choose Existing Saved Guest' : '+ Add New Guest'}
                </button>
              </div>

              {showInlineNewGuest ? (
                <form onSubmit={handleInlineAddGuest} className="p-3.5 rounded-xl bg-[#F8F7FC] border border-[#E6E8EF] space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#142342] mb-1">Guest Full Name *</label>
                    <input
                      type="text"
                      required
                      value={inlineGuestForm.name}
                      onChange={(e) => setInlineGuestForm({ ...inlineGuestForm, name: e.target.value })}
                      placeholder="e.g. Rohan Joshi"
                      className="w-full h-9 px-3 rounded-lg border border-[#E6E8EF] bg-white text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-semibold text-[#142342] mb-1">Mobile *</label>
                      <input
                        type="tel"
                        required
                        value={inlineGuestForm.phone}
                        onChange={(e) => setInlineGuestForm({ ...inlineGuestForm, phone: e.target.value })}
                        placeholder="98XXXXXXXX"
                        className="w-full h-9 px-3 rounded-lg border border-[#E6E8EF] bg-white text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#142342] mb-1">Home Area *</label>
                      <input
                        type="text"
                        required
                        value={inlineGuestForm.homeArea}
                        onChange={(e) => setInlineGuestForm({ ...inlineGuestForm, homeArea: e.target.value })}
                        placeholder="e.g. Andheri West"
                        className="w-full h-9 px-3 rounded-lg border border-[#E6E8EF] bg-white text-xs"
                      />
                    </div>
                  </div>
                  <label className="flex items-start gap-2 text-[11px] text-[#334155] cursor-pointer">
                    <input
                      type="checkbox"
                      required
                      checked={inlineGuestForm.consentConfirmed}
                      onChange={(e) => setInlineGuestForm({ ...inlineGuestForm, consentConfirmed: e.target.checked })}
                      className="mt-0.5 accent-[#6D28D9]"
                    />
                    <span>Guest consented to be nominated (no login account or direct agency payment created).</span>
                  </label>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowInlineNewGuest(false)}
                      className="h-9 px-3 rounded-lg border border-[#E6E8EF] bg-white text-xs font-medium"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={busy}
                      className="h-9 px-4 rounded-lg bg-[#142342] text-white text-xs font-semibold cursor-pointer"
                    >
                      {busy ? 'Saving...' : 'Save & Select Guest'}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={submitDelegation} className="space-y-3.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="search"
                      value={delegateGuestSearch}
                      onChange={(e) => setDelegateGuestSearch(e.target.value)}
                      placeholder="Filter saved guests..."
                      className="w-full h-9 pl-8 pr-3 rounded-lg border border-[#E6E8EF] text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#142342] mb-1">Select Saved Guest *</label>
                    <select
                      required
                      value={selectedGuestId}
                      onChange={(e) => setSelectedGuestId(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] bg-white text-sm"
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
                    <label className="block text-xs font-semibold text-[#142342] mb-1">Note for Coordinator</label>
                    <input
                      type="text"
                      value={delegateNote}
                      onChange={(e) => setDelegateNote(e.target.value)}
                      placeholder="Confirm guest availability & experience"
                      className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button type="button" onClick={() => setDelegateTarget(null)} className="h-10 px-4 rounded-xl border border-[#E6E8EF] text-xs font-semibold">Cancel</button>
                    <button type="submit" disabled={busy || !selectedGuestId} className="h-10 px-5 rounded-xl bg-[#6D28D9] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
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
        <div className="fixed inset-0 z-50 bg-[#142342]/45 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Finish Meeting">
          <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl border border-[#E6E8EF] max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E6E8EF] flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-[#142342]">Finish Meeting</h2>
                <p className="text-xs text-[#64748B]">
                  {finishTarget.chapterName} · Attendee: {finishTarget.assignment.actualAttendeeName}
                </p>
              </div>
              <button type="button" onClick={() => setFinishTarget(null)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#64748B]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleFinishSubmit} className="p-5 overflow-y-auto space-y-3.5">
              <div className="p-3 rounded-xl bg-[#F8F7FC] border border-[#E6E8EF] text-xs text-[#475569] space-y-1">
                <p>
                  Pressing Finish atomically marks this assignment <strong>Completed (Self-Reported)</strong> and posts your{' '}
                  <strong>{formatINR(finishTarget.assignment.agreedPayout)}</strong> payable once.
                </p>
                {finishTarget.assignment.isDelegated && (
                  <p className="text-[#B58F3D] font-semibold">
                    Delegated Attribution: Reported by Partner {data.actor.displayName} for Guest {finishTarget.assignment.actualAttendeeName}.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#142342] mb-1">Referrals / Leads Given (Optional)</label>
                <input
                  type="text"
                  value={finishNotes.referralsGiven}
                  onChange={(e) => setFinishNotes({ ...finishNotes, referralsGiven: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#142342] mb-1">People Met / Highlights (Optional)</label>
                <textarea
                  rows={2}
                  value={finishNotes.highlights}
                  onChange={(e) => setFinishNotes({ ...finishNotes, highlights: e.target.value })}
                  className="w-full p-3 rounded-xl border border-[#E6E8EF] text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-[#142342] cursor-pointer">
                <input
                  type="checkbox"
                  checked={isEarlyFinish}
                  onChange={(e) => setIsEarlyFinish(e.target.checked)}
                  className="accent-[#6D28D9]"
                />
                Finishing before scheduled end time ({finishTarget.endTime})
              </label>
              {isEarlyFinish && (
                <div>
                  <label className="block text-xs font-semibold text-amber-800 mb-1">Early Finish Reason *</label>
                  <input
                    type="text"
                    required
                    value={finishNotes.earlyFinishReason}
                    onChange={(e) => setFinishNotes({ ...finishNotes, earlyFinishReason: e.target.value })}
                    placeholder="Required when finishing early (triggers coordinator review)"
                    className="w-full h-10 px-3 rounded-xl border border-amber-300 text-sm"
                  />
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setFinishTarget(null)} className="h-10 px-4 rounded-xl border border-[#E6E8EF] text-xs font-semibold">Cancel</button>
                <button type="submit" disabled={busy} className="h-10 px-5 rounded-xl bg-[#6D28D9] text-white text-xs font-semibold cursor-pointer">
                  Confirm Finish
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD / EDIT PARTNER GUEST CONTACT MODAL */}
      {guestModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#142342]/45 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Guest Contact Form">
          <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl border border-[#E6E8EF] max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E6E8EF] flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-[#142342]">
                {editingGuestId ? 'Edit Saved Guest Contact' : 'Add Saved Guest Contact'}
              </h2>
              <button type="button" onClick={() => setGuestModalOpen(false)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#64748B]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveGuest} className="p-5 overflow-y-auto space-y-3.5">
              {error && <p className="p-2.5 rounded-lg bg-red-50 text-xs text-red-700">{error}</p>}
              <div>
                <label className="block text-xs font-semibold text-[#142342] mb-1">Guest Full Name *</label>
                <input type="text" required value={guestForm.name} onChange={(e) => setGuestForm({ ...guestForm, name: e.target.value })} className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#142342] mb-1">Mobile *</label>
                  <input type="tel" required value={guestForm.phone} onChange={(e) => setGuestForm({ ...guestForm, phone: e.target.value })} className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#142342] mb-1">WhatsApp</label>
                  <input type="tel" value={guestForm.whatsappPhone} onChange={(e) => setGuestForm({ ...guestForm, whatsappPhone: e.target.value })} placeholder="Same if blank" className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#142342] mb-1">Home Area *</label>
                  <input type="text" required value={guestForm.homeArea} onChange={(e) => setGuestForm({ ...guestForm, homeArea: e.target.value })} className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#142342] mb-1">Preferred Areas</label>
                  <input type="text" value={guestForm.preferredAreas} onChange={(e) => setGuestForm({ ...guestForm, preferredAreas: e.target.value })} placeholder="e.g. Andheri, Goregaon" className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#142342] mb-1">Notes</label>
                <input type="text" value={guestForm.notes} onChange={(e) => setGuestForm({ ...guestForm, notes: e.target.value })} placeholder="Punctuality, speaking comfort, etc." className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm" />
              </div>
              <label className="flex items-start gap-2 text-xs text-[#334155] cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={guestForm.consentConfirmed}
                  onChange={(e) => setGuestForm({ ...guestForm, consentConfirmed: e.target.checked })}
                  className="mt-0.5 accent-[#6D28D9]"
                />
                <span>I confirm this contact consented to be nominated as an attendee (no AgencyOS login is created for them).</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setGuestModalOpen(false)} className="h-10 px-4 rounded-xl border border-[#E6E8EF] text-xs font-semibold">Cancel</button>
                <button type="submit" disabled={busy} className="h-10 px-5 rounded-xl bg-[#6D28D9] text-white text-xs font-semibold cursor-pointer">
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
