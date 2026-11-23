import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Pin,
  X,
} from 'lucide-react';
import type { AdminBootstrapData } from '../lib/api';
import type { FinanceFilterIntent, RequestsFilterIntent } from '../App';
import { formatDisplayDate, formatINR, formatShortDate } from '../core/rules';
import type { Assignment, MeetingRequest } from '../core/types';
import { QuickSummary } from './QuickSummary';

interface OverviewHomeProps {
  data: AdminBootstrapData;
  onOpenNewRequest: () => void;
  onSelectRequest: (requestId: string) => void;
  onNavigateTab: (tab: 'requests' | 'finance' | 'people' | 'reports') => void;
  onDrillToRequests: (intent: Omit<RequestsFilterIntent, 'nonce'>) => void;
  onDrillToFinance: (intent: Omit<FinanceFilterIntent, 'nonce'>) => void;
  onVerifyAssignment: (assignmentId: string) => Promise<void>;
  onApproveResponse?: (responseId: string) => Promise<void>;
  onRejectResponse?: (responseId: string, reason?: string) => Promise<void>;
}

interface ChapterGroupCard {
  chapterId: string;
  chapterName: string;
  regularWeekday: string;
  requests: MeetingRequest[];
  assignedCount: number;
  pendingCount: number;
  completedCount: number;
  disputedCount: number;
  cancelledCount: number;
}

function groupByChapter(
  requests: MeetingRequest[],
  assignments: Assignment[]
): ChapterGroupCard[] {
  const map = new Map<string, ChapterGroupCard>();
  for (const req of requests) {
    let group = map.get(req.chapterId);
    if (!group) {
      group = {
        chapterId: req.chapterId,
        chapterName: req.chapterNameSnapshot,
        regularWeekday: req.chapterRegularWeekday,
        requests: [],
        assignedCount: 0,
        pendingCount: 0,
        completedCount: 0,
        disputedCount: 0,
        cancelledCount: 0,
      };
      map.set(req.chapterId, group);
    }
    group.requests.push(req);

    const liveAsgns = assignments.filter(
      (a) => a.requestId === req.id && !['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)
    );
    if (req.status === 'CANCELLED') {
      group.cancelledCount += 1;
    } else if (req.status === 'DISPUTED' || liveAsgns.some((a) => a.disputed)) {
      group.disputedCount += 1;
    } else if (req.status === 'COMPLETED_SELF_REPORTED' || req.status === 'VERIFIED') {
      group.completedCount += 1;
    } else if (liveAsgns.length >= req.positionsRequired) {
      group.assignedCount += 1;
    } else {
      group.pendingCount += 1;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.requests.length - a.requests.length);
}

export const OverviewHome: React.FC<OverviewHomeProps> = ({
  data,
  onOpenNewRequest,
  onSelectRequest,
  onDrillToRequests,
  onDrillToFinance,
  onVerifyAssignment,
  onApproveResponse,
  onRejectResponse,
}) => {
  const [expandedTomorrowIds, setExpandedTomorrowIds] = useState<Record<string, boolean>>({});
  const [expandedPreviousIds, setExpandedPreviousIds] = useState<Record<string, boolean>>({});
  const [prevFilter, setPrevFilter] = useState<'ALL' | 'COMPLETED' | 'REVIEW'>('ALL');
  const [prevDateFilter, setPrevDateFilter] = useState<string>('');
  const [crossBusyId, setCrossBusyId] = useState<string | null>(null);
  const [crossError, setCrossError] = useState<string | null>(null);

  const pinnedCrossMeetingRequests = useMemo(() => {
    if (data.actor.role !== 'SUPER_ADMIN') return [];
    return data.responses
      .filter((r) => r.isCrossMeetingRequest && r.status === 'AWAITING_APPROVAL')
      .map((resp) => {
        const req = data.requests.find((x) => x.id === resp.requestId);
        const sub = data.substitutes.find((x) => x.id === resp.substituteId);
        return { resp, req, sub };
      })
      .filter((entry): entry is { resp: typeof entry.resp; req: MeetingRequest; sub: typeof entry.sub } =>
        Boolean(entry.req)
      );
  }, [data.actor.role, data.responses, data.requests, data.substitutes]);

  const tomorrowRequests = useMemo(
    () => data.requests.filter((r) => r.meetingDate === data.tomorrow),
    [data.requests, data.tomorrow]
  );

  const previousRequests = useMemo(() => {
    return data.requests.filter((r) => {
      if (r.meetingDate >= data.tomorrow) return false;
      if (prevDateFilter && r.meetingDate !== prevDateFilter) return false;
      if (prevFilter === 'COMPLETED') {
        return r.status === 'COMPLETED_SELF_REPORTED' || r.status === 'VERIFIED';
      }
      if (prevFilter === 'REVIEW') {
        return r.status === 'DISPUTED' || r.status === 'COMPLETED_SELF_REPORTED';
      }
      return true;
    });
  }, [data.requests, data.tomorrow, prevFilter, prevDateFilter]);

  const tomorrowGroups = useMemo(
    () => groupByChapter(tomorrowRequests, data.assignments),
    [tomorrowRequests, data.assignments]
  );

  const previousGroups = useMemo(
    () => groupByChapter(previousRequests, data.assignments),
    [previousRequests, data.assignments]
  );

  // Super Admin Coordinator Performance & Attribution Oversight
  const coordinatorMetrics = useMemo(() => {
    if (data.actor.role !== 'SUPER_ADMIN') return [];
    const coordList = data.coordinatorDirectory ?? [];
    return coordList.map((coord) => {
      const ownedReqs = data.requests.filter((r) => r.coordinatorId === coord.id);
      const viaAssignments = data.assignments.filter(
        (a) =>
          (a.assignedViaCoordinatorId ?? a.coordinatorId) === coord.id &&
          !['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)
      );
      const ownedAssignments = data.assignments.filter(
        (a) =>
          a.coordinatorId === coord.id &&
          !['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)
      );
      const completedCount = ownedAssignments.filter(
        (a) => a.status === 'COMPLETED_SELF_REPORTED' || a.status === 'VERIFIED'
      ).length;
      const delegatedCount = ownedAssignments.filter((a) => a.isDelegated).length;
      const selfCount = ownedAssignments.length - delegatedCount;
      const receivablesDue = data.clientCharges
        .filter((c) => c.coordinatorId === coord.id)
        .reduce((sum, c) => sum + Math.max(0, c.amount - c.receivedAmount), 0);
      const payablesDue = data.substituteEarnings
        .filter((e) => (e.assignedViaCoordinatorId ?? e.coordinatorId) === coord.id)
        .reduce((sum, e) => sum + Math.max(0, e.amount - e.paidAmount), 0);
      const approvedComm = (data.coordinatorCommissions ?? [])
        .filter((cm) => cm.coordinatorId === coord.id)
        .reduce((sum, cm) => sum + cm.amount, 0);
      return {
        ...coord,
        ownedReqCount: ownedReqs.length,
        viaCount: viaAssignments.length,
        confirmedCount: ownedAssignments.length,
        completedCount,
        selfCount,
        delegatedCount,
        receivablesDue,
        payablesDue,
        approvedComm,
      };
    });
  }, [data]);

  function toggleTomorrow(chapterId: string) {
    setExpandedTomorrowIds((prev) => ({ ...prev, [chapterId]: !prev[chapterId] }));
  }

  function togglePrevious(chapterId: string) {
    setExpandedPreviousIds((prev) => ({ ...prev, [chapterId]: !prev[chapterId] }));
  }

  function renderAttendeeRows(req: MeetingRequest, isPrevious: boolean) {
    const asgns = data.assignments.filter(
      (a) => a.requestId === req.id && !['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)
    );
    const pendingResps = data.responses.filter(
      (r) => r.requestId === req.id && (r.status === 'PENDING' || r.status === 'AWAITING_APPROVAL')
    );

    if (req.status === 'CANCELLED') {
      return (
        <button
          key={req.id}
          type="button"
          onClick={() => onSelectRequest(req.id)}
          className="w-full py-2 px-2.5 rounded-lg hover:bg-[#18181a]/[0.05] text-left flex items-center justify-between gap-2 text-xs transition-colors"
        >
          <span className="truncate text-[#f2efeb]/60 line-through">
            {req.memberNameSnapshot} → Cancelled
          </span>
          <span className="text-[11px] text-[#f2efeb]/45 shrink-0">{formatShortDate(req.meetingDate)}</span>
        </button>
      );
    }

    if (asgns.length === 0) {
      return (
        <button
          key={req.id}
          type="button"
          onClick={() => onSelectRequest(req.id)}
          className="w-full py-2 px-2.5 rounded-lg hover:bg-[#C81E2B]/20 text-left flex items-center justify-between gap-2 text-xs transition-colors"
        >
          <span className="truncate text-[#f2efeb]">
            <span className="font-medium">{req.memberNameSnapshot}</span>
            <span className="mx-1.5 text-[#f2efeb]/45">→</span>
            <span className="font-semibold text-amber-400">Unassigned</span>
          </span>
          <span className="text-[11px] font-medium text-[#E2B340] shrink-0 tabular-nums">
            {pendingResps.length > 0 ? `${pendingResps.length} resp.` : req.assignmentMode === 'FIRST_CONFIRM' ? '1st-Confirm' : 'Open'}
          </span>
        </button>
      );
    }

    return asgns.map((asgn) => (
      <div
        key={asgn.id}
        className="py-2 px-2.5 rounded-lg hover:bg-[#18181a]/[0.05] flex items-center justify-between gap-2 text-xs transition-colors"
      >
        <button
          type="button"
          onClick={() => onSelectRequest(req.id)}
          className="min-w-0 flex-1 text-left truncate cursor-pointer"
        >
          <span className="font-medium text-[#f2efeb]">{req.memberNameSnapshot}</span>
          <span className="mx-1.5 text-[#f2efeb]/45">→</span>
          {/* LOCKED RULE: Always display Actual Attendee after arrow, never repetitive 'Substitute:' label */}
          <span className="font-semibold text-[#f2efeb]">{asgn.actualAttendeeName}</span>
          {asgn.isDelegated && (
            <span className="ml-1.5 text-[11px] text-[#E2B340]">(Guest)</span>
          )}
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {isPrevious && asgn.status === 'COMPLETED_SELF_REPORTED' && !asgn.disputed ? (
            <button
              type="button"
              onClick={() => onVerifyAssignment(asgn.id)}
              className="text-[11px] font-semibold text-[#E2B340] hover:underline whitespace-nowrap"
            >
              Verify
            </button>
          ) : (
            <span
              className={`text-[11px] font-medium whitespace-nowrap ${
                asgn.disputed
                  ? 'text-red-400'
                  : asgn.status === 'VERIFIED' || asgn.status === 'REACHED'
                  ? 'text-emerald-400'
                  : asgn.status === 'COMPLETED_SELF_REPORTED'
                  ? 'text-[#E2B340]'
                  : 'text-[#f2efeb]/60'
              }`}
            >
              {asgn.disputed
                ? 'Disputed'
                : asgn.status === 'VERIFIED'
                ? 'Verified'
                : asgn.status === 'COMPLETED_SELF_REPORTED'
                ? 'Self-Reported'
                : asgn.checkinState === 'REACHED'
                ? 'Reached'
                : asgn.checkinState === 'LEFT_HOME'
                ? 'On Way'
                : asgn.checkinState === 'AWAKE'
                ? 'Awake'
                : 'Confirmed'}
            </span>
          )}
        </div>
      </div>
    ));
  }

  return (
    <div className="space-y-8">
      {/* Admin / Coordinator Quick Summary */}
      <QuickSummary
        data={data}
        onOpenNewRequest={onOpenNewRequest}
        onDrillToRequests={onDrillToRequests}
        onDrillToFinance={onDrillToFinance}
      />

      {/* Pinned Super Admin Cross-Meeting Approvals */}
      {data.actor.role === 'SUPER_ADMIN' && pinnedCrossMeetingRequests.length > 0 && (
        <section
          aria-labelledby="pinned-cross-meeting-heading"
          data-testid="pinned-cross-meetings"
          className="rounded-[6px] border border-[#E2B340]/45 bg-[#18181a] overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-[#f2efeb]/10 bg-[#1f1f23] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Pin className="w-4 h-4 text-[#E2B340]" />
              <div>
                <h2 id="pinned-cross-meeting-heading" className="font-display text-sm font-bold text-[#f2efeb]">
                  Pinned Cross-Meeting Requests ({pinnedCrossMeetingRequests.length})
                </h2>
                <p className="text-[11px] text-[#f2efeb]/60">
                  Veloctive Team members already booked on the same date — only Super Admin can allow a Cross-Meeting.
                </p>
              </div>
            </div>
          </div>

          {crossError && (
            <div role="alert" className="mx-4 mt-3 px-3 py-2 rounded-[5px] bg-red-500/12 border border-red-500/35 text-xs text-red-400">
              {crossError}
            </div>
          )}

          <div className="divide-y divide-[#f2efeb]/10">
            {pinnedCrossMeetingRequests.map(({ resp, req, sub }) => (
              <div
                key={resp.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm text-[#f2efeb]">
                      {sub?.name ?? resp.substituteId}
                    </span>
                    <span className="text-[11px] font-semibold text-[#E2B340]">
                      → Request #{req.requestNumber} · {req.chapterNameSnapshot} ({formatShortDate(req.meetingDate)} · {req.reportingTime})
                    </span>
                  </div>
                  <p className="text-[#f2efeb]/65">
                    Member: <strong className="text-[#f2efeb]">{req.memberNameSnapshot}</strong> · Already booked at{' '}
                    <strong className="text-amber-400">
                      {resp.crossMeetingConflictChapter ?? 'another chapter'}
                      {resp.crossMeetingConflictTime ? ` (${resp.crossMeetingConflictTime})` : ''}
                    </strong>
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={crossBusyId === resp.id}
                    onClick={async () => {
                      if (!onApproveResponse) return;
                      setCrossBusyId(resp.id);
                      setCrossError(null);
                      try {
                        await onApproveResponse(resp.id);
                      } catch (err) {
                        setCrossError(err instanceof Error ? err.message : 'Could not allow cross-meeting.');
                      } finally {
                        setCrossBusyId(null);
                      }
                    }}
                    className="h-9 px-3.5 rounded-[5px] bg-[#C81E2B] hover:bg-[#A31621] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Allow Cross-Meeting
                  </button>
                  <button
                    type="button"
                    disabled={crossBusyId === resp.id}
                    onClick={async () => {
                      if (!onRejectResponse) return;
                      setCrossBusyId(resp.id);
                      setCrossError(null);
                      try {
                        await onRejectResponse(resp.id, 'Cross-meeting declined by Super Admin');
                      } catch (err) {
                        setCrossError(err instanceof Error ? err.message : 'Could not decline request.');
                      } finally {
                        setCrossBusyId(null);
                      }
                    }}
                    className="h-9 px-3 rounded-[5px] border border-[#f2efeb]/15 hover:text-red-400 text-xs font-semibold text-[#f2efeb]/75 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <X className="w-3.5 h-3.5" />
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tomorrow's Overview — Two-Column Chapter Grid (LOCKED SPEC Section 11.3) */}
      <section aria-labelledby="tomorrow-overview-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3 border-b border-[#f2efeb]/10">
          <div className="flex items-baseline gap-2.5">
            <h2 id="tomorrow-overview-heading" className="font-display text-lg font-bold text-[#f2efeb]">
              Tomorrow&apos;s Overview
            </h2>
            <span className="text-sm font-semibold text-[#E2B340] tabular-nums">
              {tomorrowRequests.length}
            </span>
          </div>
          <p className="text-xs text-[#f2efeb]/60 inline-flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-[#E2B340]" />
            {formatDisplayDate(data.tomorrow)}
          </p>
        </div>

        {tomorrowGroups.length === 0 ? (
          <div className="mt-4 p-8 rounded-[6px] border border-dashed border-[#f2efeb]/10 bg-white/[0.03] text-center">
            <p className="text-sm font-medium text-[#f2efeb]">No requests scheduled for tomorrow yet.</p>
            <p className="text-xs text-[#f2efeb]/60 mt-1">
              Create a request to auto-fill member chapter, venue, and tomorrow&apos;s calendar date.
            </p>
            <button
              type="button"
              onClick={onOpenNewRequest}
              className="mt-4 h-10 px-4 rounded-[6px] bg-[#C81E2B] text-white text-xs font-semibold"
            >
              Create First Request
            </button>
          </div>
        ) : (
          <div
            data-testid="tomorrow-overview-grid"
            className="mt-4 grid grid-cols-1 min-[390px]:grid-cols-2 gap-3 sm:gap-4 items-start"
          >
            {tomorrowGroups.map((group) => {
              const isOpen = Boolean(expandedTomorrowIds[group.chapterId]);
              return (
                <div
                  key={group.chapterId}
                  className="rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] overflow-hidden transition-colors hover:border-[#C81E2B]/40"
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggleTomorrow(group.chapterId)}
                    className="w-full p-3.5 sm:p-4 text-left flex items-start justify-between gap-2 cursor-pointer"
                  >
                    <div className="min-w-0">
                      {/* LOCKED: Chapter bold + inline count, NO 'Requests' word underneath */}
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span className="text-sm sm:text-[15px] font-semibold text-[#f2efeb] truncate">
                          {group.chapterName}
                        </span>
                        <span className="font-mono text-xs sm:text-sm font-bold text-[#E2B340] shrink-0 tabular-nums">
                          {group.requests.length}
                        </span>
                      </div>
                      <p className="text-xs text-[#f2efeb]/60 mt-1 tabular-nums">
                        <span className="text-emerald-400 font-medium">{group.assignedCount} Assigned</span>
                        <span aria-hidden="true"> · </span>
                        <span className={group.pendingCount > 0 ? 'text-amber-400 font-medium' : 'text-[#f2efeb]/60'}>
                          {group.pendingCount} Pending
                        </span>
                      </p>
                    </div>
                    <span className="w-7 h-7 rounded-lg bg-[#1f1f23] flex items-center justify-center text-[#f2efeb]/60 shrink-0 mt-0.5">
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-2 pb-3 pt-1 border-t border-[#f2efeb]/10 bg-white/[0.03] space-y-0.5">
                      {group.requests.map((req) => renderAttendeeRows(req, false))}
                      <div className="pt-2 px-2 border-t border-[#f2efeb]/10 mt-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            onDrillToRequests({ chapterId: group.chapterId, date: data.tomorrow })
                          }
                          className="text-[11px] font-semibold text-[#E2B340] hover:underline inline-flex items-center gap-1 cursor-pointer"
                        >
                          View Requests
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Previous Overview — Two-Column Chapter Grid with Date & Status Filters */}
      <section aria-labelledby="previous-overview-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#f2efeb]/10">
          <div className="flex items-baseline gap-2.5">
            <h2 id="previous-overview-heading" className="font-display text-lg font-bold text-[#f2efeb]">
              Previous Overview
            </h2>
            <span className="text-sm font-semibold text-[#E2B340] tabular-nums">
              {previousRequests.length}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center p-1 rounded-lg bg-[#1f1f23] border border-[#f2efeb]/10">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'COMPLETED', label: 'Completed' },
                  { id: 'REVIEW', label: 'Pending Review' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPrevFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    prevFilter === tab.id
                      ? 'bg-[#C81E2B] text-white'
                      : 'text-[#f2efeb]/70 hover:text-[#f2efeb]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <input
              type="date"
              aria-label="Filter previous overview by date"
              value={prevDateFilter}
              onChange={(e) => setPrevDateFilter(e.target.value)}
              className="h-8 px-2.5 rounded-lg border border-[#f2efeb]/10 text-xs text-[#f2efeb] bg-[#18181a] focus:outline-none focus:border-[#C81E2B]"
            />
            {prevDateFilter && (
              <button
                type="button"
                onClick={() => setPrevDateFilter('')}
                className="text-xs text-[#E2B340] font-medium hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {previousGroups.length === 0 ? (
          <div className="mt-4 p-6 rounded-[6px] border border-[#f2efeb]/10 bg-white/[0.03] text-center text-xs text-[#f2efeb]/60">
            No past meetings match this filter.
          </div>
        ) : (
          <div
            data-testid="previous-overview-grid"
            className="mt-4 grid grid-cols-1 min-[390px]:grid-cols-2 gap-3 sm:gap-4 items-start"
          >
            {previousGroups.map((group) => {
              const isOpen = Boolean(expandedPreviousIds[group.chapterId]);
              return (
                <div
                  key={group.chapterId}
                  className="rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] overflow-hidden transition-colors hover:border-[#C81E2B]/40"
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => togglePrevious(group.chapterId)}
                    className="w-full p-3.5 sm:p-4 text-left flex items-start justify-between gap-2 cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span className="text-sm sm:text-[15px] font-semibold text-[#f2efeb] truncate">
                          {group.chapterName}
                        </span>
                        <span className="font-mono text-xs sm:text-sm font-bold text-[#E2B340] shrink-0 tabular-nums">
                          {group.requests.length}
                        </span>
                      </div>
                      <p className="text-xs text-[#f2efeb]/60 mt-1 tabular-nums">
                        <span className="text-emerald-400 font-medium">{group.completedCount} Completed</span>
                        {group.disputedCount > 0 && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="text-red-400 font-medium">{group.disputedCount} Review</span>
                          </>
                        )}
                        {group.cancelledCount > 0 && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span>{group.cancelledCount} Cancelled</span>
                          </>
                        )}
                      </p>
                    </div>
                    <span className="w-7 h-7 rounded-lg bg-[#1f1f23] flex items-center justify-center text-[#f2efeb]/60 shrink-0 mt-0.5">
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-2 pb-3 pt-1 border-t border-[#f2efeb]/10 bg-white/[0.03] space-y-0.5">
                      {group.requests.map((req) => renderAttendeeRows(req, true))}
                      <div className="pt-2 px-2 border-t border-[#f2efeb]/10 mt-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            onDrillToRequests({
                              chapterId: group.chapterId,
                              date: prevDateFilter || undefined,
                            })
                          }
                          className="text-[11px] font-semibold text-[#E2B340] hover:underline inline-flex items-center gap-1 cursor-pointer"
                        >
                          View Requests
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Super Admin Coordinator Performance & Attribution Oversight */}
      {data.actor.role === 'SUPER_ADMIN' && coordinatorMetrics.length > 0 && (
        <section aria-labelledby="coord-oversight-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3 border-b border-[#f2efeb]/10">
            <h2 id="coord-oversight-heading" className="font-display text-lg font-bold text-[#f2efeb]">
              Coordinator Performance &amp; Attribution
            </h2>
            <p className="text-xs text-[#f2efeb]/60">
              Super Admin agency-wide oversight · Click to filter
            </p>
          </div>

          <div className="mt-4 overflow-x-auto rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a]">
            <table className="w-full text-left border-collapse min-w-[680px]">
              <thead>
                <tr className="border-b border-[#f2efeb]/10 bg-[#1f1f23] text-[11px] font-semibold text-[#f2efeb]/60">
                  <th className="py-2.5 px-3.5">Coordinator</th>
                  <th className="py-2.5 px-2.5 text-right">Requests</th>
                  <th className="py-2.5 px-2.5 text-right">Via Asgns</th>
                  <th className="py-2.5 px-2.5 text-right">Completed</th>
                  <th className="py-2.5 px-2.5 text-right">Self / Deleg.</th>
                  <th className="py-2.5 px-2.5 text-right">Recv. Due</th>
                  <th className="py-2.5 px-2.5 text-right">Pay. Due</th>
                  <th className="py-2.5 px-2.5 text-right">Appr. Comm.</th>
                  <th className="py-2.5 px-3.5 text-right">Drill-down</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f2efeb]/10 text-xs">
                {coordinatorMetrics.map((m) => (
                  <tr key={m.id} className="hover:bg-[#18181a]/[0.05]">
                    <td className="py-2.5 px-3.5 font-semibold text-[#f2efeb]">
                      {m.name}
                      {m.isSuperAdmin && (
                        <span className="ml-1.5 text-[10px] font-medium text-[#E2B340]">Super Admin</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#f2efeb] font-medium">
                      {m.ownedReqCount}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#E2B340] font-medium">
                      {m.viaCount}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-emerald-400 font-medium">
                      {m.completedCount}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#f2efeb]/70">
                      {m.selfCount} / {m.delegatedCount}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums font-semibold text-[#f2efeb]">
                      {formatINR(m.receivablesDue)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#f2efeb]/70">
                      {formatINR(m.payablesDue)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#E2B340] font-semibold">
                      {formatINR(m.approvedComm)}
                    </td>
                    <td className="py-2.5 px-3.5 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onDrillToRequests({ coordinatorId: m.id })}
                          className="text-[11px] font-semibold text-[#E2B340] hover:underline cursor-pointer"
                        >
                          Requests
                        </button>
                        <button
                          type="button"
                          onClick={() => onDrillToFinance({ viaCoordinatorId: m.id })}
                          className="text-[11px] font-semibold text-[#f2efeb] hover:text-[#E2B340] hover:underline cursor-pointer"
                        >
                          Finance
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};
