import type {
  Assignment,
  Chapter,
  ClientCharge,
  ClientReceipt,
  CoordinatorCommission,
  FreelancerPayout,
  Location,
  Member,
  MemberNoteType,
  SubstituteEarning,
  Weekday,
} from './types.ts';

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

/** Wraps dynamic WhatsApp words in single asterisks (*word*) so WhatsApp renders them bold. */
export function waBold(value: string): string {
  const trimmed = (value || '').trim();
  return trimmed ? `*${trimmed}*` : '';
}

/** Minimal venue photo check-in chat: ONLY Chapter Name and Date highlighted. */
export function buildReachedPhotoWhatsAppText(chapterName: string, meetingDate: string): string {
  return `${waBold(chapterName)} · ${waBold(formatShortDate(meetingDate))}`;
}

export function buildCoordinatorUpdateWhatsAppText(
  coordinatorName: string,
  chapterName: string,
  meetingDate: string
): string {
  return `Hi ${waBold(coordinatorName)}, update for ${waBold(chapterName)} (${waBold(formatShortDate(meetingDate))}):`;
}

export function buildOpenRequestHelpWhatsAppText(
  coordinatorName: string,
  chapterName: string,
  meetingDate: string
): string {
  return `Hi ${waBold(coordinatorName)}, query for ${waBold(chapterName)} (${waBold(formatShortDate(meetingDate))}).`;
}

export const MEMBER_NOTE_TYPE_OPTIONS: ReadonlyArray<{
  value: MemberNoteType;
  label: string;
  placeholder: string;
}> = [
  {
    value: 'GENERAL_NOTE',
    label: 'General note',
    placeholder: 'Anything the team member should know',
  },
  {
    value: 'REFERRAL_ROUND',
    label: 'Referral round',
    placeholder: 'Specific referral or ask to mention during the referral round',
  },
  {
    value: 'SPECIAL_INSTRUCTION',
    label: 'Special instruction',
    placeholder: 'Any special instruction to follow during this meeting',
  },
];

export function getMemberNoteTypeLabel(noteType?: MemberNoteType): string {
  return MEMBER_NOTE_TYPE_OPTIONS.find((o) => o.value === noteType)?.label ?? 'General note';
}

/** Concise member note / referral round share to a confirmed Veloctive Team member (zero member identity). */
export function buildReferralAskWhatsAppText(
  chapterName: string,
  meetingDate: string,
  referralAsk: string,
  noteType?: MemberNoteType
): string {
  const label = getMemberNoteTypeLabel(noteType);
  return `${waBold(chapterName)} · ${waBold(formatShortDate(meetingDate))}\n${label}: ${waBold(referralAsk)}`;
}

export function buildMemberConfirmationWhatsAppText(input: {
  chapterName: string;
  meetingDate: string;
  reportingTime: string;
  attendeeName: string;
  coordinatorName: string;
}): string {
  return `Confirmed for ${waBold(input.chapterName)} on ${waBold(formatShortDate(input.meetingDate))} (${waBold(input.reportingTime)}): ${waBold(input.attendeeName)}. Contact ${waBold(input.coordinatorName)} for updates.`;
}

export function buildMemberCheckinWhatsAppText(memberName: string, chapterName: string): string {
  return `Hi ${waBold(memberName)}, checking in for ${waBold(chapterName)}.`;
}

export function buildTeamAvailabilityWhatsAppText(substituteName: string): string {
  return `Hi ${waBold(substituteName)}, are you available for tomorrow's meeting?`;
}

export function buildMemberReminderWhatsAppText(input: {
  memberName: string;
  items: Array<{ meetingDate: string; chapterName: string; dueAmount: number }>;
  totalOutstanding: number;
}): string {
  const lines = input.items
    .filter((i) => i.dueAmount > 0)
    .map(
      (i) =>
        `• ${waBold(formatShortDate(i.meetingDate))} · ${waBold(i.chapterName)} — ${waBold(formatINR(i.dueAmount))}`
    );
  return [
    `Hi ${waBold(input.memberName)}, pending statement:`,
    ...(lines.length > 0 ? lines : ['All settled.']),
    `Due: ${waBold(formatINR(input.totalOutstanding))}`,
  ].join('\n');
}

export function buildPayoutSummaryWhatsAppText(input: {
  substituteName: string;
  items: Array<{ meetingDate: string; chapterName: string; amount: number }>;
  bonusesTotal: number;
  outstanding: number;
}): string {
  const lines = input.items.map(
    (i) =>
      `• ${waBold(formatShortDate(i.meetingDate))} · ${waBold(i.chapterName)} — ${waBold(formatINR(i.amount))}`
  );
  return [
    `Hi ${waBold(input.substituteName)}, payout summary:`,
    ...(lines.length > 0 ? lines : ['No pending items.']),
    ...(input.bonusesTotal > 0 ? [`Bonus: ${waBold(formatINR(input.bonusesTotal))}`] : []),
    `Balance: ${waBold(formatINR(input.outstanding))}`,
  ].join('\n');
}

export interface NotificationDestination {
  tab: 'home' | 'requests' | 'finance' | 'reports' | 'open' | 'meetings' | 'earnings';
  requestId?: string;
  requestStatus?: 'ALL' | 'OPEN' | 'CONFIRMED' | 'DISPUTED';
  financeTab?: 'receipts' | 'payments' | 'commissions';
  openRequestId?: string;
  assignmentId?: string;
}

/**
 * Pure deep-link resolver for clickable in-app notifications.
 * Maps any notification category + relatedId to the exact screen & record for the active role.
 */
export function resolveNotificationDestination(
  notification: {
    category: 'REQUEST' | 'ASSIGNMENT' | 'CHECKIN' | 'FINANCE' | 'DISPUTE' | 'MILESTONE' | 'ISSUE';
    title: string;
    body: string;
    relatedId?: string;
  },
  role: 'SUPER_ADMIN' | 'EXTERNAL_COORDINATOR' | 'SUBSTITUTE',
  context: {
    requests?: Array<{ id: string }>;
    assignments?: Array<{ id: string; requestId: string }>;
    openRequests?: Array<{ id: string }>;
  }
): NotificationDestination {
  const relatedId = notification.relatedId?.trim();
  const text = `${notification.title} ${notification.body}`.toLowerCase();

  if (role === 'SUBSTITUTE') {
    if (notification.category === 'FINANCE') {
      return { tab: 'earnings' };
    }
    if (notification.category === 'MILESTONE') {
      return { tab: 'home' };
    }
    if (notification.category === 'REQUEST') {
      const openMatch = relatedId && context.openRequests?.some((r) => r.id === relatedId);
      if (openMatch) {
        return { tab: 'open', openRequestId: relatedId };
      }
      const asgnByReq = relatedId && context.assignments?.find((a) => a.requestId === relatedId);
      if (asgnByReq) {
        return { tab: 'meetings', assignmentId: asgnByReq.id };
      }
      return { tab: 'open', openRequestId: relatedId };
    }
    // ASSIGNMENT, CHECKIN, ISSUE, DISPUTE
    const asgnMatch = relatedId
      ? (context.assignments?.find((a) => a.id === relatedId) ??
        context.assignments?.find((a) => a.requestId === relatedId))
      : undefined;
    return {
      tab: 'meetings',
      assignmentId: asgnMatch?.id ?? relatedId,
    };
  }

  // SUPER_ADMIN or EXTERNAL_COORDINATOR
  if (notification.category === 'FINANCE') {
    if (text.includes('commission')) {
      return { tab: 'finance', financeTab: 'commissions' };
    }
    if (text.includes('payout') || text.includes('bonus') || text.includes('payable')) {
      return { tab: 'finance', financeTab: 'payments' };
    }
    return { tab: 'finance', financeTab: 'receipts' };
  }

  if (notification.category === 'MILESTONE') {
    return { tab: 'reports' };
  }

  // Resolve relatedId to a requestId (either directly a request id or via assignment.requestId)
  let resolvedRequestId: string | undefined;
  if (relatedId) {
    if (context.requests?.some((r) => r.id === relatedId)) {
      resolvedRequestId = relatedId;
    } else {
      const linkedAsgn = context.assignments?.find((a) => a.id === relatedId);
      if (linkedAsgn && (!context.requests || context.requests.some((r) => r.id === linkedAsgn.requestId))) {
        resolvedRequestId = linkedAsgn.requestId;
      }
    }
  }

  if (notification.category === 'DISPUTE') {
    return {
      tab: 'requests',
      requestId: resolvedRequestId,
      requestStatus: resolvedRequestId ? 'ALL' : 'DISPUTED',
    };
  }

  return {
    tab: 'requests',
    requestId: resolvedRequestId,
    requestStatus: 'ALL',
  };
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

export interface ChapterMemberSearchResult {
  ready: boolean;
  chapters: Chapter[];
  members: Array<{ member: Member; chapterName: string }>;
}

/**
 * Pure typeahead matcher for New Request creation:
 * Strictly requires at least 3 non-whitespace characters before surfacing
 * matching Chapters or active Members (matched by member name, business, or chapter name).
 */
export function filterChapterAndMemberMatches(
  rawQuery: string,
  chapters: Chapter[],
  members: Member[],
  scopedChapterId?: string
): ChapterMemberSearchResult {
  const query = (rawQuery || '').trim().toLowerCase();
  if (query.length < 3) {
    return { ready: false, chapters: [], members: [] };
  }

  const activeChapters = chapters.filter((c) => c.active);
  const chapterById = new Map(chapters.map((c) => [c.id, c]));

  const matchedChapters = scopedChapterId
    ? []
    : activeChapters.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.region.toLowerCase().includes(query) ||
          c.regularWeekday.toLowerCase().includes(query)
      );

  const matchedMembers = members
    .filter((m) => m.active && (!scopedChapterId || m.chapterId === scopedChapterId))
    .map((m) => ({
      member: m,
      chapterName: chapterById.get(m.chapterId)?.name ?? 'Chapter',
    }))
    .filter(
      ({ member, chapterName }) =>
        member.name.toLowerCase().includes(query) ||
        member.businessName.toLowerCase().includes(query) ||
        member.businessCategory.toLowerCase().includes(query) ||
        chapterName.toLowerCase().includes(query)
    );

  return {
    ready: true,
    chapters: matchedChapters.slice(0, 6),
    members: matchedMembers.slice(0, 12),
  };
}

export interface AdminQuickSummaryMetrics {
  pendingRequestsCount: number;
  pendingResponsesCount: number;
  unfilledPositionsCount: number;
  urgentUnfilledRequestsCount: number;
  outstandingInvoicesAmount: number;
  outstandingInvoicesCount: number;
  payablesDueAmount: number;
  tomorrowConfirmedCount: number;
  tomorrowCheckedInCount: number;
  activeDisputesCount: number;
}

/**
 * Deterministic Quick Summary aggregator for Admin & Coordinator dashboards.
 */
export function computeAdminQuickSummary(input: {
  today: string;
  tomorrow: string;
  requests: Array<{
    id: string;
    status: string;
    meetingDate: string;
    positionsRequired: number;
    urgency: 'NORMAL' | 'URGENT';
  }>;
  responses: Array<{ status: string }>;
  assignments: Assignment[];
  clientCharges: ClientCharge[];
  substituteEarnings: SubstituteEarning[];
}): AdminQuickSummaryMetrics {
  const openRequests = input.requests.filter(
    (r) => (r.status === 'OPEN' || r.status === 'AWAITING_SELECTION') && r.meetingDate >= input.today
  );

  let unfilledPositionsCount = 0;
  for (const req of openRequests) {
    const liveFilled = input.assignments.filter(
      (a) => a.requestId === req.id && !['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)
    ).length;
    unfilledPositionsCount += Math.max(0, req.positionsRequired - liveFilled);
  }

  const pendingResponsesCount = input.responses.filter(
    (r) => r.status === 'PENDING' || r.status === 'AWAITING_APPROVAL'
  ).length;

  const unpaidCharges = input.clientCharges.filter(
    (c) => c.status !== 'ADJUSTED' && Math.max(0, c.amount - c.receivedAmount) > 0
  );
  const outstandingInvoicesAmount = unpaidCharges.reduce(
    (sum, c) => sum + Math.max(0, c.amount - c.receivedAmount),
    0
  );

  const payablesDueAmount = input.substituteEarnings
    .filter((e) => e.status !== 'ADJUSTED' || e.amount > 0)
    .reduce((sum, e) => sum + Math.max(0, e.amount - e.paidAmount), 0);

  const tomorrowConfirmed = input.assignments.filter(
    (a) => a.meetingDate === input.tomorrow && !['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)
  );
  const tomorrowCheckedInCount = tomorrowConfirmed.filter(
    (a) => a.checkinState !== 'AWAITING_REPLY'
  ).length;

  const activeDisputesCount = input.assignments.filter(
    (a) => a.disputed && !a.disputeResolvedAt
  ).length;

  return {
    pendingRequestsCount: openRequests.length,
    pendingResponsesCount,
    unfilledPositionsCount,
    urgentUnfilledRequestsCount: openRequests.filter((r) => r.urgency === 'URGENT').length,
    outstandingInvoicesAmount,
    outstandingInvoicesCount: unpaidCharges.length,
    payablesDueAmount,
    tomorrowConfirmedCount: tomorrowConfirmed.length,
    tomorrowCheckedInCount,
    activeDisputesCount,
  };
}

