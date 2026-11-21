import type {
  AppreciationBonus,
  Assignment,
  AuditEvent,
  Chapter,
  CheckinEvent,
  ClientCharge,
  ClientReceipt,
  Coordinator,
  CoordinatorCommission,
  FreelancerPayout,
  LedgerAdjustment,
  Location,
  MeetingRequest,
  Member,
  MessageDeliveryState,
  MessageLog,
  MilestoneReward,
  NotificationItem,
  PartnerGuestContact,
  PublicOpenRequestCard,
  RequestResponse,
  Role,
  SessionUser,
  Substitute,
  SubstituteEarning,
} from '../core/types';
import type { FinanceSummary } from '../core/rules';

// Session Bearer token held strictly in JS memory (never localStorage or sessionStorage)
let memoryToken: string | null = null;

export function setAuthToken(token: string | null) {
  memoryToken = token;
}

export function getAuthToken(): string | null {
  return memoryToken;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (memoryToken) {
    headers.Authorization = `Bearer ${memoryToken}`;
  }
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data.code || 'REQUEST_FAILED', data.error || 'Request failed');
  }
  return data as T;
}

export interface AuthStatusResponse {
  workspaceInitialized: boolean;
  supabaseConnected: boolean;
  environmentMode: string;
}

export interface ManagedUserSummary {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  coordinatorId?: string;
  substituteId?: string;
  canManageNetwork: boolean;
  active: boolean;
  hasPendingInvite: boolean;
  createdAt: string;
}

export interface CoordinatorDirectoryItem {
  id: string;
  name: string;
  isSuperAdmin: boolean;
}

export interface AdminBootstrapData {
  actor: SessionUser;
  today: string;
  tomorrow: string;
  coordinators: Coordinator[];
  coordinatorDirectory: CoordinatorDirectoryItem[];
  managedUsers: ManagedUserSummary[];
  locations: Location[];
  chapters: Chapter[];
  members: Member[];
  substitutes: Substitute[];
  partnerGuestContacts: PartnerGuestContact[];
  requests: MeetingRequest[];
  responses: RequestResponse[];
  assignments: Assignment[];
  checkins: CheckinEvent[];
  clientCharges: ClientCharge[];
  substituteEarnings: SubstituteEarning[];
  coordinatorCommissions: CoordinatorCommission[];
  clientReceipts: ClientReceipt[];
  freelancerPayouts: FreelancerPayout[];
  appreciationBonuses: AppreciationBonus[];
  ledgerAdjustments: LedgerAdjustment[];
  financeSummary: FinanceSummary;
  milestoneTargets: ReadonlyArray<{ count: number; label: string; defaultReward: number }>;
  milestoneRewards: MilestoneReward[];
  notifications: NotificationItem[];
  auditEvents: AuditEvent[];
  messageLogs: MessageLog[];
}

export interface ConfirmedBriefingItem {
  assignment: Assignment;
  requestNumber: number;
  chapterName: string;
  chapterRegularWeekday: string;
  venueName: string;
  area: string;
  address: string;
  mapsUrl: string;
  directions: string;
  reportingTime: string;
  startTime: string;
  endTime: string;
  memberName: string;
  memberBusiness: string;
  intro30Sec: string;
  specialInstructions: string;
  coordinatorName: string;
  assignedViaCoordinatorId: string;
  assignedViaCoordinatorName: string;
  coordinatorCallingPhone: string;
  coordinatorWhatsappPhone: string;
}

export interface ViaCoordinatorSummaryItem {
  coordinatorId: string;
  coordinatorName: string;
  totalMeetings: number;
  completedMeetings: number;
  totalEarned: number;
  paidAmount: number;
  remainingAmount: number;
}

export interface SubstituteBootstrapData {
  actor: SessionUser;
  today: string;
  tomorrow: string;
  substituteProfile?: Substitute;
  openRequests: PublicOpenRequestCard[];
  confirmedBriefings: ConfirmedBriefingItem[];
  myResponses: RequestResponse[];
  myAssignments: Assignment[];
  myEarnings: SubstituteEarning[];
  myPayouts: FreelancerPayout[];
  myBonuses: AppreciationBonus[];
  myGuestContacts: PartnerGuestContact[];
  viaCoordinatorSummary: ViaCoordinatorSummaryItem[];
  milestone: {
    validCompletions: number;
    nextMilestone: { count: number; label: string; defaultReward: number };
    remaining: number;
    progressPercent: number;
    unlockedTargets: ReadonlyArray<{ count: number; label: string; defaultReward: number }>;
  };
  myRewards: MilestoneReward[];
  notifications: NotificationItem[];
}

export type BootstrapPayload = AdminBootstrapData | SubstituteBootstrapData;

export const api = {
  getAuthStatus: () => requestJson<AuthStatusResponse>('/api/auth/status'),
  bootstrapAdmin: (body: { email: string; password: string; displayName: string; callingPhone: string }) =>
    requestJson<{ token: string; user: SessionUser }>('/api/auth/bootstrap-admin', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  login: (email: string, password: string) =>
    requestJson<{ token: string; user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  demoLogin: (roleKey: 'SA' | 'EC' | 'SUB') =>
    requestJson<{ token: string; user: SessionUser }>('/api/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ roleKey }),
    }),
  forgotPassword: (email: string) =>
    requestJson<{ resetToken?: string; message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (email: string, token: string, newPassword: string) =>
    requestJson<{ ok: boolean }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, token, newPassword }),
    }),
  acceptInvite: (email: string, inviteToken: string, password: string) =>
    requestJson<{ token: string; user: SessionUser }>('/api/auth/accept-invite', {
      method: 'POST',
      body: JSON.stringify({ email, inviteToken, password }),
    }),
  logout: () => requestJson<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  getBootstrap: () => requestJson<BootstrapPayload>('/api/bootstrap'),
  resetDemo: () => requestJson<BootstrapPayload>('/api/demo/reset', { method: 'POST' }),
  clearTestingTransactions: () =>
    requestJson<{ clearedRequests: number; clearedAssignments: number }>('/api/admin/clear-transactions', {
      method: 'POST',
    }),
  deleteEntity: (entityType: 'member' | 'substitute' | 'request' | 'chapter' | 'location', entityId: string) =>
    requestJson<{ deleted: boolean; entityType: string; entityId: string }>(
      `/api/admin/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
      { method: 'DELETE' }
    ),

  inviteUser: (body: Record<string, unknown>) =>
    requestJson<{ userId: string; inviteToken?: string; passwordConfigured: boolean }>('/api/users/invite', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminResetUserPassword: (userId: string, newPassword?: string) =>
    requestJson<{ userId: string; email: string; resetToken?: string; passwordUpdated: boolean }>(
      `/api/users/${encodeURIComponent(userId)}/admin-reset-password`,
      {
        method: 'POST',
        body: JSON.stringify({ newPassword }),
      }
    ),
  setUserStatus: (userId: string, active: boolean) =>
    requestJson<{ ok: boolean }>(`/api/users/${encodeURIComponent(userId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    }),

  upsertLocation: (body: Record<string, unknown>) =>
    requestJson<Location>('/api/locations', { method: 'POST', body: JSON.stringify(body) }),
  upsertChapter: (body: Record<string, unknown>) =>
    requestJson<Chapter>('/api/chapters', { method: 'POST', body: JSON.stringify(body) }),
  upsertMember: (body: Record<string, unknown>) =>
    requestJson<Member>('/api/members', { method: 'POST', body: JSON.stringify(body) }),
  upsertSubstitute: (body: Record<string, unknown>) =>
    requestJson<{ substitute: Substitute; inviteToken?: string; passwordConfigured?: boolean }>('/api/substitutes', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  upsertPartnerGuest: (body: Record<string, unknown>) =>
    requestJson<PartnerGuestContact>('/api/partner-guests', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createRequest: (body: Record<string, unknown>) =>
    requestJson<{ request: MeetingRequest; directAssignments: Assignment[] }>('/api/requests', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  cancelRequest: (requestId: string, reason: string) =>
    requestJson<MeetingRequest>(`/api/requests/${encodeURIComponent(requestId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  submitResponse: (requestId: string, body: Record<string, unknown>) =>
    requestJson<{ response: RequestResponse; assignment?: Assignment; autoConfirmed: boolean }>(
      `/api/requests/${encodeURIComponent(requestId)}/respond`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
  approveResponse: (
    responseId: string,
    overrideOrOpts?:
      | number
      | { overridePayout?: number; assignedViaCoordinatorId?: string; coordinatorCommissionAmount?: number }
  ) =>
    requestJson<Assignment>(`/api/responses/${encodeURIComponent(responseId)}/approve`, {
      method: 'POST',
      body: JSON.stringify(
        typeof overrideOrOpts === 'number' ? { overridePayout: overrideOrOpts } : (overrideOrOpts ?? {})
      ),
    }),
  rejectResponse: (responseId: string, reason?: string) =>
    requestJson<RequestResponse>(`/api/responses/${encodeURIComponent(responseId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  requestResponseChanges: (responseId: string, reason: string) =>
    requestJson<RequestResponse>(`/api/responses/${encodeURIComponent(responseId)}/request-changes`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  replaceAssignment: (
    assignmentId: string,
    body: { reason: string; replacementSubstituteId?: string; replacementGuestId?: string; agreedPayout?: number }
  ) =>
    requestJson<{ replacedAssignment: Assignment; replacementAssignment?: Assignment }>(
      `/api/assignments/${encodeURIComponent(assignmentId)}/replace`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    ),

  recordCheckin: (assignmentId: string, eventType: 'AWAKE' | 'LEFT_HOME' | 'REACHED', note?: string) =>
    requestJson<Assignment>(`/api/assignments/${encodeURIComponent(assignmentId)}/checkin`, {
      method: 'POST',
      body: JSON.stringify({ eventType, note }),
    }),
  finishAssignment: (assignmentId: string, body: Record<string, unknown>) =>
    requestJson<{
      assignment: Assignment;
      clientCharge: ClientCharge;
      substituteEarning: SubstituteEarning;
      coordinatorCommission?: CoordinatorCommission;
      idempotentReplay: boolean;
    }>(`/api/assignments/${encodeURIComponent(assignmentId)}/finish`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  verifyAssignment: (assignmentId: string) =>
    requestJson<Assignment>(`/api/assignments/${encodeURIComponent(assignmentId)}/verify`, {
      method: 'POST',
    }),
  disputeAssignment: (assignmentId: string, reason: string, holdSettlement = true) =>
    requestJson<Assignment>(`/api/assignments/${encodeURIComponent(assignmentId)}/dispute`, {
      method: 'POST',
      body: JSON.stringify({ reason, holdSettlement }),
    }),
  adjustDisputedLedger: (assignmentId: string, chargeDelta: number, earningDelta: number, reason: string) =>
    requestJson(`/api/assignments/${encodeURIComponent(assignmentId)}/adjust`, {
      method: 'POST',
      body: JSON.stringify({ chargeDelta, earningDelta, reason }),
    }),

  recordReceipt: (body: Record<string, unknown>) =>
    requestJson<{ receipt: ClientReceipt; idempotentReplay: boolean }>('/api/finance/receipts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  recordPayout: (body: Record<string, unknown>) =>
    requestJson<{ payout: FreelancerPayout; idempotentReplay: boolean }>('/api/finance/payouts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  recordCommissionPayout: (
    commissionId: string,
    body: { amount: number; paymentDate: string; method: string; reference: string }
  ) =>
    requestJson<CoordinatorCommission>(`/api/finance/commissions/${encodeURIComponent(commissionId)}/pay`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  logMessage: (body: {
    templateType: string;
    recipientLabel: string;
    recipientPhone: string;
    body: string;
    deliveryState: MessageDeliveryState;
    existingId?: string;
  }) => requestJson<MessageLog>('/api/messages/log', { method: 'POST', body: JSON.stringify(body) }),
  markNotificationRead: (notificationId: string) =>
    requestJson(`/api/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST' }),
};
