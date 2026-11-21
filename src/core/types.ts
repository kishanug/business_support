export type Namespace = 'demo' | 'workspace';

export type Role = 'SUPER_ADMIN' | 'EXTERNAL_COORDINATOR' | 'SUBSTITUTE';

export type Weekday =
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'
  | 'Saturday'
  | 'Sunday';

export type AssignmentMode = 'MULTI_INTEREST' | 'FIRST_CONFIRM' | 'DIRECT';

export type RequestStatus =
  | 'DRAFT'
  | 'OPEN'
  | 'AWAITING_SELECTION'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED_SELF_REPORTED'
  | 'VERIFIED'
  | 'DISPUTED'
  | 'CANCELLED'
  | 'UNFILLED';

export type ResponseType =
  | 'INTERESTED'
  | 'NOT_AVAILABLE'
  | 'BID'
  | 'FIRST_CONFIRM'
  | 'DELEGATE_PROPOSAL';

export type ResponseStatus =
  | 'PENDING'
  | 'AWAITING_APPROVAL'
  | 'SELECTED'
  | 'NOT_SELECTED'
  | 'FILLED'
  | 'WITHDRAWN'
  | 'REJECTED';

export type AssignmentStatus =
  | 'CONFIRMED'
  | 'AWAKE'
  | 'LEFT_HOME'
  | 'REACHED'
  | 'COMPLETED_SELF_REPORTED'
  | 'VERIFIED'
  | 'DISPUTED'
  | 'UNDER_REVIEW'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'REPLACED';

export type CheckinType = 'AWAKE' | 'LEFT_HOME' | 'REACHED' | 'FINISH';

export type DelegationStatus = 'NONE' | 'PROPOSED' | 'AWAITING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'REPLACED';

export type FinanceStatus = 'OUTSTANDING' | 'PARTIALLY_PAID' | 'FULLY_PAID' | 'ADJUSTED' | 'ON_HOLD';

export type PaymentMethod = 'UPI' | 'BANK_TRANSFER' | 'CASH' | 'CHEQUE';

export type MessageDeliveryState = 'PREPARED' | 'OPENED' | 'MANUALLY_SENT';

export type ReceivedFromType =
  | 'DIRECT_MEMBER'
  | 'EXTERNAL_COORDINATOR'
  | 'SUBSTITUTE'
  | 'EXCHANGE'
  | 'OTHER';

export type ActualAttendeeType = 'REGISTERED_SUBSTITUTE' | 'GUEST';

export interface UserAccount {
  id: string;
  namespace: Namespace;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  displayName: string;
  role: Role;
  coordinatorId?: string;
  substituteId?: string;
  canManageNetwork?: boolean;
  active: boolean;
  invitedBy?: string;
  inviteToken?: string;
  resetToken?: string;
  createdAt: string;
}

export interface SessionUser {
  id: string;
  namespace: Namespace;
  email: string;
  displayName: string;
  role: Role;
  coordinatorId?: string;
  substituteId?: string;
  canManageNetwork: boolean;
  active: boolean;
}

export interface Coordinator {
  id: string;
  namespace: Namespace;
  userId: string;
  name: string;
  email: string;
  callingPhone: string;
  whatsappPhone: string;
  region: string;
  isSuperAdmin: boolean;
  defaultMemberFee: number;
  defaultSubstitutePayout: number;
  active: boolean;
  createdAt: string;
}

export interface Location {
  id: string;
  namespace: Namespace;
  coordinatorId?: string; // undefined = shared org master
  name: string;
  area: string;
  fullAddress: string;
  mapsUrl: string;
  nearestStation: string;
  transportGuidance: string;
  entryNotes: string;
  active: boolean;
  createdAt: string;
}

export interface Chapter {
  id: string;
  namespace: Namespace;
  coordinatorId?: string;
  name: string;
  region: string;
  regularWeekday: Weekday; // Saved informational weekday ONLY; never coupled to date default
  reportingTime: string;
  startTime: string;
  endTime: string;
  defaultLocationId: string;
  alternateLocationIds: string[];
  defaultMemberFee: number;
  defaultSubstitutePayout: number;
  usualInstructions: string;
  active: boolean;
  createdAt: string;
}

export interface Member {
  id: string;
  namespace: Namespace;
  coordinatorId: string;
  name: string;
  chapterId: string;
  preferredLocationId?: string;
  phone: string;
  whatsappPhone: string;
  email?: string;
  businessName: string;
  businessCategory: string;
  intro30Sec: string;
  referralAsk: string;
  standardFee: number;
  notes: string;
  photoUrl?: string;
  communicationConsent: boolean;
  active: boolean;
  createdAt: string;
}

export interface Substitute {
  id: string;
  namespace: Namespace;
  userId: string;
  name: string;
  email: string;
  phone: string;
  whatsappPhone: string;
  homeArea: string;
  preferredAreas: string[];
  preferredChapterIds: string[];
  defaultPayout: number;
  upiReference?: string; // Private to authorized finance/admin & self
  availability: 'AVAILABLE' | 'LIMITED' | 'UNAVAILABLE';
  canManageNetwork: boolean;
  emergencyContactName?: string; // Private, consent-gated
  emergencyContactPhone?: string;
  emergencyConsent: boolean;
  notes: string;
  introducedByCoordinatorId?: string; // Historical recruiting attribution ONLY (distinct from per-assignment coordinator)
  photoUrl?: string;
  verified: boolean;
  active: boolean;
  createdAt: string;
}

export interface PartnerGuestContact {
  id: string;
  namespace: Namespace;
  partnerSubstituteId: string;
  name: string;
  phone: string;
  whatsappPhone?: string;
  homeArea: string;
  preferredAreas?: string;
  notes?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  consentConfirmed: boolean;
  active: boolean;
  createdAt: string;
}

export interface MeetingRequest {
  id: string;
  namespace: Namespace;
  requestNumber: number;
  // Distinct provenance & attribution (never conflated into one field)
  goingForMemberId: string;
  receivedFromType: ReceivedFromType;
  receivedFrom: string;
  createdByUserId: string;
  coordinatorId: string; // Responsible / Owner Coordinator
  sourcedViaCoordinatorId?: string; // Coordinator who sourced/referred this request (if distinct or explicit)
  // Linked master references
  chapterId: string;
  locationId: string;
  // Request-scoped editable snapshots (do not mutate masters)
  meetingDate: string; // YYYY-MM-DD in Asia/Kolkata
  chapterRegularWeekday: Weekday;
  chapterNameSnapshot: string;
  venueNameSnapshot: string;
  areaSnapshot: string;
  addressSnapshot: string;
  mapsUrlSnapshot: string;
  directionsSnapshot: string;
  reportingTime: string;
  startTime: string;
  endTime: string;
  intro30SecSnapshot: string;
  memberNameSnapshot: string;
  memberBusinessSnapshot: string;
  memberPhoneSnapshot: string;
  // Mode & capacity
  assignmentMode: AssignmentMode;
  requireManagerApproval: boolean;
  allowBids: boolean;
  positionsRequired: number;
  memberFee: number;
  offeredPayout: number;
  // Optional separately-approved agency coordinator commission (₹0 by default; never invented)
  coordinatorCommissionEnabled: boolean;
  coordinatorCommissionAmount: number;
  urgency: 'NORMAL' | 'URGENT';
  specialInstructions: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RequestResponse {
  id: string;
  namespace: Namespace;
  requestId: string;
  substituteId: string;
  responseType: ResponseType;
  proposedPayout?: number;
  delegatedGuestId?: string;
  delegatedGuestName?: string;
  note?: string;
  status: ResponseStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingReportNotes {
  referralsGiven?: string;
  peopleMet?: string;
  highlights?: string;
  issues?: string;
  earlyFinishReason?: string;
}

export interface Assignment {
  id: string;
  namespace: Namespace;
  requestId: string;
  coordinatorId: string; // Responsible coordinator snapshot
  assignedViaCoordinatorId: string; // Coordinator credited with arranging this confirmed booking
  confirmedByUserId: string; // Actual actor who approved/confirmed
  approvedAt?: string;
  goingForMemberId: string;
  chapterId: string;
  meetingDate: string;
  slotIndex: number;
  // Accountability invariant: distinct contractual payee vs physical attendee
  contractSubstituteId: string;
  payeeSubstituteId: string; // Always equals contractSubstituteId
  actualAttendeeType: ActualAttendeeType;
  actualAttendeeGuestId?: string;
  actualAttendeeName: string;
  actualAttendeePhone?: string;
  isDelegated: boolean;
  delegationStatus: DelegationStatus;
  replacedAssignmentId?: string;
  replacementReason?: string;
  // Contractual pricing snapshot per fulfilled position
  memberFee: number;
  agreedPayout: number;
  coordinatorCommissionAmount: number; // ₹0 unless explicitly pre-approved on request/assignment
  status: AssignmentStatus;
  checkinState: 'AWAITING_REPLY' | 'AWAKE' | 'LEFT_HOME' | 'REACHED' | 'FINISHED';
  lastCheckinAt?: string;
  lastCheckinReportedByPartner: boolean;
  finishedAt?: string;
  finishIdempotencyKey?: string;
  finishedByUserId?: string;
  finishedReportedByPartner: boolean;
  meetingNotes?: MeetingReportNotes;
  verifiedAt?: string;
  verifiedByUserId?: string;
  disputed: boolean;
  disputeReason?: string;
  disputeResolvedAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CheckinEvent {
  id: string;
  namespace: Namespace;
  assignmentId: string;
  eventType: CheckinType;
  reportedByUserId: string;
  reportedByPartner: boolean;
  actualAttendeeName: string;
  note?: string;
  createdAt: string;
}

export interface ClientCharge {
  id: string;
  namespace: Namespace;
  assignmentId: string; // Unique source assignment
  requestId: string;
  coordinatorId: string; // Responsible coordinator
  assignedViaCoordinatorId: string;
  memberId: string;
  contractSubstituteId: string;
  chapterName: string;
  meetingDate: string;
  actualAttendeeName: string;
  isDelegated: boolean;
  amount: number;
  receivedAmount: number;
  status: FinanceStatus;
  adjustmentNote?: string;
  createdAt: string;
}

export interface SubstituteEarning {
  id: string;
  namespace: Namespace;
  assignmentId: string; // Unique source assignment
  requestId: string;
  coordinatorId: string;
  assignedViaCoordinatorId: string;
  assignedViaCoordinatorName: string;
  memberId: string;
  memberName: string;
  payeeSubstituteId: string; // Registered substitute / partner only
  actualAttendeeName: string;
  isDelegated: boolean;
  chapterName: string;
  meetingDate: string;
  amount: number;
  paidAmount: number;
  status: FinanceStatus;
  adjustmentNote?: string;
  createdAt: string;
}

export interface CoordinatorCommission {
  id: string;
  namespace: Namespace;
  assignmentId: string; // Unique per assignment when explicitly approved
  requestId: string;
  coordinatorId: string; // Beneficiary coordinator
  memberId: string;
  memberName: string;
  chapterName: string;
  meetingDate: string;
  actualAttendeeName: string;
  amount: number;
  paidAmount: number;
  status: FinanceStatus;
  paymentDate?: string;
  paymentMethod?: PaymentMethod;
  paymentReference?: string;
  createdAt: string;
}

export interface ReceiptAllocation {
  chargeId: string;
  amount: number;
}

export interface ClientReceipt {
  id: string;
  namespace: Namespace;
  coordinatorId: string;
  memberId: string;
  amount: number;
  paymentDate: string;
  method: PaymentMethod;
  reference: string;
  notes?: string;
  allocations: ReceiptAllocation[];
  actorUserId: string;
  idempotencyKey?: string;
  reversed?: boolean;
  reversalReason?: string;
  createdAt: string;
}

export interface PayoutAllocation {
  earningId: string;
  amount: number;
}

export interface AppreciationBonus {
  id: string;
  namespace: Namespace;
  payoutId: string;
  coordinatorId: string;
  payeeSubstituteId: string;
  amount: number;
  message: string;
  idempotencyKey?: string;
  createdAt: string;
}

export interface FreelancerPayout {
  id: string;
  namespace: Namespace;
  coordinatorId: string;
  payeeSubstituteId: string;
  amount: number; // Cash allocated toward meeting earnings
  bonusAmount: number; // Optional discretionary appreciation bonus (agency cost, not member charge)
  bonusMessage?: string;
  totalTransferred: number;
  paymentDate: string;
  method: PaymentMethod;
  reference: string;
  notes?: string;
  allocations: PayoutAllocation[];
  actorUserId: string;
  idempotencyKey?: string;
  reversed?: boolean;
  reversalReason?: string;
  createdAt: string;
}

export interface LedgerAdjustment {
  id: string;
  namespace: Namespace;
  coordinatorId: string;
  targetType: 'CLIENT_CHARGE' | 'SUBSTITUTE_EARNING' | 'CLIENT_RECEIPT' | 'FREELANCER_PAYOUT';
  targetId: string;
  deltaAmount: number;
  reason: string;
  actorUserId: string;
  createdAt: string;
}

export interface MilestoneReward {
  id: string;
  namespace: Namespace;
  substituteId: string;
  targetCount: number;
  rewardAmount: number;
  status: 'UNLOCKED' | 'APPROVED' | 'PAID';
  approvedByUserId?: string;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  namespace: Namespace;
  recipientUserId: string;
  title: string;
  body: string;
  category: 'REQUEST' | 'ASSIGNMENT' | 'CHECKIN' | 'FINANCE' | 'DISPUTE' | 'MILESTONE';
  read: boolean;
  relatedId?: string;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  namespace: Namespace;
  coordinatorId?: string;
  actorUserId: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  reason?: string;
  createdAt: string;
}

export interface MessageLog {
  id: string;
  namespace: Namespace;
  coordinatorId?: string;
  actorUserId: string;
  templateType: string;
  recipientLabel: string;
  recipientPhone: string;
  body: string;
  deliveryState: MessageDeliveryState;
  createdAt: string;
  updatedAt: string;
}

/** Public sanitized request view for unconfirmed substitutes */
export interface PublicOpenRequestCard {
  id: string;
  requestNumber: number;
  chapterId: string;
  chapterName: string;
  area: string;
  venueName: string;
  meetingDate: string;
  chapterRegularWeekday: Weekday;
  reportingTime: string;
  startTime: string;
  endTime: string;
  assignmentMode: AssignmentMode;
  requireManagerApproval: boolean;
  allowBids: boolean;
  positionsRequired: number;
  filledPositions: number;
  offeredPayout: number;
  urgency: 'NORMAL' | 'URGENT';
  status: RequestStatus;
  specialInstructions: string;
  coordinatorName: string;
  coordinatorCallingPhone: string;
  coordinatorWhatsappPhone: string;
  myResponse?: RequestResponse;
  myAssignmentId?: string;
  // NOTE: memberName, memberPhone, intro30Sec, memberBusiness, exact address/maps are intentionally OMITTED until confirmed!
}
