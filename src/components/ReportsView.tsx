import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
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

  // Delegation / attendance history
  const delegatedHistory = useMemo(
    () => scopedAssignments.filter((a) => a.isDelegated),
    [scopedAssignments]
  );

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
          <div className="flex items-center p-1 rounded-xl bg-[#F8F7FC] border border-[#E6E8EF]">
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
                  scope === s.id ? 'bg-[#6D28D9] text-white' : 'text-[#475569] hover:text-[#142342]'
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
            className="h-9 px-3 rounded-xl border border-[#E6E8EF] bg-white text-xs font-medium text-[#142342]"
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
              className="h-9 px-3 rounded-xl border border-[#E6E8EF] bg-white text-xs font-medium text-[#142342]"
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
          className="h-9 px-3.5 rounded-xl border border-[#E6E8EF] bg-white hover:bg-[#F8F7FC] text-xs font-semibold text-[#142342] inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-[#6D28D9]" />
          Download CSV
        </button>
      </div>

      {scope === 'CUSTOM' && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="h-9 px-3 rounded-lg border border-[#E6E8EF]"
          />
          <span className="text-[#64748B]">to</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="h-9 px-3 rounded-lg border border-[#E6E8EF]"
          />
        </div>
      )}

      <p className="text-xs text-[#64748B] tabular-nums">
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
          <div key={tile.label} className="p-3.5 rounded-xl border border-[#E6E8EF] bg-white">
            <p className="font-display text-xl font-bold text-[#142342] tabular-nums">{tile.value}</p>
            <p className="text-xs text-[#64748B] mt-0.5">{tile.label}</p>
          </div>
        ))}
      </div>

      {/* Financial Metrics Grid (Accrual vs Cash strictly separated) */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-xl border border-[#E6E8EF] bg-[#F8F7FC]">
          <p className="font-display text-lg font-bold text-amber-700 tabular-nums">
            {formatINR(fin.receivablesOutstanding)}
          </p>
          <p className="text-xs text-[#64748B] mt-0.5">Receivable Pending</p>
        </div>
        <div className="p-3.5 rounded-xl border border-[#E6E8EF] bg-white">
          <p className="font-display text-lg font-bold text-emerald-700 tabular-nums">
            {formatINR(fin.cashReceived)}
          </p>
          <p className="text-xs text-[#64748B] mt-0.5">Cash Received</p>
        </div>
        <div className="p-3.5 rounded-xl border border-[#E6E8EF] bg-[#F8F7FC]">
          <p className="font-display text-lg font-bold text-red-600 tabular-nums">
            {formatINR(fin.payablesOutstanding)}
          </p>
          <p className="text-xs text-[#64748B] mt-0.5">Sub Payable Pending</p>
        </div>
        <div className="p-3.5 rounded-xl border border-[#E6E8EF] bg-white">
          <p className="font-display text-lg font-bold text-[#142342] tabular-nums">
            {formatINR(fin.cashPaidToSubstitutes)}
          </p>
          <p className="text-xs text-[#64748B] mt-0.5">Cash Paid</p>
        </div>
        <div className="p-3.5 rounded-xl border border-[#E6E8EF] bg-white">
          <p className="font-display text-lg font-bold text-[#B58F3D] tabular-nums">
            {formatINR(fin.totalCoordinatorCommissions)}
          </p>
          <p className="text-xs text-[#64748B] mt-0.5">Approved Comm.</p>
        </div>
        <div className="p-3.5 rounded-xl border border-[#E6E8EF] bg-white">
          <p className="font-display text-lg font-bold text-[#6D28D9] tabular-nums">
            {formatINR(fin.grossMarginBeforeBonus)}
          </p>
          <p className="text-xs text-[#64748B] mt-0.5">Net: {formatINR(fin.contributionAfterBonus)}</p>
        </div>
      </div>

      {/* Super Admin Coordinator Attribution & Performance Summary */}
      {isAdmin && coordinatorBreakdown.length > 0 && (
        <div className="rounded-xl border border-[#E6E8EF] bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E6E8EF] bg-[#F8F7FC] flex items-center justify-between">
            <h3 className="font-display text-sm font-bold text-[#142342]">
              Coordinator Attribution &amp; Performance
            </h3>
            <span className="text-[11px] text-[#64748B]">Agency-wide Super Admin view</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="border-b border-[#E6E8EF] text-[11px] font-semibold text-[#64748B] bg-[#F8F7FC]/60">
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
              <tbody className="divide-y divide-[#E6E8EF] text-xs">
                {coordinatorBreakdown.map((row) => (
                  <tr key={row.id} className="hover:bg-[#F8F7FC]/60">
                    <td className="py-2.5 px-4 font-semibold text-[#142342]">{row.name}</td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums">{row.owned}</td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#6D28D9] font-medium">{row.viaCount}</td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-emerald-700 font-medium">{row.completed}</td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#475569]">
                      {row.selfCount} / {row.delegated}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums font-semibold">{formatINR(row.recvDue)}</td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums">{formatINR(row.payDue)}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-[#B58F3D] font-semibold">
                      {formatINR(row.comm)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Substitute-Wise Breakdown (Registered Substitutes ONLY — Unassigned excluded from payables) */}
      <div className="rounded-xl border border-[#E6E8EF] bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E6E8EF] bg-[#F8F7FC] flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-[#142342]">
            Registered Substitute Breakdown
          </h3>
          <span className="text-[11px] text-[#64748B]">
            Excludes {unassignedCount} unassigned request(s) from payables
          </span>
        </div>
        <div className="divide-y divide-[#E6E8EF]">
          {substituteBreakdown.length === 0 ? (
            <p className="p-5 text-xs text-[#64748B]">No confirmed substitute assignments in this period.</p>
          ) : (
            substituteBreakdown.map((row) => (
              <div key={row.subId} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                <div>
                  <span className="font-semibold text-[#142342]">{row.name}</span>
                  <span className="text-[#64748B] ml-1.5 tabular-nums">× {row.count}</span>
                </div>
                <div className="text-right tabular-nums text-[#475569]">
                  <span>Billed <strong className="text-[#142342]">{formatINR(row.billed)}</strong></span>
                  <span className="mx-1.5">·</span>
                  <span>Payable <strong className="text-[#6D28D9]">{formatINR(row.payable)}</strong></span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Delegation & Attendance History */}
      <div className="rounded-xl border border-[#E6E8EF] bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E6E8EF] bg-[#F8F7FC]">
          <h3 className="font-display text-sm font-bold text-[#142342]">
            Delegation &amp; Guest Attendance History ({delegatedHistory.length})
          </h3>
        </div>
        <div className="divide-y divide-[#E6E8EF]">
          {delegatedHistory.length === 0 ? (
            <p className="p-5 text-xs text-[#64748B]">No delegated guest assignments in this date window.</p>
          ) : (
            delegatedHistory.map((asgn) => {
              const req = data.requests.find((r) => r.id === asgn.requestId);
              const partner = data.substitutes.find((s) => s.id === asgn.contractSubstituteId);
              return (
                <div key={asgn.id} className="px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[#334155]">
                    <span className="font-mono text-[#64748B]">#{req?.requestNumber}</span>
                    {' · '}
                    <span className="font-medium">{formatShortDate(asgn.meetingDate)}</span>
                    {' · '}
                    <span>{req?.memberNameSnapshot}</span>
                    {' → via '}
                    <span className="text-[#6D28D9] font-medium">{partner?.name}</span>
                    {' → '}
                    <strong className="text-[#142342]">{asgn.actualAttendeeName}</strong>
                  </p>
                  <span className="text-[11px] font-semibold text-[#B58F3D]">
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
