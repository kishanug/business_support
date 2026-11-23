import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
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
  buildMemberConfirmationWhatsAppText,
  buildReferralAskWhatsAppText,
  filterChapterAndMemberMatches,
  formatDisplayDate,
  formatINR,
  getMemberNoteTypeLabel,
  getTomorrowInKolkata,
  MEMBER_NOTE_TYPE_OPTIONS,
  resolveRequestAutoFill,
} from '../core/rules';
import type { AssignmentMode, MeetingRequest, MemberNoteType, ReceivedFromType } from '../core/types';
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
    setEditingReferralAsk(false);
  }, [selectedRequestId]);

  React.useEffect(() => {
    if (!filterIntent) return;
    setStatusFilter(filterIntent.status ?? 'ALL');
    setChapterFilter(filterIntent.chapterId ?? 'ALL');
    setCoordinatorFilter(filterIntent.coordinatorId ?? 'ALL');
    setDateFilter(filterIntent.date ?? '');
  }, [filterIntent]);

  // Create Request Form State
  const [memberId, setMemberId] = useState('');
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [scopedChapterId, setScopedChapterId] = useState('');
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
  const [memberNoteType, setMemberNoteType] = useState<MemberNoteType>('GENERAL_NOTE');
  const [referralAsk, setReferralAsk] = useState('');
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

  // Detail drawer actions: Dispute / Adjust / Replace Attendee / Request Changes / Referral Ask / Delete confirm
  const [disputeReason, setDisputeReason] = useState('');
  const [adjustChargeDelta, setAdjustChargeDelta] = useState('0');
  const [adjustEarningDelta, setAdjustEarningDelta] = useState('0');
  const [adjustReason, setAdjustReason] = useState('');
  const [changeRequestRespId, setChangeRequestRespId] = useState<string | null>(null);
  const [changeRequestNote, setChangeRequestNote] = useState('');
  const [replaceAsgnId, setReplaceAsgnId] = useState<string | null>(null);
  const [replaceReason, setReplaceReason] = useState('');
  const [replaceSubId, setReplaceSubId] = useState('');
  const [editingReferralAsk, setEditingReferralAsk] = useState(false);
  const [referralAskTypeDraft, setReferralAskTypeDraft] = useState<MemberNoteType>('GENERAL_NOTE');
  const [referralAskDraft, setReferralAskDraft] = useState('');
  const [confirmDeleteReq, setConfirmDeleteReq] = useState(false);

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const selectedMember = useMemo(
    () => data.members.find((m) => m.id === memberId) ?? null,
    [data.members, memberId]
  );

  const scopedChapter = useMemo(
    () => data.chapters.find((c) => c.id === scopedChapterId) ?? null,
    [data.chapters, scopedChapterId]
  );

  const typeaheadMatches = useMemo(
    () =>
      filterChapterAndMemberMatches(
        memberSearchQuery,
        data.chapters,
        data.members,
        scopedChapterId || undefined
      ),
    [memberSearchQuery, data.chapters, data.members, scopedChapterId]
  );

  function handleSelectChapterScope(chapterId: string) {
    setScopedChapterId(chapterId);
    setMemberId('');
    setMemberSearchQuery('');
    const chap = data.chapters.find((c) => c.id === chapterId);
    if (!chap) return;
    const venue = data.locations.find((l) => l.id === chap.defaultLocationId);
    const directionsParts = [
      venue?.nearestStation ? `Nearest station: ${venue.nearestStation}` : '',
      venue?.transportGuidance ?? '',
      venue?.entryNotes ? `Entry: ${venue.entryNotes}` : '',
    ].filter(Boolean);
    setMeetingDate(data.tomorrow || getTomorrowInKolkata());
    setChapterWeekdayInfo(chap.regularWeekday);
    setChapterNameInfo(chap.name);
    setLocationId(venue?.id ?? '');
    setVenueNameOverride(venue?.name ?? '');
    setReportingTime(chap.reportingTime);
    setStartTime(chap.startTime);
    setEndTime(chap.endTime);
    setMapsUrlOverride(venue?.mapsUrl ?? '');
    setDirectionsOverride(directionsParts.join(' · '));
    setMemberFee(chap.defaultMemberFee);
    setOfferedPayout(chap.defaultSubstitutePayout);
  }

  function handleMemberChange(nextMemberId: string) {
    setMemberId(nextMemberId);
    setMemberSearchQuery('');
    const member = data.members.find((m) => m.id === nextMemberId);
    if (!member) return;
    setScopedChapterId(member.chapterId);
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
      setFormError('Type at least 3 characters to search and select a member for this request.');
      return;
    }
    if (assignmentMode === 'DIRECT' && directSubIds.length === 0) {
      setFormError('Select at least one Veloctive Team member for Direct Assignment.');
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
        memberNoteType: referralAsk.trim() ? memberNoteType : undefined,
        referralAsk: referralAsk.trim() || undefined,
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
      setMemberSearchQuery('');
      setScopedChapterId('');
      setChapterNameInfo('');
      setChapterWeekdayInfo('');
      setMemberNoteType('GENERAL_NOTE');
      setReferralAsk('');
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
        <div role="status" className="px-4 py-2.5 rounded-[6px] bg-[#C81E2B]/20 border border-[#E12D39]/40 text-xs font-medium text-[#F5DFA0] flex items-center justify-between gap-2">
          <span>{actionMessage}</span>
          <button type="button" onClick={() => setActionMessage(null)} className="text-[#E2B340] font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {/* Header + Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10 overflow-x-auto">
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
                statusFilter === tab.id ? 'bg-[#C81E2B] text-white' : 'text-[#f2efeb]/70 hover:text-[#f2efeb]'
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
          className="h-10 px-4 rounded-[6px] bg-[#C81E2B] hover:bg-[#A31621] text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          New Request
        </button>
      </div>

      {/* Search, Chapter, Coordinator & Date Filters */}
      <div className="flex flex-wrap gap-2.5">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-[#f2efeb]/45 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search member, chapter, locality, or #ID..."
            className="w-full h-10 pl-10 pr-3.5 rounded-[6px] border border-[#f2efeb]/10 text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
          />
        </div>
        <select
          aria-label="Filter by chapter"
          value={chapterFilter}
          onChange={(e) => setChapterFilter(e.target.value)}
          className="h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] text-xs font-medium text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
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
            className="h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] text-xs font-medium text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
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
          className="h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] text-xs text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
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
            className="h-10 px-3 rounded-[6px] border border-[#E12D39]/40 bg-[#C81E2B]/18 text-xs font-semibold text-[#E2B340] cursor-pointer"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Request Cards List — Clean Date-Grouped 2-Column Layout (SS #2) */}
      <div className="space-y-5" data-testid="requests-date-groups">
        {filteredRequests.length === 0 ? (
          <div className="p-8 rounded-xl border border-dashed border-[#f2efeb]/12 text-center text-sm text-[#f2efeb]/60">
            No requests match the current filter.
          </div>
        ) : (
          (() => {
            const groups = new Map<string, MeetingRequest[]>();
            for (const req of filteredRequests) {
              const list = groups.get(req.meetingDate) ?? [];
              list.push(req);
              groups.set(req.meetingDate, list);
            }
            const sortedDates = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));

            const assignmentModeLabel = (mode: AssignmentMode) =>
              mode === 'DIRECT_ASSIGN'
                ? 'Direct'
                : mode === 'OPEN_FIRST_CONFIRM'
                ? 'First Confirm'
                : 'Multi Interest';

            const statusBadgeStyle = (status: MeetingRequest['status'], isFilled: boolean) => {
              if (status === 'DISPUTED') {
                return { label: 'DISPUTED', cls: 'bg-red-500/14 text-red-400 border-red-500/30' };
              }
              if (status === 'CANCELLED') {
                return { label: 'CANCELLED', cls: 'bg-[#f2efeb]/8 text-[#f2efeb]/50 border-[#f2efeb]/12' };
              }
              if (status === 'VERIFIED') {
                return { label: 'VERIFIED', cls: 'bg-emerald-500/14 text-emerald-400 border-emerald-500/30' };
              }
              if (status === 'COMPLETED_SELF_REPORTED') {
                return { label: 'COMPLETED', cls: 'bg-[#E2B340]/14 text-[#E2B340] border-[#E2B340]/35' };
              }
              if (status === 'CONFIRMED' || isFilled) {
                return { label: 'FILLED', cls: 'bg-emerald-500/14 text-emerald-400 border-emerald-500/30' };
              }
              if (status === 'AWAITING_SELECTION') {
                return { label: 'REVIEW', cls: 'bg-amber-500/14 text-amber-400 border-amber-500/30' };
              }
              return { label: 'OPEN', cls: 'bg-[#C81E2B]/14 text-[#E12D39] border-[#E12D39]/30' };
            };

            return sortedDates.map((dateKey) => {
              const items = groups.get(dateKey) ?? [];
              return (
                <section key={dateKey} className="space-y-2.5">
                  <div className="flex items-center gap-2 px-0.5">
                    <h3 className="font-mono text-xs font-semibold tracking-wider text-[#f2efeb]/60">
                      {dateKey}
                    </h3>
                    <span className="text-[#f2efeb]/35">·</span>
                    <span className="font-mono text-xs font-semibold text-[#f2efeb]/50 tabular-nums">
                      {items.length}
                    </span>
                    <span className="text-[11px] text-[#f2efeb]/45 ml-1">
                      ({formatDisplayDate(dateKey)})
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {items.map((req) => {
                      const asgns = data.assignments.filter(
                        (a) => a.requestId === req.id && !['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)
                      );
                      const resps = data.responses.filter(
                        (r) => r.requestId === req.id && (r.status === 'PENDING' || r.status === 'AWAITING_APPROVAL')
                      );
                      const isFilled = asgns.length >= req.positionsRequired;
                      const badge = statusBadgeStyle(req.status, isFilled);
                      const mapHref =
                        req.mapsUrlSnapshot ||
                        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                          `${req.venueNameSnapshot} ${req.areaSnapshot}`
                        )}`;

                      return (
                        <div
                          key={req.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedRequestId(req.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedRequestId(req.id);
                            }
                          }}
                          className="w-full text-left p-4 rounded-xl border border-[#f2efeb]/10 bg-[#18181a] hover:border-[#C81E2B]/50 transition-colors cursor-pointer flex flex-col justify-between gap-3"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex items-baseline gap-1.5">
                                <span className="font-display text-[15px] font-bold text-[#f2efeb] truncate">
                                  {req.chapterNameSnapshot}
                                </span>
                                <span className="font-mono text-[11px] text-[#f2efeb]/45 shrink-0">
                                  #{req.requestNumber}
                                </span>
                              </div>
                              <span
                                className={`px-2 py-0.5 rounded-full border text-[10px] font-bold tracking-wide shrink-0 ${badge.cls}`}
                              >
                                {badge.label}
                              </span>
                            </div>

                            <p className="text-xs text-[#f2efeb]/75 truncate">
                              <span className="font-medium text-[#f2efeb]/90">{req.memberNameSnapshot}</span>
                              {asgns.length > 0 ? (
                                <>
                                  <span className="mx-1.5 text-[#f2efeb]/40">→</span>
                                  <span className="text-[#f2efeb]/85 font-medium">
                                    {asgns.map((a) => a.actualAttendeeName).join(', ')}
                                  </span>
                                  {asgns.some((a) => a.isDelegated) && (
                                    <span className="ml-1 text-[11px] text-[#E2B340] font-semibold">(Guest)</span>
                                  )}
                                </>
                              ) : (
                                <span className="ml-1.5 text-amber-400/90 font-medium">· Unassigned</span>
                              )}
                            </p>

                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#f2efeb]/55 pt-0.5">
                              <span className="inline-flex items-center gap-1 tabular-nums">
                                <Clock className="w-3.5 h-3.5 text-[#f2efeb]/45 shrink-0" />
                                {req.reportingTime}
                              </span>
                              <a
                                href={mapHref}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title={`Open ${req.venueNameSnapshot} on Maps`}
                                aria-label={`Open ${req.venueNameSnapshot} on Google Maps`}
                                className="inline-flex items-center gap-1 hover:text-[#E2B340] transition-colors min-w-0 truncate"
                              >
                                <MapPin className="w-3.5 h-3.5 text-[#E2B340]/85 shrink-0" />
                                <span className="truncate">{req.venueNameSnapshot}</span>
                              </a>
                            </div>
                          </div>

                          <div className="pt-2.5 border-t border-[#f2efeb]/10 flex items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2 min-w-0 truncate text-[#f2efeb]/55">
                              <span className="font-medium text-[#f2efeb]/75">
                                {assignmentModeLabel(req.assignmentMode)}
                              </span>
                              {resps.length > 0 && (
                                <span className="text-[#E2B340] font-semibold">
                                  · {resps.length} awaiting
                                </span>
                              )}
                              {isAdmin && (
                                <span className="truncate text-[11px] text-[#f2efeb]/45">
                                  · {coordName(req.sourcedViaCoordinatorId ?? req.coordinatorId)}
                                </span>
                              )}
                            </div>
                            <div className="shrink-0 flex items-baseline gap-2 tabular-nums">
                              <span className="text-[11px] text-[#f2efeb]/45">
                                Bill {formatINR(req.memberFee)}
                              </span>
                              <span className="font-display text-sm font-bold text-[#f2efeb]">
                                {formatINR(req.offeredPayout)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            });
          })()
        )}
      </div>

      {/* CREATE REQUEST MODAL */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="New Request"
        >
          <div className="w-full sm:max-w-xl bg-[#18181a] rounded-t-lg sm:rounded-lg border border-[#f2efeb]/10 max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f2efeb]/10 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-[#f2efeb]">New Request</h2>
                <p className="text-xs text-[#f2efeb]/60">Auto-fills linked chapter, venue, times, intro &amp; fee</p>
              </div>
              <button
                type="button"
                aria-label="Close new request modal"
                onClick={() => setCreateOpen(false)}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-[#f2efeb]/60 hover:bg-[#18181a]/[0.05]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
              {formError && (
                <div role="alert" className="p-3 rounded-lg bg-red-500/12 border border-red-500/35 text-xs font-medium text-red-400">
                  {formError}
                </div>
              )}

              {/* Chapter or Member Typeahead (minimum 3 characters before matches appear) */}
              <div className="space-y-2">
                <label htmlFor="req-member-search" className="block text-xs font-semibold text-[#f2efeb]">
                  Going For (Type Chapter or Member Name) *
                </label>

                {selectedMember ? (
                  <div
                    data-testid="selected-member-card"
                    className="p-3 rounded-[6px] border border-[#E2B340]/45 bg-[#1f1f23] flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#f2efeb] truncate">
                        {selectedMember.name}
                      </p>
                      <p className="text-xs text-[#f2efeb]/65 truncate mt-0.5">
                        {chapterNameInfo || scopedChapter?.name || 'Chapter'} · {selectedMember.businessCategory}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMemberId('');
                        setMemberSearchQuery('');
                      }}
                      className="h-8 px-2.5 rounded-[4px] border border-[#f2efeb]/15 bg-[#18181a] hover:bg-white/[0.06] text-xs font-semibold text-[#E2B340] shrink-0 cursor-pointer"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {scopedChapter && (
                      <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-[6px] border border-[#E2B340]/35 bg-[#E2B340]/10 text-xs">
                        <span className="text-[#f2efeb] truncate">
                          Chapter scope: <strong className="text-[#E2B340]">{scopedChapter.name}</strong>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setScopedChapterId('');
                            setChapterNameInfo('');
                            setChapterWeekdayInfo('');
                          }}
                          className="text-[11px] font-semibold text-[#f2efeb]/75 hover:text-[#f2efeb] cursor-pointer shrink-0"
                        >
                          Clear chapter
                        </button>
                      </div>
                    )}

                    <div className="relative">
                      <Search className="w-4 h-4 text-[#f2efeb]/45 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="req-member-search"
                        data-testid="req-chapter-member-search"
                        type="text"
                        autoComplete="off"
                        value={memberSearchQuery}
                        onChange={(e) => setMemberSearchQuery(e.target.value)}
                        placeholder={
                          scopedChapter
                            ? `Type 3+ characters of a member in ${scopedChapter.name}...`
                            : 'Type at least 3 characters of chapter or member name...'
                        }
                        className="w-full h-11 pl-9 pr-3.5 rounded-[6px] border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] placeholder:text-[#f2efeb]/40 focus:outline-none focus:border-[#E2B340]"
                      />
                    </div>

                    {!typeaheadMatches.ready ? (
                      <p
                        data-testid="typeahead-min-chars-hint"
                        className="text-[11px] text-[#f2efeb]/55"
                      >
                        {memberSearchQuery.trim().length === 0
                          ? 'Start typing a Chapter or Member name — suggestions appear after 3 characters.'
                          : `Type ${3 - memberSearchQuery.trim().length} more character${
                              3 - memberSearchQuery.trim().length === 1 ? '' : 's'
                            } to show matching chapters & members (${memberSearchQuery.trim().length}/3).`}
                      </p>
                    ) : (
                      <div
                        data-testid="typeahead-results"
                        className="rounded-[6px] border border-[#f2efeb]/12 bg-[#111113] divide-y divide-[#f2efeb]/10 max-h-56 overflow-y-auto"
                      >
                        {typeaheadMatches.chapters.length > 0 && (
                          <div className="p-2 space-y-1">
                            <p className="px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[#E2B340]">
                              Matching Chapters ({typeaheadMatches.chapters.length})
                            </p>
                            {typeaheadMatches.chapters.map((chap) => {
                              const count = data.members.filter(
                                (m) => m.active && m.chapterId === chap.id
                              ).length;
                              return (
                                <button
                                  key={chap.id}
                                  type="button"
                                  onClick={() => handleSelectChapterScope(chap.id)}
                                  className="w-full px-2.5 py-2 rounded-[4px] hover:bg-[#1f1f23] text-left flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer"
                                >
                                  <span className="font-semibold text-[#f2efeb] truncate">
                                    {chap.name}
                                  </span>
                                  <span className="text-[11px] text-[#f2efeb]/55 shrink-0">
                                    {chap.region} · {count} member{count === 1 ? '' : 's'}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {typeaheadMatches.members.length > 0 && (
                          <div className="p-2 space-y-1">
                            <p className="px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[#E12D39]">
                              Matching Members ({typeaheadMatches.members.length})
                            </p>
                            {typeaheadMatches.members.map(({ member, chapterName }) => (
                              <button
                                key={member.id}
                                type="button"
                                onClick={() => handleMemberChange(member.id)}
                                className="w-full px-2.5 py-2 rounded-[4px] hover:bg-[#C81E2B]/15 text-left flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer"
                              >
                                <div className="min-w-0">
                                  <p className="font-semibold text-[#f2efeb] truncate">
                                    {member.name}
                                  </p>
                                  <p className="text-[11px] text-[#f2efeb]/60 truncate">
                                    {chapterName} · {member.businessCategory}
                                  </p>
                                </div>
                                <span className="text-[11px] font-semibold text-[#E2B340] shrink-0">
                                  Select
                                </span>
                              </button>
                            ))}
                          </div>
                        )}

                        {typeaheadMatches.chapters.length === 0 &&
                          typeaheadMatches.members.length === 0 && (
                            <p className="p-3 text-xs text-[#f2efeb]/55 text-center">
                              No matching chapters or members found for &ldquo;{memberSearchQuery.trim()}&rdquo;.
                            </p>
                          )}
                      </div>
                    )}
                  </div>
                )}

                {chapterNameInfo && (
                  <p className="text-xs text-[#f2efeb]/70">
                    Linked chapter: <strong className="text-[#f2efeb]">{chapterNameInfo}</strong> · Saved regular weekday:{' '}
                    <strong className="text-[#E2B340]">{chapterWeekdayInfo}</strong> (informational only; date defaults to tomorrow)
                  </p>
                )}
              </div>

              {/* Editable Date (Defaults to Tomorrow in Asia/Kolkata) & Positions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="req-date" className="block text-xs font-semibold text-[#f2efeb] mb-1.5">
                    Meeting Date (Tomorrow Default) *
                  </label>
                  <input
                    id="req-date"
                    type="date"
                    value={meetingDate}
                    onChange={(e) => setMeetingDate(e.target.value)}
                    required
                    className="w-full h-11 px-3.5 rounded-[6px] border border-[#f2efeb]/10 text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                  />
                </div>
                <div>
                  <label htmlFor="req-positions" className="block text-xs font-semibold text-[#f2efeb] mb-1.5">
                    Required Positions
                  </label>
                  <input
                    id="req-positions"
                    type="number"
                    min={1}
                    max={10}
                    value={positionsRequired}
                    onChange={(e) => setPositionsRequired(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full h-11 px-3.5 rounded-[6px] border border-[#f2efeb]/10 text-sm tabular-nums text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                  />
                </div>
              </div>

              {/* Assignment Mode */}
              <div>
                <span className="block text-xs font-semibold text-[#f2efeb] mb-1.5">Assignment Mode</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'MULTI_INTEREST', label: 'Multiple Interests', sub: 'Select from Veloctive Team' },
                      { id: 'FIRST_CONFIRM', label: 'First Confirm', sub: 'Auto-locks first eligible' },
                      { id: 'DIRECT', label: 'Direct Assign', sub: 'Pick Veloctive Team now' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setAssignmentMode(m.id)}
                      className={`p-2.5 rounded-[6px] border text-left transition-colors cursor-pointer ${
                        assignmentMode === m.id
                          ? 'border-[#C81E2B] bg-[#C81E2B]/18'
                          : 'border-[#f2efeb]/10 bg-[#18181a] hover:bg-[#18181a]/[0.05]'
                      }`}
                    >
                      <p className="text-xs font-bold text-[#f2efeb]">{m.label}</p>
                      <p className="text-[11px] text-[#f2efeb]/60 mt-0.5">{m.sub}</p>
                    </button>
                  ))}
                </div>
              </div>

              {assignmentMode === 'DIRECT' && (
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1.5">
                    Select Veloctive Team Member(s) (up to {positionsRequired})
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto p-2 rounded-[6px] border border-[#f2efeb]/10 bg-[#1f1f23]">
                    {data.substitutes
                      .filter((s) => s.active)
                      .map((sub) => {
                        const checked = directSubIds.includes(sub.id);
                        return (
                          <label
                            key={sub.id}
                            className="flex items-center gap-2 text-xs text-[#f2efeb] p-1.5 rounded-lg hover:bg-[#18181a]/[0.06] cursor-pointer"
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
                              className="accent-[#C81E2B]"
                            />
                            <span className="truncate font-medium">{sub.name}</span>
                            <span className="text-[#f2efeb]/60 ml-auto shrink-0 tabular-nums">₹{sub.defaultPayout}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Member Charge & Offered Payout */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="req-fee" className="block text-xs font-semibold text-[#f2efeb] mb-1.5">
                    Member Charge (₹)
                  </label>
                  <input
                    id="req-fee"
                    type="number"
                    min={0}
                    value={memberFee}
                    onChange={(e) => setMemberFee(Number(e.target.value) || 0)}
                    className="w-full h-11 px-3.5 rounded-[6px] border border-[#f2efeb]/10 text-sm tabular-nums text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                  />
                </div>
                <div>
                  <label htmlFor="req-payout" className="block text-xs font-semibold text-[#f2efeb] mb-1.5">
                    Offered Payout (₹)
                  </label>
                  <input
                    id="req-payout"
                    type="number"
                    min={0}
                    value={offeredPayout}
                    onChange={(e) => setOfferedPayout(Number(e.target.value) || 0)}
                    className="w-full h-11 px-3.5 rounded-[6px] border border-[#f2efeb]/10 text-sm tabular-nums text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                  />
                </div>
              </div>

              {/* Optional Member Note for Veloctive Team with Dropdown Type Selector */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <label htmlFor="req-referral-ask" className="block text-xs font-semibold text-[#f2efeb]">
                      Member note for Veloctive Team{' '}
                      <span className="font-normal text-[#f2efeb]/55">(Optional)</span>
                    </label>
                    {memberNoteType === 'REFERRAL_ROUND' && selectedMember?.referralAsk && (
                      <button
                        type="button"
                        onClick={() => setReferralAsk(selectedMember.referralAsk)}
                        className="text-[11px] font-semibold text-[#E2B340] hover:underline cursor-pointer"
                      >
                        Use saved ask
                      </button>
                    )}
                  </div>
                  <select
                    id="req-member-note-type"
                    aria-label="Member note type"
                    value={memberNoteType}
                    onChange={(e) => setMemberNoteType(e.target.value as MemberNoteType)}
                    className="h-8 px-2.5 rounded-[6px] border border-[#f2efeb]/15 bg-[#1f1f23] text-xs font-semibold text-[#f2efeb] focus:outline-none focus:border-[#C81E2B] cursor-pointer"
                  >
                    {MEMBER_NOTE_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  id="req-referral-ask"
                  rows={2}
                  value={referralAsk}
                  onChange={(e) => setReferralAsk(e.target.value)}
                  placeholder={
                    MEMBER_NOTE_TYPE_OPTIONS.find((o) => o.value === memberNoteType)?.placeholder ??
                    'Anything the team member should know'
                  }
                  className="w-full p-3 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] text-xs text-[#f2efeb] placeholder:text-[#f2efeb]/35 focus:outline-none focus:border-[#C81E2B]"
                />
                <p className="text-[11px] text-[#f2efeb]/50 mt-1">
                  This note appears in the team member&apos;s meeting details once assigned.
                </p>
              </div>

              {/* Collapsed More Details (Request-Only Overrides) */}
              <div className="border-t border-[#f2efeb]/10 pt-3">
                <button
                  type="button"
                  aria-expanded={showMoreDetails}
                  onClick={() => setShowMoreDetails((p) => !p)}
                  className="w-full flex items-center justify-between text-xs font-semibold text-[#E2B340] py-1 cursor-pointer"
                >
                  <span>More Details (Venue, Schedule, Intro, Source &amp; Overrides)</span>
                  {showMoreDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {showMoreDetails && (
                  <div className="mt-3 space-y-3 bg-[#1f1f23] p-3.5 rounded-[6px] border border-[#f2efeb]/10">
                    <p className="text-[11px] text-[#f2efeb]/60">
                      Edits below apply as a snapshot for this request only and do not overwrite saved Member, Chapter, or Location masters.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Venue Override</label>
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
                          className="w-full h-10 px-3 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs text-[#f2efeb]"
                        >
                          {data.locations.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name} ({l.area})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Received From</label>
                        <input
                          type="text"
                          value={receivedFrom}
                          onChange={(e) => setReceivedFrom(e.target.value)}
                          className="w-full h-10 px-3 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs text-[#f2efeb]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-[#f2efeb] mb-1">Reporting</label>
                        <input
                          type="text"
                          value={reportingTime}
                          onChange={(e) => setReportingTime(e.target.value)}
                          className="w-full h-9 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-[#f2efeb] mb-1">Start</label>
                        <input
                          type="text"
                          value={startTime}
                          onChange={(e) => setStartTime(e.target.value)}
                          className="w-full h-9 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-[#f2efeb] mb-1">End</label>
                        <input
                          type="text"
                          value={endTime}
                          onChange={(e) => setEndTime(e.target.value)}
                          className="w-full h-9 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#f2efeb] mb-1">
                        Private 30-Second Intro (Unlocked only after confirmation)
                      </label>
                      <textarea
                        rows={3}
                        value={intro30Sec}
                        onChange={(e) => setIntro30Sec(e.target.value)}
                        className="w-full p-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs text-[#f2efeb]"
                      />
                    </div>

                    {/* Distinct Source & Coordinator Attribution */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-[#f2efeb]/10">
                      <div>
                        <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Received From Type</label>
                        <select
                          value={receivedFromType}
                          onChange={(e) => setReceivedFromType(e.target.value as ReceivedFromType)}
                          className="w-full h-10 px-3 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs text-[#f2efeb]"
                        >
                          <option value="DIRECT_MEMBER">Direct Member</option>
                          <option value="EXTERNAL_COORDINATOR">External Coordinator</option>
                          <option value="SUBSTITUTE">Substitute Referral</option>
                          <option value="EXCHANGE">Chapter Exchange</option>
                          <option value="OTHER">Other Source</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#f2efeb] mb-1">
                          Sourced Via Coordinator (Attribution)
                        </label>
                        <select
                          value={sourcedViaCoordinatorId}
                          onChange={(e) => setSourcedViaCoordinatorId(e.target.value)}
                          className="w-full h-10 px-3 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs text-[#f2efeb]"
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
                      <div className="space-y-2.5 pt-1 border-t border-[#f2efeb]/10">
                        <div>
                          <label className="block text-xs font-semibold text-[#f2efeb] mb-1">
                            Responsible / Owner Coordinator
                          </label>
                          <select
                            value={responsibleCoordinatorId}
                            onChange={(e) => setResponsibleCoordinatorId(e.target.value)}
                            className="w-full h-10 px-3 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs text-[#f2efeb]"
                          >
                            <option value="">Auto (Member&apos;s Owner / Current Admin)</option>
                            {data.coordinatorDirectory.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="p-3 rounded-lg bg-[#18181a] border border-[#f2efeb]/10 space-y-2">
                          <label className="flex items-start gap-2 text-xs text-[#f2efeb] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={commissionEnabled}
                              onChange={(e) => {
                                setCommissionEnabled(e.target.checked);
                                if (!e.target.checked) setCommissionAmount(0);
                              }}
                              className="mt-0.5 accent-[#C81E2B]"
                            />
                            <div>
                              <span className="font-semibold">Approve Coordinator Commission (Optional)</span>
                              <p className="text-[11px] text-[#f2efeb]/60">
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
                              className="w-full h-9 px-3 rounded-lg border border-[#f2efeb]/10 text-xs tabular-nums"
                            />
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-4 pt-1 text-xs text-[#f2efeb]">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allowBids}
                          onChange={(e) => setAllowBids(e.target.checked)}
                          className="accent-[#C81E2B]"
                        />
                        Allow price bids
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={requireManagerApproval}
                          onChange={(e) => setRequireManagerApproval(e.target.checked)}
                          className="accent-[#C81E2B]"
                        />
                        Require manager review on First-Confirm
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={urgency === 'URGENT'}
                          onChange={(e) => setUrgency(e.target.checked ? 'URGENT' : 'NORMAL')}
                          className="accent-[#C81E2B]"
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
                  className="h-11 px-4 rounded-[6px] border border-[#f2efeb]/10 text-sm font-semibold text-[#f2efeb]/70 hover:bg-[#18181a]/[0.05]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="h-11 px-5 rounded-[6px] bg-[#C81E2B] hover:bg-[#A31621] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
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
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label={`Request ${selectedRequest.requestNumber} details`}
        >
          <div className="w-full max-w-xl bg-[#18181a] h-full border-l border-[#f2efeb]/10 flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f2efeb]/10 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-mono text-[#f2efeb]/60">
                  Request #{selectedRequest.requestNumber} · {selectedRequest.status.replace(/_/g, ' ')}
                </p>
                <h2 className="font-display text-base font-bold text-[#f2efeb] truncate">
                  {selectedRequest.chapterNameSnapshot} · {formatDisplayDate(selectedRequest.meetingDate)}
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close request details"
                onClick={() => setSelectedRequestId(null)}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-[#f2efeb]/60 hover:bg-[#18181a]/[0.05]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Distinct Source & Coordinator Provenance Block */}
              <div className="p-4 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-[#f2efeb]/60">Going For (Member)</span>
                  <p className="font-semibold text-[#f2efeb] mt-0.5">{selectedRequest.memberNameSnapshot}</p>
                </div>
                <div>
                  <span className="text-[#f2efeb]/60">Received From ({selectedRequest.receivedFromType.replace(/_/g, ' ')})</span>
                  <p className="font-semibold text-[#f2efeb] mt-0.5">{selectedRequest.receivedFrom}</p>
                </div>
                <div>
                  <span className="text-[#f2efeb]/60">Responsible Coordinator</span>
                  <p className="font-semibold text-[#f2efeb] mt-0.5">{coordName(selectedRequest.coordinatorId)}</p>
                </div>
                <div>
                  <span className="text-[#f2efeb]/60">Sourced / Assigned Via</span>
                  <p className="font-semibold text-[#E2B340] mt-0.5">
                    {coordName(selectedRequest.sourcedViaCoordinatorId ?? selectedRequest.coordinatorId)}
                  </p>
                </div>
                <div>
                  <span className="text-[#f2efeb]/60">Venue &amp; Timing</span>
                  <p className="font-semibold text-[#f2efeb] mt-0.5">
                    {selectedRequest.venueNameSnapshot} · {selectedRequest.reportingTime}
                  </p>
                </div>
                <div>
                  <span className="text-[#f2efeb]/60">Pricing &amp; Commission</span>
                  <p className="font-semibold text-[#f2efeb] mt-0.5 tabular-nums">
                    Bill {formatINR(selectedRequest.memberFee)} · Pay {formatINR(selectedRequest.offeredPayout)}
                  </p>
                  <p className="text-[11px] text-[#f2efeb]/60 mt-0.5 tabular-nums">
                    Coord. Commission:{' '}
                    {selectedRequest.coordinatorCommissionEnabled && selectedRequest.coordinatorCommissionAmount > 0 ? (
                      <strong className="text-[#E2B340]">
                        {formatINR(selectedRequest.coordinatorCommissionAmount)} Approved
                      </strong>
                    ) : (
                      <span>₹0 (None)</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Member Intro Snapshot, Optional Referral/Ask & Venue Map */}
              <div className="space-y-3 text-xs">
                <div>
                  <p className="font-semibold text-[#f2efeb] mb-1.5">30-Second Member Briefing (Snapshot)</p>
                  <p className="p-3 rounded-[6px] border border-[#f2efeb]/10 text-[#f2efeb]/80 leading-relaxed">
                    {selectedRequest.intro30SecSnapshot || 'No introduction saved.'}
                  </p>
                </div>

                {/* Optional Member Note (General note / Referral round / Special instruction) */}
                <div className="p-3.5 rounded-[6px] bg-[#E2B340]/[0.06] border border-[#E2B340]/30 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-[#E2B340]">
                      {selectedRequest.referralAskSnapshot
                        ? getMemberNoteTypeLabel(selectedRequest.memberNoteType)
                        : 'Member note for Veloctive Team'}{' '}
                      <span className="font-normal text-[#f2efeb]/55">(Optional)</span>
                    </p>
                    <div className="flex items-center gap-2">
                      {!editingReferralAsk && selectedRequest.referralAskSnapshot && selectedAssignments.length > 0 && (() => {
                        const activeAsgn = selectedAssignments.find(
                          (a) => a.status !== 'CANCELLED' && a.status !== 'REPLACED'
                        );
                        const activeSub = activeAsgn
                          ? data.substitutes.find((s) => s.id === activeAsgn.contractSubstituteId)
                          : null;
                        if (!activeSub) return null;
                        return (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenDraft({
                                templateType: 'REFERRAL_ASK_SHARE',
                                title: `Share ${getMemberNoteTypeLabel(selectedRequest.memberNoteType)} to ${activeSub.name}`,
                                recipientLabel: `${activeSub.name} (Veloctive Team)`,
                                recipientPhone: activeSub.whatsappPhone || activeSub.phone,
                                defaultBody: buildReferralAskWhatsAppText(
                                  selectedRequest.chapterNameSnapshot,
                                  selectedRequest.meetingDate,
                                  selectedRequest.referralAskSnapshot!,
                                  selectedRequest.memberNoteType
                                ),
                              })
                            }
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:underline cursor-pointer"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            Send WA
                          </button>
                        );
                      })()}
                      {!editingReferralAsk && (
                        <button
                          type="button"
                          onClick={() => {
                            setReferralAskTypeDraft(selectedRequest.memberNoteType ?? 'GENERAL_NOTE');
                            setReferralAskDraft(selectedRequest.referralAskSnapshot ?? '');
                            setEditingReferralAsk(true);
                          }}
                          className="text-[11px] font-semibold text-[#f2efeb] hover:text-[#E2B340] cursor-pointer"
                        >
                          {selectedRequest.referralAskSnapshot ? 'Edit' : '+ Add note'}
                        </button>
                      )}
                    </div>
                  </div>

                  {editingReferralAsk ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-[#f2efeb]/65">Note category</span>
                        <select
                          aria-label="Edit member note type"
                          value={referralAskTypeDraft}
                          onChange={(e) => setReferralAskTypeDraft(e.target.value as MemberNoteType)}
                          className="h-8 px-2.5 rounded-[5px] border border-[#E2B340]/35 bg-[#111113] text-xs font-semibold text-[#f2efeb] focus:outline-none focus:border-[#E2B340] cursor-pointer"
                        >
                          {MEMBER_NOTE_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <textarea
                        rows={2}
                        aria-label="Member note for Veloctive Team"
                        value={referralAskDraft}
                        onChange={(e) => setReferralAskDraft(e.target.value)}
                        placeholder={
                          MEMBER_NOTE_TYPE_OPTIONS.find((o) => o.value === referralAskTypeDraft)?.placeholder ??
                          'Anything the team member should know'
                        }
                        className="w-full p-2.5 rounded-[5px] border border-[#E2B340]/35 bg-[#111113] text-xs text-[#f2efeb] placeholder:text-[#f2efeb]/40 focus:outline-none focus:border-[#E2B340]"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingReferralAsk(false)}
                          className="h-8 px-3 rounded-[5px] border border-[#f2efeb]/15 text-[11px] font-semibold text-[#f2efeb]/70 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await api.updateRequestReferralAsk(
                                selectedRequest.id,
                                referralAskDraft,
                                referralAskTypeDraft
                              );
                              await onRefresh();
                              setEditingReferralAsk(false);
                              setActionMessage(
                                referralAskDraft.trim()
                                  ? `${getMemberNoteTypeLabel(referralAskTypeDraft)} saved & shared with confirmed team member.`
                                  : 'Member note cleared.'
                              );
                            } catch (err) {
                              setActionMessage(err instanceof ApiError ? err.message : 'Failed to save member note.');
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="h-8 px-3 rounded-[5px] bg-[#E2B340] hover:bg-[#d1a230] text-[#111113] text-[11px] font-bold cursor-pointer disabled:opacity-60"
                        >
                          {busy ? 'Saving...' : 'Save & Share'}
                        </button>
                      </div>
                    </div>
                  ) : selectedRequest.referralAskSnapshot ? (
                    <p className="text-[#f2efeb]/90 leading-relaxed">{selectedRequest.referralAskSnapshot}</p>
                  ) : (
                    <p className="text-[#f2efeb]/50 italic">
                      No note attached yet. Click &ldquo;+ Add note&rdquo; to attach a General note, Referral round ask, or Special instruction once assigned.
                    </p>
                  )}
                </div>

                {selectedRequest.mapsUrlSnapshot && (
                  <a
                    href={selectedRequest.mapsUrlSnapshot}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[#E2B340] font-semibold hover:underline"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    Open Venue Maps Link
                  </a>
                )}
              </div>

              {/* Confirmed Assignments & Accountability */}
              <div className="space-y-3">
                <h3 className="font-display text-sm font-bold text-[#f2efeb]">
                  Assignments ({selectedAssignments.length}/{selectedRequest.positionsRequired})
                </h3>
                {selectedAssignments.length === 0 ? (
                  <p className="text-xs text-[#f2efeb]/60">No substitute confirmed yet.</p>
                ) : (
                  selectedAssignments.map((asgn) => {
                    const contractSub = data.substitutes.find((s) => s.id === asgn.contractSubstituteId);
                    const coord = data.coordinators.find((c) => c.id === selectedRequest.coordinatorId);
                    return (
                      <div key={asgn.id} className="p-4 rounded-[6px] border border-[#f2efeb]/10 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-bold text-[#f2efeb]">
                              Actual Attendee: {asgn.actualAttendeeName}
                              {asgn.isCrossMeeting && (
                                <span className="ml-2 text-[11px] font-semibold text-[#E2B340]">
                                  · Cross-Meeting Approved
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-[#f2efeb]/70 mt-0.5">
                              Contracted Payee:{' '}
                              <strong className="text-[#f2efeb]">{contractSub?.name ?? asgn.contractSubstituteId}</strong>
                              {asgn.isDelegated && ' · Delegated Guest (Partner accountable)'}
                            </p>
                          </div>
                          <span className="text-xs font-bold text-[#E2B340] tabular-nums">
                            {formatINR(asgn.agreedPayout)}
                          </span>
                        </div>

                        <div className="text-xs text-[#f2efeb]/70 flex flex-wrap gap-x-3 gap-y-1">
                          <span>Status: <strong className="text-[#f2efeb]">{asgn.status.replace(/_/g, ' ')}</strong></span>
                          <span>Check-in: <strong className="text-[#f2efeb]">{asgn.checkinState.replace(/_/g, ' ')}</strong></span>
                          <span>Assigned Via: <strong className="text-[#E2B340]">{coordName(asgn.assignedViaCoordinatorId)}</strong></span>
                          {asgn.coordinatorCommissionAmount > 0 && (
                            <span className="text-[#E2B340] font-semibold">
                              Approved Comm: {formatINR(asgn.coordinatorCommissionAmount)}
                            </span>
                          )}
                          {(asgn.lastCheckinReportedByPartner || asgn.finishedReportedByPartner) && (
                            <span className="text-[#E2B340] font-semibold">
                              Reported by Partner {contractSub?.name ?? ''} for Guest {asgn.actualAttendeeName}
                            </span>
                          )}
                        </div>
                        {asgn.status === 'REPLACED' && asgn.replacementReason && (
                          <p className="text-[11px] text-amber-400 bg-amber-500/12 px-2.5 py-1.5 rounded-lg">
                            Replaced (History Preserved): {asgn.replacementReason}
                          </p>
                        )}

                        {asgn.meetingNotes && (
                          <div className="p-3 rounded-lg bg-[#1f1f23] text-xs text-[#f2efeb]/80 space-y-1">
                            {asgn.meetingNotes.referralsGiven && <p><strong>Referrals:</strong> {asgn.meetingNotes.referralsGiven}</p>}
                            {asgn.meetingNotes.peopleMet && <p><strong>People Met:</strong> {asgn.meetingNotes.peopleMet}</p>}
                            {asgn.meetingNotes.highlights && <p><strong>Highlights:</strong> {asgn.meetingNotes.highlights}</p>}
                            {asgn.meetingNotes.earlyFinishReason && (
                              <p className="text-amber-400"><strong>Early Finish Reason:</strong> {asgn.meetingNotes.earlyFinishReason}</p>
                            )}
                          </div>
                        )}

                        {asgn.disputed && (
                          <div className="p-3 rounded-lg bg-red-500/12 border border-red-500/35 text-xs text-red-400 space-y-2">
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
                                className="h-9 px-2.5 rounded-lg border border-red-500/35 bg-[#18181a] text-xs text-[#f2efeb]"
                              />
                              <input
                                type="number"
                                value={adjustEarningDelta}
                                onChange={(e) => setAdjustEarningDelta(e.target.value)}
                                placeholder="Payout Δ (e.g. -100)"
                                className="h-9 px-2.5 rounded-lg border border-red-500/35 bg-[#18181a] text-xs text-[#f2efeb]"
                              />
                            </div>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={adjustReason}
                                onChange={(e) => setAdjustReason(e.target.value)}
                                placeholder="Audited adjustment reason..."
                                className="flex-1 h-9 px-2.5 rounded-lg border border-red-500/35 bg-[#18181a] text-xs text-[#f2efeb]"
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
                                defaultBody: buildMemberConfirmationWhatsAppText({
                                  chapterName: selectedRequest.chapterNameSnapshot,
                                  meetingDate: selectedRequest.meetingDate,
                                  reportingTime: selectedRequest.reportingTime,
                                  attendeeName: asgn.actualAttendeeName,
                                  coordinatorName: coord?.name ?? 'Coordinator',
                                }),
                              })
                            }
                            className="h-9 px-3 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] hover:bg-[#18181a]/[0.05] text-xs font-semibold text-[#f2efeb] inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
                            Member WhatsApp
                          </button>

                          {(asgn.status === 'COMPLETED_SELF_REPORTED' || asgn.disputed) && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleVerify(asgn.id)}
                              className="h-9 px-3 rounded-lg bg-[#C81E2B] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
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
                              className="h-9 px-3 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] hover:bg-[#18181a]/[0.05] text-xs font-semibold text-[#f2efeb]/70 inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              Replace Attendee
                            </button>
                          )}

                          {replaceAsgnId === asgn.id && (
                            <div className="w-full p-3 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10 space-y-2 mt-1">
                              <p className="text-[11px] font-semibold text-[#f2efeb]">
                                Replace Attendee (old record marked REPLACED &amp; history preserved)
                              </p>
                              <input
                                type="text"
                                value={replaceReason}
                                onChange={(e) => setReplaceReason(e.target.value)}
                                placeholder="Reason for replacement *"
                                className="w-full h-9 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs"
                              />
                              <select
                                value={replaceSubId}
                                onChange={(e) => setReplaceSubId(e.target.value)}
                                className="w-full h-9 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs"
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
                                  className="h-8 px-3 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  disabled={busy || !replaceReason.trim()}
                                  onClick={() => handleReplaceAssignment(asgn.id)}
                                  className="h-8 px-3 rounded-lg bg-[#C81E2B] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
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
                                className="flex-1 h-9 px-2.5 rounded-lg border border-[#f2efeb]/10 text-xs"
                              />
                              <button
                                type="button"
                                disabled={busy || !disputeReason.trim()}
                                onClick={() => handleDispute(asgn.id)}
                                className="h-9 px-3 rounded-lg border border-red-500/35 text-red-400 hover:bg-red-500/12 disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
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
                <h3 className="font-display text-sm font-bold text-[#f2efeb]">
                  Candidate Responses ({selectedResponses.length})
                </h3>
                {selectedResponses.length === 0 ? (
                  <p className="text-xs text-[#f2efeb]/60">No substitute responses recorded yet.</p>
                ) : (
                  selectedResponses.map((resp) => {
                    const sub = data.substitutes.find((s) => s.id === resp.substituteId);
                    const canDecide =
                      (resp.status === 'PENDING' || resp.status === 'AWAITING_APPROVAL') &&
                      selectedAssignments.length < selectedRequest.positionsRequired;
                    return (
                      <div key={resp.id} className="p-3.5 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-bold text-[#f2efeb]">
                              {sub?.name ?? resp.substituteId}
                              {resp.delegatedGuestName && (
                                <span className="text-[#E2B340]"> → Guest: {resp.delegatedGuestName}</span>
                              )}
                            </p>
                            <p className="text-xs text-[#f2efeb]/60 mt-0.5">
                              {resp.responseType.replace(/_/g, ' ')}
                              {resp.proposedPayout ? ` · Offered Bid ${formatINR(resp.proposedPayout)}` : ` · Standard ${formatINR(selectedRequest.offeredPayout)}`}
                              {' · '}
                              <strong className="text-[#f2efeb]">{resp.status.replace(/_/g, ' ')}</strong>
                            </p>
                          </div>
                        </div>
                        {resp.isCrossMeetingRequest && (
                          <div className="px-2.5 py-1.5 rounded-[5px] bg-[#E2B340]/12 border border-[#E2B340]/35 text-[11px] font-medium text-[#F5DFA0]">
                            Pinned Cross-Meeting Request · Already booked on this date at{' '}
                            <strong>
                              {resp.crossMeetingConflictChapter ?? 'another chapter'}
                              {resp.crossMeetingConflictTime ? ` (${resp.crossMeetingConflictTime})` : ''}
                            </strong>
                            . Super Admin approval required.
                          </div>
                        )}
                        {resp.note && <p className="text-xs text-[#f2efeb]/70">{resp.note}</p>}
                        {canDecide && (
                          <div className="space-y-2 pt-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {resp.isCrossMeetingRequest && !isAdmin ? (
                                <span className="h-9 px-3 rounded-lg border border-[#E2B340]/35 bg-[#E2B340]/10 text-[#E2B340] text-xs font-semibold inline-flex items-center">
                                  Super Admin Approval Required
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleApproveCandidate(resp.id, resp.proposedPayout)}
                                  className="h-9 px-3.5 rounded-lg bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  {resp.isCrossMeetingRequest
                                    ? 'Allow Cross-Meeting'
                                    : resp.responseType === 'DELEGATE_PROPOSAL'
                                    ? 'Approve Guest & Confirm'
                                    : resp.responseType === 'BID'
                                    ? `Accept Bid (${formatINR(resp.proposedPayout || 0)})`
                                    : 'Select & Confirm'}
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setChangeRequestRespId(changeRequestRespId === resp.id ? null : resp.id);
                                  setChangeRequestNote('');
                                }}
                                className="h-9 px-3 rounded-lg border border-[#f2efeb]/10 text-xs font-semibold text-[#f2efeb] hover:bg-[#18181a]/[0.05] cursor-pointer"
                              >
                                Request Changes
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleRejectCandidate(resp.id)}
                                className="h-9 px-3 rounded-lg border border-[#f2efeb]/10 text-xs font-semibold text-[#f2efeb]/60 hover:text-red-400 cursor-pointer"
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
                                  className="flex-1 h-9 px-2.5 rounded-lg border border-[#f2efeb]/10 text-xs"
                                />
                                <button
                                  type="button"
                                  disabled={busy || !changeRequestNote.trim()}
                                  onClick={() => handleRequestChanges(resp.id)}
                                  className="h-9 px-3 rounded-lg bg-[#27272d] text-white text-xs font-semibold cursor-pointer"
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

              <div className="pt-4 border-t border-[#f2efeb]/10 flex flex-wrap items-center justify-between gap-2">
                {isAdmin ? (
                  confirmDeleteReq ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-red-400">Delete test request?</span>
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
                        className="h-8 px-2.5 rounded-lg border border-[#f2efeb]/10 text-[#f2efeb]/70"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmDeleteReq(true)}
                      className="h-9 px-3 rounded-lg border border-red-500/35 text-red-400 hover:bg-red-500/12 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
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
                      className="h-9 px-3.5 rounded-lg border border-red-500/35 text-red-400 hover:bg-red-500/12 text-xs font-semibold cursor-pointer"
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
