import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Filter,
  IndianRupee,
  MessageCircle,
  Phone,
  Search,
  X,
} from 'lucide-react';
import { api, ApiError, type AdminBootstrapData } from '../lib/api';
import type { FinanceFilterIntent } from '../App';
import {
  autoAllocateAmount,
  buildTelHref,
  computeFinanceSummary,
  formatINR,
  formatShortDate,
} from '../core/rules';
import type {
  ClientCharge,
  CoordinatorCommission,
  PaymentMethod,
  SubstituteEarning,
} from '../core/types';
import type { DraftMessageConfig } from './WhatsAppModal';

interface FinanceViewProps {
  data: AdminBootstrapData;
  filterIntent?: FinanceFilterIntent | null;
  onRefresh: () => Promise<void>;
  onOpenDraft: (draft: DraftMessageConfig) => void;
}

type FinanceTab = 'receipts' | 'payments' | 'commissions' | 'ledger';
type DatePreset = 'ALL' | 'TODAY_TMRW' | 'WEEK' | 'MONTH' | 'CUSTOM';
type PayStatusFilter = 'ALL' | 'OUTSTANDING' | 'SETTLED' | 'ON_HOLD';

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export const FinanceView: React.FC<FinanceViewProps> = ({
  data,
  filterIntent,
  onRefresh,
  onOpenDraft,
}) => {
  const isAdmin = data.actor.role === 'SUPER_ADMIN';
  const [tab, setTab] = useState<FinanceTab>('receipts');
  const [expandedGroup, setExpandedGroup] = useState<Record<string, boolean>>({});
  const [filtersOpen, setFiltersOpen] = useState(true);

  // Comprehensive Finance filters
  const [datePreset, setDatePreset] = useState<DatePreset>('ALL');
  const [dateBasis, setDateBasis] = useState<'MEETING_DATE' | 'PAYMENT_DATE'>('MEETING_DATE');
  const [customStart, setCustomStart] = useState(addDays(data.today, -30));
  const [customEnd, setCustomEnd] = useState(addDays(data.tomorrow, 7));
  const [chapterFilter, setChapterFilter] = useState('ALL');
  const [responsibleCoordFilter, setResponsibleCoordFilter] = useState('ALL');
  const [viaCoordFilter, setViaCoordFilter] = useState('ALL');
  const [subFilter, setSubFilter] = useState('ALL');
  const [modeFilter, setModeFilter] = useState<'ALL' | 'SELF' | 'DELEGATED'>('ALL');
  const [statusFilter, setStatusFilter] = useState<PayStatusFilter>('ALL');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!filterIntent) return;
    if (filterIntent.tab) setTab(filterIntent.tab);
    if (filterIntent.status) setStatusFilter(filterIntent.status);
    if (filterIntent.viaCoordinatorId !== undefined) {
      setViaCoordFilter(filterIntent.viaCoordinatorId || 'ALL');
    }
    if (filterIntent.responsibleCoordinatorId !== undefined) {
      setResponsibleCoordFilter(filterIntent.responsibleCoordinatorId || 'ALL');
    }
    if (filterIntent.chapterId !== undefined) {
      setChapterFilter(filterIntent.chapterId || 'ALL');
    }
  }, [filterIntent]);

  // Record Receipt modal state
  const [receiptMemberId, setReceiptMemberId] = useState<string | null>(null);
  const [receiptAmount, setReceiptAmount] = useState('');
  const [receiptDate, setReceiptDate] = useState(data.today);
  const [receiptMethod, setReceiptMethod] = useState<PaymentMethod>('UPI');
  const [receiptRef, setReceiptRef] = useState('');
  const [receiptNotes, setReceiptNotes] = useState('');
  const [receiptAllocs, setReceiptAllocs] = useState<Record<string, number>>({});

  // Record Payout modal state
  const [payoutSubId, setPayoutSubId] = useState<string | null>(null);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [bonusAmount, setBonusAmount] = useState('0');
  const [bonusMessage, setBonusMessage] = useState('Thank you for your outstanding contribution!');
  const [payoutDate, setPayoutDate] = useState(data.today);
  const [payoutMethod, setPayoutMethod] = useState<PaymentMethod>('UPI');
  const [payoutRef, setPayoutRef] = useState('');
  const [payoutNotes, setPayoutNotes] = useState('');
  const [payoutAllocs, setPayoutAllocs] = useState<Record<string, number>>({});

  // Commission Payout modal state (Super Admin only)
  const [commTarget, setCommTarget] = useState<CoordinatorCommission | null>(null);
  const [commPayAmt, setCommPayAmt] = useState('');
  const [commPayDate, setCommPayDate] = useState(data.today);
  const [commPayMethod, setCommPayMethod] = useState<PaymentMethod>('UPI');
  const [commPayRef, setCommPayRef] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const coordName = (id?: string) =>
    id ? data.coordinatorDirectory.find((c) => c.id === id)?.name ?? 'Coordinator' : '—';

  const { startDate, endDate } = useMemo(() => {
    if (datePreset === 'ALL') return { startDate: '', endDate: '' };
    if (datePreset === 'TODAY_TMRW') return { startDate: data.today, endDate: data.tomorrow };
    if (datePreset === 'WEEK') return { startDate: addDays(data.today, -6), endDate: data.tomorrow };
    if (datePreset === 'MONTH') return { startDate: addDays(data.today, -30), endDate: addDays(data.tomorrow, 7) };
    return { startDate: customStart, endDate: customEnd };
  }, [datePreset, data.today, data.tomorrow, customStart, customEnd]);

  const inDateRange = (isoDate: string) => {
    if (!startDate && !endDate) return true;
    if (startDate && isoDate < startDate) return false;
    if (endDate && isoDate > endDate) return false;
    return true;
  };

  const chapterNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of data.chapters) m.set(c.id, c.name);
    return m;
  }, [data.chapters]);

  const q = search.trim().toLowerCase();

  const filteredCharges = useMemo(() => {
    return data.clientCharges.filter((c) => {
      if (dateBasis === 'MEETING_DATE' && !inDateRange(c.meetingDate)) return false;
      if (chapterFilter !== 'ALL') {
        const targetName = chapterNameById.get(chapterFilter);
        if (targetName && c.chapterName !== targetName) return false;
      }
      if (responsibleCoordFilter !== 'ALL' && c.coordinatorId !== responsibleCoordFilter) return false;
      if (viaCoordFilter !== 'ALL' && c.assignedViaCoordinatorId !== viaCoordFilter) return false;
      if (subFilter !== 'ALL' && c.contractSubstituteId !== subFilter) return false;
      if (modeFilter === 'SELF' && c.isDelegated) return false;
      if (modeFilter === 'DELEGATED' && !c.isDelegated) return false;
      const rem = Math.max(0, c.amount - c.receivedAmount);
      if (statusFilter === 'OUTSTANDING' && rem <= 0) return false;
      if (statusFilter === 'SETTLED' && rem > 0) return false;
      if (statusFilter === 'ON_HOLD' && c.status !== 'ON_HOLD') return false;
      if (q) {
        const memberName = data.members.find((m) => m.id === c.memberId)?.name ?? '';
        const text = `${memberName} ${c.chapterName} ${c.actualAttendeeName} ${coordName(c.assignedViaCoordinatorId)}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [
    data.clientCharges,
    data.members,
    dateBasis,
    startDate,
    endDate,
    chapterFilter,
    chapterNameById,
    responsibleCoordFilter,
    viaCoordFilter,
    subFilter,
    modeFilter,
    statusFilter,
    q,
  ]);

  const filteredEarnings = useMemo(() => {
    return data.substituteEarnings.filter((e) => {
      if (dateBasis === 'MEETING_DATE' && !inDateRange(e.meetingDate)) return false;
      if (chapterFilter !== 'ALL') {
        const targetName = chapterNameById.get(chapterFilter);
        if (targetName && e.chapterName !== targetName) return false;
      }
      if (responsibleCoordFilter !== 'ALL' && e.coordinatorId !== responsibleCoordFilter) return false;
      if (viaCoordFilter !== 'ALL' && e.assignedViaCoordinatorId !== viaCoordFilter) return false;
      if (subFilter !== 'ALL' && e.payeeSubstituteId !== subFilter) return false;
      if (modeFilter === 'SELF' && e.isDelegated) return false;
      if (modeFilter === 'DELEGATED' && !e.isDelegated) return false;
      const rem = Math.max(0, e.amount - e.paidAmount);
      if (statusFilter === 'OUTSTANDING' && rem <= 0) return false;
      if (statusFilter === 'SETTLED' && rem > 0) return false;
      if (statusFilter === 'ON_HOLD' && e.status !== 'ON_HOLD') return false;
      if (q) {
        const subName = data.substitutes.find((s) => s.id === e.payeeSubstituteId)?.name ?? '';
        const text = `${subName} ${e.memberName} ${e.chapterName} ${e.actualAttendeeName} ${e.assignedViaCoordinatorName}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [
    data.substituteEarnings,
    data.substitutes,
    dateBasis,
    startDate,
    endDate,
    chapterFilter,
    chapterNameById,
    responsibleCoordFilter,
    viaCoordFilter,
    subFilter,
    modeFilter,
    statusFilter,
    q,
  ]);

  const filteredCommissions = useMemo(() => {
    return (data.coordinatorCommissions ?? []).filter((cm) => {
      if (dateBasis === 'MEETING_DATE' && !inDateRange(cm.meetingDate)) return false;
      if (dateBasis === 'PAYMENT_DATE' && cm.paymentDate && !inDateRange(cm.paymentDate)) return false;
      if (chapterFilter !== 'ALL') {
        const targetName = chapterNameById.get(chapterFilter);
        if (targetName && cm.chapterName !== targetName) return false;
      }
      if (responsibleCoordFilter !== 'ALL' && cm.coordinatorId !== responsibleCoordFilter) return false;
      if (viaCoordFilter !== 'ALL' && cm.coordinatorId !== viaCoordFilter) return false;
      const rem = Math.max(0, cm.amount - cm.paidAmount);
      if (statusFilter === 'OUTSTANDING' && rem <= 0) return false;
      if (statusFilter === 'SETTLED' && rem > 0) return false;
      if (statusFilter === 'ON_HOLD' && cm.status !== 'ON_HOLD') return false;
      if (q) {
        const text = `${coordName(cm.coordinatorId)} ${cm.memberName} ${cm.chapterName} ${cm.actualAttendeeName}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [
    data.coordinatorCommissions,
    dateBasis,
    startDate,
    endDate,
    chapterFilter,
    chapterNameById,
    responsibleCoordFilter,
    viaCoordFilter,
    statusFilter,
    q,
  ]);

  const filteredReceipts = useMemo(() => {
    return data.clientReceipts.filter((r) => {
      if (!inDateRange(r.paymentDate)) return false;
      if (responsibleCoordFilter !== 'ALL' && r.coordinatorId !== responsibleCoordFilter) return false;
      if (q) {
        const mName = data.members.find((m) => m.id === r.memberId)?.name ?? '';
        if (!`${mName} ${r.reference} ${r.method}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [data.clientReceipts, data.members, startDate, endDate, responsibleCoordFilter, q]);

  const filteredPayouts = useMemo(() => {
    return data.freelancerPayouts.filter((p) => {
      if (!inDateRange(p.paymentDate)) return false;
      if (responsibleCoordFilter !== 'ALL' && p.coordinatorId !== responsibleCoordFilter) return false;
      if (subFilter !== 'ALL' && p.payeeSubstituteId !== subFilter) return false;
      if (q) {
        const sName = data.substitutes.find((s) => s.id === p.payeeSubstituteId)?.name ?? '';
        if (!`${sName} ${p.reference} ${p.method}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [data.freelancerPayouts, data.substitutes, startDate, endDate, responsibleCoordFilter, subFilter, q]);

  const summary = useMemo(
    () =>
      computeFinanceSummary(
        filteredCharges,
        filteredEarnings,
        filteredReceipts,
        filteredPayouts,
        filteredCommissions
      ),
    [filteredCharges, filteredEarnings, filteredReceipts, filteredPayouts, filteredCommissions]
  );

  const hasActiveFilters =
    datePreset !== 'ALL' ||
    chapterFilter !== 'ALL' ||
    responsibleCoordFilter !== 'ALL' ||
    viaCoordFilter !== 'ALL' ||
    subFilter !== 'ALL' ||
    modeFilter !== 'ALL' ||
    statusFilter !== 'ALL' ||
    search.trim().length > 0;

  function resetAllFilters() {
    setDatePreset('ALL');
    setDateBasis('MEETING_DATE');
    setChapterFilter('ALL');
    setResponsibleCoordFilter('ALL');
    setViaCoordFilter('ALL');
    setSubFilter('ALL');
    setModeFilter('ALL');
    setStatusFilter('ALL');
    setSearch('');
  }

  // Group filtered charges by Member
  const memberGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        memberId: string;
        memberName: string;
        phone: string;
        whatsapp: string;
        charges: ClientCharge[];
        outstanding: number;
        unpaidCount: number;
      }
    >();
    for (const chg of filteredCharges) {
      const m = data.members.find((x) => x.id === chg.memberId);
      let g = map.get(chg.memberId);
      if (!g) {
        g = {
          memberId: chg.memberId,
          memberName: m?.name ?? 'Member',
          phone: m?.phone ?? '',
          whatsapp: m?.whatsappPhone || m?.phone || '',
          charges: [],
          outstanding: 0,
          unpaidCount: 0,
        };
        map.set(chg.memberId, g);
      }
      g.charges.push(chg);
      const rem = Math.max(0, chg.amount - chg.receivedAmount);
      g.outstanding += rem;
      if (rem > 0) g.unpaidCount += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.outstanding - a.outstanding);
  }, [filteredCharges, data.members]);

  // Group filtered earnings by Registered Substitute / Partner Payee ONLY
  const substituteGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        substituteId: string;
        substituteName: string;
        phone: string;
        whatsapp: string;
        upiReference?: string;
        earnings: SubstituteEarning[];
        outstanding: number;
        unpaidCount: number;
        bonusesTotal: number;
      }
    >();
    for (const earn of filteredEarnings) {
      const s = data.substitutes.find((x) => x.id === earn.payeeSubstituteId);
      let g = map.get(earn.payeeSubstituteId);
      if (!g) {
        const bonusSum = data.appreciationBonuses
          .filter((b) => b.payeeSubstituteId === earn.payeeSubstituteId)
          .reduce((acc, b) => acc + b.amount, 0);
        g = {
          substituteId: earn.payeeSubstituteId,
          substituteName: s?.name ?? 'Registered Substitute',
          phone: s?.phone ?? '',
          whatsapp: s?.whatsappPhone || s?.phone || '',
          upiReference: s?.upiReference,
          earnings: [],
          outstanding: 0,
          unpaidCount: 0,
          bonusesTotal: bonusSum,
        };
        map.set(earn.payeeSubstituteId, g);
      }
      g.earnings.push(earn);
      const rem = Math.max(0, earn.amount - earn.paidAmount);
      g.outstanding += rem;
      if (rem > 0) g.unpaidCount += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.outstanding - a.outstanding);
  }, [filteredEarnings, data.substitutes, data.appreciationBonuses]);

  function openReceiptModal(memberId: string) {
    setError(null);
    const eligible = data.clientCharges.filter(
      (c) => c.memberId === memberId && c.status !== 'ON_HOLD' && c.amount - c.receivedAmount > 0
    );
    const totalDue = eligible.reduce((sum, c) => sum + (c.amount - c.receivedAmount), 0);
    const initialMap: Record<string, number> = {};
    for (const c of eligible) {
      initialMap[c.id] = c.amount - c.receivedAmount;
    }
    setReceiptMemberId(memberId);
    setReceiptAmount(String(totalDue));
    setReceiptDate(data.today);
    setReceiptMethod('UPI');
    setReceiptRef('');
    setReceiptNotes('');
    setReceiptAllocs(initialMap);
  }

  function handleReceiptAmountAutoSplit(val: string) {
    setReceiptAmount(val);
    if (!receiptMemberId) return;
    const num = Number(val) || 0;
    const eligible = data.clientCharges
      .filter((c) => c.memberId === receiptMemberId && c.status !== 'ON_HOLD' && c.amount - c.receivedAmount > 0)
      .map((c) => ({ id: c.id, remaining: c.amount - c.receivedAmount }));
    const allocated = autoAllocateAmount(eligible, num);
    const map: Record<string, number> = {};
    for (const a of allocated) map[a.id] = a.amount;
    setReceiptAllocs(map);
  }

  async function submitReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!receiptMemberId) return;
    setBusy(true);
    setError(null);
    try {
      const allocations = Object.entries(receiptAllocs)
        .filter(([, amt]) => amt > 0)
        .map(([chargeId, amount]) => ({ chargeId, amount }));
      await api.recordReceipt({
        memberId: receiptMemberId,
        amount: Number(receiptAmount),
        paymentDate: receiptDate,
        method: receiptMethod,
        reference: receiptRef.trim(),
        notes: receiptNotes.trim(),
        allocations,
        idempotencyKey: `rcpt-${receiptMemberId}-${receiptRef.trim()}-${receiptAmount}`,
      });
      await onRefresh();
      setReceiptMemberId(null);
      setNotice('Member receipt recorded and allocated across dated meetings.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record receipt.');
    } finally {
      setBusy(false);
    }
  }

  function openPayoutModal(substituteId: string) {
    setError(null);
    const eligible = data.substituteEarnings.filter(
      (e) => e.payeeSubstituteId === substituteId && e.status !== 'ON_HOLD' && e.amount - e.paidAmount > 0
    );
    const totalDue = eligible.reduce((sum, e) => sum + (e.amount - e.paidAmount), 0);
    const initialMap: Record<string, number> = {};
    for (const e of eligible) {
      initialMap[e.id] = e.amount - e.paidAmount;
    }
    setPayoutSubId(substituteId);
    setPayoutAmount(String(totalDue));
    setBonusAmount('0');
    setBonusMessage('Thank you for your outstanding contribution!');
    setPayoutDate(data.today);
    setPayoutMethod('UPI');
    setPayoutRef('');
    setPayoutNotes('');
    setPayoutAllocs(initialMap);
  }

  function handlePayoutAmountAutoSplit(val: string) {
    setPayoutAmount(val);
    if (!payoutSubId) return;
    const num = Number(val) || 0;
    const eligible = data.substituteEarnings
      .filter((e) => e.payeeSubstituteId === payoutSubId && e.status !== 'ON_HOLD' && e.amount - e.paidAmount > 0)
      .map((e) => ({ id: e.id, remaining: e.amount - e.paidAmount }));
    const allocated = autoAllocateAmount(eligible, num);
    const map: Record<string, number> = {};
    for (const a of allocated) map[a.id] = a.amount;
    setPayoutAllocs(map);
  }

  async function submitPayout(e: React.FormEvent) {
    e.preventDefault();
    if (!payoutSubId) return;
    setBusy(true);
    setError(null);
    try {
      const allocations = Object.entries(payoutAllocs)
        .filter(([, amt]) => amt > 0)
        .map(([earningId, amount]) => ({ earningId, amount }));
      await api.recordPayout({
        payeeSubstituteId: payoutSubId,
        amount: Number(payoutAmount) || 0,
        bonusAmount: Number(bonusAmount) || 0,
        bonusMessage,
        paymentDate: payoutDate,
        method: payoutMethod,
        reference: payoutRef.trim(),
        notes: payoutNotes.trim(),
        allocations,
        idempotencyKey: `pay-${payoutSubId}-${payoutRef.trim()}-${payoutAmount}-${bonusAmount}`,
      });
      await onRefresh();
      setPayoutSubId(null);
      setNotice('Substitute payout recorded and allocated cleanly.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record payout.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCommissionPayout(e: React.FormEvent) {
    e.preventDefault();
    if (!commTarget) return;
    setBusy(true);
    setError(null);
    try {
      await api.recordCommissionPayout(commTarget.id, {
        amount: Number(commPayAmt) || 0,
        paymentDate: commPayDate,
        method: commPayMethod,
        reference: commPayRef.trim(),
      });
      await onRefresh();
      setCommTarget(null);
      setNotice('Approved coordinator commission payout recorded.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record commission payout.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {notice && (
        <div role="status" className="px-4 py-2.5 rounded-xl bg-[#F3E8FF] border border-[#DDD6FE] text-xs font-medium text-[#5B21B6] flex items-center justify-between gap-2">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-semibold cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* Segmented Receipts | Payments | Commissions | Ledger Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 rounded-xl bg-[#F8F7FC] border border-[#E6E8EF]">
        {(
          [
            { id: 'receipts', label: `Receipts (${filteredCharges.filter((c) => c.amount > c.receivedAmount).length})` },
            { id: 'payments', label: `Payments (${filteredEarnings.filter((e) => e.amount > e.paidAmount).length})` },
            { id: 'commissions', label: `Commissions (${filteredCommissions.length})` },
            { id: 'ledger', label: 'Ledger' },
          ] as Array<{ id: FinanceTab; label: string }>
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`h-10 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              tab === t.id ? 'bg-[#142342] text-white' : 'text-[#475569] hover:text-[#142342]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Comprehensive Finance Filter Bar */}
      <div className="rounded-xl border border-[#E6E8EF] bg-[#F8F7FC]/70 overflow-hidden">
        <div className="px-3.5 py-2.5 flex items-center justify-between gap-2 border-b border-[#E6E8EF]/80">
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            className="text-xs font-semibold text-[#142342] inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Filter className="w-3.5 h-3.5 text-[#6D28D9]" />
            Finance Filters
            {hasActiveFilters && <span className="text-[#6D28D9]">· Active</span>}
            {filtersOpen ? <ChevronUp className="w-3.5 h-3.5 text-[#64748B]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#64748B]" />}
          </button>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetAllFilters}
              className="text-xs font-semibold text-[#6D28D9] hover:underline cursor-pointer"
            >
              Reset All
            </button>
          )}
        </div>

        {filtersOpen && (
          <div className="p-3.5 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search member, sub, ref..."
                  className="w-full h-9 pl-8 pr-3 rounded-lg border border-[#E6E8EF] bg-white text-xs text-[#142342] focus:outline-none focus:border-[#6D28D9]"
                />
              </div>

              <select
                aria-label="Filter finance by date range"
                value={datePreset}
                onChange={(e) => setDatePreset(e.target.value as DatePreset)}
                className="h-9 px-2.5 rounded-lg border border-[#E6E8EF] bg-white text-xs text-[#142342]"
              >
                <option value="ALL">All Dates</option>
                <option value="TODAY_TMRW">Today &amp; Tomorrow</option>
                <option value="WEEK">Last 7 Days</option>
                <option value="MONTH">Last 30 Days</option>
                <option value="CUSTOM">Custom Range</option>
              </select>

              <select
                aria-label="Filter finance by date basis"
                value={dateBasis}
                onChange={(e) => setDateBasis(e.target.value as 'MEETING_DATE' | 'PAYMENT_DATE')}
                className="h-9 px-2.5 rounded-lg border border-[#E6E8EF] bg-white text-xs text-[#142342]"
              >
                <option value="MEETING_DATE">Basis: Meeting Date</option>
                <option value="PAYMENT_DATE">Basis: Payment Date</option>
              </select>

              <select
                aria-label="Filter finance by payment status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as PayStatusFilter)}
                className="h-9 px-2.5 rounded-lg border border-[#E6E8EF] bg-white text-xs text-[#142342]"
              >
                <option value="ALL">All Statuses</option>
                <option value="OUTSTANDING">Outstanding Only</option>
                <option value="SETTLED">Settled Only</option>
                <option value="ON_HOLD">On Hold / Disputed</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
              <select
                aria-label="Filter finance by chapter"
                value={chapterFilter}
                onChange={(e) => setChapterFilter(e.target.value)}
                className="h-9 px-2.5 rounded-lg border border-[#E6E8EF] bg-white text-xs text-[#142342]"
              >
                <option value="ALL">All Chapters</option>
                {data.chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              {isAdmin && (
                <select
                  aria-label="Filter finance by responsible coordinator"
                  value={responsibleCoordFilter}
                  onChange={(e) => setResponsibleCoordFilter(e.target.value)}
                  className="h-9 px-2.5 rounded-lg border border-[#E6E8EF] bg-white text-xs text-[#142342]"
                >
                  <option value="ALL">Responsible: All</option>
                  {data.coordinatorDirectory.map((c) => (
                    <option key={c.id} value={c.id}>
                      Owner: {c.name}
                    </option>
                  ))}
                </select>
              )}

              <select
                aria-label="Filter finance by assigned via coordinator"
                value={viaCoordFilter}
                onChange={(e) => setViaCoordFilter(e.target.value)}
                className="h-9 px-2.5 rounded-lg border border-[#E6E8EF] bg-white text-xs text-[#142342]"
              >
                <option value="ALL">Assigned Via: All</option>
                {data.coordinatorDirectory.map((c) => (
                  <option key={c.id} value={c.id}>
                    Via {c.name}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter finance by substitute or partner"
                value={subFilter}
                onChange={(e) => setSubFilter(e.target.value)}
                className="h-9 px-2.5 rounded-lg border border-[#E6E8EF] bg-white text-xs text-[#142342]"
              >
                <option value="ALL">All Substitutes / Partners</option>
                {data.substitutes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter finance by fulfillment mode"
                value={modeFilter}
                onChange={(e) => setModeFilter(e.target.value as 'ALL' | 'SELF' | 'DELEGATED')}
                className="h-9 px-2.5 rounded-lg border border-[#E6E8EF] bg-white text-xs text-[#142342]"
              >
                <option value="ALL">Mode: Self &amp; Delegated</option>
                <option value="SELF">Self-Attended Only</option>
                <option value="DELEGATED">Delegated Guest Only</option>
              </select>
            </div>

            {datePreset === 'CUSTOM' && (
              <div className="flex flex-wrap items-center gap-2 text-xs pt-1">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="h-8 px-2.5 rounded-lg border border-[#E6E8EF] bg-white"
                />
                <span className="text-[#64748B]">to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="h-8 px-2.5 rounded-lg border border-[#E6E8EF] bg-white"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Clickable Accrual vs Cash KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2.5">
        <button
          type="button"
          onClick={() => {
            setTab('receipts');
            setStatusFilter('OUTSTANDING');
          }}
          className="p-3.5 rounded-xl border border-[#E6E8EF] hover:border-[#6D28D9]/50 bg-[#F8F7FC] text-left cursor-pointer transition-colors"
        >
          <p className="text-[11px] font-medium text-[#64748B]">To Receive</p>
          <p className="font-display text-lg font-bold text-amber-700 mt-1 tabular-nums">
            {formatINR(summary.receivablesOutstanding)}
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            setTab('payments');
            setStatusFilter('OUTSTANDING');
          }}
          className="p-3.5 rounded-xl border border-[#E6E8EF] hover:border-[#6D28D9]/50 bg-[#F8F7FC] text-left cursor-pointer transition-colors"
        >
          <p className="text-[11px] font-medium text-[#64748B]">To Pay (Subs)</p>
          <p className="font-display text-lg font-bold text-red-600 mt-1 tabular-nums">
            {formatINR(summary.payablesOutstanding)}
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            setTab('commissions');
            setStatusFilter('ALL');
          }}
          className="p-3.5 rounded-xl border border-[#E6E8EF] hover:border-[#6D28D9]/50 bg-[#F8F7FC] text-left cursor-pointer transition-colors"
        >
          <p className="text-[11px] font-medium text-[#64748B]">Appr. Comm. Due</p>
          <p className="font-display text-lg font-bold text-[#B58F3D] mt-1 tabular-nums">
            {formatINR(summary.commissionsOutstanding)}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setTab('ledger')}
          className="p-3.5 rounded-xl border border-[#E6E8EF] hover:border-[#6D28D9]/50 bg-white text-left cursor-pointer transition-colors"
        >
          <p className="text-[11px] font-medium text-[#64748B]">Cash Received</p>
          <p className="font-display text-lg font-bold text-emerald-700 mt-1 tabular-nums">
            {formatINR(summary.cashReceived)}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setTab('ledger')}
          className="p-3.5 rounded-xl border border-[#E6E8EF] hover:border-[#6D28D9]/50 bg-white text-left cursor-pointer transition-colors"
        >
          <p className="text-[11px] font-medium text-[#64748B]">Cash Paid</p>
          <p className="font-display text-lg font-bold text-[#142342] mt-1 tabular-nums">
            {formatINR(summary.cashPaidToSubstitutes)}
          </p>
        </button>

        <div className="p-3.5 rounded-xl border border-[#E6E8EF] bg-white">
          <p className="text-[11px] font-medium text-[#64748B]">Gross Margin</p>
          <p className="font-display text-lg font-bold text-[#6D28D9] mt-1 tabular-nums">
            {formatINR(summary.grossMarginBeforeBonus)}
          </p>
          <p className="text-[11px] text-[#64748B] tabular-nums">
            Net: {formatINR(summary.contributionAfterBonus)}
          </p>
        </div>
      </div>

      {/* RECEIPTS TAB (Member-wise grouped statements) */}
      {tab === 'receipts' && (
        <div className="space-y-3">
          {memberGroups.length === 0 ? (
            <div className="p-8 rounded-xl border border-dashed border-[#E6E8EF] text-center text-sm text-[#64748B]">
              No member charges posted yet. Valid meeting finishes post charges automatically.
            </div>
          ) : (
            memberGroups.map((group) => {
              const isOpen = expandedGroup[`m-${group.memberId}`] ?? true;
              const eligibleDue = group.charges
                .filter((c) => c.status !== 'ON_HOLD')
                .reduce((s, c) => s + Math.max(0, c.amount - c.receivedAmount), 0);

              const reminderLines = group.charges
                .filter((c) => c.amount > c.receivedAmount)
                .map(
                  (c) =>
                    `• ${formatShortDate(c.meetingDate)} — ${c.chapterName} (${c.actualAttendeeName}): Due ${formatINR(
                      c.amount - c.receivedAmount
                    )}`
                )
                .join('\n');

              return (
                <div key={group.memberId} className="rounded-xl border border-[#E6E8EF] bg-white overflow-hidden">
                  <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedGroup((p) => ({ ...p, [`m-${group.memberId}`]: !isOpen }))
                      }
                      className="text-left min-w-0 flex-1 flex items-center gap-2 cursor-pointer"
                    >
                      <span className="text-[#64748B]">
                        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </span>
                      <div className="min-w-0">
                        <p className="font-display text-sm sm:text-base font-bold text-[#142342] truncate">
                          {group.memberName}
                        </p>
                        <p className="text-xs text-[#64748B] tabular-nums">
                          {group.unpaidCount} unpaid · Outstanding{' '}
                          <strong className={group.outstanding > 0 ? 'text-amber-700' : 'text-emerald-700'}>
                            {formatINR(group.outstanding)}
                          </strong>
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <a
                        href={buildTelHref(group.phone)}
                        aria-label={`Call ${group.memberName}`}
                        className="w-9 h-9 rounded-lg border border-[#E6E8EF] bg-white hover:bg-[#F8F7FC] flex items-center justify-center text-[#142342]"
                      >
                        <Phone className="w-4 h-4" />
                      </a>
                      <button
                        type="button"
                        onClick={() =>
                          onOpenDraft({
                            templateType: 'MEMBER_REMINDER',
                            title: `Payment Reminder — ${group.memberName}`,
                            recipientLabel: group.memberName,
                            recipientPhone: group.whatsapp,
                            defaultBody: `Hi ${group.memberName}, here is your AgencyOS statement:\n${reminderLines || 'All meetings settled.'}\nTotal Outstanding: ${formatINR(
                              group.outstanding
                            )}. Thank you!`,
                          })
                        }
                        className="h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        Remind
                      </button>
                      {eligibleDue > 0 && (
                        <button
                          type="button"
                          onClick={() => openReceiptModal(group.memberId)}
                          className="h-9 px-3.5 rounded-lg bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                        >
                          <IndianRupee className="w-3.5 h-3.5" />
                          Record Receipt
                        </button>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-[#E6E8EF] divide-y divide-[#E6E8EF]/70 bg-[#F8F7FC]/40">
                      {group.charges.map((chg) => {
                        const rem = Math.max(0, chg.amount - chg.receivedAmount);
                        return (
                          <div
                            key={chg.id}
                            className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0">
                              <span className="font-semibold text-[#142342]">{formatShortDate(chg.meetingDate)}</span>
                              <span className="text-[#64748B]">
                                {' · '}
                                {chg.chapterName} · Attended by <strong className="text-[#142342]">{chg.actualAttendeeName}</strong>
                                {chg.isDelegated && <span className="text-[#B58F3D] font-semibold"> (Delegated)</span>}
                                {' · '}
                                Via <strong className="text-[#6D28D9]">{coordName(chg.assignedViaCoordinatorId)}</strong>
                              </span>
                              {chg.adjustmentNote && (
                                <p className="text-[11px] text-red-600 mt-0.5">{chg.adjustmentNote}</p>
                              )}
                            </div>
                            <div className="text-right shrink-0 tabular-nums">
                              <span className="font-bold text-[#142342]">Billed {formatINR(chg.amount)}</span>
                              <span className="text-[#64748B]"> · Recd {formatINR(chg.receivedAmount)}</span>
                              <span
                                className={`ml-2 font-semibold ${
                                  chg.status === 'ON_HOLD'
                                    ? 'text-red-600'
                                    : rem === 0
                                    ? 'text-emerald-700'
                                    : 'text-amber-700'
                                }`}
                              >
                                {chg.status === 'ON_HOLD' ? 'On Hold' : rem === 0 ? 'Settled' : `Bal ${formatINR(rem)}`}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* PAYMENTS TAB (Registered Substitute / Partner-wise statements + Appreciation Bonus) */}
      {tab === 'payments' && (
        <div className="space-y-3">
          {substituteGroups.length === 0 ? (
            <div className="p-8 rounded-xl border border-dashed border-[#E6E8EF] text-center text-sm text-[#64748B]">
              No substitute payables recorded yet.
            </div>
          ) : (
            substituteGroups.map((group) => {
              const isOpen = expandedGroup[`s-${group.substituteId}`] ?? true;
              const eligibleDue = group.earnings
                .filter((e) => e.status !== 'ON_HOLD')
                .reduce((s, e) => s + Math.max(0, e.amount - e.paidAmount), 0);

              const stmtLines = group.earnings
                .map(
                  (e) =>
                    `• ${formatShortDate(e.meetingDate)} — ${e.chapterName} (${e.actualAttendeeName}): ${formatINR(
                      e.amount
                    )} (Paid ${formatINR(e.paidAmount)})`
                )
                .join('\n');

              return (
                <div key={group.substituteId} className="rounded-xl border border-[#E6E8EF] bg-white overflow-hidden">
                  <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedGroup((p) => ({ ...p, [`s-${group.substituteId}`]: !isOpen }))
                      }
                      className="text-left min-w-0 flex-1 flex items-center gap-2 cursor-pointer"
                    >
                      <span className="text-[#64748B]">
                        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </span>
                      <div className="min-w-0">
                        <p className="font-display text-sm sm:text-base font-bold text-[#142342] truncate">
                          {group.substituteName}
                        </p>
                        <p className="text-xs text-[#64748B] tabular-nums">
                          {group.unpaidCount} unpaid · Due{' '}
                          <strong className={group.outstanding > 0 ? 'text-red-600' : 'text-emerald-700'}>
                            {formatINR(group.outstanding)}
                          </strong>
                          {group.bonusesTotal > 0 && (
                            <span className="text-[#B58F3D] font-semibold">
                              {' · '}Bonus paid {formatINR(group.bonusesTotal)}
                            </span>
                          )}
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <a
                        href={buildTelHref(group.phone)}
                        aria-label={`Call ${group.substituteName}`}
                        className="w-9 h-9 rounded-lg border border-[#E6E8EF] bg-white hover:bg-[#F8F7FC] flex items-center justify-center text-[#142342]"
                      >
                        <Phone className="w-4 h-4" />
                      </a>
                      <button
                        type="button"
                        onClick={() =>
                          onOpenDraft({
                            templateType: 'PAYOUT_SUMMARY',
                            title: `Payout Summary — ${group.substituteName}`,
                            recipientLabel: group.substituteName,
                            recipientPhone: group.whatsapp,
                            defaultBody: `Thank you for supporting our assignments, ${group.substituteName}.\n${stmtLines}\nAppreciation bonus credited: ${formatINR(
                              group.bonusesTotal
                            )}\nRemaining Balance: ${formatINR(group.outstanding)}`,
                          })
                        }
                        className="h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        Summary
                      </button>
                      {eligibleDue > 0 && (
                        <button
                          type="button"
                          onClick={() => openPayoutModal(group.substituteId)}
                          className="h-9 px-3.5 rounded-lg bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                        >
                          <IndianRupee className="w-3.5 h-3.5" />
                          Record Payout
                        </button>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-[#E6E8EF] divide-y divide-[#E6E8EF]/70 bg-[#F8F7FC]/40">
                      {group.earnings.map((earn) => {
                        const rem = Math.max(0, earn.amount - earn.paidAmount);
                        return (
                          <div
                            key={earn.id}
                            className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0">
                              <span className="font-semibold text-[#142342]">{formatShortDate(earn.meetingDate)}</span>
                              <span className="text-[#64748B]">
                                {' · '}
                                {earn.chapterName} · Attendee: <strong className="text-[#142342]">{earn.actualAttendeeName}</strong>
                                {earn.isDelegated && <span className="text-[#B58F3D] font-semibold"> (Delegated — paid to Partner)</span>}
                                {' · '}
                                Via <strong className="text-[#6D28D9]">{earn.assignedViaCoordinatorName}</strong>
                              </span>
                              {earn.adjustmentNote && (
                                <p className="text-[11px] text-red-600 mt-0.5">{earn.adjustmentNote}</p>
                              )}
                            </div>
                            <div className="text-right shrink-0 tabular-nums">
                              <span className="font-bold text-[#142342]">Payable {formatINR(earn.amount)}</span>
                              <span className="text-[#64748B]"> · Paid {formatINR(earn.paidAmount)}</span>
                              <span
                                className={`ml-2 font-semibold ${
                                  earn.status === 'ON_HOLD'
                                    ? 'text-red-600'
                                    : rem === 0
                                    ? 'text-emerald-700'
                                    : 'text-red-600'
                                }`}
                              >
                                {earn.status === 'ON_HOLD' ? 'On Hold' : rem === 0 ? 'Settled' : `Bal ${formatINR(rem)}`}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* APPROVED COORDINATOR COMMISSIONS TAB (Separate optional ledger — ₹0 by default unless explicitly approved) */}
      {tab === 'commissions' && (
        <div className="space-y-3">
          <div className="p-3.5 rounded-xl bg-[#F8F7FC] border border-[#E6E8EF] text-xs text-[#475569]">
            <strong className="text-[#142342]">Zero-By-Default Policy:</strong> Coordinator commissions are posted here ONLY when explicitly approved on a request/assignment and validly finished. Attribution tags like &ldquo;Assigned Via&rdquo; alone always post ₹0.
          </div>

          <div className="rounded-xl border border-[#E6E8EF] bg-white overflow-hidden divide-y divide-[#E6E8EF]">
            {filteredCommissions.length === 0 ? (
              <p className="p-8 text-center text-sm text-[#64748B]">
                No approved coordinator commissions match the current filter.
              </p>
            ) : (
              filteredCommissions.map((cm) => {
                const rem = Math.max(0, cm.amount - cm.paidAmount);
                return (
                  <div key={cm.id} className="p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <p className="font-display text-sm font-bold text-[#142342]">
                        {coordName(cm.coordinatorId)} · {formatShortDate(cm.meetingDate)} · {cm.chapterName}
                      </p>
                      <p className="text-[#64748B] mt-0.5">
                        Member: <strong className="text-[#142342]">{cm.memberName}</strong> · Attendee: {cm.actualAttendeeName}
                        {cm.paymentReference ? ` · Ref ${cm.paymentReference}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 tabular-nums">
                      <div className="text-right">
                        <p className="font-bold text-[#142342]">Approved {formatINR(cm.amount)}</p>
                        <p className={rem === 0 ? 'text-emerald-700 font-semibold' : 'text-[#B58F3D] font-semibold'}>
                          {rem === 0 ? `Paid ${formatINR(cm.paidAmount)}` : `Due ${formatINR(rem)}`}
                        </p>
                      </div>
                      {isAdmin && rem > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setError(null);
                            setCommTarget(cm);
                            setCommPayAmt(String(rem));
                            setCommPayDate(data.today);
                            setCommPayMethod('UPI');
                            setCommPayRef('');
                          }}
                          className="h-9 px-3 rounded-lg bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold cursor-pointer"
                        >
                          Pay Commission
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* IMMUTABLE LEDGER TAB */}
      {tab === 'ledger' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#E6E8EF] bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E6E8EF] bg-[#F8F7FC] flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-[#142342]">Cash Receipts &amp; Payouts (Immutable)</h3>
              <span className="text-xs text-[#64748B]">Never silently edited or deleted</span>
            </div>
            <div className="divide-y divide-[#E6E8EF]">
              {filteredReceipts.map((r) => {
                const m = data.members.find((x) => x.id === r.memberId);
                return (
                  <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <p className="font-semibold text-[#142342]">
                        Receipt from {m?.name ?? r.memberId} · {r.method}
                      </p>
                      <p className="text-[#64748B] mt-0.5 font-mono text-[11px]">
                        {r.paymentDate} · Ref {r.reference} · {r.allocations.length} meeting(s) allocated
                      </p>
                    </div>
                    <span className="font-display text-sm font-bold text-emerald-700 tabular-nums shrink-0">
                      +{formatINR(r.amount)}
                    </span>
                  </div>
                );
              })}

              {filteredPayouts.map((p) => {
                const s = data.substitutes.find((x) => x.id === p.payeeSubstituteId);
                return (
                  <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <p className="font-semibold text-[#142342]">
                        Payout to {s?.name ?? p.payeeSubstituteId} · {p.method}
                        {p.bonusAmount > 0 && (
                          <span className="ml-1.5 text-[#B58F3D] inline-flex items-center gap-0.5">
                            <Award className="w-3.5 h-3.5" />
                            +{formatINR(p.bonusAmount)} Bonus
                          </span>
                        )}
                      </p>
                      <p className="text-[#64748B] mt-0.5 font-mono text-[11px]">
                        {p.paymentDate} · Ref {p.reference} · {p.allocations.length} meeting(s) allocated
                      </p>
                    </div>
                    <span className="font-display text-sm font-bold text-[#142342] tabular-nums shrink-0">
                      -{formatINR(p.totalTransferred)}
                    </span>
                  </div>
                );
              })}

              {data.ledgerAdjustments.map((adj) => (
                <div key={adj.id} className="px-4 py-3 flex items-center justify-between gap-3 text-xs bg-amber-50/40">
                  <div>
                    <p className="font-semibold text-[#142342]">
                      Audited Adjustment ({adj.targetType.replace(/_/g, ' ')})
                    </p>
                    <p className="text-[#475569] mt-0.5">{adj.reason}</p>
                  </div>
                  <span className="font-mono font-bold text-amber-800 tabular-nums">
                    {adj.deltaAmount >= 0 ? `+${formatINR(adj.deltaAmount)}` : `-${formatINR(Math.abs(adj.deltaAmount))}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* RECORD RECEIPT MODAL */}
      {receiptMemberId && (
        <div className="fixed inset-0 z-50 bg-[#142342]/45 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Record Receipt">
          <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl border border-[#E6E8EF] max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E6E8EF] flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-[#142342]">Record Member Receipt</h2>
                <p className="text-xs text-[#64748B]">
                  {data.members.find((m) => m.id === receiptMemberId)?.name} · Supports partial or batch settlement
                </p>
              </div>
              <button type="button" onClick={() => setReceiptMemberId(null)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#64748B]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={submitReceipt} className="p-5 overflow-y-auto space-y-3.5">
              {error && <p className="p-2.5 rounded-lg bg-red-50 text-xs text-red-700">{error}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#142342] mb-1">Amount Received (₹) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={receiptAmount}
                    onChange={(e) => handleReceiptAmountAutoSplit(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#142342] mb-1">Payment Date *</label>
                  <input
                    type="date"
                    required
                    value={receiptDate}
                    onChange={(e) => setReceiptDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#142342] mb-1">Method</label>
                  <select
                    value={receiptMethod}
                    onChange={(e) => setReceiptMethod(e.target.value as PaymentMethod)}
                    className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] bg-white text-sm"
                  >
                    <option value="UPI">UPI</option>
                    <option value="BANK_TRANSFER">Bank Transfer / NEFT</option>
                    <option value="CASH">Cash</option>
                    <option value="CHEQUE">Cheque</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#142342] mb-1">UTR / Reference *</label>
                  <input
                    type="text"
                    required
                    value={receiptRef}
                    onChange={(e) => setReceiptRef(e.target.value)}
                    placeholder="e.g. UPI-884122"
                    className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm font-mono"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-[#142342]">Itemized Meeting Allocation</p>
                <div className="divide-y divide-[#E6E8EF] rounded-xl border border-[#E6E8EF] bg-[#F8F7FC]">
                  {data.clientCharges
                    .filter((c) => c.memberId === receiptMemberId && c.status !== 'ON_HOLD' && c.amount > c.receivedAmount)
                    .map((c) => {
                      const rem = c.amount - c.receivedAmount;
                      return (
                        <div key={c.id} className="p-3 flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <p className="font-semibold text-[#142342] truncate">
                              {formatShortDate(c.meetingDate)} · {c.chapterName}
                            </p>
                            <p className="text-[#64748B] tabular-nums">Remaining: {formatINR(rem)}</p>
                          </div>
                          <input
                            type="number"
                            min={0}
                            max={rem}
                            value={receiptAllocs[c.id] ?? 0}
                            onChange={(e) =>
                              setReceiptAllocs((prev) => ({ ...prev, [c.id]: Number(e.target.value) || 0 }))
                            }
                            className="w-24 h-9 px-2.5 rounded-lg border border-[#E6E8EF] bg-white text-right text-xs font-semibold tabular-nums"
                          />
                        </div>
                      );
                    })}
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setReceiptMemberId(null)} className="h-10 px-4 rounded-xl border border-[#E6E8EF] text-xs font-semibold">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="h-10 px-5 rounded-xl bg-[#6D28D9] text-white text-xs font-semibold inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  Confirm Receipt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RECORD PAYOUT MODAL (Supports Multi-Meeting Allocation + Optional Appreciation Bonus) */}
      {payoutSubId && (
        <div className="fixed inset-0 z-50 bg-[#142342]/45 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Record Payout">
          <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl border border-[#E6E8EF] max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E6E8EF] flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-[#142342]">Record Substitute Payout</h2>
                <p className="text-xs text-[#64748B]">
                  Payee: {data.substitutes.find((s) => s.id === payoutSubId)?.name} (Registered Partner Only)
                </p>
              </div>
              <button type="button" onClick={() => setPayoutSubId(null)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#64748B]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={submitPayout} className="p-5 overflow-y-auto space-y-3.5">
              {error && <p className="p-2.5 rounded-lg bg-red-50 text-xs text-red-700">{error}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#142342] mb-1">Meeting Payout (₹) *</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={payoutAmount}
                    onChange={(e) => handlePayoutAmountAutoSplit(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#142342] mb-1">Payment Date *</label>
                  <input
                    type="date"
                    required
                    value={payoutDate}
                    onChange={(e) => setPayoutDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#142342] mb-1">Method</label>
                  <select
                    value={payoutMethod}
                    onChange={(e) => setPayoutMethod(e.target.value as PaymentMethod)}
                    className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] bg-white text-sm"
                  >
                    <option value="UPI">UPI</option>
                    <option value="BANK_TRANSFER">Bank Transfer / IMPS</option>
                    <option value="CASH">Cash</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#142342] mb-1">Transfer Reference *</label>
                  <input
                    type="text"
                    required
                    value={payoutRef}
                    onChange={(e) => setPayoutRef(e.target.value)}
                    placeholder="e.g. IMPS-991042"
                    className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm font-mono"
                  />
                </div>
              </div>

              {/* Optional Appreciation Bonus (Agency cost, NEVER billed to member!) */}
              <div className="p-3.5 rounded-xl bg-[#F8F7FC] border border-[#E6E8EF] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#142342] inline-flex items-center gap-1.5">
                    <Award className="w-4 h-4 text-[#B58F3D]" />
                    Optional Appreciation Bonus
                  </span>
                  <span className="text-[11px] text-[#64748B]">Agency cost only (never billed to member)</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="number"
                    min={0}
                    value={bonusAmount}
                    onChange={(e) => setBonusAmount(e.target.value)}
                    placeholder="₹0"
                    className="h-9 px-2.5 rounded-lg border border-[#E6E8EF] bg-white text-xs tabular-nums"
                  />
                  <input
                    type="text"
                    value={bonusMessage}
                    onChange={(e) => setBonusMessage(e.target.value)}
                    placeholder="Gratitude note"
                    className="col-span-2 h-9 px-2.5 rounded-lg border border-[#E6E8EF] bg-white text-xs"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-[#142342]">Itemized Meeting Allocation</p>
                <div className="divide-y divide-[#E6E8EF] rounded-xl border border-[#E6E8EF] bg-[#F8F7FC]">
                  {data.substituteEarnings
                    .filter((e) => e.payeeSubstituteId === payoutSubId && e.status !== 'ON_HOLD' && e.amount > e.paidAmount)
                    .map((e) => {
                      const rem = e.amount - e.paidAmount;
                      return (
                        <div key={e.id} className="p-3 flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <p className="font-semibold text-[#142342] truncate">
                              {formatShortDate(e.meetingDate)} · {e.chapterName} ({e.actualAttendeeName})
                            </p>
                            <p className="text-[#64748B] tabular-nums">Remaining: {formatINR(rem)}</p>
                          </div>
                          <input
                            type="number"
                            min={0}
                            max={rem}
                            value={payoutAllocs[e.id] ?? 0}
                            onChange={(ev) =>
                              setPayoutAllocs((prev) => ({ ...prev, [e.id]: Number(ev.target.value) || 0 }))
                            }
                            className="w-24 h-9 px-2.5 rounded-lg border border-[#E6E8EF] bg-white text-right text-xs font-semibold tabular-nums"
                          />
                        </div>
                      );
                    })}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[#E6E8EF]">
                <span className="text-xs font-semibold text-[#142342] tabular-nums">
                  Total Transfer: {formatINR((Number(payoutAmount) || 0) + (Number(bonusAmount) || 0))}
                </span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPayoutSubId(null)} className="h-10 px-4 rounded-xl border border-[#E6E8EF] text-xs font-semibold">
                    Cancel
                  </button>
                  <button type="submit" disabled={busy} className="h-10 px-5 rounded-xl bg-[#6D28D9] text-white text-xs font-semibold cursor-pointer">
                    Confirm Payout
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RECORD COMMISSION PAYOUT MODAL (Super Admin Only) */}
      {commTarget && isAdmin && (
        <div className="fixed inset-0 z-50 bg-[#142342]/45 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Pay coordinator commission">
          <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl border border-[#E6E8EF] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E6E8EF] flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-[#142342]">Pay Approved Commission</h2>
                <p className="text-xs text-[#64748B]">
                  {coordName(commTarget.coordinatorId)} · {commTarget.chapterName} ({formatShortDate(commTarget.meetingDate)})
                </p>
              </div>
              <button type="button" onClick={() => setCommTarget(null)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#64748B]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={submitCommissionPayout} className="p-5 space-y-3.5">
              {error && <p className="p-2.5 rounded-lg bg-red-50 text-xs text-red-700">{error}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#142342] mb-1">Amount (₹) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={commTarget.amount - commTarget.paidAmount}
                    value={commPayAmt}
                    onChange={(e) => setCommPayAmt(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#142342] mb-1">Payment Date *</label>
                  <input
                    type="date"
                    required
                    value={commPayDate}
                    onChange={(e) => setCommPayDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#142342] mb-1">Method</label>
                  <select
                    value={commPayMethod}
                    onChange={(e) => setCommPayMethod(e.target.value as PaymentMethod)}
                    className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] bg-white text-sm"
                  >
                    <option value="UPI">UPI</option>
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                    <option value="CASH">Cash</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#142342] mb-1">Reference *</label>
                  <input
                    type="text"
                    required
                    value={commPayRef}
                    onChange={(e) => setCommPayRef(e.target.value)}
                    placeholder="UPI / IMPS ref"
                    className="w-full h-10 px-3 rounded-xl border border-[#E6E8EF] text-sm font-mono"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setCommTarget(null)} className="h-10 px-4 rounded-xl border border-[#E6E8EF] text-xs font-semibold">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="h-10 px-5 rounded-xl bg-[#6D28D9] text-white text-xs font-semibold cursor-pointer">
                  Confirm Commission Payout
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
