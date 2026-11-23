import React, { useMemo, useState } from 'react';
import { BarChart3, Download } from 'lucide-react';
import type { AdminBootstrapData } from '../lib/api';
import {
  computeFinanceSummary,
  formatINR,
  formatShortDate,
  generateCsvContent,
} from '../core/rules';

interface ReportsViewProps {
  data: AdminBootstrapData;
}

type DateScope = 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM';

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ data }) => {
  const isAdmin = data.actor.role === 'SUPER_ADMIN';
  const [scope, setScope] = useState<DateScope>('MONTH');
  const [chapterId, setChapterId] = useState('ALL');
  const [coordFilter, setCoordFilter] = useState('ALL');
  const [customStart, setCustomStart] = useState(addDays(data.today, -14));
  const [customEnd, setCustomEnd] = useState(data.tomorrow);

  const coordName = (id?: string) =>
    id ? data.coordinatorDirectory.find((c) => c.id === id)?.name ?? 'Coordinator' : '—';

  const { startDate, endDate } = useMemo(() => {
    if (scope === 'TODAY') return { startDate: data.today, endDate: data.tomorrow };
    if (scope === 'WEEK') return { startDate: addDays(data.today, -6), endDate: data.tomorrow };
    if (scope === 'MONTH') return { startDate: addDays(data.today, -30), endDate: addDays(data.tomorrow, 7) };
    return { startDate: customStart, endDate: customEnd };
  }, [scope, data.today, data.tomorrow, customStart, customEnd]);

  const scopedRequests = useMemo(
    () =>
      data.requests.filter((r) => {
        if (chapterId !== 'ALL' && r.chapterId !== chapterId) return false;
        if (coordFilter !== 'ALL') {
          const match =
            r.coordinatorId === coordFilter ||
            r.sourcedViaCoordinatorId === coordFilter ||
            data.assignments.some(
              (a) =>
                a.requestId === r.id &&
                (a.coordinatorId === coordFilter || a.assignedViaCoordinatorId === coordFilter)
            );
          if (!match) return false;
        }
        return r.meetingDate >= startDate && r.meetingDate <= endDate;
      }),
    [data.requests, data.assignments, chapterId, coordFilter, startDate, endDate]
  );

  const scopedRequestIds = useMemo(() => new Set(scopedRequests.map((r) => r.id)), [scopedRequests]);

  const scopedAssignments = useMemo(
    () => data.assignments.filter((a) => scopedRequestIds.has(a.requestId)),
    [data.assignments, scopedRequestIds]
  );

  const scopedCharges = useMemo(
    () => data.clientCharges.filter((c) => scopedRequestIds.has(c.requestId)),
    [data.clientCharges, scopedRequestIds]
  );

  const scopedEarnings = useMemo(
    () => data.substituteEarnings.filter((e) => scopedRequestIds.has(e.requestId)),
    [data.substituteEarnings, scopedRequestIds]
  );

  const scopedCommissions = useMemo(
    () => (data.coordinatorCommissions ?? []).filter((cm) => scopedRequestIds.has(cm.requestId)),
    [data.coordinatorCommissions, scopedRequestIds]
  );

  const scopedReceipts = useMemo(
    () =>
      data.clientReceipts.filter(
        (r) =>
          r.paymentDate >= startDate &&
          r.paymentDate <= endDate &&
          (coordFilter === 'ALL' || r.coordinatorId === coordFilter)
      ),
    [data.clientReceipts, startDate, endDate, coordFilter]
  );

  const scopedPayouts = useMemo(
    () =>
      data.freelancerPayouts.filter(
        (p) =>
          p.paymentDate >= startDate &&
          p.paymentDate <= endDate &&
          (coordFilter === 'ALL' || p.coordinatorId === coordFilter)
      ),
    [data.freelancerPayouts, startDate, endDate, coordFilter]
  );

  const fin = useMemo(
    () =>
      computeFinanceSummary(
        scopedCharges,
        scopedEarnings,
        scopedReceipts,
        scopedPayouts,
        scopedCommissions
      ),
    [scopedCharges, scopedEarnings, scopedReceipts, scopedPayouts, scopedCommissions]
  );

  const coordinatorBreakdown = useMemo(() => {
    if (!isAdmin) return [];
    return data.coordinatorDirectory.map((c) => {
      const owned = scopedRequests.filter((r) => r.coordinatorId === c.id).length;
      const viaAsgns = scopedAssignments.filter(
        (a) =>
          (a.assignedViaCoordinatorId ?? a.coordinatorId) === c.id &&
          !['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)
      );
      const completed = viaAsgns.filter(
        (a) => a.status === 'COMPLETED_SELF_REPORTED' || a.status === 'VERIFIED'
      ).length;
      const delegated = viaAsgns.filter((a) => a.isDelegated).length;
      const recvDue = scopedCharges
        .filter((ch) => ch.coordinatorId === c.id)
        .reduce((s, ch) => s + Math.max(0, ch.amount - ch.receivedAmount), 0);
      const payDue = scopedEarnings
        .filter((e) => (e.assignedViaCoordinatorId ?? e.coordinatorId) === c.id)
        .reduce((s, e) => s + Math.max(0, e.amount - e.paidAmount), 0);
      const comm = scopedCommissions
        .filter((cm) => cm.coordinatorId === c.id)
        .reduce((s, cm) => s + cm.amount, 0);
      return {
        ...c,
        owned,
        viaCount: viaAsgns.length,
        completed,
        selfCount: viaAsgns.length - delegated,
        delegated,
        recvDue,
        payDue,
        comm,
      };
    });
  }, [isAdmin, data.coordinatorDirectory, scopedRequests, scopedAssignments, scopedCharges, scopedEarnings, scopedCommissions]);

  // Operational counts (strict PRD definitions)
  const confirmedCount = scopedAssignments.filter(
    (a) => !['CANCELLED', 'NO_SHOW', 'REPLACED'].includes(a.status)
  ).length;
  const completedSelfReported = scopedAssignments.filter((a) => a.status === 'COMPLETED_SELF_REPORTED').length;
  const verifiedCount = scopedAssignments.filter((a) => a.status === 'VERIFIED').length;
  const cancelledCount = scopedRequests.filter((r) => r.status === 'CANCELLED').length;
  const unassignedCount = scopedRequests.filter(
    (r) =>
      (r.status === 'OPEN' || r.status === 'AWAITING_SELECTION') &&
      !scopedAssignments.some((a) => a.requestId === r.id && !['CANCELLED', 'REPLACED'].includes(a.status))
  ).length;

  // Substitute-wise breakdown: LOCKED RULE — NEVER list 'Unassigned' as if it were a payable!
  const substituteBreakdown = useMemo(() => {
    const map = new Map<
      string,
      { subId: string; name: string; count: number; billed: number; payable: number }
    >();
    for (const asgn of scopedAssignments) {
      if (['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(asgn.status)) continue;
      const sub = data.substitutes.find((s) => s.id === asgn.contractSubstituteId);
      const existing = map.get(asgn.contractSubstituteId) ?? {
        subId: asgn.contractSubstituteId,
        name: sub?.name ?? asgn.contractSubstituteId,
        count: 0,
        billed: 0,
        payable: 0,
      };
      existing.count += 1;
      existing.billed += asgn.memberFee;
      existing.payable += asgn.agreedPayout;
      map.set(asgn.contractSubstituteId, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [scopedAssignments, data.substitutes]);

  // Chapter-wise breakdown for visual bar chart
  const chapterBreakdown = useMemo(() => {
    const map = new Map<
      string,
      { chapterId: string; name: string; requests: number; completed: number; billed: number; payable: number }
    >();
    for (const req of scopedRequests) {
      if (req.status === 'CANCELLED') continue;
      const existing = map.get(req.chapterId) ?? {
        chapterId: req.chapterId,
        name: req.chapterNameSnapshot,
        requests: 0,
        completed: 0,
        billed: 0,
        payable: 0,
      };
      existing.requests += 1;
      const reqAsgns = scopedAssignments.filter(
        (a) => a.requestId === req.id && !['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)
      );
      for (const a of reqAsgns) {
        if (a.status === 'COMPLETED_SELF_REPORTED' || a.status === 'VERIFIED') {
          existing.completed += 1;
        }
        existing.billed += a.memberFee;
        existing.payable += a.agreedPayout;
      }
      map.set(req.chapterId, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.billed - a.billed || b.requests - a.requests);
  }, [scopedRequests, scopedAssignments]);

  // Delegation / attendance history
  const delegatedHistory = useMemo(
    () => scopedAssignments.filter((a) => a.isDelegated),
    [scopedAssignments]
  );

  // Financial overview bar chart metrics
  const financialChartBars = useMemo(
    () => [
      { label: 'Billed', value: fin.totalBilled, color: '#C81E2B', textClass: 'text-[#f2efeb]' },
      { label: 'Received', value: fin.cashReceived, color: '#10B981', textClass: 'text-emerald-400' },
      { label: 'Payables', value: fin.totalEarnedBySubstitutes, color: '#E2B340', textClass: 'text-[#E2B340]' },
      { label: 'Paid Out', value: fin.cashPaidToSubstitutes, color: '#94A3B8', textClass: 'text-[#f2efeb]/80' },
      {
        label: 'Net Margin',
        value: Math.max(0, fin.contributionAfterBonus),
        color: '#D97706',
        textClass: 'text-amber-400',
      },
    ],
    [fin]
  );
  const maxFinancialBar = Math.max(1, ...financialChartBars.map((b) => b.value));
  const maxChapterBilled = Math.max(1, ...chapterBreakdown.map((c) => c.billed));
  const maxChapterReqs = Math.max(1, ...chapterBreakdown.map((c) => c.requests));
  const maxCoordMetric = Math.max(
    1,
    ...coordinatorBreakdown.map((c) => Math.max(c.owned, c.viaCount, c.completed))
  );
  const maxSubPayable = Math.max(1, ...substituteBreakdown.map((s) => Math.max(s.billed, s.payable)));

  function handleExportCsv() {
    const headers = [
      'Request #',
      'Meeting Date',
      'Chapter',
      'Member',
      'Responsible Coordinator',
      'Assigned Via',
      'Contracted Payee',
      'Actual Attendee',
      'Delegated',
      'Status',
      'Member Fee (INR)',
      'Agreed Payout (INR)',
      'Approved Commission (INR)',
    ];
    const rows = scopedRequests.map((req) => {
      const asgn = scopedAssignments.find((a) => a.requestId === req.id && a.status !== 'REPLACED');
      const sub = asgn ? data.substitutes.find((s) => s.id === asgn.contractSubstituteId) : undefined;
      return [
        req.requestNumber,
        req.meetingDate,
        req.chapterNameSnapshot,
        req.memberNameSnapshot,
        coordName(req.coordinatorId),
        coordName(asgn?.assignedViaCoordinatorId ?? req.sourcedViaCoordinatorId ?? req.coordinatorId),
        sub?.name ?? 'Unassigned',
        asgn?.actualAttendeeName ?? 'Unassigned',
        asgn?.isDelegated ? 'Yes' : 'No',
        asgn?.status ?? req.status,
        asgn?.memberFee ?? req.memberFee,
        asgn ? asgn.agreedPayout : 0, // Zero earned payable if unassigned
        asgn ? asgn.coordinatorCommissionAmount : 0,
      ];
    });
    const csv = generateCsvContent(headers, rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agencyos-report-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Date Scope & Chapter Filter Bar (Screenshot 3 pattern in Navy/Purple/Gold) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center p-1 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10">
            {(
              [
                { id: 'TODAY', label: 'Today & Tmrw' },
                { id: 'WEEK', label: 'This Week' },
                { id: 'MONTH', label: 'This Month' },
                { id: 'CUSTOM', label: 'Custom' },
              ] as Array<{ id: DateScope; label: string }>
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setScope(s.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  scope === s.id ? 'bg-[#C81E2B] text-white' : 'text-[#f2efeb]/70 hover:text-[#f2efeb]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter report by chapter"
            value={chapterId}
            onChange={(e) => setChapterId(e.target.value)}
            className="h-9 px-3 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] text-xs font-medium text-[#f2efeb]"
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
              aria-label="Filter report by coordinator or assigned via"
              value={coordFilter}
              onChange={(e) => setCoordFilter(e.target.value)}
              className="h-9 px-3 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] text-xs font-medium text-[#f2efeb]"
            >
              <option value="ALL">All Coordinators / Via</option>
              {data.coordinatorDirectory.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="h-9 px-3.5 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] hover:bg-[#18181a]/[0.05] text-xs font-semibold text-[#f2efeb] inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-[#E2B340]" />
          Download CSV
        </button>
      </div>

      {scope === 'CUSTOM' && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="h-9 px-3 rounded-lg border border-[#f2efeb]/10"
          />
          <span className="text-[#f2efeb]/60">to</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="h-9 px-3 rounded-lg border border-[#f2efeb]/10"
          />
        </div>
      )}

      <p className="text-xs text-[#f2efeb]/60 tabular-nums">
        Meeting Dates {startDate} → {endDate} · {scopedRequests.length} requests ({unassignedCount} currently unassigned)
      </p>

      {/* Operational Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Request Count', value: scopedRequests.length },
          { label: 'Confirmed', value: confirmedCount },
          { label: 'Completed (Self-Rep.)', value: completedSelfReported },
          { label: 'Verified', value: verifiedCount },
          { label: 'Cancelled', value: cancelledCount },
        ].map((tile) => (
          <div key={tile.label} className="p-3.5 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a]">
            <p className="text-xl font-bold tracking-tight text-[#f2efeb] tabular-nums">{tile.value}</p>
            <p className="text-xs text-[#f2efeb]/60 mt-0.5">{tile.label}</p>
          </div>
        ))}
      </div>

      {/* Financial Metrics Grid (Accrual vs Cash strictly separated) */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-[6px] border border-[#f2efeb]/10 bg-[#1f1f23]">
          <p className="text-lg font-bold tracking-tight text-amber-400 tabular-nums">
            {formatINR(fin.receivablesOutstanding)}
          </p>
          <p className="text-xs text-[#f2efeb]/60 mt-0.5">Receivable Pending</p>
        </div>
        <div className="p-3.5 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a]">
          <p className="text-lg font-bold tracking-tight text-emerald-400 tabular-nums">
            {formatINR(fin.cashReceived)}
          </p>
          <p className="text-xs text-[#f2efeb]/60 mt-0.5">Cash Received</p>
        </div>
        <div className="p-3.5 rounded-[6px] border border-[#f2efeb]/10 bg-[#1f1f23]">
          <p className="text-lg font-bold tracking-tight text-red-400 tabular-nums">
            {formatINR(fin.payablesOutstanding)}
          </p>
          <p className="text-xs text-[#f2efeb]/60 mt-0.5">Veloctive Payable Pending</p>
        </div>
        <div className="p-3.5 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a]">
          <p className="text-lg font-bold tracking-tight text-[#f2efeb] tabular-nums">
            {formatINR(fin.cashPaidToSubstitutes)}
          </p>
          <p className="text-xs text-[#f2efeb]/60 mt-0.5">Cash Paid</p>
        </div>
        <div className="p-3.5 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a]">
          <p className="text-lg font-bold tracking-tight text-[#E2B340] tabular-nums">
            {formatINR(fin.totalCoordinatorCommissions)}
          </p>
          <p className="text-xs text-[#f2efeb]/60 mt-0.5">Approved Comm.</p>
        </div>
        <div className="p-3.5 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a]">
          <p className="text-lg font-bold tracking-tight text-[#E2B340] tabular-nums">
            {formatINR(fin.grossMarginBeforeBonus)}
          </p>
          <p className="text-xs text-[#f2efeb]/60 mt-0.5">Net: {formatINR(fin.contributionAfterBonus)}</p>
        </div>
      </div>

      {/* VISUAL OVERVIEW BAR CHARTS */}
      <section aria-labelledby="reports-charts-heading" data-testid="reports-bar-charts" className="space-y-4">
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#f2efeb]/10">
          <h3 id="reports-charts-heading" className="font-display text-base font-bold text-[#f2efeb] inline-flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#E2B340]" />
            Visual Performance Overview
          </h3>
          <span className="text-[11px] text-[#f2efeb]/60">
            Live bar charts for Financials, Chapters, External Coordinators &amp; Veloctive Team
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Chart 1: Financial Overview Vertical Bar Chart */}
          <div className="rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h4 className="font-display text-sm font-bold text-[#f2efeb]">Financial Cashflow Summary</h4>
                <p className="text-[11px] text-[#f2efeb]/60">Accrual billing vs cash settled &amp; margin</p>
              </div>
              <span className="font-mono text-[11px] text-[#E2B340] font-semibold tabular-nums">
                Margin {formatINR(fin.contributionAfterBonus)}
              </span>
            </div>

            <div className="h-48 pt-4 flex items-end justify-between gap-2.5 sm:gap-4 border-b border-[#f2efeb]/10 pb-2">
              {financialChartBars.map((bar) => {
                const pct = Math.max(bar.value > 0 ? 10 : 3, Math.round((bar.value / maxFinancialBar) * 100));
                return (
                  <div key={bar.label} className="flex-1 h-full flex flex-col items-center justify-end gap-1.5 min-w-0">
                    <span className={`text-[11px] font-bold tabular-nums truncate ${bar.textClass}`}>
                      {formatINR(bar.value)}
                    </span>
                    <div className="w-full max-w-[56px] flex-1 flex items-end">
                      <div
                        className="w-full rounded-t-[4px] transition-all duration-300"
                        style={{ height: `${pct}%`, backgroundColor: bar.color }}
                        title={`${bar.label}: ${formatINR(bar.value)}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] text-[#f2efeb]/65 text-center">
              {financialChartBars.map((bar) => (
                <span key={bar.label} className="flex-1 truncate font-medium">
                  {bar.label}
                </span>
              ))}
            </div>
          </div>

          {/* Chart 2: Chapter Volume & Billing Bar Chart */}
          <div className="rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] p-4 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h4 className="font-display text-sm font-bold text-[#f2efeb]">Chapter-Wise Billing &amp; Volume</h4>
                <p className="text-[11px] text-[#f2efeb]/60">Member billing &amp; request load per chapter</p>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-[#f2efeb]/65">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-xs bg-[#C81E2B]" />
                  Billed
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-xs bg-[#E2B340]" />
                  Reqs
                </span>
              </div>
            </div>

            {chapterBreakdown.length === 0 ? (
              <p className="text-xs text-[#f2efeb]/60 py-10 text-center">No chapter activity in this period.</p>
            ) : (
              <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                {chapterBreakdown.slice(0, 6).map((ch) => {
                  const billedPct = Math.max(ch.billed > 0 ? 8 : 2, Math.round((ch.billed / maxChapterBilled) * 100));
                  const reqPct = Math.max(ch.requests > 0 ? 10 : 2, Math.round((ch.requests / maxChapterReqs) * 100));
                  return (
                    <div key={ch.chapterId} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-[#f2efeb] truncate">{ch.name}</span>
                        <span className="text-[11px] text-[#f2efeb]/70 tabular-nums shrink-0">
                          <strong className="text-[#f2efeb]">{formatINR(ch.billed)}</strong> · {ch.requests} reqs ({ch.completed} done)
                        </span>
                      </div>
                      <div className="space-y-1">
                        <div className="h-2 w-full rounded-full bg-[#1f1f23] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#C81E2B]"
                            style={{ width: `${billedPct}%` }}
                          />
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-[#1f1f23] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#E2B340]"
                            style={{ width: `${reqPct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Chart 3: External Coordinator & Admin Bar Chart */}
          <div className="rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] p-4 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h4 className="font-display text-sm font-bold text-[#f2efeb]">
                  {isAdmin ? 'External Coordinators & Admin Overview' : 'Operational Funnel Overview'}
                </h4>
                <p className="text-[11px] text-[#f2efeb]/60">
                  {isAdmin
                    ? 'Owned requests, assigned-via volume & completed meetings'
                    : 'Request fulfillment stages in this period'}
                </p>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2.5 text-[10px] text-[#f2efeb]/65">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-xs bg-[#C81E2B]" />
                    Owned
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-xs bg-[#E2B340]" />
                    Via
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-xs bg-emerald-500" />
                    Done
                  </span>
                </div>
              )}
            </div>

            {isAdmin && coordinatorBreakdown.length > 0 ? (
              <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                {coordinatorBreakdown.map((c) => {
                  const ownedPct = Math.max(c.owned > 0 ? 8 : 0, Math.round((c.owned / maxCoordMetric) * 100));
                  const viaPct = Math.max(c.viaCount > 0 ? 8 : 0, Math.round((c.viaCount / maxCoordMetric) * 100));
                  const donePct = Math.max(c.completed > 0 ? 8 : 0, Math.round((c.completed / maxCoordMetric) * 100));
                  return (
                    <div key={c.id} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-[#f2efeb] truncate">
                          {c.name}
                          {c.isSuperAdmin && <span className="ml-1.5 text-[10px] text-[#E2B340]">Admin</span>}
                        </span>
                        <span className="text-[11px] text-[#f2efeb]/70 tabular-nums shrink-0">
                          {c.owned} own · {c.viaCount} via · {c.completed} done
                          {c.comm > 0 ? ` · Comm ${formatINR(c.comm)}` : ''}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <div className="h-2 rounded-full bg-[#1f1f23] overflow-hidden" title={`Owned: ${c.owned}`}>
                          <div className="h-full rounded-full bg-[#C81E2B]" style={{ width: `${ownedPct}%` }} />
                        </div>
                        <div className="h-2 rounded-full bg-[#1f1f23] overflow-hidden" title={`Assigned Via: ${c.viaCount}`}>
                          <div className="h-full rounded-full bg-[#E2B340]" style={{ width: `${viaPct}%` }} />
                        </div>
                        <div className="h-2 rounded-full bg-[#1f1f23] overflow-hidden" title={`Completed: ${c.completed}`}>
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${donePct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2.5">
                {[
                  { label: 'Total Requests', val: scopedRequests.length, color: '#C81E2B' },
                  { label: 'Confirmed', val: confirmedCount, color: '#E2B340' },
                  { label: 'Completed (Self-Reported)', val: completedSelfReported, color: '#10B981' },
                  { label: 'Verified', val: verifiedCount, color: '#059669' },
                ].map((row) => {
                  const maxVal = Math.max(1, scopedRequests.length);
                  const pct = Math.max(row.val > 0 ? 8 : 0, Math.round((row.val / maxVal) * 100));
                  return (
                    <div key={row.label} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-[#f2efeb]/75">{row.label}</span>
                        <span className="font-bold text-[#f2efeb] tabular-nums">{row.val}</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-[#1f1f23] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: row.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Chart 4: Veloctive Team Performance Bar Chart */}
          <div className="rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] p-4 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h4 className="font-display text-sm font-bold text-[#f2efeb]">Veloctive Team Performance</h4>
                <p className="text-[11px] text-[#f2efeb]/60">Member billing generated vs team payable earned</p>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-[#f2efeb]/65">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-xs bg-[#C81E2B]" />
                  Billed
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-xs bg-[#E2B340]" />
                  Payable
                </span>
              </div>
            </div>

            {substituteBreakdown.length === 0 ? (
              <p className="text-xs text-[#f2efeb]/60 py-10 text-center">No confirmed Veloctive Team assignments yet.</p>
            ) : (
              <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                {substituteBreakdown.slice(0, 6).map((sub) => {
                  const billedPct = Math.max(sub.billed > 0 ? 8 : 2, Math.round((sub.billed / maxSubPayable) * 100));
                  const payPct = Math.max(sub.payable > 0 ? 8 : 2, Math.round((sub.payable / maxSubPayable) * 100));
                  return (
                    <div key={sub.subId} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-[#f2efeb] truncate">
                          {sub.name} <span className="text-[#f2efeb]/55 font-normal">({sub.count} mtgs)</span>
                        </span>
                        <span className="text-[11px] text-[#f2efeb]/70 tabular-nums shrink-0">
                          <strong className="text-[#f2efeb]">{formatINR(sub.billed)}</strong> /{' '}
                          <strong className="text-[#E2B340]">{formatINR(sub.payable)}</strong>
                        </span>
                      </div>
                      <div className="space-y-1">
                        <div className="h-2 w-full rounded-full bg-[#1f1f23] overflow-hidden">
                          <div className="h-full rounded-full bg-[#C81E2B]" style={{ width: `${billedPct}%` }} />
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-[#1f1f23] overflow-hidden">
                          <div className="h-full rounded-full bg-[#E2B340]" style={{ width: `${payPct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Super Admin Coordinator Attribution & Performance Summary */}
      {isAdmin && coordinatorBreakdown.length > 0 && (
        <div className="rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#f2efeb]/10 bg-[#1f1f23] flex items-center justify-between">
            <h3 className="font-display text-sm font-bold text-[#f2efeb]">
              Coordinator Attribution &amp; Performance
            </h3>
            <span className="text-[11px] text-[#f2efeb]/60">Agency-wide Super Admin view</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="border-b border-[#f2efeb]/10 text-[11px] font-semibold text-[#f2efeb]/60 bg-white/[0.03]">
                  <th className="py-2.5 px-4">Coordinator</th>
                  <th className="py-2.5 px-2.5 text-right">Owned Reqs</th>
                  <th className="py-2.5 px-2.5 text-right">Assigned Via</th>
                  <th className="py-2.5 px-2.5 text-right">Completed</th>
                  <th className="py-2.5 px-2.5 text-right">Self / Deleg.</th>
                  <th className="py-2.5 px-2.5 text-right">Recv. Due</th>
                  <th className="py-2.5 px-2.5 text-right">Pay. Due</th>
                  <th className="py-2.5 px-4 text-right">Appr. Comm.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f2efeb]/10 text-xs">
                {coordinatorBreakdown.map((row) => (
                  <tr key={row.id} className="hover:bg-[#18181a]/[0.05]">
                    <td className="py-2.5 px-4 font-semibold text-[#f2efeb]">{row.name}</td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums">{row.owned}</td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#E2B340] font-medium">{row.viaCount}</td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-emerald-400 font-medium">{row.completed}</td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#f2efeb]/70">
                      {row.selfCount} / {row.delegated}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums font-semibold">{formatINR(row.recvDue)}</td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums">{formatINR(row.payDue)}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-[#E2B340] font-semibold">
                      {formatINR(row.comm)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Veloctive Team Breakdown (Registered Team ONLY — Unassigned excluded from payables) */}
      <div className="rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#f2efeb]/10 bg-[#1f1f23] flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-[#f2efeb]">
            Veloctive Team Breakdown
          </h3>
          <span className="text-[11px] text-[#f2efeb]/60">
            Excludes {unassignedCount} unassigned request(s) from payables
          </span>
        </div>
        <div className="divide-y divide-[#f2efeb]/10">
          {substituteBreakdown.length === 0 ? (
            <p className="p-5 text-xs text-[#f2efeb]/60">No confirmed Veloctive Team assignments in this period.</p>
          ) : (
            substituteBreakdown.map((row) => (
              <div key={row.subId} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                <div>
                  <span className="font-semibold text-[#f2efeb]">{row.name}</span>
                  <span className="text-[#f2efeb]/60 ml-1.5 tabular-nums">× {row.count}</span>
                </div>
                <div className="text-right tabular-nums text-[#f2efeb]/70">
                  <span>Billed <strong className="text-[#f2efeb]">{formatINR(row.billed)}</strong></span>
                  <span className="mx-1.5">·</span>
                  <span>Payable <strong className="text-[#E2B340]">{formatINR(row.payable)}</strong></span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Delegation & Attendance History */}
      <div className="rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#f2efeb]/10 bg-[#1f1f23]">
          <h3 className="font-display text-sm font-bold text-[#f2efeb]">
            Delegation &amp; Guest Attendance History ({delegatedHistory.length})
          </h3>
        </div>
        <div className="divide-y divide-[#f2efeb]/10">
          {delegatedHistory.length === 0 ? (
            <p className="p-5 text-xs text-[#f2efeb]/60">No delegated guest assignments in this date window.</p>
          ) : (
            delegatedHistory.map((asgn) => {
              const req = data.requests.find((r) => r.id === asgn.requestId);
              const partner = data.substitutes.find((s) => s.id === asgn.contractSubstituteId);
              return (
                <div key={asgn.id} className="px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[#f2efeb]/80">
                    <span className="font-mono text-[#f2efeb]/60">#{req?.requestNumber}</span>
                    {' · '}
                    <span className="font-medium">{formatShortDate(asgn.meetingDate)}</span>
                    {' · '}
                    <span>{req?.memberNameSnapshot}</span>
                    {' → via '}
                    <span className="text-[#E2B340] font-medium">{partner?.name}</span>
                    {' → '}
                    <strong className="text-[#f2efeb]">{asgn.actualAttendeeName}</strong>
                  </p>
                  <span className="text-[11px] font-semibold text-[#E2B340]">
                    {asgn.status.replace(/_/g, ' ')}
                    {asgn.finishedReportedByPartner ? ' · Reported by Partner' : ''}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
