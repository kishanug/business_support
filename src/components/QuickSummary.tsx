import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  ClipboardList,
  IndianRupee,
  Plus,
  Users,
} from 'lucide-react';
import { computeAdminQuickSummary, formatDisplayDate, formatINR } from '../core/rules';
import type { AdminBootstrapData } from '../lib/api';
import type { FinanceFilterIntent, RequestsFilterIntent } from '../App';

interface QuickSummaryProps {
  data: AdminBootstrapData;
  onOpenNewRequest: () => void;
  onDrillToRequests: (intent: Omit<RequestsFilterIntent, 'nonce'>) => void;
  onDrillToFinance: (intent: Omit<FinanceFilterIntent, 'nonce'>) => void;
}

export const QuickSummary: React.FC<QuickSummaryProps> = ({
  data,
  onOpenNewRequest,
  onDrillToRequests,
  onDrillToFinance,
}) => {
  const metrics = computeAdminQuickSummary({
    today: data.today,
    tomorrow: data.tomorrow,
    requests: data.requests,
    responses: data.responses,
    assignments: data.assignments,
    clientCharges: data.clientCharges,
    substituteEarnings: data.substituteEarnings,
  });

  const hasUrgentGap = metrics.unfilledPositionsCount > 0;
  const hasDisputes = metrics.activeDisputesCount > 0;

  return (
    <section
      aria-labelledby="quick-summary-heading"
      data-testid="admin-quick-summary"
      className="rounded-lg border border-[#f2efeb]/10 bg-[#18181a] p-4 sm:p-5 space-y-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#E2B340]">
            {data.actor.role === 'SUPER_ADMIN'
              ? 'Global Agency Operations'
              : 'Coordinator Workspace'}
            {' · '}
            {formatDisplayDate(data.today)}
          </p>
          <div className="flex items-center gap-2.5 mt-1">
            <h2
              id="quick-summary-heading"
              className="font-display text-xl sm:text-2xl font-extrabold tracking-tight text-[#f2efeb]"
            >
              Quick Summary
            </h2>
            {hasDisputes && (
              <button
                type="button"
                onClick={() => onDrillToRequests({ status: 'DISPUTED' })}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] border border-red-500/40 bg-red-950/40 text-[11px] font-semibold text-red-300 hover:bg-red-950/70 transition-colors cursor-pointer"
              >
                <AlertTriangle className="w-3 h-3" />
                {metrics.activeDisputesCount} Dispute{metrics.activeDisputesCount > 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenNewRequest}
          className="h-10 px-4 rounded-[6px] bg-[#C81E2B] hover:bg-[#A31621] text-white text-sm font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          New Request
        </button>
      </div>

      {/* High-Priority 4-Card KPI Grid: BNI Crimson × Veloctive Goldenrod × Carbon Graphite */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* 1. Pending Requests */}
        <button
          type="button"
          data-testid="qs-pending-requests"
          onClick={() => onDrillToRequests({ status: 'OPEN' })}
          className="group p-4 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10 border-l-[3px] border-l-[#E12D39] hover:border-[#E12D39]/60 text-left transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-[#f2efeb]/65">
            <span className="font-medium">Pending Requests</span>
            <ClipboardList className="w-4 h-4 text-[#E12D39] shrink-0" />
          </div>
          <p className="font-display text-2xl sm:text-[28px] font-extrabold tracking-tight text-[#f2efeb] mt-2 tabular-nums leading-none">
            {metrics.pendingRequestsCount}
          </p>
          <p className="text-xs text-[#f2efeb]/65 mt-2 flex items-center justify-between gap-1">
            <span className="truncate">
              {metrics.pendingResponsesCount} response{metrics.pendingResponsesCount === 1 ? '' : 's'} waiting
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-[#f2efeb]/40 group-hover:text-[#E2B340] shrink-0 transition-colors" />
          </p>
        </button>

        {/* 2. Unfilled Positions */}
        <button
          type="button"
          data-testid="qs-unfilled-positions"
          onClick={() => onDrillToRequests({ status: 'OPEN' })}
          className={`group p-4 rounded-[6px] bg-[#1f1f23] border border-l-[3px] text-left transition-colors cursor-pointer ${
            hasUrgentGap
              ? 'border-[#C81E2B]/35 border-l-[#C81E2B] hover:border-[#E12D39]'
              : 'border-[#f2efeb]/10 border-l-emerald-500/70 hover:border-emerald-500/50'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[#f2efeb]/65">
            <span className="font-medium">Unfilled Positions</span>
            <Users className={`w-4 h-4 shrink-0 ${hasUrgentGap ? 'text-[#F06A74]' : 'text-emerald-400'}`} />
          </div>
          <p
            className={`font-display text-2xl sm:text-[28px] font-extrabold tracking-tight mt-2 tabular-nums leading-none ${
              hasUrgentGap ? 'text-[#F06A74]' : 'text-emerald-400'
            }`}
          >
            {metrics.unfilledPositionsCount}
          </p>
          <p className="text-xs text-[#f2efeb]/65 mt-2 flex items-center justify-between gap-1">
            <span className="truncate">
              {metrics.urgentUnfilledRequestsCount > 0
                ? `${metrics.urgentUnfilledRequestsCount} urgent`
                : hasUrgentGap
                ? 'Open slots'
                : 'All filled'}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-[#f2efeb]/40 group-hover:text-[#E2B340] shrink-0 transition-colors" />
          </p>
        </button>

        {/* 3. Outstanding Invoices */}
        <button
          type="button"
          data-testid="qs-outstanding-invoices"
          onClick={() => onDrillToFinance({ tab: 'receipts', status: 'OUTSTANDING' })}
          className="group p-4 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10 border-l-[3px] border-l-[#E2B340] hover:border-[#E2B340]/60 text-left transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-[#f2efeb]/65">
            <span className="font-medium">Outstanding Invoices</span>
            <IndianRupee className="w-4 h-4 text-[#E2B340] shrink-0" />
          </div>
          <p className="font-display text-2xl sm:text-[28px] font-extrabold tracking-tight text-[#E2B340] mt-2 tabular-nums leading-none">
            {formatINR(metrics.outstandingInvoicesAmount)}
          </p>
          <p className="text-xs text-[#f2efeb]/65 mt-2 flex items-center justify-between gap-1 tabular-nums">
            <span className="truncate">
              {metrics.outstandingInvoicesCount} unpaid · Payables {formatINR(metrics.payablesDueAmount)}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-[#f2efeb]/40 group-hover:text-[#E2B340] shrink-0 transition-colors" />
          </p>
        </button>

        {/* 4. Tomorrow Confirmed & Check-in Readiness */}
        <button
          type="button"
          data-testid="qs-tomorrow-confirmed"
          onClick={() => onDrillToRequests({ status: 'CONFIRMED', date: data.tomorrow })}
          className="group p-4 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10 border-l-[3px] border-l-[#f2efeb]/40 hover:border-[#E2B340]/50 text-left transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-[#f2efeb]/65">
            <span className="font-medium">Tomorrow Confirmed</span>
            {metrics.tomorrowConfirmedCount > 0 && metrics.tomorrowCheckedInCount === metrics.tomorrowConfirmedCount ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <CalendarCheck2 className="w-4 h-4 text-[#f2efeb]/70 shrink-0" />
            )}
          </div>
          <p className="font-display text-2xl sm:text-[28px] font-extrabold tracking-tight text-[#f2efeb] mt-2 tabular-nums leading-none">
            {metrics.tomorrowConfirmedCount}
          </p>
          <p className="text-xs text-[#f2efeb]/65 mt-2 flex items-center justify-between gap-1 tabular-nums">
            <span className="truncate">
              {metrics.tomorrowCheckedInCount}/{metrics.tomorrowConfirmedCount} checked in
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-[#f2efeb]/40 group-hover:text-[#E2B340] shrink-0 transition-colors" />
          </p>
        </button>
      </div>
    </section>
  );
};
