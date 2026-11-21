import type {
  Assignment,
  Chapter,
  ClientCharge,
  ClientReceipt,
  CoordinatorCommission,
  FreelancerPayout,
  Location,
  Member,
  SubstituteEarning,
  Weekday,
} from './types';

export const MILESTONE_TARGETS = [
  { count: 10, label: '10 Verified / Completed Meetings', defaultReward: 500 },
  { count: 20, label: '20 Verified / Completed Meetings', defaultReward: 1200 },
  { count: 50, label: '50 Verified / Completed Meetings', defaultReward: 3500 },
] as const;

/**
 * Returns YYYY-MM-DD for the current date in Asia/Kolkata (UTC+05:30).
 */
export function getTodayInKolkata(referenceDate: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(referenceDate);
}

/**
 * LOCKED RULE (AT-01):
 * New Request meeting date ALWAYS defaults to TOMORROW's calendar date in Asia/Kolkata,
 * completely independent of the chapter's saved informational regular weekday.
 */
export function getTomorrowInKolkata(referenceDate: Date = new Date()): string {
  const todayStr = getTodayInKolkata(referenceDate);
  const [y, m, d] = todayStr.split('-').map(Number);
  const utcDate = new Date(Date.UTC(y, m - 1, d + 1));
  const year = utcDate.getUTCFullYear();
  const month = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utcDate.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getYesterdayInKolkata(referenceDate: Date = new Date()): string {
  const todayStr = getTodayInKolkata(referenceDate);
  const [y, m, d] = todayStr.split('-').map(Number);
  const utcDate = new Date(Date.UTC(y, m - 1, d - 1));
  const year = utcDate.getUTCFullYear();
  const month = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utcDate.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDisplayDate(isoDate: string): string {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}

export function formatShortDate(isoDate: string): string {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(dt);
}

export function formatINR(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `₹${Math.round(safe).toLocaleString('en-IN')}`;
}

export interface AutoFillDraft {
  meetingDate: string;
  chapterId: string;
  chapterName: string;
  chapterRegularWeekday: Weekday;
  locationId: string;
  venueName: string;
  area: string;
  address: string;
  mapsUrl: string;
  directions: string;
  reportingTime: string;
  startTime: string;
  endTime: string;
  intro30Sec: string;
  memberFee: number;
  offeredPayout: number;
}

/**
 * LOCKED RULE (AT-02):
 * Pre-fills request from Member -> Chapter -> Venue (member preferred or chapter default).
 * Meeting date ALWAYS defaults to tomorrow in Asia/Kolkata regardless of chapter weekday.
 */
export function resolveRequestAutoFill(
  member: Member,
  chapters: Chapter[],
  locations: Location[],
  referenceDate: Date = new Date()
): AutoFillDraft | null {
  const chapter = chapters.find((c) => c.id === member.chapterId);
  if (!chapter) return null;

  const preferredLoc = member.preferredLocationId
    ? locations.find((l) => l.id === member.preferredLocationId)
    : undefined;
  const defaultLoc = locations.find((l) => l.id === chapter.defaultLocationId);
  const venue = preferredLoc ?? defaultLoc;

  const directionsParts = [
    venue?.nearestStation ? `Nearest station: ${venue.nearestStation}` : '',
    venue?.transportGuidance ?? '',
    venue?.entryNotes ? `Entry: ${venue.entryNotes}` : '',
  ].filter(Boolean);

  return {
    meetingDate: getTomorrowInKolkata(referenceDate),
    chapterId: chapter.id,
    chapterName: chapter.name,
    chapterRegularWeekday: chapter.regularWeekday,
    locationId: venue?.id ?? '',
    venueName: venue?.name ?? 'TBD Venue',
    area: venue?.area ?? chapter.region,
    address: venue?.fullAddress ?? '',
    mapsUrl: venue?.mapsUrl ?? '',
    directions: directionsParts.join(' · '),
    reportingTime: chapter.reportingTime,
    startTime: chapter.startTime,
    endTime: chapter.endTime,
    intro30Sec: member.intro30Sec,
    memberFee: member.standardFee || chapter.defaultMemberFee,
    offeredPayout: chapter.defaultSubstitutePayout,
  };
}

export interface FinanceSummary {
  totalBilled: number;
  receivablesOutstanding: number;
  cashReceived: number;
  totalEarnedBySubstitutes: number;
  payablesOutstanding: number;
  cashPaidToSubstitutes: number;
  totalAppreciationBonuses: number;
  totalCoordinatorCommissions: number;
  commissionsOutstanding: number;
  commissionsPaid: number;
  grossMarginBeforeBonus: number;
  contributionAfterBonus: number; // Contribution after approved bonuses & approved coordinator commissions
  netCashFlow: number;
}

/**
 * Computes exact accrual vs cash financial metrics without conflating
 * cash movement with earned margin, double-counting guest internal payouts,
 * or inventing unapproved coordinator commissions.
 */
export function computeFinanceSummary(
  charges: ClientCharge[],
  earnings: SubstituteEarning[],
  receipts: ClientReceipt[],
  payouts: FreelancerPayout[],
  commissions: CoordinatorCommission[] = []
): FinanceSummary {
  const activeCharges = charges.filter((c) => c.status !== 'ADJUSTED' || c.amount > 0);
  const activeEarnings = earnings.filter((e) => e.status !== 'ADJUSTED' || e.amount > 0);
  const activeCommissions = commissions.filter((c) => c.status !== 'ADJUSTED' || c.amount > 0);

  const totalBilled = activeCharges.reduce((sum, c) => sum + c.amount, 0);
  const receivablesOutstanding = activeCharges.reduce(
    (sum, c) => sum + Math.max(0, c.amount - c.receivedAmount),
    0
  );

  const totalEarnedBySubstitutes = activeEarnings.reduce((sum, e) => sum + e.amount, 0);
  const payablesOutstanding = activeEarnings.reduce(
    (sum, e) => sum + Math.max(0, e.amount - e.paidAmount),
    0
  );

  const totalCoordinatorCommissions = activeCommissions.reduce((sum, c) => sum + c.amount, 0);
  const commissionsPaid = activeCommissions.reduce((sum, c) => sum + c.paidAmount, 0);
  const commissionsOutstanding = activeCommissions.reduce(
    (sum, c) => sum + Math.max(0, c.amount - c.paidAmount),
    0
  );

  const validReceipts = receipts.filter((r) => !r.reversed);
  const validPayouts = payouts.filter((p) => !p.reversed);

  const cashReceived = validReceipts.reduce((sum, r) => sum + r.amount, 0);
  const cashPaidForMeetings = validPayouts.reduce((sum, p) => sum + p.amount, 0);
  const totalAppreciationBonuses = validPayouts.reduce((sum, p) => sum + (p.bonusAmount || 0), 0);
  const cashPaidToSubstitutes = cashPaidForMeetings + totalAppreciationBonuses;

  const grossMarginBeforeBonus = totalBilled - totalEarnedBySubstitutes;
  const contributionAfterBonus =
    grossMarginBeforeBonus - totalAppreciationBonuses - totalCoordinatorCommissions;
  const netCashFlow = cashReceived - cashPaidToSubstitutes - commissionsPaid;

  return {
    totalBilled,
    receivablesOutstanding,
    cashReceived,
    totalEarnedBySubstitutes,
    payablesOutstanding,
    cashPaidToSubstitutes,
    totalAppreciationBonuses,
    totalCoordinatorCommissions,
    commissionsOutstanding,
    commissionsPaid,
    grossMarginBeforeBonus,
    contributionAfterBonus,
    netCashFlow,
  };
}

/**
 * Normalizes a locality string into a clean Mumbai/suburban location hub cluster
 * (e.g., "Andheri West" / "Andheri East" -> "Andheri", "Kandivali West" -> "Kandivali",
 * "Goregaon East" -> "Goregaon", "Malad West" -> "Malad", etc.).
 */
export function normalizeLocationHub(area: string): string {
  const clean = (area || '').trim();
  if (!clean) return 'Other Areas';
  const lower = clean.toLowerCase();
  const knownHubs = [
    'Andheri',
    'Kandivali',
    'Goregaon',
    'Malad',
    'Borivali',
    'Powai',
    'Bandra',
    'BKC',
    'Juhu',
    'Vile Parle',
    'Lower Parel',
    'Dadar',
    'Santacruz',
    'Thane',
    'Navi Mumbai',
  ];
  for (const hub of knownHubs) {
    if (lower.includes(hub.toLowerCase())) {
      return hub === 'BKC' ? 'Bandra / BKC' : hub === 'Bandra' ? 'Bandra / BKC' : hub;
    }
  }
  return clean.replace(/\s+(East|West|North|South)$/i, '').trim() || clean;
}

/**
 * Greedy/FIFO or explicit settlement allocator that enforces zero overpayment
 * and non-negative remaining balances.
 */
export function autoAllocateAmount(
  items: Array<{ id: string; remaining: number }>,
  totalAmount: number
): Array<{ id: string; amount: number }> {
  let left = Math.max(0, Math.round(totalAmount * 100) / 100);
  const result: Array<{ id: string; amount: number }> = [];
  for (const item of items) {
    if (left <= 0) break;
    const alloc = Math.min(item.remaining, left);
    if (alloc > 0) {
      result.push({ id: item.id, amount: Math.round(alloc * 100) / 100 });
      left = Math.round((left - alloc) * 100) / 100;
    }
  }
  return result;
}

/**
 * Counts valid completed assignments for milestone progress.
 * Excludes cancelled, no-show, replaced, or unresolved disputed assignments.
 */
export function computeMilestoneProgress(assignments: Assignment[], substituteId: string) {
  const validCompletions = assignments.filter(
    (a) =>
      a.contractSubstituteId === substituteId &&
      (a.status === 'COMPLETED_SELF_REPORTED' || a.status === 'VERIFIED') &&
      !a.disputed
  ).length;

  const nextMilestone =
    MILESTONE_TARGETS.find((t) => t.count > validCompletions) ??
    MILESTONE_TARGETS[MILESTONE_TARGETS.length - 1];

  const remaining = Math.max(0, nextMilestone.count - validCompletions);
  const progressPercent = Math.min(100, Math.round((validCompletions / nextMilestone.count) * 100));

  return {
    validCompletions,
    nextMilestone,
    remaining,
    progressPercent,
    unlockedTargets: MILESTONE_TARGETS.filter((t) => validCompletions >= t.count),
  };
}

export function sanitizePhoneForLink(phone: string): string {
  const digits = (phone || '').replace(/[^0-9]/g, '');
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export function buildTelHref(phone: string): string {
  const digits = sanitizePhoneForLink(phone);
  return digits ? `tel:+${digits}` : '#';
}

export function buildWhatsAppHref(phone: string, text: string): string {
  const digits = sanitizePhoneForLink(phone);
  if (!digits) return '#';
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function generateCsvContent(headers: string[], rows: Array<Array<string | number>>): string {
  const escapeCell = (val: string | number) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  return [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join(
    '\n'
  );
}
