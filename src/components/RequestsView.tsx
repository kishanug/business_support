import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MapPin,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiError, type AdminBootstrapData } from '../lib/api';
import type { RequestsFilterIntent } from '../App';
import {
  formatDisplayDate,
  formatINR,
  getTomorrowInKolkata,
  resolveRequestAutoFill,
} from '../core/rules';
import type { AssignmentMode, MeetingRequest, ReceivedFromType } from '../core/types';
import type { DraftMessageConfig } from './WhatsAppModal';

interface RequestsViewProps {
  data: AdminBootstrapData;
  initialOpenCreate?: boolean;
  initialSelectedRequestId?: string | null;
  filterIntent?: RequestsFilterIntent | null;
  onClearInitials: () => void;
  onRefresh: () => Promise<void>;
  onOpenDraft: (draft: DraftMessageConfig) => void;
}

export const RequestsView: React.FC<RequestsViewProps> = ({
  data,
  initialOpenCreate,
  initialSelectedRequestId,
  filterIntent,
  onClearInitials,
  onRefresh,
  onOpenDraft,
}) => {
  const isAdmin = data.actor.role === 'SUPER_ADMIN';
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'CONFIRMED' | 'COMPLETED' | 'DISPUTED'>('ALL');
  const [search, setSearch] = useState('');
  const [chapterFilter, setChapterFilter] = useState('ALL');
  const [coordinatorFilter, setCoordinatorFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(Boolean(initialOpenCreate));
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(initialSelectedRequestId ?? null);

  React.useEffect(() => {
    if (initialOpenCreate) {
      setCreateOpen(true);
      onClearInitials();
    }
  }, [initialOpenCreate, onClearInitials]);

  React.useEffect(() => {
    if (initialSelectedRequestId) {
      setSelectedRequestId(initialSelectedRequestId);
      onClearInitials();
    }
  }, [initialSelectedRequestId, onClearInitials]);

  React.useEffect(() => {
    if (!filterIntent) return;
    setStatusFilter(filterIntent.status ?? 'ALL');
    setChapterFilter(filterIntent.chapterId ?? 'ALL');
    setCoordinatorFilter(filterIntent.coordinatorId ?? 'ALL');
    setDateFilter(filterIntent.date ?? '');
  }, [filterIntent]);

  // Create Request Form State
  const [memberId, setMemberId] = useState('');
  const [meetingDate, setMeetingDate] = useState(data.tomorrow || getTomorrowInKolkata());
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>('MULTI_INTEREST');
  const [positionsRequired, setPositionsRequired] = useState(1);
  const [memberFee, setMemberFee] = useState(500);
  const [offeredPayout, setOfferedPayout] = useState(350);
  const [directSubIds, setDirectSubIds] = useState<string[]>([]);
  const [showMoreDetails, setShowMoreDetails] = useState(false);

  // Collapsed More Details overrides & provenance
  const [chapterWeekdayInfo, setChapterWeekdayInfo] = useState('');
  const [chapterNameInfo, setChapterNameInfo] = useState('');
  const [locationId, setLocationId] = useState('');
  const [venueNameOverride, setVenueNameOverride] = useState('');
  const [reportingTime, setReportingTime] = useState('07:15 AM');
  const [startTime, setStartTime] = useState('07:30 AM');
  const [endTime, setEndTime] = useState('09:30 AM');
  const [mapsUrlOverride, setMapsUrlOverride] = useState('');
  const [directionsOverride, setDirectionsOverride] = useState('');
  const [intro30Sec, setIntro30Sec] = useState('');
  const [receivedFromType, setReceivedFromType] = useState<ReceivedFromType>('DIRECT_MEMBER');
  const [receivedFrom, setReceivedFrom] = useState('WhatsApp from Member');
  const [responsibleCoordinatorId, setResponsibleCoordinatorId] = useState('');
  const [sourcedViaCoordinatorId, setSourcedViaCoordinatorId] = useState('');
  const [commissionEnabled, setCommissionEnabled] = useState(false);
  const [commissionAmount, setCommissionAmount] = useState(0);
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [allowBids, setAllowBids] = useState(true);
  const [requireManagerApproval, setRequireManagerApproval] = useState(false);
  const [urgency, setUrgency] = useState<'NORMAL' | 'URGENT'>('NORMAL');

  // Detail drawer actions: Dispute / Adjust / Replace Attendee / Request Changes / Delete confirm
  const [disputeReason, setDisputeReason] = useState('');
  const [adjustChargeDelta, setAdjustChargeDelta] = useState('0');
  const [adjustEarningDelta, setAdjustEarningDelta] = useState('0');
  const [adjustReason, setAdjustReason] = useState('');
  const [changeRequestRespId, setChangeRequestRespId] = useState<string | null>(null);
  const [changeRequestNote, setChangeRequestNote] = useState('');
  const [replaceAsgnId, setReplaceAsgnId] = useState<string | null>(null);
  const [replaceReason, setReplaceReason] = useState('');
  const [replaceSubId, setReplaceSubId] = useState('');
  const [confirmDeleteReq, setConfirmDeleteReq] = useState(false);

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  function handleMemberChange(nextMemberId: string) {
    setMemberId(nextMemberId);
    const member = data.members.find((m) => m.id === nextMemberId);
    if (!member) return;
    const auto = resolveRequestAutoFill(member, data.chapters, data.locations);
    if (auto) {
      // LOCKED: Always default meetingDate to tomorrow in Asia/Kolkata regardless of chapter regular weekday!
      setMeetingDate(data.tomorrow || auto.meetingDate);
      setChapterWeekdayInfo(auto.chapterRegularWeekday);
      setChapterNameInfo(auto.chapterName);
      setLocationId(auto.locationId);
      setVenueNameOverride(auto.venueName);
      setReportingTime(auto.reportingTime);
      setStartTime(auto.startTime);
      setEndTime(auto.endTime);
      setMapsUrlOverride(auto.mapsUrl);
      setDirectionsOverride(auto.directions);
      setIntro30Sec(auto.intro30Sec);
      setMemberFee(auto.memberFee);
      setOfferedPayout(auto.offeredPayout);
      setReceivedFrom(`WhatsApp from ${member.name}`);
    }
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!memberId) {
      setFormError('Select a member for this request.');
      return;
    }
    if (assignmentMode === 'DIRECT' && directSubIds.length === 0) {
      setFormError('Select at least one registered substitute for Direct Assignment.');
      return;
    }
    setBusy(true);
    try {
      await api.createRequest({
        goingForMemberId: memberId,
        meetingDate,
        locationId: locationId || undefined,
        venueNameOverride: venueNameOverride || undefined,
        reportingTime,
        startTime,
        endTime,
        mapsUrlOverride: mapsUrlOverride || undefined,
        directionsOverride: directionsOverride || undefined,
        intro30Sec,
        assignmentMode,
        positionsRequired,
        memberFee,
        offeredPayout,
        receivedFromType,
        receivedFrom,
        coordinatorId: isAdmin && responsibleCoordinatorId ? responsibleCoordinatorId : undefined,
        sourcedViaCoordinatorId: sourcedViaCoordinatorId || undefined,
        coordinatorCommissionEnabled: isAdmin ? commissionEnabled : false,
        coordinatorCommissionAmount: isAdmin && commissionEnabled ? commissionAmount : 0,
        specialInstructions,
        allowBids,
        requireManagerApproval,
        urgency,
        directSubstituteIds: assignmentMode === 'DIRECT' ? directSubIds : undefined,
      });
      await onRefresh();
      setCreateOpen(false);
      setMemberId('');
      setDirectSubIds([]);
      setCommissionEnabled(false);
      setCommissionAmount(0);
      setSourcedViaCoordinatorId('');
      setShowMoreDetails(false);
      setActionMessage('Request published successfully.');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to create request.');
    } finally {
      setBusy(false);
    }
  }

  async function handleApproveCandidate(responseId: string, overridePayout?: number) {
    setBusy(true);
    setActionMessage(null);
    try {
      await api.approveResponse(responseId, overridePayout);
      await onRefresh();
      setActionMessage('Candidate approved and assignment confirmed.');
    } catch (err) {
      setActionMessage(err instanceof ApiError ? err.message : 'Approval failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRejectCandidate(responseId: string) {
    setBusy(true);
    try {
      await api.rejectResponse(responseId, 'Coordinator declined candidate');
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(assignmentId: string) {
    setBusy(true);
    try {
      await api.verifyAssignment(assignmentId);
      await onRefresh();
      setActionMessage('Attendance verified and settlement hold released.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDispute(assignmentId: string) {
    if (!disputeReason.trim()) return;
    setBusy(true);
    try {
      await api.disputeAssignment(assignmentId, disputeReason.trim(), true);
      setDisputeReason('');
      await onRefresh();
      setActionMessage('Assignment marked Disputed; settlement placed On Hold.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAdjust(assignmentId: string) {
    if (!adjustReason.trim()) return;
    setBusy(true);
    try {
      await api.adjustDisputedLedger(
        assignmentId,
        Number(adjustChargeDelta) || 0,
        Number(adjustEarningDelta) || 0,
        adjustReason.trim()
      );
      setAdjustChargeDelta('0');
      setAdjustEarningDelta('0');
      setAdjustReason('');
      await onRefresh();
      setActionMessage('Auditable ledger adjustment recorded.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestChanges(responseId: string) {
    if (!changeRequestNote.trim()) return;
    setBusy(true);
    try {
      await api.requestResponseChanges(responseId, changeRequestNote.trim());
      setChangeRequestRespId(null);
      setChangeRequestNote('');
      await onRefresh();
      setActionMessage('Requested clarification/changes from substitute.');
    } catch (err) {
      setActionMessage(err instanceof ApiError ? err.message : 'Could not send change request.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReplaceAssignment(assignmentId: string) {
    if (!replaceReason.trim()) return;
    setBusy(true);
    try {
      await api.replaceAssignment(assignmentId, {
        reason: replaceReason.trim(),
        replacementSubstituteId: replaceSubId || undefined,
      });
      setReplaceAsgnId(null);
      setReplaceReason('');
      setReplaceSubId('');
      await onRefresh();
      setActionMessage(
        replaceSubId
          ? 'Old assignment marked REPLACED (history preserved) and replacement confirmed.'
          : 'Old assignment marked REPLACED (history preserved) and request slot re-opened.'
      );
    } catch (err) {
      setActionMessage(err instanceof ApiError ? err.message : 'Replacement failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteRequest(reqId: string) {
    setBusy(true);
    try {
      await api.deleteEntity('request', reqId);
      setSelectedRequestId(null);
      setConfirmDeleteReq(false);
      await onRefresh();
      setActionMessage('Test request deleted.');
    } catch (err) {
      setActionMessage(err instanceof ApiError ? err.message : 'Could not delete request.');
      setConfirmDeleteReq(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelRequest(reqId: string) {
    setBusy(true);
    try {
      await api.cancelRequest(reqId, 'Cancelled by coordinator');
      await onRefresh();
      setActionMessage('Request cancelled (historical record preserved).');
    } finally {
      setBusy(false);
    }
  }

  const filteredRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.requests.filter((r) => {
      if (chapterFilter !== 'ALL' && r.chapterId !== chapterFilter) return false;
      if (dateFilter && r.meetingDate !== dateFilter) return false;
      if (coordinatorFilter !== 'ALL') {
        const matchesCoord =
          r.coordinatorId === coordinatorFilter ||
          r.sourcedViaCoordinatorId === coordinatorFilter ||
          data.assignments.some(
            (a) =>
              a.requestId === r.id &&
              (a.coordinatorId === coordinatorFilter || a.assignedViaCoordinatorId === coordinatorFilter)
          );
        if (!matchesCoord) return false;
      }
      if (statusFilter === 'OPEN' && r.status !== 'OPEN' && r.status !== 'AWAITING_SELECTION') return false;
      if (statusFilter === 'CONFIRMED' && r.status !== 'CONFIRMED' && r.status !== 'IN_PROGRESS') return false;
      if (statusFilter === 'COMPLETED' && r.status !== 'COMPLETED_SELF_REPORTED' && r.status !== 'VERIFIED') return false;
      if (statusFilter === 'DISPUTED' && r.status !== 'DISPUTED' && r.status !== 'CANCELLED') return false;
      if (!q) return true;
      return (
        r.memberNameSnapshot.toLowerCase().includes(q) ||
        r.chapterNameSnapshot.toLowerCase().includes(q) ||
        r.areaSnapshot.toLowerCase().includes(q) ||
        String(r.requestNumber).includes(q)
      );
    });
  }, [data.requests, data.assignments, statusFilter, chapterFilter, coordinatorFilter, dateFilter, search]);

  const coordName = (id?: string) =>
    id ? data.coordinatorDirectory.find((c) => c.id === id)?.name ?? 'Coordinator' : '—';

  const selectedRequest: MeetingRequest | undefined = data.requests.find((r) => r.id === selectedRequestId);
  const selectedResponses = selectedRequest
    ? data.responses.filter((r) => r.requestId === selectedRequest.id)
    : [];
  const selectedAssignments = selectedRequest
    ? data.assignments.filter((a) => a.requestId === selectedRequest.id)
    : [];

  return (
    <div className="space-y-5">
      {actionMessage && (
        <div role="status" className="px-4 py-2.5 rounded-xl bg-[#F3E8FF] border border-[#DDD6FE] text-xs font-medium text-[#5B21B6] flex items-center justify-between gap-2">
          <span>{actionMessage}</span>
          <button type="button" onClick={() => setActionMessage(null)} className="text-[#6D28D9] font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {/* Header + Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#F8F7FC] border border-[#E6E8EF] overflow-x-auto">
          {(
            [
              { id: 'ALL', label: 'All' },
              { id: 'OPEN', label: 'Open & Pending' },
              { id: 'CONFIRMED', label: 'Confirmed' },
              { id: 'COMPLETED', label: 'Completed' },
              { id: 'DISPUTED', label: 'Exceptions' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                statusFilter === tab.id ? 'bg-[#6D28D9] text-white' : 'text-[#475569] hover:text-[#142342]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setMeetingDate(data.tomorrow || getTomorrowInKolkata());
            setCreateOpen(true);
          }}
          className="h-10 px-4 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          New Request
        </button>
      </div>

      {/* Search, Chapter, Coordinator & Date Filters */}
      <div className="flex flex-wrap gap-2.5">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search member, chapter, locality, or #ID..."
            className="w-full h-10 pl-10 pr-3.5 rounded-xl border border-[#E6E8EF] text-sm text-[#142342] focus:outline-none focus:border-[#6D28D9]"
          />
        </div>
        <select
          aria-label="Filter by chapter"
          value={chapterFilter}
          onChange={(e) => setChapterFilter(e.target.value)}
          className="h-10 px-3 rounded-xl border border-[#E6E8EF] bg-white text-xs font-medium text-[#142342] focus:outline-none focus:border-[#6D28D9]"
        >
          <option value="ALL">All Chapters</option>
          {data.chapters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {isAdmin && data.coordinatorDirectory.length > 0 && (
          <select
            aria-label="Filter by coordinator or via attribution"
            value={coordinatorFilter}
            onChange={(e) => setCoordinatorFilter(e.target.value)}
            className="h-10 px-3 rounded-xl border border-[#E6E8EF] bg-white text-xs font-medium text-[#142342] focus:outline-none focus:border-[#6D28D9]"
          >
            <option value="ALL">All Coordinators / Via</option>
            {data.coordinatorDirectory.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <input
          type="date"
          aria-label="Filter requests by meeting date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="h-10 px-3 rounded-xl border border-[#E6E8EF] bg-white text-xs text-[#142342] focus:outline-none focus:border-[#6D28D9]"
        />
        {(chapterFilter !== 'ALL' || coordinatorFilter !== 'ALL' || dateFilter || statusFilter !== 'ALL') && (
          <button
            type="button"
            onClick={() => {
              setStatusFilter('ALL');
              setChapterFilter('ALL');
              setCoordinatorFilter('ALL');
              setDateFilter('');
              setSearch('');
            }}
            className="h-10 px-3 rounded-xl border border-[#DDD6FE] bg-[#F3E8FF]/60 text-xs font-semibold text-[#6D28D9] cursor-pointer"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Request Cards List */}
      <div className="space-y-3">
        {filteredRequests.length === 0 ? (
          <div className="p-8 rounded-xl border border-dashed border-[#E6E8EF] text-center text-sm text-[#64748B]">
            No requests match the current filter.
          </div>
        ) : (
          filteredRequests.map((req) => {
            const asgns = data.assignments.filter(
              (a) => a.requestId === req.id && !['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)
            );
            const resps = data.responses.filter(
              (r) => r.requestId === req.id && (r.status === 'PENDING' || r.status === 'AWAITING_APPROVAL')
            );
            return (
              <button
                key={req.id}
                type="button"
                onClick={() => setSelectedRequestId(req.id)}
                className="w-full text-left p-4 rounded-xl border border-[#E6E8EF] bg-white hover:border-[#6D28D9]/50 transition-colors cursor-pointer"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-mono text-xs text-[#64748B]">#{req.requestNumber}</span>
                      <span className="font-display text-sm sm:text-base font-bold text-[#142342]">
                        {req.chapterNameSnapshot}
                      </span>
                      <span className="text-xs text-[#64748B]">· {req.areaSnapshot}</span>
                    </div>
                    <p className="text-xs sm:text-sm text-[#334155] mt-1">
                      <span className="font-medium text-[#142342]">{req.memberNameSnapshot}</span>
                      <span className="mx-1.5 text-[#94A3B8]">→</span>
                      <span className={asgns.length > 0 ? 'font-semibold text-[#142342]' : 'font-semibold text-amber-700'}>
                        {asgns.length > 0
                          ? asgns.map((a) => a.actualAttendeeName).join(', ')
                          : 'Unassigned'}
                      </span>
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="font-display text-sm font-bold text-[#142342] tabular-nums">
                      Bill {formatINR(req.memberFee)} · Pay {formatINR(req.offeredPayout)}
                    </p>
                    <p
                      className={`text-xs font-semibold mt-0.5 ${
                        req.status === 'DISPUTED'
                          ? 'text-red-600'
                          : req.status === 'VERIFIED' || req.status === 'CONFIRMED'
                          ? 'text-emerald-700'
                          : req.status === 'COMPLETED_SELF_REPORTED'
                          ? 'text-[#6D28D9]'
                          : req.status === 'CANCELLED'
                          ? 'text-[#94A3B8]'
                          : 'text-amber-700'
                      }`}
                    >
                      {req.status.replace(/_/g, ' ')}
                    </p>
                  </div>
                </div>

                <div className="mt-3 pt-2.5 border-t border-[#E6E8EF]/80 flex flex-wrap items-center justify-between gap-2 text-xs text-[#64748B]">
                  <span>
                    <strong className="text-[#142342]">{formatDisplayDate(req.meetingDate)}</strong>
                    {' · '}
                    {req.reportingTime}
                    {' · '}
                    Via <strong className="text-[#142342]">{coordName(req.sourcedViaCoordinatorId ?? req.coordinatorId)}</strong>
                    {asgns.some((a) => a.isDelegated) && (
                      <span className="ml-1.5 text-[#B58F3D] font-semibold">· Delegated</span>
                    )}
                    {req.coordinatorCommissionAmount > 0 && (
                      <span className="ml-1.5 text-[#6D28D9] font-semibold">
                        · Comm {formatINR(req.coordinatorCommissionAmount)}
                      </span>
                    )}
                  </span>
                  <span className="font-medium text-[#6D28D9] tabular-nums">
                    {resps.length > 0
                      ? `${resps.length} awaiting review`
                      : `${asgns.length}/${req.positionsRequired} slot${req.positionsRequired > 1 ? 's' : ''} filled`}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* CREATE REQUEST MODAL */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#142342]/45 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="New Request"
        >
          <div className="w-full sm:max-w-xl bg-white rounded-t-2xl sm:rounded-2xl border border-[#E6E8EF] max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E6E8EF] flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-[#142342]">New Request</h2>
                <p className="text-xs text-[#64748B]">Auto-fills linked chapter, venue, times, intro &amp; fee</p>
              </div>
              <button
                type="button"
                aria-label="Close new request modal"
                onClick={() => setCreateOpen(false)}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-[#64748B] hover:bg-[#F8F7FC]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
              {formError && (
                <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
                  {formError}
                </div>
              )}

              {/* Member selector */}
              <div>
                <label htmlFor="req-member" className="block text-xs font-semibold text-[#142342] mb-1.5">
                  Going For (Member) *
                </label>
                <select
                  id="req-member"
                  value={memberId}
                  onChange={(e) => handleMemberChange(e.target.value)}
                  required
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E6E8EF] bg-white text-sm text-[#142342] focus:outline-none focus:border-[#6D28D9]"
                >
                  <option value="">Select member...</option>
                  {data.members
                    .filter((m) => m.active)
                    .map((m) => {
                      const chap = data.chapters.find((c) => c.id === m.chapterId);
                      return (
                        <option key={m.id} value={m.id}>
                          {m.name} — {chap?.name ?? 'Chapter'} ({m.businessCategory})
                        </option>
                      );
                    })}
                </select>
                {chapterNameInfo && (
                  <p className="mt-1.5 text-xs text-[#475569]">
                    Linked chapter: <strong className="text-[#142342]">{chapterNameInfo}</strong> · Saved regular weekday:{' '}
                    <strong className="text-[#B58F3D]">{chapterWeekdayInfo}</strong> (informational only; date defaults to tomorrow)
                  </p>
                )}
              </div>

              {/* Editable Date (Defaults to Tomorrow in Asia/Kolkata) & Positions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="req-date" className="block text-xs font-semibold text-[#142342] mb-1.5">
                    Meeting Date (Tomorrow Default) *
                  </label>
                  <input
                    id="req-date"
                    type="date"
                    value={meetingDate}
                    onChange={(e) => setMeetingDate(e.target.value)}
                    required
                    className="w-full h-11 px-3.5 rounded-xl border border-[#E6E8EF] text-sm text-[#142342] focus:outline-none focus:border-[#6D28D9]"
                  />
                </div>
                <div>
                  <label htmlFor="req-positions" className="block text-xs font-semibold text-[#142342] mb-1.5">
                    Required Positions
                  </label>
                  <input
                    id="req-positions"
                    type="number"
                    min={1}
                    max={10}
                    value={positionsRequired}
                    onChange={(e) => setPositionsRequired(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full h-11 px-3.5 rounded-xl border border-[#E6E8EF] text-sm tabular-nums text-[#142342] focus:outline-none focus:border-[#6D28D9]"
                  />
                </div>
              </div>

              {/* Assignment Mode */}
              <div>
                <span className="block text-xs font-semibold text-[#142342] mb-1.5">Assignment Mode</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'MULTI_INTEREST', label: 'Multiple Interests', sub: 'Select from volunteers' },
                      { id: 'FIRST_CONFIRM', label: 'First Confirm', sub: 'Auto-locks first eligible' },
                      { id: 'DIRECT', label: 'Direct Assign', sub: 'Pick substitute now' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setAssignmentMode(m.id)}
                      className={`p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                        assignmentMode === m.id
                          ? 'border-[#6D28D9] bg-[#F3E8FF]/60'
                          : 'border-[#E6E8EF] bg-white hover:bg-[#F8F7FC]'
                      }`}
                    >
                      <p className="text-xs font-bold text-[#142342]">{m.label}</p>
                      <p className="text-[11px] text-[#64748B] mt-0.5">{m.sub}</p>
                    </button>
                  ))}
                </div>
              </div>

              {assignmentMode === 'DIRECT' && (
                <div>
                  <label className="block text-xs font-semibold text-[#142342] mb-1.5">
                    Select Registered Substitute(s) (up to {positionsRequired})
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto p-2 rounded-xl border border-[#E6E8EF] bg-[#F8F7FC]">
                    {data.substitutes
                      .filter((s) => s.active)
                      .map((sub) => {
                        const checked = directSubIds.includes(sub.id);
                        return (
                          <label
                            key={sub.id}
                            className="flex items-center gap-2 text-xs text-[#142342] p-1.5 rounded-lg hover:bg-white cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setDirectSubIds((prev) =>
                                  checked
                                    ? prev.filter((id) => id !== sub.id)
                                    : [...prev.slice(0, positionsRequired - 1), sub.id]
                                );
                              }}
                              className="accent-[#6D28D9]"
                            />
                            <span className="truncate font-medium">{sub.name}</span>
                            <span className="text-[#64748B] ml-auto shrink-0 tabular-nums">₹{sub.defaultPayout}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Member Charge & Offered Payout */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="req-fee" className="block text-xs font-semibold text-[#142342] mb-1.5">
                    Member Charge (₹)
                  </label>
                  <input
                    id="req-fee"
                    type="number"
                    min={0}
                    value={memberFee}
                    onChange={(e) => setMemberFee(Number(e.target.value) || 0)}
                    className="w-full h-11 px-3.5 rounded-xl border border-[#E6E8EF] text-sm tabular-nums text-[#142342] focus:outline-none focus:border-[#6D28D9]"
                  />
                </div>
                <div>
                  <label htmlFor="req-payout" className="block text-xs font-semibold text-[#142342] mb-1.5">
                    Offered Payout (₹)
                  </label>
                  <input
                    id="req-payout"
                    type="number"
                    min={0}
                    value={offeredPayout}
                    onChange={(e) => setOfferedPayout(Number(e.target.value) || 0)}
                    className="w-full h-11 px-3.5 rounded-xl border border-[#E6E8EF] text-sm tabular-nums text-[#142342] focus:outline-none focus:border-[#6D28D9]"
                  />
                </div>
              </div>

              {/* Collapsed More Details (Request-Only Overrides) */}
              <div className="border-t border-[#E6E8EF] pt-3">
                <button
                  type="button"
                  aria-expanded={showMoreDetails}
                  onClick={() => setShowMoreDetails((p) => !p)}
                  className="w-full flex items-center justify-between text-xs font-semibold text-[#6D28D9] py-1 cursor-pointer"
                >
                  <span>More Details (Venue, Schedule, Intro, Source &amp; Overrides)</span>
                  {showMoreDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {showMoreDetails && (
                  <div className="mt-3 space-y-3 bg-[#F8F7FC] p-3.5 rounded-xl border border-[#E6E8EF]">
                    <p className="text-[11px] text-[#64748B]">
                      Edits below apply as a snapshot for this request only and do not overwrite saved Member, Chapter, or Location masters.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-[#142342] mb-1">Venue Override</label>
                        <select
                          value={locationId}
                          onChange={(e) => {
                            setLocationId(e.target.value);
                            const loc = data.locations.find((l) => l.id === e.target.value);
                            if (loc) {
                              setVenueNameOverride(loc.name);
                              setMapsUrlOverride(loc.mapsUrl);
                            }
                          }}
                          className="w-full h-10 px-3 rounded-lg border border-[#E6E8EF] bg-white text-xs text-[#142342]"
                        >
                          {data.locations.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name} ({l.area})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#142342] mb-1">Received From</label>
                        <input
                          type="text"
                          value={receivedFrom}
                          onChange={(e) => setReceivedFrom(e.target.value)}
                          className="w-full h-10 px-3 rounded-lg border border-[#E6E8EF] bg-white text-xs text-[#142342]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-[#142342] mb-1">Reporting</label>
                        <input
                          type="text"
                          value={reportingTime}
                          onChange={(e) => setReportingTime(e.target.value)}
                          className="w-full h-9 px-2.5 rounded-lg border border-[#E6E8EF] bg-white text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-[#142342] mb-1">Start</label>
                        <input
                          type="text"
                          value={startTime}
                          onChange={(e) => setStartTime(e.target.value)}
                          className="w-full h-9 px-2.5 rounded-lg border border-[#E6E8EF] bg-white text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-[#142342] mb-1">End</label>
                        <input
                          type="text"
                          value={endTime}
                          onChange={(e) => setEndTime(e.target.value)}
                          className="w-full h-9 px-2.5 rounded-lg border border-[#E6E8EF] bg-white text-xs"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#142342] mb-1">
                        Private 30-Second Intro (Unlocked only after confirmation)
                      </label>
                      <textarea
                        rows={3}
                        value={intro30Sec}
                        onChange={(e) => setIntro30Sec(e.target.value)}
                        className="w-full p-2.5 rounded-lg border border-[#E6E8EF] bg-white text-xs text-[#142342]"
                      />
                    </div>

                    {/* Distinct Source & Coordinator Attribution */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-[#E6E8EF]">
                      <div>
                        <label className="block text-xs font-semibold text-[#142342] mb-1">Received From Type</label>
                        <select
                          value={receivedFromType}
                          onChange={(e) => setReceivedFromType(e.target.value as ReceivedFromType)}
                          className="w-full h-10 px-3 rounded-lg border border-[#E6E8EF] bg-white text-xs text-[#142342]"
                        >
                          <option value="DIRECT_MEMBER">Direct Member</option>
                          <option value="EXTERNAL_COORDINATOR">External Coordinator</option>
                          <option value="SUBSTITUTE">Substitute Referral</option>
                          <option value="EXCHANGE">Chapter Exchange</option>
                          <option value="OTHER">Other Source</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#142342] mb-1">
                          Sourced Via Coordinator (Attribution)
                        </label>
                        <select
                          value={sourcedViaCoordinatorId}
                          onChange={(e) => setSourcedViaCoordinatorId(e.target.value)}
                          className="w-full h-10 px-3 rounded-lg border border-[#E6E8EF] bg-white text-xs text-[#142342]"
                        >
                          <option value="">Same as Responsible Coordinator</option>
                          {data.coordinatorDirectory.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {isAdmin && (
                      <div className="space-y-2.5 pt-1 border-t border-[#E6E8EF]">
                        <div>
                          <label className="block text-xs font-semibold text-[#142342] mb-1">
                            Responsible / Owner Coordinator
                          </label>
                          <select
                            value={responsibleCoordinatorId}
                            onChange={(e) => setResponsibleCoordinatorId(e.target.value)}
                            className="w-full h-10 px-3 rounded-lg border border-[#E6E8EF] bg-white text-xs text-[#142342]"
                          >
                            <option value="">Auto (Member&apos;s Owner / Current Admin)</option>
                            {data.coordinatorDirectory.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="p-3 rounded-lg bg-white border border-[#E6E8EF] space-y-2">
                          <label className="flex items-start gap-2 text-xs text-[#142342] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={commissionEnabled}
                              onChange={(e) => {
                                setCommissionEnabled(e.target.checked);
                                if (!e.target.checked) setCommissionAmount(0);
                              }}
                              className="mt-0.5 accent-[#6D28D9]"
                            />
                            <div>
                              <span className="font-semibold">Approve Coordinator Commission (Optional)</span>
                              <p className="text-[11px] text-[#64748B]">
                                Merely tagging &ldquo;Sourced Via&rdquo; posts ₹0 commission unless explicitly enabled here.
                              </p>
                            </div>
                          </label>
                          {commissionEnabled && (
                            <input
                              type="number"
                              min={0}
                              value={commissionAmount}
                              onChange={(e) => setCommissionAmount(Math.max(0, Number(e.target.value) || 0))}
                              placeholder="Approved commission ₹ (e.g. 50)"
                              className="w-full h-9 px-3 rounded-lg border border-[#E6E8EF] text-xs tabular-nums"
                            />
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-4 pt-1 text-xs text-[#142342]">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allowBids}
                          onChange={(e) => setAllowBids(e.target.checked)}
                          className="accent-[#6D28D9]"
                        />
                        Allow price bids
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={requireManagerApproval}
                          onChange={(e) => setRequireManagerApproval(e.target.checked)}
                          className="accent-[#6D28D9]"
                        />
                        Require manager review on First-Confirm
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={urgency === 'URGENT'}
                          onChange={(e) => setUrgency(e.target.checked ? 'URGENT' : 'NORMAL')}
                          className="accent-[#6D28D9]"
                        />
                        Mark Urgent
                      </label>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="h-11 px-4 rounded-xl border border-[#E6E8EF] text-sm font-semibold text-[#475569] hover:bg-[#F8F7FC]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="h-11 px-5 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {busy ? 'Saving...' : assignmentMode === 'DIRECT' ? 'Assign Directly' : 'Publish Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REQUEST DETAIL & CANDIDATE APPROVAL DRAWER */}
      {selectedRequest && (
        <div
          className="fixed inset-0 z-50 bg-[#142342]/45 backdrop-blur-[2px] flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label={`Request ${selectedRequest.requestNumber} details`}
        >
          <div className="w-full max-w-xl bg-white h-full border-l border-[#E6E8EF] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E6E8EF] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-mono text-[#64748B]">
                  Request #{selectedRequest.requestNumber} · {selectedRequest.status.replace(/_/g, ' ')}
                </p>
                <h2 className="font-display text-base font-bold text-[#142342] truncate">
                  {selectedRequest.chapterNameSnapshot} · {formatDisplayDate(selectedRequest.meetingDate)}
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close request details"
                onClick={() => setSelectedRequestId(null)}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-[#64748B] hover:bg-[#F8F7FC]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Distinct Source & Coordinator Provenance Block */}
              <div className="p-4 rounded-xl bg-[#F8F7FC] border border-[#E6E8EF] grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-[#64748B]">Going For (Member)</span>
                  <p className="font-semibold text-[#142342] mt-0.5">{selectedRequest.memberNameSnapshot}</p>
                </div>
                <div>
                  <span className="text-[#64748B]">Received From ({selectedRequest.receivedFromType.replace(/_/g, ' ')})</span>
                  <p className="font-semibold text-[#142342] mt-0.5">{selectedRequest.receivedFrom}</p>
                </div>
                <div>
                  <span className="text-[#64748B]">Responsible Coordinator</span>
                  <p className="font-semibold text-[#142342] mt-0.5">{coordName(selectedRequest.coordinatorId)}</p>
                </div>
                <div>
                  <span className="text-[#64748B]">Sourced / Assigned Via</span>
                  <p className="font-semibold text-[#6D28D9] mt-0.5">
                    {coordName(selectedRequest.sourcedViaCoordinatorId ?? selectedRequest.coordinatorId)}
                  </p>
                </div>
                <div>
                  <span className="text-[#64748B]">Venue &amp; Timing</span>
                  <p className="font-semibold text-[#142342] mt-0.5">
                    {selectedRequest.venueNameSnapshot} · {selectedRequest.reportingTime}
                  </p>
                </div>
                <div>
                  <span className="text-[#64748B]">Pricing &amp; Commission</span>
                  <p className="font-semibold text-[#142342] mt-0.5 tabular-nums">
                    Bill {formatINR(selectedRequest.memberFee)} · Pay {formatINR(selectedRequest.offeredPayout)}
                  </p>
                  <p className="text-[11px] text-[#64748B] mt-0.5 tabular-nums">
                    Coord. Commission:{' '}
                    {selectedRequest.coordinatorCommissionEnabled && selectedRequest.coordinatorCommissionAmount > 0 ? (
                      <strong className="text-[#B58F3D]">
                        {formatINR(selectedRequest.coordinatorCommissionAmount)} Approved
                      </strong>
                    ) : (
                      <span>₹0 (None)</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Member Intro Snapshot & Venue Map */}
              <div className="space-y-2 text-xs">
                <p className="font-semibold text-[#142342]">30-Second Member Briefing (Snapshot)</p>
                <p className="p-3 rounded-xl border border-[#E6E8EF] text-[#334155] leading-relaxed">
                  {selectedRequest.intro30SecSnapshot || 'No introduction saved.'}
                </p>
                {selectedRequest.mapsUrlSnapshot && (
                  <a
                    href={selectedRequest.mapsUrlSnapshot}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[#6D28D9] font-semibold hover:underline"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    Open Venue Maps Link
                  </a>
                )}
              </div>

              {/* Confirmed Assignments & Accountability */}
              <div className="space-y-3">
                <h3 className="font-display text-sm font-bold text-[#142342]">
                  Assignments ({selectedAssignments.length}/{selectedRequest.positionsRequired})
                </h3>
                {selectedAssignments.length === 0 ? (
                  <p className="text-xs text-[#64748B]">No substitute confirmed yet.</p>
                ) : (
                  selectedAssignments.map((asgn) => {
                    const contractSub = data.substitutes.find((s) => s.id === asgn.contractSubstituteId);
                    const coord = data.coordinators.find((c) => c.id === selectedRequest.coordinatorId);
                    return (
                      <div key={asgn.id} className="p-4 rounded-xl border border-[#E6E8EF] space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-bold text-[#142342]">
                              Actual Attendee: {asgn.actualAttendeeName}
                            </p>
                            <p className="text-xs text-[#475569] mt-0.5">
                              Contracted Payee:{' '}
                              <strong className="text-[#142342]">{contractSub?.name ?? asgn.contractSubstituteId}</strong>
                              {asgn.isDelegated && ' · Delegated Guest (Partner accountable)'}
                            </p>
                          </div>
                          <span className="text-xs font-bold text-[#6D28D9] tabular-nums">
                            {formatINR(asgn.agreedPayout)}
                          </span>
                        </div>

                        <div className="text-xs text-[#475569] flex flex-wrap gap-x-3 gap-y-1">
                          <span>Status: <strong className="text-[#142342]">{asgn.status.replace(/_/g, ' ')}</strong></span>
                          <span>Check-in: <strong className="text-[#142342]">{asgn.checkinState.replace(/_/g, ' ')}</strong></span>
                          <span>Assigned Via: <strong className="text-[#6D28D9]">{coordName(asgn.assignedViaCoordinatorId)}</strong></span>
                          {asgn.coordinatorCommissionAmount > 0 && (
                            <span className="text-[#B58F3D] font-semibold">
                              Approved Comm: {formatINR(asgn.coordinatorCommissionAmount)}
                            </span>
                          )}
                          {(asgn.lastCheckinReportedByPartner || asgn.finishedReportedByPartner) && (
                            <span className="text-[#B58F3D] font-semibold">
                              Reported by Partner {contractSub?.name ?? ''} for Guest {asgn.actualAttendeeName}
                            </span>
                          )}
                        </div>
                        {asgn.status === 'REPLACED' && asgn.replacementReason && (
                          <p className="text-[11px] text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg">
                            Replaced (History Preserved): {asgn.replacementReason}
                          </p>
                        )}

                        {asgn.meetingNotes && (
                          <div className="p-3 rounded-lg bg-[#F8F7FC] text-xs text-[#334155] space-y-1">
                            {asgn.meetingNotes.referralsGiven && <p><strong>Referrals:</strong> {asgn.meetingNotes.referralsGiven}</p>}
                            {asgn.meetingNotes.peopleMet && <p><strong>People Met:</strong> {asgn.meetingNotes.peopleMet}</p>}
                            {asgn.meetingNotes.highlights && <p><strong>Highlights:</strong> {asgn.meetingNotes.highlights}</p>}
                            {asgn.meetingNotes.earlyFinishReason && (
                              <p className="text-amber-700"><strong>Early Finish Reason:</strong> {asgn.meetingNotes.earlyFinishReason}</p>
                            )}
                          </div>
                        )}

                        {asgn.disputed && (
                          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 space-y-2">
                            <p className="font-semibold flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              Dispute Active: {asgn.disputeReason}
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                type="number"
                                value={adjustChargeDelta}
                                onChange={(e) => setAdjustChargeDelta(e.target.value)}
                                placeholder="Charge Δ (e.g. -200)"
                                className="h-9 px-2.5 rounded-lg border border-red-200 bg-white text-xs text-[#142342]"
                              />
                              <input
                                type="number"
                                value={adjustEarningDelta}
                                onChange={(e) => setAdjustEarningDelta(e.target.value)}
                                placeholder="Payout Δ (e.g. -100)"
                                className="h-9 px-2.5 rounded-lg border border-red-200 bg-white text-xs text-[#142342]"
                              />
                            </div>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={adjustReason}
                                onChange={(e) => setAdjustReason(e.target.value)}
                                placeholder="Audited adjustment reason..."
                                className="flex-1 h-9 px-2.5 rounded-lg border border-red-200 bg-white text-xs text-[#142342]"
                              />
                              <button
                                type="button"
                                onClick={() => handleAdjust(asgn.id)}
                                className="h-9 px-3 rounded-lg bg-red-600 text-white text-xs font-semibold whitespace-nowrap"
                              >
                                Apply Adjustment
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() =>
                              onOpenDraft({
                                templateType: 'MEMBER_CONFIRMATION',
                                title: 'Member Confirmation Draft',
                                recipientLabel: selectedRequest.memberNameSnapshot,
                                recipientPhone: selectedRequest.memberPhoneSnapshot,
                                defaultBody: `Your representative for ${selectedRequest.chapterNameSnapshot} on ${formatDisplayDate(selectedRequest.meetingDate)} has been confirmed: ${asgn.actualAttendeeName}. Reporting time: ${selectedRequest.reportingTime}. For any questions, contact ${coord?.name ?? 'Coordinator'} (${coord?.callingPhone ?? ''}).`,
                              })
                            }
                            className="h-9 px-3 rounded-lg border border-[#E6E8EF] bg-white hover:bg-[#F8F7FC] text-xs font-semibold text-[#142342] inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                            Member WhatsApp
                          </button>

                          {(asgn.status === 'COMPLETED_SELF_REPORTED' || asgn.disputed) && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleVerify(asgn.id)}
                              className="h-9 px-3 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Verify Attendance
                            </button>
                          )}

                          {!['COMPLETED_SELF_REPORTED', 'VERIFIED', 'CANCELLED', 'REPLACED'].includes(asgn.status) && (
                            <button
                              type="button"
                              onClick={() => {
                                setReplaceAsgnId(replaceAsgnId === asgn.id ? null : asgn.id);
                                setReplaceReason('');
                                setReplaceSubId('');
                              }}
                              className="h-9 px-3 rounded-lg border border-[#E6E8EF] bg-white hover:bg-[#F8F7FC] text-xs font-semibold text-[#475569] inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              Replace Attendee
                            </button>
                          )}

                          {replaceAsgnId === asgn.id && (
                            <div className="w-full p-3 rounded-xl bg-[#F8F7FC] border border-[#E6E8EF] space-y-2 mt-1">
                              <p className="text-[11px] font-semibold text-[#142342]">
                                Replace Attendee (old record marked REPLACED &amp; history preserved)
                              </p>
                              <input
                                type="text"
                                value={replaceReason}
                                onChange={(e) => setReplaceReason(e.target.value)}
                                placeholder="Reason for replacement *"
                                className="w-full h-9 px-2.5 rounded-lg border border-[#E6E8EF] bg-white text-xs"
                              />
                              <select
                                value={replaceSubId}
                                onChange={(e) => setReplaceSubId(e.target.value)}
                                className="w-full h-9 px-2.5 rounded-lg border border-[#E6E8EF] bg-white text-xs"
                              >
                                <option value="">Leave blank to re-open slot for new responses</option>
                                {data.substitutes
                                  .filter((s) => s.active)
                                  .map((s) => (
                                    <option key={s.id} value={s.id}>
                                      Replace directly with {s.name} ({s.homeArea})
                                    </option>
                                  ))}
                              </select>
                              <div className="flex gap-2 justify-end">
                                <button
                                  type="button"
                                  onClick={() => setReplaceAsgnId(null)}
                                  className="h-8 px-3 rounded-lg border border-[#E6E8EF] bg-white text-xs"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  disabled={busy || !replaceReason.trim()}
                                  onClick={() => handleReplaceAssignment(asgn.id)}
                                  className="h-8 px-3 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                                >
                                  Confirm Replacement
                                </button>
                              </div>
                            </div>
                          )}

                          {!asgn.disputed && asgn.status !== 'CANCELLED' && asgn.status !== 'REPLACED' && (
                            <div className="flex items-center gap-1.5 w-full mt-1">
                              <input
                                type="text"
                                value={disputeReason}
                                onChange={(e) => setDisputeReason(e.target.value)}
                                placeholder="Reason to flag dispute / hold settlement..."
                                className="flex-1 h-9 px-2.5 rounded-lg border border-[#E6E8EF] text-xs"
                              />
                              <button
                                type="button"
                                disabled={busy || !disputeReason.trim()}
                                onClick={() => handleDispute(asgn.id)}
                                className="h-9 px-3 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
                              >
                                <ShieldAlert className="w-3.5 h-3.5" />
                                Flag Dispute
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Candidate Responses / Bids / Delegations Awaiting Decision */}
              <div className="space-y-3">
                <h3 className="font-display text-sm font-bold text-[#142342]">
                  Candidate Responses ({selectedResponses.length})
                </h3>
                {selectedResponses.length === 0 ? (
                  <p className="text-xs text-[#64748B]">No substitute responses recorded yet.</p>
                ) : (
                  selectedResponses.map((resp) => {
                    const sub = data.substitutes.find((s) => s.id === resp.substituteId);
                    const canDecide =
                      (resp.status === 'PENDING' || resp.status === 'AWAITING_APPROVAL') &&
                      selectedAssignments.length < selectedRequest.positionsRequired;
                    return (
                      <div key={resp.id} className="p-3.5 rounded-xl border border-[#E6E8EF] bg-white space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-bold text-[#142342]">
                              {sub?.name ?? resp.substituteId}
                              {resp.delegatedGuestName && (
                                <span className="text-[#6D28D9]"> → Guest: {resp.delegatedGuestName}</span>
                              )}
                            </p>
                            <p className="text-xs text-[#64748B] mt-0.5">
                              {resp.responseType.replace(/_/g, ' ')}
                              {resp.proposedPayout ? ` · Offered Bid ${formatINR(resp.proposedPayout)}` : ` · Standard ${formatINR(selectedRequest.offeredPayout)}`}
                              {' · '}
                              <strong className="text-[#142342]">{resp.status.replace(/_/g, ' ')}</strong>
                            </p>
                          </div>
                        </div>
                        {resp.note && <p className="text-xs text-[#475569]">{resp.note}</p>}
                        {canDecide && (
                          <div className="space-y-2 pt-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleApproveCandidate(resp.id, resp.proposedPayout)}
                                className="h-9 px-3.5 rounded-lg bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                                {resp.responseType === 'DELEGATE_PROPOSAL'
                                  ? 'Approve Guest & Confirm'
                                  : resp.responseType === 'BID'
                                  ? `Accept Bid (${formatINR(resp.proposedPayout || 0)})`
                                  : 'Select & Confirm'}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setChangeRequestRespId(changeRequestRespId === resp.id ? null : resp.id);
                                  setChangeRequestNote('');
                                }}
                                className="h-9 px-3 rounded-lg border border-[#E6E8EF] text-xs font-semibold text-[#142342] hover:bg-[#F8F7FC] cursor-pointer"
                              >
                                Request Changes
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleRejectCandidate(resp.id)}
                                className="h-9 px-3 rounded-lg border border-[#E6E8EF] text-xs font-semibold text-[#64748B] hover:text-red-600 cursor-pointer"
                              >
                                Decline
                              </button>
                            </div>

                            {changeRequestRespId === resp.id && (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={changeRequestNote}
                                  onChange={(e) => setChangeRequestNote(e.target.value)}
                                  placeholder="Note for substitute (e.g. confirm earlier arrival or alternate guest)..."
                                  className="flex-1 h-9 px-2.5 rounded-lg border border-[#E6E8EF] text-xs"
                                />
                                <button
                                  type="button"
                                  disabled={busy || !changeRequestNote.trim()}
                                  onClick={() => handleRequestChanges(resp.id)}
                                  className="h-9 px-3 rounded-lg bg-[#142342] text-white text-xs font-semibold cursor-pointer"
                                >
                                  Send
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="pt-4 border-t border-[#E6E8EF] flex flex-wrap items-center justify-between gap-2">
                {isAdmin ? (
                  confirmDeleteReq ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-red-700">Delete test request?</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDeleteRequest(selectedRequest.id)}
                        className="h-8 px-3 rounded-lg bg-red-600 text-white font-semibold cursor-pointer"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteReq(false)}
                        className="h-8 px-2.5 rounded-lg border border-[#E6E8EF] text-[#475569]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmDeleteReq(true)}
                      className="h-9 px-3 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete Test Request
                    </button>
                  )
                ) : (
                  <span />
                )}

                {selectedRequest.status !== 'CANCELLED' &&
                  selectedRequest.status !== 'COMPLETED_SELF_REPORTED' &&
                  selectedRequest.status !== 'VERIFIED' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleCancelRequest(selectedRequest.id)}
                      className="h-9 px-3.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold cursor-pointer"
                    >
                      Cancel Request
                    </button>
                  )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
