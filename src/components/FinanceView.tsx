import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpDown,
  ArrowUpRight,
  Award,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Filter,
  MessageCircle,
  Search,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import { api, ApiError, type AdminBootstrapData } from '../lib/api';
import type { FinanceFilterIntent } from '../App';
import {
  autoAllocateAmount,
  buildMemberReminderWhatsAppText,
  buildPayoutSummaryWhatsAppText,
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

type FinanceTab = 'receivables' | 'payables' | 'receipts_log' | 'payouts_log' | 'commissions';
type DatePreset = 'ALL' | 'TODAY_TMRW' | 'WEEK' | 'MONTH' | 'CUSTOM';
type PayStatusFilter = 'ALL' | 'OUTSTANDING' | 'SETTLED' | 'ON_HOLD';
type FinanceSortBy = 'OUTSTANDING_DESC' | 'TOTAL_DESC' | 'DATE_DESC' | 'NAME_ASC';

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
  const [tab, setTab] = useState<FinanceTab>('receivables');
  const [expandedChapter, setExpandedChapter] = useState<Record<string, boolean>>({});
  const [expandedPayableChapter, setExpandedPayableChapter] = useState<Record<string, boolean>>({});
  const [groupReceivablesByChapter, setGroupReceivablesByChapter] = useState(true);
  const [groupPayablesByChapter, setGroupPayablesByChapter] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Comprehensive Finance filters + Sort By (shared cleanly across Receivables & Payables)
  const [sortBy, setSortBy] = useState<FinanceSortBy>('OUTSTANDING_DESC');
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
    if (filterIntent.tab) {
      if (filterIntent.tab === 'receipts') setTab('receivables');
      else if (filterIntent.tab === 'payments') setTab('payables');
      else if (filterIntent.tab === 'ledger') setTab('receipts_log');
      else if (filterIntent.tab === 'commissions') setTab('commissions');
    }
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

  // Group filtered charges by Member with Sort By support
  const memberGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        memberId: string;
        memberName: string;
        chapterName: string;
        phone: string;
        whatsapp: string;
        charges: ClientCharge[];
        totalBilled: number;
        outstanding: number;
        unpaidCount: number;
        latestDate: string;
      }
    >();
    for (const chg of filteredCharges) {
      const m = data.members.find((x) => x.id === chg.memberId);
      const chapterName =
        chg.chapterName ||
        (m ? data.chapters.find((ch) => ch.id === m.chapterId)?.name : undefined) ||
        'Unassigned Chapter';
      let g = map.get(chg.memberId);
      if (!g) {
        g = {
          memberId: chg.memberId,
          memberName: m?.name ?? 'Member',
          chapterName,
          phone: m?.phone ?? '',
          whatsapp: m?.whatsappPhone || m?.phone || '',
          charges: [],
          totalBilled: 0,
          outstanding: 0,
          unpaidCount: 0,
          latestDate: chg.meetingDate,
        };
        map.set(chg.memberId, g);
      }
      g.charges.push(chg);
      g.totalBilled += chg.amount;
      const rem = Math.max(0, chg.amount - chg.receivedAmount);
      g.outstanding += rem;
      if (rem > 0) g.unpaidCount += 1;
      if (chg.meetingDate > g.latestDate) g.latestDate = chg.meetingDate;
    }
    const list = Array.from(map.values()).map((g) => ({
      ...g,
      charges: [...g.charges].sort((a, b) => b.meetingDate.localeCompare(a.meetingDate)),
    }));
    return list.sort((a, b) => {
      if (sortBy === 'TOTAL_DESC') return b.totalBilled - a.totalBilled;
      if (sortBy === 'DATE_DESC') return b.latestDate.localeCompare(a.latestDate);
      if (sortBy === 'NAME_ASC') return a.memberName.localeCompare(b.memberName);
      return b.outstanding - a.outstanding || b.totalBilled - a.totalBilled;
    });
  }, [filteredCharges, data.members, data.chapters, sortBy]);

  // Group member cards cleanly under collapsible Chapter dropdown sections
  const receivablesByChapter = useMemo(() => {
    const map = new Map<
      string,
      {
        chapterName: string;
        members: typeof memberGroups;
        totalBilled: number;
        totalOutstanding: number;
        meetingCount: number;
      }
    >();
    for (const m of memberGroups) {
      let bucket = map.get(m.chapterName);
      if (!bucket) {
        bucket = {
          chapterName: m.chapterName,
          members: [],
          totalBilled: 0,
          totalOutstanding: 0,
          meetingCount: 0,
        };
        map.set(m.chapterName, bucket);
      }
      bucket.members.push(m);
      bucket.totalBilled += m.totalBilled;
      bucket.totalOutstanding += m.outstanding;
      bucket.meetingCount += m.charges.length;
    }
    return Array.from(map.values()).sort((a, b) => {
      if (sortBy === 'NAME_ASC') return a.chapterName.localeCompare(b.chapterName);
      if (sortBy === 'TOTAL_DESC') return b.totalBilled - a.totalBilled;
      return b.totalOutstanding - a.totalOutstanding || b.totalBilled - a.totalBilled;
    });
  }, [memberGroups, sortBy]);

  // Group filtered earnings by Veloctive Team / Partner Payee ONLY with Sort By support
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
        totalEarned: number;
        outstanding: number;
        unpaidCount: number;
        bonusesTotal: number;
        latestDate: string;
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
          substituteName: s?.name ?? 'Veloctive Team',
          phone: s?.phone ?? '',
          whatsapp: s?.whatsappPhone || s?.phone || '',
          upiReference: s?.upiReference,
          earnings: [],
          totalEarned: 0,
          outstanding: 0,
          unpaidCount: 0,
          bonusesTotal: bonusSum,
          latestDate: earn.meetingDate,
        };
        map.set(earn.payeeSubstituteId, g);
      }
      g.earnings.push(earn);
      g.totalEarned += earn.amount;
      const rem = Math.max(0, earn.amount - earn.paidAmount);
      g.outstanding += rem;
      if (rem > 0) g.unpaidCount += 1;
      if (earn.meetingDate > g.latestDate) g.latestDate = earn.meetingDate;
    }
    const list = Array.from(map.values()).map((g) => ({
      ...g,
      earnings: [...g.earnings].sort((a, b) => b.meetingDate.localeCompare(a.meetingDate)),
    }));
    return list.sort((a, b) => {
      if (sortBy === 'TOTAL_DESC') return b.totalEarned - a.totalEarned;
      if (sortBy === 'DATE_DESC') return b.latestDate.localeCompare(a.latestDate);
      if (sortBy === 'NAME_ASC') return a.substituteName.localeCompare(b.substituteName);
      return b.outstanding - a.outstanding || b.totalEarned - a.totalEarned;
    });
  }, [filteredEarnings, data.substitutes, data.appreciationBonuses, sortBy]);

  // Group filtered payables cleanly by Chapter -> Substitute (SS #4: By chapter | By substitute)
  const payablesByChapter = useMemo(() => {
    const chapterMap = new Map<
      string,
      {
        chapterName: string;
        substitutesMap: Map<
          string,
          {
            substituteId: string;
            substituteName: string;
            whatsapp: string;
            earnings: SubstituteEarning[];
            totalEarned: number;
            outstanding: number;
            bonusesTotal: number;
            latestDate: string;
          }
        >;
        totalEarned: number;
        totalOutstanding: number;
        meetingCount: number;
      }
    >();

    for (const earn of filteredEarnings) {
      const chName = earn.chapterName || 'Unassigned Chapter';
      let chBucket = chapterMap.get(chName);
      if (!chBucket) {
        chBucket = {
          chapterName: chName,
          substitutesMap: new Map(),
          totalEarned: 0,
          totalOutstanding: 0,
          meetingCount: 0,
        };
        chapterMap.set(chName, chBucket);
      }

      const s = data.substitutes.find((x) => x.id === earn.payeeSubstituteId);
      let subBucket = chBucket.substitutesMap.get(earn.payeeSubstituteId);
      if (!subBucket) {
        const bonusSum = data.appreciationBonuses
          .filter((b) => b.payeeSubstituteId === earn.payeeSubstituteId)
          .reduce((acc, b) => acc + b.amount, 0);
        subBucket = {
          substituteId: earn.payeeSubstituteId,
          substituteName: s?.name ?? 'Veloctive Team',
          whatsapp: s?.whatsappPhone || s?.phone || '',
          earnings: [],
          totalEarned: 0,
          outstanding: 0,
          bonusesTotal: bonusSum,
          latestDate: earn.meetingDate,
        };
        chBucket.substitutesMap.set(earn.payeeSubstituteId, subBucket);
      }

      subBucket.earnings.push(earn);
      subBucket.totalEarned += earn.amount;
      const rem = Math.max(0, earn.amount - earn.paidAmount);
      subBucket.outstanding += rem;
      if (earn.meetingDate > subBucket.latestDate) subBucket.latestDate = earn.meetingDate;

      chBucket.totalEarned += earn.amount;
      chBucket.totalOutstanding += rem;
      chBucket.meetingCount += 1;
    }

    return Array.from(chapterMap.values())
      .map((ch) => ({
        chapterName: ch.chapterName,
        totalEarned: ch.totalEarned,
        totalOutstanding: ch.totalOutstanding,
        meetingCount: ch.meetingCount,
        substitutes: Array.from(ch.substitutesMap.values())
          .map((sub) => ({
            ...sub,
            earnings: [...sub.earnings].sort((a, b) => b.meetingDate.localeCompare(a.meetingDate)),
          }))
          .sort((a, b) => {
            if (sortBy === 'TOTAL_DESC') return b.totalEarned - a.totalEarned;
            if (sortBy === 'DATE_DESC') return b.latestDate.localeCompare(a.latestDate);
            if (sortBy === 'NAME_ASC') return a.substituteName.localeCompare(b.substituteName);
            return b.outstanding - a.outstanding || b.totalEarned - a.totalEarned;
          }),
      }))
      .sort((a, b) => {
        if (sortBy === 'NAME_ASC') return a.chapterName.localeCompare(b.chapterName);
        if (sortBy === 'TOTAL_DESC') return b.totalEarned - a.totalEarned;
        return b.totalOutstanding - a.totalOutstanding || b.totalEarned - a.totalEarned;
      });
  }, [filteredEarnings, data.substitutes, data.appreciationBonuses, sortBy]);

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
      setNotice('Veloctive Team payout recorded and allocated cleanly.');
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
        <div role="status" className="px-4 py-2.5 rounded-[6px] bg-[#C81E2B]/20 border border-[#E12D39]/40 text-xs font-medium text-[#F5DFA0] flex items-center justify-between gap-2">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-semibold cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* Top 4 KPI Cards matching SS #4: TO RECEIVE | TO PAY | GROSS MARGIN | BONUS (AGENCY) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => {
            setTab('receivables');
            setStatusFilter('OUTSTANDING');
          }}
          className={`p-4 rounded-xl border bg-[#18181a] text-left cursor-pointer transition-colors ${
            tab === 'receivables'
              ? 'border-[#C81E2B]/65'
              : 'border-[#f2efeb]/10 hover:border-[#C81E2B]/45'
          }`}
        >
          <div className="w-7 h-7 rounded-lg bg-emerald-500/14 text-emerald-400 flex items-center justify-center mb-3">
            <ArrowUpRight className="w-4 h-4" />
          </div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#f2efeb]/55">
            To Receive
          </p>
          <p className="font-display text-xl font-bold tracking-tight text-emerald-400 mt-0.5 tabular-nums">
            {formatINR(summary.receivablesOutstanding)}
          </p>
          <p className="text-[11px] text-[#f2efeb]/45 mt-0.5 tabular-nums">
            Received {formatINR(summary.cashReceived)}
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            setTab('payables');
            setStatusFilter('OUTSTANDING');
          }}
          className={`p-4 rounded-xl border bg-[#18181a] text-left cursor-pointer transition-colors ${
            tab === 'payables'
              ? 'border-[#C81E2B]/65'
              : 'border-[#f2efeb]/10 hover:border-[#C81E2B]/45'
          }`}
        >
          <div className="w-7 h-7 rounded-lg bg-[#C81E2B]/14 text-[#E12D39] flex items-center justify-center mb-3">
            <ArrowDownRight className="w-4 h-4" />
          </div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#f2efeb]/55">
            To Pay
          </p>
          <p className="font-display text-xl font-bold tracking-tight text-[#E12D39] mt-0.5 tabular-nums">
            {formatINR(summary.payablesOutstanding)}
          </p>
          <p className="text-[11px] text-[#f2efeb]/45 mt-0.5 tabular-nums">
            Paid {formatINR(summary.cashPaidToSubstitutes)}
          </p>
        </button>

        <div className="p-4 rounded-xl border border-[#f2efeb]/10 bg-[#18181a]">
          <div className="w-7 h-7 rounded-lg bg-[#C81E2B]/12 text-[#E12D39] flex items-center justify-center mb-3">
            <TrendingUp className="w-4 h-4" />
          </div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#f2efeb]/55">
            Gross Margin
          </p>
          <p className="font-display text-xl font-bold tracking-tight text-[#f2efeb] mt-0.5 tabular-nums">
            {formatINR(summary.grossMarginBeforeBonus)}
          </p>
          <p className="text-[11px] text-[#f2efeb]/45 mt-0.5 tabular-nums">
            Net {formatINR(summary.contributionAfterBonus)}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setTab('payouts_log')}
          className="p-4 rounded-xl border border-[#f2efeb]/10 hover:border-[#E2B340]/45 bg-[#18181a] text-left cursor-pointer transition-colors"
        >
          <div className="w-7 h-7 rounded-lg bg-[#E2B340]/14 text-[#E2B340] flex items-center justify-center mb-3">
            <Sparkles className="w-4 h-4" />
          </div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#f2efeb]/55">
            Bonus (Agency)
          </p>
          <p className="font-display text-xl font-bold tracking-tight text-[#E2B340] mt-0.5 tabular-nums">
            {formatINR(summary.agencyBonusPaid)}
          </p>
          <p className="text-[11px] text-[#f2efeb]/45 mt-0.5 tabular-nums">
            Appreciation rewards
          </p>
        </button>
      </div>

      {/* Clean Segmented Tabs matching SS #4: Receivables | Payables | Receipts | Payouts (+ Commissions) */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Finance views">
        {(
          [
            { id: 'receivables', label: 'Receivables' },
            { id: 'payables', label: 'Payables' },
            { id: 'receipts_log', label: 'Receipts' },
            { id: 'payouts_log', label: 'Payouts' },
            ...(isAdmin || filteredCommissions.length > 0
              ? [{ id: 'commissions' as FinanceTab, label: 'Commissions' }]
              : []),
          ] as Array<{ id: FinanceTab; label: string }>
        ).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`h-9 px-4 rounded-xl text-xs sm:text-[13px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                active
                  ? 'bg-[#C81E2B] text-white border border-[#C81E2B]'
                  : 'bg-[#18181a] text-[#f2efeb]/80 border border-[#f2efeb]/12 hover:border-[#C81E2B]/50 hover:text-[#f2efeb]'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Clean Single-Row Filter Strip matching SS #4 (Chapter, Sort, Only outstanding, By chapter / By member or By substitute + More Filters) */}
      <div className="p-3 rounded-xl border border-[#f2efeb]/10 bg-[#18181a] flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#f2efeb]/60 pr-1">
            <Filter className="w-3.5 h-3.5" />
            Filters
          </span>

          <select
            aria-label="Filter finance by chapter"
            data-testid="finance-chapter-select"
            value={chapterFilter}
            onChange={(e) => setChapterFilter(e.target.value)}
            className="h-9 px-3 rounded-lg border border-[#f2efeb]/12 bg-[#111113] text-xs font-medium text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
          >
            <option value="ALL">All chapters</option>
            {data.chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <div className="relative inline-flex items-center">
            <ArrowUpDown className="w-3.5 h-3.5 text-[#E2B340] absolute left-2.5 pointer-events-none" />
            <select
              aria-label="Sort receivables and payables"
              data-testid="finance-sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as FinanceSortBy)}
              className="h-9 pl-8 pr-3 rounded-lg border border-[#f2efeb]/12 bg-[#111113] text-xs font-medium text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
            >
              <option value="OUTSTANDING_DESC">Outstanding ↓</option>
              <option value="TOTAL_DESC">Billed / Earned ↓</option>
              <option value="DATE_DESC">Latest date ↓</option>
              <option value="NAME_ASC">Name (A → Z)</option>
            </select>
          </div>

          <label className="h-9 px-3 rounded-lg border border-[#f2efeb]/12 bg-[#111113] inline-flex items-center gap-2 text-xs font-medium text-[#f2efeb]/80 cursor-pointer select-none">
            <input
              type="checkbox"
              data-testid="finance-only-outstanding-checkbox"
              checked={statusFilter === 'OUTSTANDING'}
              onChange={(e) => setStatusFilter(e.target.checked ? 'OUTSTANDING' : 'ALL')}
              className="accent-[#C81E2B]"
            />
            <span>Only outstanding</span>
          </label>

          {tab === 'receivables' && (
            <div
              className="inline-flex items-center p-0.5 rounded-lg border border-[#f2efeb]/12 bg-[#111113]"
              role="group"
              aria-label="Receivables grouping"
            >
              <button
                type="button"
                data-testid="receivables-by-chapter-btn"
                onClick={() => setGroupReceivablesByChapter(true)}
                className={`h-8 px-3 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                  groupReceivablesByChapter
                    ? 'bg-[#C81E2B] text-white'
                    : 'text-[#f2efeb]/70 hover:text-[#f2efeb]'
                }`}
              >
                By chapter
              </button>
              <button
                type="button"
                data-testid="receivables-by-member-btn"
                onClick={() => setGroupReceivablesByChapter(false)}
                className={`h-8 px-3 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                  !groupReceivablesByChapter
                    ? 'bg-[#C81E2B] text-white'
                    : 'text-[#f2efeb]/70 hover:text-[#f2efeb]'
                }`}
              >
                By member
              </button>
            </div>
          )}

          {tab === 'payables' && (
            <div
              className="inline-flex items-center p-0.5 rounded-lg border border-[#f2efeb]/12 bg-[#111113]"
              role="group"
              aria-label="Payables grouping"
            >
              <button
                type="button"
                data-testid="payables-by-chapter-btn"
                onClick={() => setGroupPayablesByChapter(true)}
                className={`h-8 px-3 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                  groupPayablesByChapter
                    ? 'bg-[#C81E2B] text-white'
                    : 'text-[#f2efeb]/70 hover:text-[#f2efeb]'
                }`}
              >
                By chapter
              </button>
              <button
                type="button"
                data-testid="payables-by-substitute-btn"
                onClick={() => setGroupPayablesByChapter(false)}
                className={`h-8 px-3 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                  !groupPayablesByChapter
                    ? 'bg-[#C81E2B] text-white'
                    : 'text-[#f2efeb]/70 hover:text-[#f2efeb]'
                }`}
              >
                By substitute
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          className={`h-9 px-3 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
            filtersOpen || hasActiveFilters
              ? 'border-[#E2B340]/50 bg-[#1f1f23] text-[#E2B340]'
              : 'border-[#f2efeb]/12 bg-[#111113] text-[#f2efeb]/75 hover:text-[#f2efeb]'
          }`}
        >
          More Filters{hasActiveFilters ? ' · Active' : ''}
        </button>
      </div>

      {/* Collapsible Advanced Filter Drawer */}
      {filtersOpen && (
        <div className="rounded-xl border border-[#f2efeb]/10 bg-[#18181a] p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#f2efeb]/80">Advanced Filters</span>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="text-xs font-semibold text-[#E2B340] hover:underline cursor-pointer"
              >
                Reset All
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#f2efeb]/45 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search member, substitute, ref..."
                className="w-full h-9 pl-8 pr-3 rounded-lg border border-[#f2efeb]/10 bg-[#111113] text-xs text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
              />
            </div>

            <select
              aria-label="Filter finance by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as PayStatusFilter)}
              className="h-9 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#111113] text-xs text-[#f2efeb]"
            >
              <option value="ALL">All Statuses</option>
              <option value="OUTSTANDING">Outstanding Only</option>
              <option value="SETTLED">Settled Only</option>
              <option value="ON_HOLD">On Hold / Disputed</option>
            </select>

            <select
              aria-label="Filter finance by date range"
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value as DatePreset)}
              className="h-9 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#111113] text-xs text-[#f2efeb]"
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
              className="h-9 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#111113] text-xs text-[#f2efeb]"
            >
              <option value="MEETING_DATE">Basis: Meeting Date</option>
              <option value="PAYMENT_DATE">Basis: Payment Date</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {isAdmin && (
              <select
                aria-label="Filter finance by responsible coordinator"
                value={responsibleCoordFilter}
                onChange={(e) => setResponsibleCoordFilter(e.target.value)}
                className="h-9 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#111113] text-xs text-[#f2efeb]"
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
              className="h-9 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#111113] text-xs text-[#f2efeb]"
            >
              <option value="ALL">Assigned Via: All</option>
              {data.coordinatorDirectory.map((c) => (
                <option key={c.id} value={c.id}>
                  Via {c.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter finance by Veloctive Team or partner"
              value={subFilter}
              onChange={(e) => setSubFilter(e.target.value)}
              className="h-9 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#111113] text-xs text-[#f2efeb]"
            >
              <option value="ALL">All Veloctive Team / Partners</option>
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
              className="h-9 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#111113] text-xs text-[#f2efeb]"
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
                className="h-8 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#111113]"
              />
              <span className="text-[#f2efeb]/60">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-8 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#111113]"
              />
            </div>
          )}
        </div>
      )}

      {/* ==================== RECEIVABLES TAB (BY CHAPTER | BY MEMBER — SS #4) ==================== */}
      {tab === 'receivables' && (
        <div className="space-y-4">
          {memberGroups.length === 0 ? (
            <div className="p-8 rounded-xl border border-dashed border-[#f2efeb]/12 text-center text-sm text-[#f2efeb]/60">
              No member receivables match this filter.
            </div>
          ) : groupReceivablesByChapter ? (
            <div className="space-y-4">
              {receivablesByChapter.map((chGroup) => {
                const isChapterOpen = expandedChapter[chGroup.chapterName] ?? true;
                return (
                  <div
                    key={chGroup.chapterName}
                    data-testid={`receivables-chapter-${chGroup.chapterName}`}
                    className="rounded-xl border border-[#f2efeb]/12 bg-[#18181a] overflow-hidden"
                  >
                    <button
                      type="button"
                      aria-expanded={isChapterOpen}
                      onClick={() =>
                        setExpandedChapter((prev) => ({
                          ...prev,
                          [chGroup.chapterName]: !isChapterOpen,
                        }))
                      }
                      className="w-full px-5 py-3.5 bg-[#1f1f23] flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-white/[0.03] transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#f2efeb]/45">
                          Chapter
                        </p>
                        <h3 className="font-display text-base font-bold text-[#f2efeb] truncate mt-0.5">
                          {chGroup.chapterName}
                        </h3>
                        <p className="text-xs text-[#f2efeb]/55 mt-0.5 tabular-nums">
                          {chGroup.members.length} member{chGroup.members.length === 1 ? '' : 's'} · Billed{' '}
                          {formatINR(chGroup.totalBilled)} · Outstanding {formatINR(chGroup.totalOutstanding)}
                        </p>
                      </div>
                      <span className="text-[#f2efeb]/50 shrink-0">
                        {isChapterOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </span>
                    </button>

                    {isChapterOpen && (
                      <div className="divide-y divide-[#f2efeb]/10 border-t border-[#f2efeb]/10">
                        {chGroup.members.map((group) => {
                          const eligibleDue = group.charges
                            .filter((c) => c.status !== 'ON_HOLD')
                            .reduce((s, c) => s + Math.max(0, c.amount - c.receivedAmount), 0);

                          return (
                            <div key={group.memberId} className="px-5 py-4 space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <h4 className="font-display text-[15px] font-bold text-[#f2efeb] truncate">
                                    {group.memberName}
                                  </h4>
                                  <p className="text-xs text-[#f2efeb]/60 mt-0.5 tabular-nums">
                                    {group.charges.length} absence{group.charges.length === 1 ? '' : 's'} · Billed{' '}
                                    {formatINR(group.totalBilled)} ·{' '}
                                    <span
                                      className={
                                        group.outstanding > 0
                                          ? 'text-[#E12D39] font-semibold'
                                          : 'text-emerald-400 font-semibold'
                                      }
                                    >
                                      Outstanding {formatINR(group.outstanding)}
                                    </span>
                                  </p>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onOpenDraft({
                                        templateType: 'MEMBER_REMINDER',
                                        title: `Payment Reminder — ${group.memberName}`,
                                        recipientLabel: group.memberName,
                                        recipientPhone: group.whatsapp,
                                        defaultBody: buildMemberReminderWhatsAppText({
                                          memberName: group.memberName,
                                          items: group.charges.map((c) => ({
                                            meetingDate: c.meetingDate,
                                            chapterName: c.chapterName,
                                            dueAmount: Math.max(0, c.amount - c.receivedAmount),
                                          })),
                                          totalOutstanding: group.outstanding,
                                        }),
                                      })
                                    }
                                    className="h-9 px-3 rounded-lg bg-emerald-500/12 border border-emerald-500/25 hover:bg-emerald-500/20 text-emerald-400 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                                  >
                                    <MessageCircle className="w-3.5 h-3.5" />
                                    Draft
                                  </button>
                                  {eligibleDue > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() => openReceiptModal(group.memberId)}
                                      className="h-9 px-4 rounded-lg bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors"
                                    >
                                      Record Receipt
                                    </button>
                                  ) : group.outstanding > 0 ? (
                                    <span className="h-9 px-3 rounded-lg bg-red-500/12 border border-red-500/30 text-red-400 text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap">
                                      On Hold
                                    </span>
                                  ) : (
                                    <span className="h-9 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-semibold inline-flex items-center gap-1">
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      Settled
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="space-y-1.5 pt-1">
                                {group.charges.map((chg) => {
                                  const isSettled = chg.receivedAmount >= chg.amount;
                                  return (
                                    <div
                                      key={chg.id}
                                      className="flex items-center justify-between gap-3 text-xs sm:text-[13px]"
                                    >
                                      <div className="min-w-0 truncate text-[#f2efeb]/85">
                                        <span className="tabular-nums font-medium">{chg.meetingDate}</span>
                                        <span className="mx-1.5 text-[#f2efeb]/40">·</span>
                                        <span className="text-[#f2efeb]/65">
                                          covered by <span className="text-[#f2efeb]/90">{chg.actualAttendeeName}</span>
                                        </span>
                                        {chg.isDelegated && (
                                          <span className="ml-1.5 text-[11px] text-[#E2B340]">(Guest)</span>
                                        )}
                                        {chg.status === 'ON_HOLD' && (
                                          <span className="ml-1.5 text-[11px] text-red-400 font-semibold">· On Hold</span>
                                        )}
                                      </div>
                                      <span
                                        className={`shrink-0 tabular-nums font-semibold ${
                                          chg.status === 'ON_HOLD'
                                            ? 'text-red-400'
                                            : isSettled
                                            ? 'text-emerald-400'
                                            : 'text-[#f2efeb]'
                                        }`}
                                      >
                                        {formatINR(chg.receivedAmount)} / {formatINR(chg.amount)}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3">
              {memberGroups.map((group) => {
                const eligibleDue = group.charges
                  .filter((c) => c.status !== 'ON_HOLD')
                  .reduce((s, c) => s + Math.max(0, c.amount - c.receivedAmount), 0);
                return (
                  <div
                    key={group.memberId}
                    className="rounded-xl border border-[#f2efeb]/12 bg-[#18181a] overflow-hidden"
                  >
                    <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-display text-base font-bold text-[#f2efeb] truncate">
                          {group.memberName}
                        </h3>
                        <p className="text-xs text-[#f2efeb]/60 mt-0.5 tabular-nums">
                          {group.chapterName} · Billed {formatINR(group.totalBilled)} ·{' '}
                          <span
                            className={
                              group.outstanding > 0
                                ? 'text-[#E12D39] font-semibold'
                                : 'text-emerald-400 font-semibold'
                            }
                          >
                            Outstanding {formatINR(group.outstanding)}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            onOpenDraft({
                              templateType: 'MEMBER_REMINDER',
                              title: `Payment Reminder — ${group.memberName}`,
                              recipientLabel: group.memberName,
                              recipientPhone: group.whatsapp,
                              defaultBody: buildMemberReminderWhatsAppText({
                                memberName: group.memberName,
                                items: group.charges.map((c) => ({
                                  meetingDate: c.meetingDate,
                                  chapterName: c.chapterName,
                                  dueAmount: Math.max(0, c.amount - c.receivedAmount),
                                })),
                                totalOutstanding: group.outstanding,
                              }),
                            })
                          }
                          className="h-9 px-3 rounded-lg bg-emerald-500/12 border border-emerald-500/25 hover:bg-emerald-500/20 text-emerald-400 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          Draft
                        </button>
                        {eligibleDue > 0 ? (
                          <button
                            type="button"
                            onClick={() => openReceiptModal(group.memberId)}
                            className="h-9 px-4 rounded-lg bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
                          >
                            Record Receipt
                          </button>
                        ) : group.outstanding > 0 ? (
                          <span className="h-9 px-3 rounded-lg bg-red-500/12 border border-red-500/30 text-red-400 text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap">
                            On Hold
                          </span>
                        ) : (
                          <span className="h-9 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-semibold inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Settled
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="border-t border-[#f2efeb]/10 px-5 py-3 space-y-1.5">
                      {group.charges.map((chg) => {
                        const isSettled = chg.receivedAmount >= chg.amount;
                        return (
                          <div key={chg.id} className="flex items-center justify-between gap-3 text-xs sm:text-[13px]">
                            <div className="min-w-0 truncate text-[#f2efeb]/85">
                              <span className="tabular-nums font-medium">{chg.meetingDate}</span>
                              <span className="mx-1.5 text-[#f2efeb]/40">·</span>
                              <span className="text-[#f2efeb]/65">
                                covered by <span className="text-[#f2efeb]/90">{chg.actualAttendeeName}</span>
                              </span>
                              <span className="mx-1.5 text-[#f2efeb]/40">·</span>
                              <span className="text-[#f2efeb]/55">{chg.chapterName}</span>
                            </div>
                            <span
                              className={`shrink-0 tabular-nums font-semibold ${
                                chg.status === 'ON_HOLD'
                                  ? 'text-red-400'
                                  : isSettled
                                  ? 'text-emerald-400'
                                  : 'text-[#f2efeb]'
                              }`}
                            >
                              {formatINR(chg.receivedAmount)} / {formatINR(chg.amount)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================== PAYABLES TAB (BY CHAPTER | BY SUBSTITUTE — SS #4) ==================== */}
      {tab === 'payables' && (
        <div className="space-y-4">
          {substituteGroups.length === 0 ? (
            <div className="p-8 rounded-xl border border-dashed border-[#f2efeb]/12 text-center text-sm text-[#f2efeb]/60">
              No Veloctive Team payables match your current filter.
            </div>
          ) : groupPayablesByChapter ? (
            <div className="space-y-4" data-testid="payables-by-chapter-view">
              {payablesByChapter.map((chGroup) => {
                const isChapterOpen = expandedPayableChapter[chGroup.chapterName] ?? true;
                return (
                  <div
                    key={chGroup.chapterName}
                    data-testid={`payables-chapter-${chGroup.chapterName}`}
                    className="rounded-xl border border-[#f2efeb]/12 bg-[#18181a] overflow-hidden"
                  >
                    <button
                      type="button"
                      aria-expanded={isChapterOpen}
                      onClick={() =>
                        setExpandedPayableChapter((prev) => ({
                          ...prev,
                          [chGroup.chapterName]: !isChapterOpen,
                        }))
                      }
                      className="w-full px-5 py-3.5 bg-[#1f1f23] flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-white/[0.03] transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#f2efeb]/45">
                          Chapter
                        </p>
                        <h3 className="font-display text-base font-bold text-[#f2efeb] truncate mt-0.5">
                          {chGroup.chapterName}
                        </h3>
                        <p className="text-xs text-[#f2efeb]/55 mt-0.5 tabular-nums">
                          {chGroup.substitutes.length} substitute{chGroup.substitutes.length === 1 ? '' : 's'} · Earned{' '}
                          {formatINR(chGroup.totalEarned)} · Outstanding {formatINR(chGroup.totalOutstanding)}
                        </p>
                      </div>
                      <span className="text-[#f2efeb]/50 shrink-0">
                        {isChapterOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </span>
                    </button>

                    {isChapterOpen && (
                      <div className="divide-y divide-[#f2efeb]/10 border-t border-[#f2efeb]/10">
                        {chGroup.substitutes.map((group) => {
                          const eligibleDue = group.earnings
                            .filter((e) => e.status !== 'ON_HOLD')
                            .reduce((s, e) => s + Math.max(0, e.amount - e.paidAmount), 0);

                          return (
                            <div key={`${chGroup.chapterName}-${group.substituteId}`} className="px-5 py-4 space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <h4 className="font-display text-[15px] font-bold text-[#f2efeb] truncate">
                                    {group.substituteName}
                                  </h4>
                                  <p className="text-xs text-[#f2efeb]/60 mt-0.5 tabular-nums">
                                    {group.earnings.length} meeting{group.earnings.length === 1 ? '' : 's'} · Earned{' '}
                                    {formatINR(group.totalEarned)} ·{' '}
                                    <span
                                      className={
                                        group.outstanding > 0
                                          ? 'text-[#E12D39] font-semibold'
                                          : 'text-emerald-400 font-semibold'
                                      }
                                    >
                                      Outstanding {formatINR(group.outstanding)}
                                    </span>
                                  </p>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onOpenDraft({
                                        templateType: 'PAYOUT_SUMMARY',
                                        title: `Payout Summary — ${group.substituteName}`,
                                        recipientLabel: group.substituteName,
                                        recipientPhone: group.whatsapp,
                                        defaultBody: buildPayoutSummaryWhatsAppText({
                                          substituteName: group.substituteName,
                                          items: group.earnings.map((e) => ({
                                            meetingDate: e.meetingDate,
                                            chapterName: e.chapterName,
                                            amount: e.amount,
                                          })),
                                          bonusesTotal: group.bonusesTotal,
                                          outstanding: group.outstanding,
                                        }),
                                      })
                                    }
                                    className="h-9 px-3 rounded-lg bg-emerald-500/12 border border-emerald-500/25 hover:bg-emerald-500/20 text-emerald-400 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                                  >
                                    <MessageCircle className="w-3.5 h-3.5" />
                                    Draft
                                  </button>
                                  {eligibleDue > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() => openPayoutModal(group.substituteId)}
                                      className="h-9 px-4 rounded-lg bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors"
                                    >
                                      Record Payout
                                    </button>
                                  ) : group.outstanding > 0 ? (
                                    <span className="h-9 px-3 rounded-lg bg-red-500/12 border border-red-500/30 text-red-400 text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap">
                                      On Hold
                                    </span>
                                  ) : (
                                    <span className="h-9 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-semibold inline-flex items-center gap-1">
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      Settled
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="space-y-1.5 pt-1">
                                {group.earnings.map((earn) => {
                                  const isSettled = earn.paidAmount >= earn.amount;
                                  return (
                                    <div
                                      key={earn.id}
                                      className="flex items-center justify-between gap-3 text-xs sm:text-[13px]"
                                    >
                                      <div className="min-w-0 truncate text-[#f2efeb]/85">
                                        <span className="tabular-nums font-medium">{earn.meetingDate}</span>
                                        <span className="mx-1.5 text-[#f2efeb]/40">·</span>
                                        <span className="text-[#f2efeb]/70">for {earn.memberName}</span>
                                        {earn.isDelegated && (
                                          <span className="ml-1.5 text-[11px] text-[#E2B340]">
                                            (Guest: {earn.actualAttendeeName})
                                          </span>
                                        )}
                                        {earn.status === 'ON_HOLD' && (
                                          <span className="ml-1.5 text-[11px] text-red-400 font-semibold">· On Hold</span>
                                        )}
                                      </div>
                                      <span
                                        className={`shrink-0 tabular-nums font-semibold ${
                                          earn.status === 'ON_HOLD'
                                            ? 'text-red-400'
                                            : isSettled
                                            ? 'text-emerald-400'
                                            : 'text-[#f2efeb]'
                                        }`}
                                      >
                                        {formatINR(earn.paidAmount)} / {formatINR(earn.amount)}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3" data-testid="payables-by-substitute-view">
              {substituteGroups.map((group) => {
                const eligibleDue = group.earnings
                  .filter((e) => e.status !== 'ON_HOLD')
                  .reduce((s, e) => s + Math.max(0, e.amount - e.paidAmount), 0);

                return (
                  <div
                    key={group.substituteId}
                    className="rounded-xl border border-[#f2efeb]/12 bg-[#18181a] overflow-hidden"
                  >
                    <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-display text-base font-bold text-[#f2efeb] truncate">
                          {group.substituteName}
                        </h3>
                        <p className="text-xs text-[#f2efeb]/60 mt-0.5 tabular-nums">
                          Earned {formatINR(group.totalEarned)} ·{' '}
                          <span
                            className={
                              group.outstanding > 0
                                ? 'text-[#E12D39] font-semibold'
                                : 'text-emerald-400 font-semibold'
                            }
                          >
                            Outstanding {formatINR(group.outstanding)}
                          </span>
                          {group.bonusesTotal > 0 && (
                            <span className="text-[#E2B340] font-semibold">
                              {' · '}Bonus {formatINR(group.bonusesTotal)}
                            </span>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            onOpenDraft({
                              templateType: 'PAYOUT_SUMMARY',
                              title: `Payout Summary — ${group.substituteName}`,
                              recipientLabel: group.substituteName,
                              recipientPhone: group.whatsapp,
                              defaultBody: buildPayoutSummaryWhatsAppText({
                                substituteName: group.substituteName,
                                items: group.earnings.map((e) => ({
                                  meetingDate: e.meetingDate,
                                  chapterName: e.chapterName,
                                  amount: e.amount,
                                })),
                                bonusesTotal: group.bonusesTotal,
                                outstanding: group.outstanding,
                              }),
                            })
                          }
                          className="h-9 px-3 rounded-lg bg-emerald-500/12 border border-emerald-500/25 hover:bg-emerald-500/20 text-emerald-400 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          Draft
                        </button>
                        {eligibleDue > 0 ? (
                          <button
                            type="button"
                            onClick={() => openPayoutModal(group.substituteId)}
                            className="h-9 px-4 rounded-lg bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors"
                          >
                            Record Payout
                          </button>
                        ) : group.outstanding > 0 ? (
                          <span className="h-9 px-3 rounded-lg bg-red-500/12 border border-red-500/30 text-red-400 text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap">
                            On Hold
                          </span>
                        ) : (
                          <span className="h-9 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-semibold inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Settled
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="border-t border-[#f2efeb]/10 px-5 py-3 space-y-1.5">
                      {group.earnings.map((earn) => {
                        const isSettled = earn.paidAmount >= earn.amount;
                        return (
                          <div
                            key={earn.id}
                            className="flex items-center justify-between gap-3 text-xs sm:text-[13px]"
                          >
                            <div className="min-w-0 truncate text-[#f2efeb]/85">
                              <span className="tabular-nums font-medium">{earn.meetingDate}</span>
                              <span className="mx-1.5 text-[#f2efeb]/40">·</span>
                              <span>{earn.chapterName}</span>
                              <span className="mx-1.5 text-[#f2efeb]/40">·</span>
                              <span className="text-[#f2efeb]/65">{earn.memberName}</span>
                              {earn.isDelegated && (
                                <span className="ml-1.5 text-[11px] text-[#E2B340]">
                                  (Guest: {earn.actualAttendeeName})
                                </span>
                              )}
                              {earn.status === 'ON_HOLD' && (
                                <span className="ml-1.5 text-[11px] text-red-400 font-semibold">· On Hold</span>
                              )}
                            </div>
                            <span
                              className={`shrink-0 tabular-nums font-semibold ${
                                earn.status === 'ON_HOLD'
                                  ? 'text-red-400'
                                  : isSettled
                                  ? 'text-emerald-400'
                                  : 'text-[#f2efeb]'
                              }`}
                            >
                              {formatINR(earn.paidAmount)} / {formatINR(earn.amount)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================== RECEIPTS HISTORY TAB ==================== */}
      {tab === 'receipts_log' && (
        <div className="rounded-xl border border-[#f2efeb]/12 bg-[#18181a] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#f2efeb]/10 bg-[#1f1f23] flex items-center justify-between">
            <h3 className="font-display text-sm font-bold text-[#f2efeb]">
              Member Cash Receipts ({filteredReceipts.length})
            </h3>
            <span className="text-xs text-[#f2efeb]/60">Immutable receipt log</span>
          </div>
          <div className="divide-y divide-[#f2efeb]/10">
            {filteredReceipts.length === 0 ? (
              <p className="p-8 text-center text-sm text-[#f2efeb]/60">No client receipts recorded in this filter.</p>
            ) : (
              filteredReceipts.map((r) => {
                const m = data.members.find((x) => x.id === r.memberId);
                return (
                  <div key={r.id} className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-xs sm:text-[13px]">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#f2efeb] truncate">
                        {m?.name ?? r.memberId} · {r.method}
                      </p>
                      <p className="text-[#f2efeb]/60 mt-0.5 font-mono text-[11px]">
                        {r.paymentDate} · Ref {r.reference || '—'} · {r.allocations.length} meeting(s)
                      </p>
                    </div>
                    <span className="font-display text-sm font-bold text-emerald-400 tabular-nums shrink-0">
                      +{formatINR(r.amount)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ==================== PAYOUTS HISTORY TAB ==================== */}
      {tab === 'payouts_log' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#f2efeb]/12 bg-[#18181a] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#f2efeb]/10 bg-[#1f1f23] flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-[#f2efeb]">
                Veloctive Team Payouts ({filteredPayouts.length})
              </h3>
              <span className="text-xs text-[#f2efeb]/60">Immutable payout log</span>
            </div>
            <div className="divide-y divide-[#f2efeb]/10">
              {filteredPayouts.length === 0 ? (
                <p className="p-8 text-center text-sm text-[#f2efeb]/60">No payouts recorded in this filter.</p>
              ) : (
                filteredPayouts.map((p) => {
                  const s = data.substitutes.find((x) => x.id === p.payeeSubstituteId);
                  return (
                    <div key={p.id} className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-xs sm:text-[13px]">
                      <div className="min-w-0">
                        <p className="font-semibold text-[#f2efeb] truncate">
                          {s?.name ?? p.payeeSubstituteId} · {p.method}
                          {p.bonusAmount > 0 && (
                            <span className="ml-1.5 text-[#E2B340] inline-flex items-center gap-0.5">
                              <Award className="w-3.5 h-3.5" />
                              +{formatINR(p.bonusAmount)} Bonus
                            </span>
                          )}
                        </p>
                        <p className="text-[#f2efeb]/60 mt-0.5 font-mono text-[11px]">
                          {p.paymentDate} · Ref {p.reference || '—'} · {p.allocations.length} meeting(s)
                        </p>
                      </div>
                      <span className="font-display text-sm font-bold text-[#f2efeb] tabular-nums shrink-0">
                        -{formatINR(p.totalTransferred)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {data.ledgerAdjustments.length > 0 && (
            <div className="rounded-xl border border-[#f2efeb]/12 bg-[#18181a] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#f2efeb]/10 bg-[#1f1f23]">
                <h3 className="font-display text-sm font-bold text-[#f2efeb]">Audited Ledger Adjustments</h3>
              </div>
              <div className="divide-y divide-[#f2efeb]/10">
                {data.ledgerAdjustments.map((adj) => (
                  <div key={adj.id} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <p className="font-semibold text-[#f2efeb]">
                        Audited Adjustment ({adj.targetType.replace(/_/g, ' ')})
                      </p>
                      <p className="text-[#f2efeb]/70 mt-0.5">{adj.reason}</p>
                    </div>
                    <span className="font-mono font-bold text-amber-400 tabular-nums">
                      {adj.deltaAmount >= 0
                        ? `+${formatINR(adj.deltaAmount)}`
                        : `-${formatINR(Math.abs(adj.deltaAmount))}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== APPROVED COORDINATOR COMMISSIONS TAB ==================== */}
      {tab === 'commissions' && (
        <div className="space-y-3">
          <div className="p-3.5 rounded-xl bg-[#1f1f23] border border-[#f2efeb]/10 text-xs text-[#f2efeb]/70">
            <strong className="text-[#f2efeb]">Zero-By-Default Policy:</strong> Coordinator commissions are posted here ONLY when explicitly approved on a request/assignment and validly finished. Attribution tags like &ldquo;Assigned Via&rdquo; alone always post ₹0.
          </div>

          <div className="rounded-xl border border-[#f2efeb]/12 bg-[#18181a] overflow-hidden divide-y divide-[#f2efeb]/10">
            {filteredCommissions.length === 0 ? (
              <p className="p-8 text-center text-sm text-[#f2efeb]/60">
                No approved coordinator commissions match the current filter.
              </p>
            ) : (
              filteredCommissions.map((cm) => {
                const rem = Math.max(0, cm.amount - cm.paidAmount);
                return (
                  <div key={cm.id} className="p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <p className="font-display text-sm font-bold text-[#f2efeb]">
                        {coordName(cm.coordinatorId)} · {formatShortDate(cm.meetingDate)} · {cm.chapterName}
                      </p>
                      <p className="text-[#f2efeb]/60 mt-0.5">
                        Member: <strong className="text-[#f2efeb]">{cm.memberName}</strong> · Attendee: {cm.actualAttendeeName}
                        {cm.paymentReference ? ` · Ref ${cm.paymentReference}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 tabular-nums">
                      <div className="text-right">
                        <p className="font-bold text-[#f2efeb]">Approved {formatINR(cm.amount)}</p>
                        <p className={rem === 0 ? 'text-emerald-400 font-semibold' : 'text-[#E2B340] font-semibold'}>
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
                          className="h-9 px-3 rounded-lg bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold cursor-pointer"
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

      {/* RECORD RECEIPT MODAL */}
      {receiptMemberId && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Record Receipt">
          <div className="w-full sm:max-w-lg bg-[#18181a] rounded-t-lg sm:rounded-lg border border-[#f2efeb]/10 max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f2efeb]/10 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-[#f2efeb]">Record Member Receipt</h2>
                <p className="text-xs text-[#f2efeb]/60">
                  {data.members.find((m) => m.id === receiptMemberId)?.name} · Supports partial or batch settlement
                </p>
              </div>
              <button type="button" onClick={() => setReceiptMemberId(null)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#f2efeb]/60">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={submitReceipt} className="p-5 overflow-y-auto space-y-3.5">
              {error && <p className="p-2.5 rounded-lg bg-red-500/12 text-xs text-red-400">{error}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Amount Received (₹) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={receiptAmount}
                    onChange={(e) => handleReceiptAmountAutoSplit(e.target.value)}
                    className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Payment Date *</label>
                  <input
                    type="date"
                    required
                    value={receiptDate}
                    onChange={(e) => setReceiptDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Method</label>
                  <select
                    value={receiptMethod}
                    onChange={(e) => setReceiptMethod(e.target.value as PaymentMethod)}
                    className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] text-sm"
                  >
                    <option value="UPI">UPI</option>
                    <option value="BANK_TRANSFER">Bank Transfer / NEFT</option>
                    <option value="CASH">Cash</option>
                    <option value="CHEQUE">Cheque</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">UTR / Reference *</label>
                  <input
                    type="text"
                    required
                    value={receiptRef}
                    onChange={(e) => setReceiptRef(e.target.value)}
                    placeholder="e.g. UPI-884122"
                    className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-[#f2efeb]">Itemized Meeting Allocation</p>
                <div className="divide-y divide-[#f2efeb]/10 rounded-[6px] border border-[#f2efeb]/10 bg-[#1f1f23]">
                  {data.clientCharges
                    .filter((c) => c.memberId === receiptMemberId && c.status !== 'ON_HOLD' && c.amount > c.receivedAmount)
                    .map((c) => {
                      const rem = c.amount - c.receivedAmount;
                      return (
                        <div key={c.id} className="p-3 flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <p className="font-semibold text-[#f2efeb] truncate">
                              {formatShortDate(c.meetingDate)} · {c.chapterName}
                            </p>
                            <p className="text-[#f2efeb]/60 tabular-nums">Remaining: {formatINR(rem)}</p>
                          </div>
                          <input
                            type="number"
                            min={0}
                            max={rem}
                            value={receiptAllocs[c.id] ?? 0}
                            onChange={(e) =>
                              setReceiptAllocs((prev) => ({ ...prev, [c.id]: Number(e.target.value) || 0 }))
                            }
                            className="w-24 h-9 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-right text-xs font-semibold tabular-nums"
                          />
                        </div>
                      );
                    })}
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setReceiptMemberId(null)} className="h-10 px-4 rounded-[6px] border border-[#f2efeb]/10 text-xs font-semibold">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="h-10 px-5 rounded-[6px] bg-[#C81E2B] text-white text-xs font-semibold inline-flex items-center gap-1.5">
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
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Record Payout">
          <div className="w-full sm:max-w-lg bg-[#18181a] rounded-t-lg sm:rounded-lg border border-[#f2efeb]/10 max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f2efeb]/10 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-[#f2efeb]">Record Veloctive Team Payout</h2>
                <p className="text-xs text-[#f2efeb]/60">
                  Payee: {data.substitutes.find((s) => s.id === payoutSubId)?.name} (Veloctive Team Only)
                </p>
              </div>
              <button type="button" onClick={() => setPayoutSubId(null)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#f2efeb]/60">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={submitPayout} className="p-5 overflow-y-auto space-y-3.5">
              {error && <p className="p-2.5 rounded-lg bg-red-500/12 text-xs text-red-400">{error}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Meeting Payout (₹) *</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={payoutAmount}
                    onChange={(e) => handlePayoutAmountAutoSplit(e.target.value)}
                    className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Payment Date *</label>
                  <input
                    type="date"
                    required
                    value={payoutDate}
                    onChange={(e) => setPayoutDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Method</label>
                  <select
                    value={payoutMethod}
                    onChange={(e) => setPayoutMethod(e.target.value as PaymentMethod)}
                    className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] text-sm"
                  >
                    <option value="UPI">UPI</option>
                    <option value="BANK_TRANSFER">Bank Transfer / IMPS</option>
                    <option value="CASH">Cash</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Transfer Reference *</label>
                  <input
                    type="text"
                    required
                    value={payoutRef}
                    onChange={(e) => setPayoutRef(e.target.value)}
                    placeholder="e.g. IMPS-991042"
                    className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm font-mono"
                  />
                </div>
              </div>

              {/* Optional Appreciation Bonus (Agency cost, NEVER billed to member!) */}
              <div className="p-3.5 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#f2efeb] inline-flex items-center gap-1.5">
                    <Award className="w-4 h-4 text-[#E2B340]" />
                    Optional Appreciation Bonus
                  </span>
                  <span className="text-[11px] text-[#f2efeb]/60">Agency cost only (never billed to member)</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="number"
                    min={0}
                    value={bonusAmount}
                    onChange={(e) => setBonusAmount(e.target.value)}
                    placeholder="₹0"
                    className="h-9 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs tabular-nums"
                  />
                  <input
                    type="text"
                    value={bonusMessage}
                    onChange={(e) => setBonusMessage(e.target.value)}
                    placeholder="Gratitude note"
                    className="col-span-2 h-9 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-xs"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-[#f2efeb]">Itemized Meeting Allocation</p>
                <div className="divide-y divide-[#f2efeb]/10 rounded-[6px] border border-[#f2efeb]/10 bg-[#1f1f23]">
                  {data.substituteEarnings
                    .filter((e) => e.payeeSubstituteId === payoutSubId && e.status !== 'ON_HOLD' && e.amount > e.paidAmount)
                    .map((e) => {
                      const rem = e.amount - e.paidAmount;
                      return (
                        <div key={e.id} className="p-3 flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <p className="font-semibold text-[#f2efeb] truncate">
                              {formatShortDate(e.meetingDate)} · {e.chapterName} ({e.actualAttendeeName})
                            </p>
                            <p className="text-[#f2efeb]/60 tabular-nums">Remaining: {formatINR(rem)}</p>
                          </div>
                          <input
                            type="number"
                            min={0}
                            max={rem}
                            value={payoutAllocs[e.id] ?? 0}
                            onChange={(ev) =>
                              setPayoutAllocs((prev) => ({ ...prev, [e.id]: Number(ev.target.value) || 0 }))
                            }
                            className="w-24 h-9 px-2.5 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] text-right text-xs font-semibold tabular-nums"
                          />
                        </div>
                      );
                    })}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[#f2efeb]/10">
                <span className="text-xs font-semibold text-[#f2efeb] tabular-nums">
                  Total Transfer: {formatINR((Number(payoutAmount) || 0) + (Number(bonusAmount) || 0))}
                </span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPayoutSubId(null)} className="h-10 px-4 rounded-[6px] border border-[#f2efeb]/10 text-xs font-semibold">
                    Cancel
                  </button>
                  <button type="submit" disabled={busy} className="h-10 px-5 rounded-[6px] bg-[#C81E2B] text-white text-xs font-semibold cursor-pointer">
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
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Pay coordinator commission">
          <div className="w-full sm:max-w-md bg-[#18181a] rounded-t-lg sm:rounded-lg border border-[#f2efeb]/10 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f2efeb]/10 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-[#f2efeb]">Pay Approved Commission</h2>
                <p className="text-xs text-[#f2efeb]/60">
                  {coordName(commTarget.coordinatorId)} · {commTarget.chapterName} ({formatShortDate(commTarget.meetingDate)})
                </p>
              </div>
              <button type="button" onClick={() => setCommTarget(null)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#f2efeb]/60">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={submitCommissionPayout} className="p-5 space-y-3.5">
              {error && <p className="p-2.5 rounded-lg bg-red-500/12 text-xs text-red-400">{error}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Amount (₹) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={commTarget.amount - commTarget.paidAmount}
                    value={commPayAmt}
                    onChange={(e) => setCommPayAmt(e.target.value)}
                    className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Payment Date *</label>
                  <input
                    type="date"
                    required
                    value={commPayDate}
                    onChange={(e) => setCommPayDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Method</label>
                  <select
                    value={commPayMethod}
                    onChange={(e) => setCommPayMethod(e.target.value as PaymentMethod)}
                    className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] text-sm"
                  >
                    <option value="UPI">UPI</option>
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                    <option value="CASH">Cash</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Reference *</label>
                  <input
                    type="text"
                    required
                    value={commPayRef}
                    onChange={(e) => setCommPayRef(e.target.value)}
                    placeholder="UPI / IMPS ref"
                    className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm font-mono"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setCommTarget(null)} className="h-10 px-4 rounded-[6px] border border-[#f2efeb]/10 text-xs font-semibold">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="h-10 px-5 rounded-[6px] bg-[#C81E2B] text-white text-xs font-semibold cursor-pointer">
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
