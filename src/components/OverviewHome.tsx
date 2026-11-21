import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Plus,
  UserCheck,
} from 'lucide-react';
import type { AdminBootstrapData } from '../lib/api';
import type { FinanceFilterIntent, RequestsFilterIntent } from '../App';
import { formatDisplayDate, formatINR, formatShortDate } from '../core/rules';
import type { Assignment, MeetingRequest } from '../core/types';

interface OverviewHomeProps {
  data: AdminBootstrapData;
  onOpenNewRequest: () => void;
  onSelectRequest: (requestId: string) => void;
  onNavigateTab: (tab: 'requests' | 'finance' | 'people' | 'reports') => void;
  onDrillToRequests: (intent: Omit<RequestsFilterIntent, 'nonce'>) => void;
  onDrillToFinance: (intent: Omit<FinanceFilterIntent, 'nonce'>) => void;
  onVerifyAssignment: (assignmentId: string) => Promise<void>;
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
}) => {
  const [expandedTomorrowIds, setExpandedTomorrowIds] = useState<Record<string, boolean>>({});
  const [expandedPreviousIds, setExpandedPreviousIds] = useState<Record<string, boolean>>({});
  const [prevFilter, setPrevFilter] = useState<'ALL' | 'COMPLETED' | 'REVIEW'>('ALL');
  const [prevDateFilter, setPrevDateFilter] = useState<string>('');

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

  // Action Center counters
  const urgentUnfilled = data.requests.filter(
    (r) => (r.status === 'OPEN' || r.status === 'AWAITING_SELECTION') && r.meetingDate >= data.today
  );
  const pendingApprovals = data.responses.filter(
    (r) => r.status === 'AWAITING_APPROVAL' || r.status === 'PENDING'
  );
  const tomorrowConfirmed = data.assignments.filter(
    (a) => a.meetingDate === data.tomorrow && !['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)
  );
  const activeDisputes = data.assignments.filter((a) => a.disputed && !a.disputeResolvedAt);

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
          className="w-full py-2 px-2.5 rounded-lg hover:bg-[#F8F7FC] text-left flex items-center justify-between gap-2 text-xs transition-colors"
        >
          <span className="truncate text-[#64748B] line-through">
            {req.memberNameSnapshot} → Cancelled
          </span>
          <span className="text-[11px] text-[#94A3B8] shrink-0">{formatShortDate(req.meetingDate)}</span>
        </button>
      );
    }

    if (asgns.length === 0) {
      return (
        <button
          key={req.id}
          type="button"
          onClick={() => onSelectRequest(req.id)}
          className="w-full py-2 px-2.5 rounded-lg hover:bg-[#F3E8FF]/50 text-left flex items-center justify-between gap-2 text-xs transition-colors"
        >
          <span className="truncate text-[#142342]">
            <span className="font-medium">{req.memberNameSnapshot}</span>
            <span className="mx-1.5 text-[#94A3B8]">→</span>
            <span className="font-semibold text-amber-700">Unassigned</span>
          </span>
          <span className="text-[11px] font-medium text-[#6D28D9] shrink-0 tabular-nums">
            {pendingResps.length > 0 ? `${pendingResps.length} resp.` : req.assignmentMode === 'FIRST_CONFIRM' ? '1st-Confirm' : 'Open'}
          </span>
        </button>
      );
    }

    return asgns.map((asgn) => (
      <div
        key={asgn.id}
        className="py-2 px-2.5 rounded-lg hover:bg-[#F8F7FC] flex items-center justify-between gap-2 text-xs transition-colors"
      >
        <button
          type="button"
          onClick={() => onSelectRequest(req.id)}
          className="min-w-0 flex-1 text-left truncate cursor-pointer"
        >
          <span className="font-medium text-[#142342]">{req.memberNameSnapshot}</span>
          <span className="mx-1.5 text-[#94A3B8]">→</span>
          {/* LOCKED RULE: Always display Actual Attendee after arrow, never repetitive 'Substitute:' label */}
          <span className="font-semibold text-[#142342]">{asgn.actualAttendeeName}</span>
          {asgn.isDelegated && (
            <span className="ml-1.5 text-[11px] text-[#B58F3D]">(Guest)</span>
          )}
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {isPrevious && asgn.status === 'COMPLETED_SELF_REPORTED' && !asgn.disputed ? (
            <button
              type="button"
              onClick={() => onVerifyAssignment(asgn.id)}
              className="text-[11px] font-semibold text-[#6D28D9] hover:underline whitespace-nowrap"
            >
              Verify
            </button>
          ) : (
            <span
              className={`text-[11px] font-medium whitespace-nowrap ${
                asgn.disputed
                  ? 'text-red-600'
                  : asgn.status === 'VERIFIED' || asgn.status === 'REACHED'
                  ? 'text-emerald-700'
                  : asgn.status === 'COMPLETED_SELF_REPORTED'
                  ? 'text-[#6D28D9]'
                  : 'text-[#64748B]'
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
      {/* Action Center */}
      <section aria-labelledby="action-center-heading">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <p className="text-xs font-medium text-[#B58F3D]">
              {data.actor.role === 'SUPER_ADMIN'
                ? 'Global Agency Operations'
                : 'Coordinator Workspace'}
              {' · '}
              {formatDisplayDate(data.today)}
            </p>
            <h2 id="action-center-heading" className="font-display text-xl sm:text-2xl font-bold text-[#142342] mt-0.5">
              Action Center
            </h2>
          </div>
          <button
            type="button"
            onClick={onOpenNewRequest}
            className="h-10 px-4 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-sm font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            New Request
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <button
            type="button"
            onClick={() => onDrillToRequests({ status: 'OPEN' })}
            className="p-4 rounded-xl bg-[#F8F7FC] border border-[#E6E8EF] hover:border-[#6D28D9]/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between text-xs text-[#64748B]">
              <span>Unfilled &amp; Open</span>
              <Clock className="w-4 h-4 text-amber-600 shrink-0" />
            </div>
            <p className="font-display text-2xl font-bold text-[#142342] mt-2 tabular-nums">
              {urgentUnfilled.length}
            </p>
            <p className="text-xs text-[#475569] mt-1 truncate">
              {pendingApprovals.length} candidate responses pending
            </p>
          </button>

          <button
            type="button"
            onClick={() => onDrillToRequests({ status: 'CONFIRMED', date: data.tomorrow })}
            className="p-4 rounded-xl bg-[#F8F7FC] border border-[#E6E8EF] hover:border-[#6D28D9]/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between text-xs text-[#64748B]">
              <span>Tomorrow Confirmed</span>
              <UserCheck className="w-4 h-4 text-[#6D28D9] shrink-0" />
            </div>
            <p className="font-display text-2xl font-bold text-[#142342] mt-2 tabular-nums">
              {tomorrowConfirmed.length}
            </p>
            <p className="text-xs text-[#475569] mt-1 truncate">
              {tomorrowConfirmed.filter((a) => a.checkinState !== 'AWAITING_REPLY').length} checked in already
            </p>
          </button>

          <button
            type="button"
            onClick={() => onDrillToFinance({ tab: 'receipts', status: 'OUTSTANDING' })}
            className="p-4 rounded-xl bg-[#F8F7FC] border border-[#E6E8EF] hover:border-[#6D28D9]/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between text-xs text-[#64748B]">
              <span>Receivables Due</span>
              <ArrowRight className="w-4 h-4 text-[#B58F3D] shrink-0" />
            </div>
            <p className="font-display text-2xl font-bold text-[#142342] mt-2 tabular-nums">
              {formatINR(data.financeSummary.receivablesOutstanding)}
            </p>
            <p className="text-xs text-[#475569] mt-1 truncate tabular-nums">
              Payables due {formatINR(data.financeSummary.payablesOutstanding)}
            </p>
          </button>

          <button
            type="button"
            onClick={() => onDrillToRequests({ status: 'DISPUTED' })}
            className="p-4 rounded-xl bg-[#F8F7FC] border border-[#E6E8EF] hover:border-[#6D28D9]/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between text-xs text-[#64748B]">
              <span>Exceptions / Disputes</span>
              {activeDisputes.length > 0 ? (
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              )}
            </div>
            <p className="font-display text-2xl font-bold text-[#142342] mt-2 tabular-nums">
              {activeDisputes.length}
            </p>
            <p className="text-xs text-[#475569] mt-1 truncate">
              {activeDisputes.length > 0 ? 'Settlement hold active' : 'All accounts clear'}
            </p>
          </button>
        </div>
      </section>

      {/* Tomorrow's Overview — Two-Column Chapter Grid (LOCKED SPEC Section 11.3) */}
      <section aria-labelledby="tomorrow-overview-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3 border-b border-[#E6E8EF]">
          <div className="flex items-baseline gap-2.5">
            <h2 id="tomorrow-overview-heading" className="font-display text-lg font-bold text-[#142342]">
              Tomorrow&apos;s Overview
            </h2>
            <span className="text-sm font-semibold text-[#6D28D9] tabular-nums">
              {tomorrowRequests.length}
            </span>
          </div>
          <p className="text-xs text-[#64748B] inline-flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-[#B58F3D]" />
            {formatDisplayDate(data.tomorrow)}
          </p>
        </div>

        {tomorrowGroups.length === 0 ? (
          <div className="mt-4 p-8 rounded-xl border border-dashed border-[#E6E8EF] bg-[#F8F7FC]/60 text-center">
            <p className="text-sm font-medium text-[#142342]">No requests scheduled for tomorrow yet.</p>
            <p className="text-xs text-[#64748B] mt-1">
              Create a request to auto-fill member chapter, venue, and tomorrow&apos;s calendar date.
            </p>
            <button
              type="button"
              onClick={onOpenNewRequest}
              className="mt-4 h-10 px-4 rounded-xl bg-[#6D28D9] text-white text-xs font-semibold"
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
                  className="rounded-xl border border-[#E6E8EF] bg-white overflow-hidden transition-colors hover:border-[#6D28D9]/40"
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
                        <span className="font-display text-sm sm:text-[15px] font-bold text-[#142342] truncate">
                          {group.chapterName}
                        </span>
                        <span className="font-display text-sm sm:text-[15px] font-bold text-[#6D28D9] shrink-0 tabular-nums">
                          {group.requests.length}
                        </span>
                      </div>
                      <p className="text-xs text-[#64748B] mt-1 tabular-nums">
                        <span className="text-emerald-700 font-medium">{group.assignedCount} Assigned</span>
                        <span aria-hidden="true"> · </span>
                        <span className={group.pendingCount > 0 ? 'text-amber-700 font-medium' : 'text-[#64748B]'}>
                          {group.pendingCount} Pending
                        </span>
                      </p>
                    </div>
                    <span className="w-7 h-7 rounded-lg bg-[#F8F7FC] flex items-center justify-center text-[#64748B] shrink-0 mt-0.5">
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-2 pb-3 pt-1 border-t border-[#E6E8EF] bg-[#F8F7FC]/50 space-y-0.5">
                      {group.requests.map((req) => renderAttendeeRows(req, false))}
                      <div className="pt-2 px-2 border-t border-[#E6E8EF]/70 mt-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            onDrillToRequests({ chapterId: group.chapterId, date: data.tomorrow })
                          }
                          className="text-[11px] font-semibold text-[#6D28D9] hover:underline inline-flex items-center gap-1 cursor-pointer"
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
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E6E8EF]">
          <div className="flex items-baseline gap-2.5">
            <h2 id="previous-overview-heading" className="font-display text-lg font-bold text-[#142342]">
              Previous Overview
            </h2>
            <span className="text-sm font-semibold text-[#6D28D9] tabular-nums">
              {previousRequests.length}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center p-1 rounded-lg bg-[#F8F7FC] border border-[#E6E8EF]">
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
                      ? 'bg-[#6D28D9] text-white'
                      : 'text-[#475569] hover:text-[#142342]'
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
              className="h-8 px-2.5 rounded-lg border border-[#E6E8EF] text-xs text-[#142342] bg-white focus:outline-none focus:border-[#6D28D9]"
            />
            {prevDateFilter && (
              <button
                type="button"
                onClick={() => setPrevDateFilter('')}
                className="text-xs text-[#6D28D9] font-medium hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {previousGroups.length === 0 ? (
          <div className="mt-4 p-6 rounded-xl border border-[#E6E8EF] bg-[#F8F7FC]/50 text-center text-xs text-[#64748B]">
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
                  className="rounded-xl border border-[#E6E8EF] bg-white overflow-hidden transition-colors hover:border-[#6D28D9]/40"
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => togglePrevious(group.chapterId)}
                    className="w-full p-3.5 sm:p-4 text-left flex items-start justify-between gap-2 cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span className="font-display text-sm sm:text-[15px] font-bold text-[#142342] truncate">
                          {group.chapterName}
                        </span>
                        <span className="font-display text-sm sm:text-[15px] font-bold text-[#6D28D9] shrink-0 tabular-nums">
                          {group.requests.length}
                        </span>
                      </div>
                      <p className="text-xs text-[#64748B] mt-1 tabular-nums">
                        <span className="text-emerald-700 font-medium">{group.completedCount} Completed</span>
                        {group.disputedCount > 0 && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="text-red-600 font-medium">{group.disputedCount} Review</span>
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
                    <span className="w-7 h-7 rounded-lg bg-[#F8F7FC] flex items-center justify-center text-[#64748B] shrink-0 mt-0.5">
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-2 pb-3 pt-1 border-t border-[#E6E8EF] bg-[#F8F7FC]/50 space-y-0.5">
                      {group.requests.map((req) => renderAttendeeRows(req, true))}
                      <div className="pt-2 px-2 border-t border-[#E6E8EF]/70 mt-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            onDrillToRequests({
                              chapterId: group.chapterId,
                              date: prevDateFilter || undefined,
                            })
                          }
                          className="text-[11px] font-semibold text-[#6D28D9] hover:underline inline-flex items-center gap-1 cursor-pointer"
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
          <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3 border-b border-[#E6E8EF]">
            <h2 id="coord-oversight-heading" className="font-display text-lg font-bold text-[#142342]">
              Coordinator Performance &amp; Attribution
            </h2>
            <p className="text-xs text-[#64748B]">
              Super Admin agency-wide oversight · Click to filter
            </p>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-[#E6E8EF] bg-white">
            <table className="w-full text-left border-collapse min-w-[680px]">
              <thead>
                <tr className="border-b border-[#E6E8EF] bg-[#F8F7FC] text-[11px] font-semibold text-[#64748B]">
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
              <tbody className="divide-y divide-[#E6E8EF] text-xs">
                {coordinatorMetrics.map((m) => (
                  <tr key={m.id} className="hover:bg-[#F8F7FC]/60">
                    <td className="py-2.5 px-3.5 font-semibold text-[#142342]">
                      {m.name}
                      {m.isSuperAdmin && (
                        <span className="ml-1.5 text-[10px] font-medium text-[#B58F3D]">Super Admin</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#142342] font-medium">
                      {m.ownedReqCount}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#6D28D9] font-medium">
                      {m.viaCount}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-emerald-700 font-medium">
                      {m.completedCount}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#475569]">
                      {m.selfCount} / {m.delegatedCount}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums font-semibold text-[#142342]">
                      {formatINR(m.receivablesDue)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#475569]">
                      {formatINR(m.payablesDue)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#B58F3D] font-semibold">
                      {formatINR(m.approvedComm)}
                    </td>
                    <td className="py-2.5 px-3.5 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onDrillToRequests({ coordinatorId: m.id })}
                          className="text-[11px] font-semibold text-[#6D28D9] hover:underline cursor-pointer"
                        >
                          Requests
                        </button>
                        <button
                          type="button"
                          onClick={() => onDrillToFinance({ viaCoordinatorId: m.id })}
                          className="text-[11px] font-semibold text-[#142342] hover:text-[#6D28D9] hover:underline cursor-pointer"
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
